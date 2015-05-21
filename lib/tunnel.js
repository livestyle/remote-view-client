/**
 * A reverse tunnel: creates socket connection to
 * RV server 
 */
'use strict'

var http = require('http');
var https = require('https');
var net = require('net');
var tls = require('tls');
var EventEmitter = require('events');
var urlUtils = require('url');
var debug = require('debug')('rv:client');
var extend = require('xtend');
var through = require('through2');
var proxy = require('./proxy2');

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
			console.log('destroy with error', err);
			self.destroy(err);
		};

		// a reverse tunnel to RV server
		var connOptions = extend(parseEndpoint(url), {
			method: 'CONNECT',
			headers: {'X-RV-Session': sessionId}
		});
		var transport = /^https:?$/i.test(connOptions.protocol) ? https : http;

		var req = transport.request(connOptions)
		// .on('socket', function(socket) {
		// 	self.socket = socket.on('data', function(chunk) {
		// 		console.log('socket data\n%s\n--------------', chunk);
		// 	});
		// })
		.on('connect', function(res, socket, head) {
			debug('reverse tunnel connected');
			self.connected = true;

			// tell server we are ready to receive connections
			// socket.write('rv-ready');

			
			self.socket = socket
			.once('end', function() {
				debug('END!!!');
			})
			.once('error', destroy)
			.once('close', function(err) {
				debug('reverse tunnel closed');
				self.destroy(err);
			});

			var url = urlUtils.parse(res.headers['x-rv-host']);
			var transport = /^https:?$/i.test(url.protocol) ? tls : net;
			var proxy = transport.connect({
				port: url.port,
				host: url.hostname,
				rejectUnauthorized: false
			}, function() {
				proxy.on('end', function() {
					console.log('PROXY CLOSED!!');
				});
				proxy.pipe(socket);
				socket.on('data', function(chunk) {
					console.log(chunk.toString());
					proxy.write(chunk);
				})
				.on('end', function() {
					proxy.end();
				})
				self.emit('connect');
			});

			// self.socket
			// // proxy requests to local web-server requests
			// .pipe(proxy(res.headers['x-rv-host'])).on('error', destroy)

			// // write proxied data back to remote socket
			// .pipe(self.socket);

			process.nextTick(function() {
				// var p = proxy(res.headers['x-rv-host']);
				// console.log(p);
				// // p.pipe(socket);
				// socket.pipe(p).pipe(socket);

				self.emit('connect');
			});
		})
		.on('error', function(err) {
			destroy(err);
		});

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
				this.socket.end();
				if (!this.socket.destroyed) {
					debug('--destroying socket');
					this.socket.destroy();
				} else {
					debug('--socket already destroyed');
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