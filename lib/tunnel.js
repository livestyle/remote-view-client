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
		};

		getTransport(conn.protocol, http, https).request(conn)
		.on('connect', function(res, rvSocket, head) {
			// successfully connected to RV server 
			if (res.statusCode !== 200) {
				debug('rv tunnel connection forbidden for session %s', self.sessionId);
				let err = new Error('Unable to create tunnel: ' + res.statusMessage);
				err.code = 'EFORBIDDEN';
				err.statusCode = res.statusCode;
				return self.destroy(err);
			}

			debug('rv tunnel connected for session %s', self.sessionId);

			var url = parseUrl(res.headers['x-rv-host']);
			self.rvSocket = rvSocket
			.once('data', activity)
			.on('end', function() {
				debug('rvSocket end');
				self.destroy();
			})
			.on('error', function(err) {
				debug('rvSocket error');
				self.destroy(err);
			});

			// connect to requested host
			var conn = {
				port: url.port || 80,
				host: url.hostname,
				rejectUnauthorized: false
			};
			self.socket = getTransport(url.protocol, net, tls).connect(conn, function() {
				// everything is OK, we’re ready for tunneling
				debug('remote tunnel connected to %s:%d', url.hostname, url.port || 80);
				self._connected = true;

				// tell RV server we are ready to accept connections:
				// simply send some data
				rvSocket.write('rv-ready');

				// this only string makes all tunneling magic!
				rvSocket.pipe(gzip(self.socket)).pipe(rvSocket);
				// rvSocket.pipe(self.socket).pipe(rvSocket);
				
				process.nextTick(function() {
					self.emit('connected', self.socket);
				});
			})
			.on('data', activity)
			.once('end', function() {
				debug('socket ended for session %s', self.sessionId);
				self.destroy();
			})
			.once('close', function() {
				debug('socket closed for session %s', self.sessionId);
				self.destroy();
			})
			.once('error', function(err) {
				self.destroy(err);
			});
		})
		.once('error', function(err) {
			self.destroy(err);
		})
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
			this._destroyed = true;

			destroyIfNeeded(this.socket);
			destroyIfNeeded(this.rvSocket);
			this.socket = this.rvSocket = null;

			this.emit('destroy', err);
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