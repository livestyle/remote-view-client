/**
 * A reverse tunnel: creates socket connection to
 * RV server 
 */
'use strict'

var net = require('net');
var tls = require('tls');
var urlUtils = require('url');
var debug = require('debug')('rv-client');
var EventEmitter = require('events');
var proxy = require('./proxy');

module.exports = class Tunnel extends EventEmitter {
	constructor(url, callback) {
		super();
		this.connected = false;
		this._destroyed = false;
		this._active = false;

		if (typeof callback === 'function') {
			this.once('connect', callback);
		}

		var self = this;
		var destroy = function(err) {
			self.destroy(err);
		};

		var endpoint = parseEndpoint(url);
		var transport = endpoint.protocol === 'https' ? tls : net;
		// a reverse tunnel to RV server
		self.socket = transport.connect(endpoint, function() {
			debug('reverse tunnel connected');
			self.connected = true;
			process.nextTick(function() {
				self.emit('connect');
			});
		})
		.on('data', function() {
			self.emit('activity');
		})
		.once('error', destroy)
		.once('close', function(err) {
			debug('reverse tunnel closed');
			self.destroy(err);
		});

		self.socket
		// proxy requests to local web-server requests
		.pipe(proxy())
		.on('active', function() {
			self._active = true;
			self.emit('active');
		})
		.on('error', destroy)

		// write proxied data back to remote socket
		.pipe(self.socket);
	}

	get active() {
		return this._active;
	}

	get destroyed() {
		return this._destroyed;
	}

	destroy(err) {
		if (!this._destroyed) {
			debug('destroying tunnel');
			this._destroyed = true;
			if (!this.socket.destroyed) {
				this.socket.destroy();
			}
			this.socket = null;
			this.emit('destroy', err);
		}
		return this;
	}
};

function parseEndpoint(endpoint) {
	if (typeof endpoint === 'number') {
		return {port: endpoint};
	}

	if (typeof endpoint === 'string') {
		endpoint = urlUtils.parse(endpoint);
		return {
			protocol: endpoint.protocol.replace(/:$/, '').toLowerCase(),
			port: endpoint.port,
			host: endpoint.hostname,
			rejectUnauthorized: false
		};
	}

	return endpoint;
}