/**
 * A reverse tunnel: creates socket connection to
 * RV server 
 */
'use strict'

var http = require('http');
var https = require('https');
var EventEmitter = require('events');
var urlUtils = require('url');
var debug = require('debug')('rv:client');
var extend = require('xtend');
var through = require('through2');
var proxy = require('./proxy');

module.exports = class Tunnel extends EventEmitter {
	constructor(url, sessionId, callback) {
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

		// a reverse tunnel to RV server
		var connOptions = extend(parseEndpoint(url), {
			method: 'CONNECT',
			path: '/',
			headers: {'X-RV-Session': sessionId}
		});
		var transport = /^https:?$/i.test(connOptions.protocol) ? https : http;

		var req = transport.request(connOptions)
		.on('connect', function(res, socket, head) {
			debug('reverse tunnel connected');
			self.connected = true;

			// tell server we are ready to receive connections
			socket.write('rv-ready');
			
			self.socket = socket
			.on('data', function(chunk) {
				self.emit('activity');
			})
			.once('error', destroy)
			.once('close', function(err) {
				debug('reverse tunnel closed');
				self.destroy(err);
			});

			self.socket
			// proxy requests to local web-server requests
			.pipe(proxy()).on('error', destroy)

			// write proxied data back to remote socket
			.pipe(self.socket);

			process.nextTick(function() {
				self.emit('connect');
			});
		})
		.on('error', function(err) {
			destroy(err);
		});

		req.setNoDelay();
		req.end();

		// var endpoint = parseEndpoint(url);
		// self.socket = transport.connect(endpoint, function() {
		// 	debug('reverse tunnel connected');
		// 	self.connected = true;
		// 	process.nextTick(function() {
		// 		self.emit('connect');
		// 	});
		// })
		// .on('data', function() {
		// 	self.emit('activity');
		// })
		// .once('error', destroy)
		// .once('close', function(err) {
		// 	debug('reverse tunnel closed');
		// 	self.destroy(err);
		// });

		// self.socket
		// // proxy requests to local web-server requests
		// .pipe(proxy())
		// .on('active', function() {
		// 	self._active = true;
		// 	self.emit('active');
		// })
		// .on('error', destroy)

		// // write proxied data back to remote socket
		// .pipe(self.socket);
	}

	get destroyed() {
		return this._destroyed;
	}

	destroy(err) {
		if (!this._destroyed) {
			debug('destroying tunnel');
			this._destroyed = true;
			if (this.socket) {
				if (!this.socket.destroyed) {
					this.socket.destroy();
				}
				this.socket = null;
			}
			this.emit('destroy', err);
		}
		return this;
	}
};

function parseEndpoint(endpoint) {
	if (typeof endpoint === 'number') {
		return {
			port: endpoint,
			rejectUnauthorized: false
		};
	}

	if (typeof endpoint === 'string') {
		endpoint = urlUtils.parse(endpoint);
		return {
			protocol: endpoint.protocol,
			port: endpoint.port,
			host: endpoint.hostname,
			rejectUnauthorized: false
		};
	}

	return endpoint;
}