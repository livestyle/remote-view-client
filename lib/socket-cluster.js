'use strict';

var net = require('net');
var http = require('http');
var urlUtils = require('url');
var EventEmitter = require('events').EventEmitter;
var extend = require('xtend');
var debug = require('debug')('rv-client');

var defaultOptions = {
	url: 'http://localhost:9001',
	maxConnections: 2,
	idleTimeout: 5000
};

const STATE_IDLE = 'idle';
const STATE_ACTIVE = 'active';
const STATE_DESTROYED = 'destroyed';

function connectionOptions(data) {
	if (typeof data === 'number') {
		return {port: data};
	}

	if (typeof data === 'string') {
		data = urlUtils.parse(data);
		return {
			port: data.port,
			host: data.hostname
		};
	}

	return data;
}

class SocketCluster extends EventEmitter {
	constructor(options) {
		debug('creaing cluster');
		this.options = extend({}, defaultOptions, options || {});
		if ('url' in this.options) {
			this.options.url = connectionOptions(this.options.url);
		}

		this.sockets = [];
		this._state = STATE_IDLE;

		// setup idle state: close all sockets except one
		// after a period of inactivity to save resources
		var self = this;
		var goToIdle = function() {
			if (self.state === STATE_ACTIVE) {
				debug('going to idle state');
				// keep only one connected socket, save some resources
				while (self.sockets.length > 1) {
					self.sockets.pop().end();
				}
				self.state = STATE_IDLE;
			}
		};

		var resetIdleTimer = function() {
			debug('reset idle timer ' + self._idleTimer);
			self._idleTimer && clearTimeout(self._idleTimer);
			self._idleTimer = setTimeout(goToIdle, self.options.idleTimeout);
		};

		this.on('data', resetIdleTimer);
		resetIdleTimer();
		this.createSocket();
	}

	get state() {
		return this._state;
	}

	set state(value) {
		if (this._state === STATE_DESTROYED) {
			// do not change state if cluster is destroyed
			return;
		}

		if (this._state !== value) {
			this._state = value;
			this.emit('state', value);
		}
	}

	createSocket(url) {
		if (this.state === STATE_DESTROYED) {
			return;
		}

		if (typeof url === 'undefined') {
			url = this.options.url;
		}

		var self = this;
		var remove = function(client) {
			var ix = self.sockets.indexOf(client);
			if (ix !== -1) {
				self.sockets.splice(ix, 1);
			}
		};

		var client = net.connect(connectionOptions(url), function() {
			debug('connected to server, total sockets: ' + self.sockets.length);
			self.emit('connect', client);
		})
		.on('data', function(data) {
			debug('-------');
			debug(data.toString());
			debug('-------');

			self.emit('data', client, data);
			self.state = STATE_ACTIVE;
			self.fill();

			http.get('http://download.emmet.io/hello.txt', function(res) {
				res.pipe(client);
			});
		})
		.on('end', function() {
			self.emit('close', client);
			remove(client);
			debug('client closed, total sockets: ' + self.sockets.length);
			self.fill();
		})
		.on('error', function(err) {
			debug('got error', err);
			remove(client);
			self.emit('error', err);
			// TODO detect what kind of errors may occur and re-create 
			// sockets if required
		});

		self.sockets.push(client);
		return client;
	}

	/**
	 * Fills cluster with maximum amount of available socket connections
	 */
	fill() {
		var max = 0;
		switch (this.state) {
			case STATE_IDLE:
				max = 1;
				break;

			case STATE_ACTIVE:
				max = this.options.maxConnections;
				break;
		}

		while (this.sockets.length < max) {
			this.createSocket();
		}
	}

	/**
	 * Destoys current cluster: closes all socket connections
	 * and do not allow further socket initiation
	 */
	destroy() {
		this.state = STATE_DESTROYED;
		this._idleTimer && clearTimeout(this._idleTimer);
		while (this.sockets.length) {
			this.sockets.pop().end();
		}
	}
};

module.exports = SocketCluster;