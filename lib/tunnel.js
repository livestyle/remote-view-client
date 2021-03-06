'use strict';

var net = require('net');
var tls = require('tls');
var parseUrl = require('url').parse;
var EventEmitter = require('events');
var debug = require('debug')('rv:tunnel');
var extend = require('xtend');
var gzip = require('./gzip');
var headerParser = require('./http-header-parser');

const HEADER_END = new Buffer('\r\n\r\n');

module.exports = class Tunnel extends EventEmitter {
	constructor(serverUrl, options, callback) {
		super();
		if (typeof options === 'function') {
			callback = options;
			options = {};
		}

		this.options = options = options || {};
		this._connected = false;
		this._destroyed = false;

		this.once('connected', function() {
			this._connected = true;
			if (typeof callback === 'function') {
				callback.call(this);
			}
		});

		var url = parseUrl(serverUrl);
		this.sessionId = url.pathname.replace(/^\/+/, '');

		var destroy = this.destroy.bind(this);
		var connected = this.emit.bind(this, 'connected');
		var activity = this.emit.bind(this, 'activity');

		// To reduce network latency and bypass some HTTP limitations, 
		// we will create a raw TCP socket and send HTTP request in it instead
		// of using `http(s).request()` method.
		// The reason to do so is because with HTTP response we can also receive 
		// a queued HTTP request. With strict HTTP parser used in `http(s).request()` 
		// such packet would throw an error
		debug('creating RV socket');
		this.socket = getTransport(url.protocol, net, tls)
		.connect({
			port: url.port || 80,
			host: url.hostname,
			rejectUnauthorized: false
		}, function() {
			debug('RV connection established, request auth');
			this.write(createConnectPayload(url, options.headers));
		})
		.on('data', onSocketData)
		.on('activity', activity)
		.once('connected', connected)
		.once('error', destroy)
		.once('close', function() {
			this.removeListener('data', onSocketData);
			this.removeListener('activity', activity);
			this.removeListener('connected', connected);
			this.removeListener('error', destroy);
			destroy();
		});

		this.socket.sessionId = this.sessionId;
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

			if (this.socket) {
				if (this.socket.parser) {
					this.socket.parser.reset();
					this.socket.parser = null;
				}
				destroyIfNeeded(this.socket.local);
				this.socket.local = this.socket.localStream = null;
			}
			destroyIfNeeded(this.socket);
			this.socket = null;
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

function onSocketData(chunk) {
	debug('received chunk %d', chunk.length);
	if (!this.parser) {
		debug('create response parser');
		this.parser = headerParser('response');
	}

	var parser = this.parser;
	var head = null;
	var ix = chunk.indexOf(HEADER_END);
	if (ix !== -1) {
		// make sure we don’t feed queued HTTP request to HTTP response
		// parser here
		head = chunk.slice(ix + HEADER_END.length);
		chunk = chunk.slice(0, ix + HEADER_END.length);
	}

	var ret = parser.execute(chunk);
	if (ret instanceof Error) {
		debug('error parsing response');
		return this.destroy(ret);
	}

	if (parser.headers) {
		// response successfully parsed, validate it
		this.removeListener('data', onSocketData);

		if (parser.statusCode !== 200) {
			debug('rv tunnel connection forbidden for session %s', this.sessionId);
			let err = new Error('Unable to create tunnel: ' + parser.statusMessage);
			err.code = 'EFORBIDDEN';
			err.statusCode = parser.statusCode;
			return this.destroy(err);
		}

		// everything seems OK, we are ready for tunneling
		this.host = parser.headers['X-Rv-Host'];
		debug('ready to tunnel %s', this.host);
		if (head && head.length) {
			// already have a request
			debug('got pending request');
			setupLocalConnection.call(this).write(head);
		} else {
			debug('wait for incoming data');
			this.once('readable', setupLocalConnection).pause();
		}

		parser.reset();
		parser = head = null;
		this.emit('connected');
	}
}

function setupLocalConnection() {
	debug('setup remote socket for %s', this.host);
	var url = parseUrl(this.host);
	var destroy = this.destroy.bind(this);
	var activity = this.emit.bind(this, 'activity');
	
	this.local = getTransport(url.protocol, net, tls)
	.connect({
		port: url.port || 80,
		host: url.hostname,
		rejectUnauthorized: false
	})
	.on('data', activity)
	.once('timeout', destroy)
	.once('error', destroy)
	.once('close', function() {
		debug('remote socket closed');
		this.removeListener('data', activity);
		this.removeListener('timeout', destroy);
		this.removeListener('error', destroy);
	});

	this.local.setTimeout(30000);
	this.localStream = gzip(this.local);
	this.pipe(this.localStream).pipe(this);

	process.nextTick(this.emit.bind(this, 'local', this.local, this.localStream));
	return this.local;
}

function createConnectPayload(url, headers) {
	if (typeof url === 'string') {
		url = parseUrl(url);
	}

	var payload = `CONNECT ${url.path} HTTP/1.1\r\n` +
		`Host: ${url.host}\r\n`;

	if (headers) {
		let keys = Object.keys(headers);
		for (var i = 0, il = keys.length; i < il; i++) {
			payload += `${keys[i]}: ${headers[keys[i]]}\r\n`;
		}
	}

	return payload + `\r\n`;
}