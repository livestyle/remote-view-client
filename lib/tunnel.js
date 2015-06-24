'use strict';

var net = require('net');
var tls = require('tls');
var http = require('http');
var https = require('https');
var parseUrl = require('url').parse;
var EventEmitter = require('events');
var debug = require('debug')('rv:tunnel');
var extend = require('xtend');
var gzip = require('./gzip');

module.exports = class Tunnel extends EventEmitter {
	constructor(serverUrl, callback) {
		super();
		this.traffic = 0;
		this._connected = false;
		this._destroyed = false;

		if (typeof callback === 'function') {
			this.once('connected', callback);
		}

		var self = this;
		var conn = extend(parseUrl(serverUrl), {
			method: 'CONNECT',
			rejectUnauthorized: false
		});
		this.sessionId = conn.pathname.replace(/^\/+/, '');

		var activity = function() {
			self.emit('activity');
			self.traffic = self.rvSocket.bytesRead + self.rvSocket.bytesWritten;
			if (self.socket) {
				self.traffic += self.socket.bytesRead + self.socket.bytesWritten;
			}
		};

		var destroy = this.destroy.bind(this);

		getTransport(conn.protocol, http, https).request(conn)
		.once('connect', function(res, rvSocket, head) {
			// successfully connected to RV server 
			if (res.statusCode !== 200) {
				debug('rv tunnel connection forbidden for session %s', self.sessionId);
				let err = new Error('Unable to create tunnel: ' + res.statusMessage);
				err.code = 'EFORBIDDEN';
				err.statusCode = res.statusCode;
				return destroy(err);
			}

			debug('rv tunnel connected for session %s', self.sessionId);

			process.nextTick(function() {
				self._connected = true;
				self.emit('connected', rvSocket);
			});

			self.rvSocket = rvSocket
			.once('end', destroy)
			.once('error', destroy)
			.once('close', function() {
				this.removeListener('data', activity);
				this.removeListener('end', destroy);
				this.removeListener('error', destroy);
				destroy();
			});

			self.socket = createDestinationConnection(res.headers['x-rv-host'], self)
			.on('data', activity)
			.once('error', destroy)
			.once('close', function() {
				this.removeListener('data', activity);
				this.removeListener('error', destroy);
			});

			// this only string makes all tunneling magic!
			rvSocket.pipe(gzip(self.socket)).pipe(rvSocket);

			if (debug.enabled) {
				rvSocket
				.once('end', function() {
					debug('rvSocket end');
				})
				.once('close', function() {
					debug('rvSocket close');
				})
				.once('error', function(err) {
					debug('rvSocket error %o', err);
				});
			}

			// connect to destination host
			// var url = parseUrl(res.headers['x-rv-host']);
			// var conn = {
			// 	port: url.port || 80,
			// 	host: url.hostname,
			// 	rejectUnauthorized: false
			// };
			// self.socket = getTransport(url.protocol, net, tls).connect(conn, function() {
			// 	// everything is OK, we’re ready for tunneling
			// 	debug('remote tunnel connected to %s:%d', url.hostname, url.port || 80);
			// 	self._connected = true;

			// 	// tell RV server we are ready to accept connections:
			// 	// simply send some data
			// 	rvSocket.write('rv-ready');

			// 	// this only string makes all tunneling magic!
			// 	rvSocket.pipe(gzip(self.socket)).pipe(rvSocket);
			// 	// rvSocket.pipe(self.socket).pipe(rvSocket);
				
			// 	process.nextTick(function() {
			// 		self.emit('connected', self.socket);
			// 	});
			// })
			// .on('data', activity)
			// .once('error', destroy)
			// .once('close', function() {
			// 	this.removeListener('data', activity);
			// 	this.removeListener('error', destroy);
			// });

			// if (debug.enabled) {
			// 	self.socket
			// 	.once('end', function() {
			// 		debug('socket ended for session %s', self.sessionId);
			// 	})
			// 	.once('close', function() {
			// 		debug('socket closed for session %s', self.sessionId);
			// 	});
			// }
		})
		.once('error', destroy)
		.end();
	}

	get connected() {
		return this._connected;
	}

	get destroyed() {
		return this._destroyed;
	}

	destroy(err) {
		if (!this._destroyed) {
			debug('destroying tunnel for session %s', this.sessionId);
			if (err) {
				debug('because of error\n%s', err.stack);
			}
			this._destroyed = true;

			destroyIfNeeded(this.socket);
			destroyIfNeeded(this.rvSocket);
			this.socket = this.rvSocket = null;
			process.nextTick(this.emit.bind(this, 'destroy', err));
		}
		return this;
	}
};

function destroyIfNeeded(socket, err) {
	if (socket && !socket.destroyed) {
		socket.destroy(err);
	}
	return socket;
}

function getTransport(protocol, plain, ssl) {
	return /^https:/i.test(protocol) ? ssl : plain;
}

function createDestinationConnection(host, tunnel) {
	var url = parseUrl(host);
	var conn = {
		port: url.port || 80,
		host: url.hostname,
		rejectUnauthorized: false
	};
	var socket = getTransport(url.protocol, net, tls).connect(conn, function() {
		// everything is OK, we’re ready for tunneling
		debug('remote tunnel connected to %s:%d', url.hostname, url.port || 80);
	});

	if (debug.enabled) {
		socket
		.once('end', function() {
			debug('socket ended for session %s', tunnel.sessionId);
		})
		.once('close', function() {
			debug('socket closed for session %s', tunnel.sessionId);
		});
	}

	return socket;
}