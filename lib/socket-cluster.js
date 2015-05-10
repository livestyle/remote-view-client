'use strict';

var net = require('net');
var http = require('http');
var urlUtils = require('url');
var EventEmitter = require('events').EventEmitter;
var extend = require('xtend');
var debug = require('debug')('rv-client');
var proxy = require('./proxy');
var utils = require('./utils');

var defaultOptions = {
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
		super();
		debug('creating cluster');
		this.options = extend({}, defaultOptions, options || {});
		if ('url' in this.options) {
			this.options.url = connectionOptions(this.options.url);
		}

		this.sockets = [];
		this._state = STATE_IDLE;

		// setup idle state: close all sockets except one
		// after a period of inactivity to save resources
		this._idleTimer = utils.timer(function() {
			if (this.state === STATE_ACTIVE) {
				debug('going to idle state');
				// keep only one connected socket, save some resources
				while (this.sockets.length > 1) {
					this.sockets.pop().end();
				}
				this.state = STATE_IDLE;
			}
		}.bind(this), this.options.idleTimeout);

		this._idleTimer.start();
		this.on('data', this._idleTimer.restart);
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

	createSocket() {
		if (this.state === STATE_DESTROYED) {
			return;
		}

		var url = this.options.url;
		var self = this;

		var remove = function(client) {
			utils.removeFromArray(self.sockets, client);
			client.removeListener('data', onData);
			client.removeListener('error', onError);
		};

		var onData = function(data) {
			self.emit('data', client, data);
			self.state = STATE_ACTIVE;
			self.fill();
		};

		var onError = function(err) {
			debug('got error %s', err);
			remove(client);
			self.emit('error', err);
			// TODO detect what kind of errors may occur and re-create 
			// sockets if required
		};

		var client = net.connect(connectionOptions(url), function() {
			debug('connected to server, total sockets: ' + self.sockets.length);
			self.emit('connect', client);
		})
		.on('data', onData)
		.once('error', onError)
		.once('close', function(hadErr) {
			debug('client closed, total sockets: ' + self.sockets.length);
			remove(client);
			self.emit('close', client);
			self.fill();
		});

		self.sockets.push(client);
		return proxy(client);
	}

	/**
	 * Fills cluster with maximum amount of available socket connections
	 */
	fill() {
		var max = 0;
		if (this.state === STATE_IDLE) {
			max = 1;
		} else if (this.state === STATE_ACTIVE) {
			max = this.options.maxConnections;
		}

		debug('fill sockets up to %d (+%d)', max, max - this.sockets.length);
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
		this._idleTimer.stop();
		this._idleTimer = null;
		while (this.sockets.length) {
			this.sockets.pop().end();
		}
		this.removeListener('data', this._idleTimer.restart);
	}
};

module.exports = SocketCluster;