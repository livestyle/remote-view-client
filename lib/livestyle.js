/**
 * A dedicated tunnel connector for LiveStyle messaging channel.
 * Unlike a regular, short-lived cluster tunnel, this channel
 * must be persistent, with higher priority, not controlled by idle state 
 * and must automatically re-connect on connection lost
 */
'use strict';

var EventEmitter = require('events');
var extend = require('xtend');
var parseUrl = require('url').parse;
var debug = require('debug')('rv:livestyle');
var Tunnel = require('./tunnel');
var LiveStyleFilterStream = require('./stream/livestyle-filter');
var WebSocketClient = require('./websocket/client');

var allowedMessages = ['incoming-updates', 'diff'];
var defaultOptions = {
	reconnectTimeout: 1000
};

module.exports = class LiveStyleConnector extends EventEmitter {
	constructor(localUrl, remoteUrl, options, callback) {
		super();

		if (typeof options === 'function') {
			callback = options;
			options = {};
		}

		this.localUrl = localUrl;
		this.remoteUrl = remoteUrl;
		this.options = extend(defaultOptions, options || {});
		this.localClient = null;
		this.remoteClient = null;
		this._destroyed = false;
		this._forwardMessage = forwardWebsocketData.bind(this);

		this
		.on('localConnect', onLocalConnect)
		.on('localDisconnect', onLocalDisconnect)
		.on('remoteConnect', onRemoteConnect)
		.on('remoteDisconnect', onRemoteDisconnect)
		.once('destroy', onDestroy);

		if (typeof callback === 'function') {
			this.once('connect', callback);
		}

		connectTunnel(this, this.localUrl, 'local');
		connectTunnel(this, this.remoteUrl, 'remote', {
			'X-RV-Connection': 'livestyle'
		});
	}

	get destroyed() {
		return this._distroyed;
	}

	destroy() {
		if (!this.destroyed) {
			this._distroyed = true;
			this.emit('destroy');
		}
	}
};

/**
 * Initiates WebSocket connection to given URL. Tries to automatically reconnect 
 * when connection is dropped
 * @param {LiveStyleConnector} connector
 * @param {String} url URL to connect
 * @param {String} eventPrefix Event name prefix to emit for client life cycle.
 * Emitted events are `eventPrefix` + 'Connect' and `eventPrefix` + 'Disconnect'
 * @param {Object} headers Additional headers to send with connection request
 * @return {WebSocketClient}
 */
function connectTunnel(connector, url, eventPrefix, headers) {
	if (connector.destroyed) {
		return;
	}

	var reconnect = function() {
		if (!connector.destroyed) {
			setTimeout(connectTunnel, connector.options.reconnectTimeout, 
				connector, url, eventPrefix, headers).unref();
		}
	};

	var client = new WebSocketClient()
	.once('connectFailed', reconnect)
	.once('connect', function(connection) {
		connection.origin = getOrigin(this.response.headers || {});
		debug('%s tunnel connected with origin %s', eventPrefix, connection.origin);
		connector.emit(eventPrefix + 'Connect', connection);
		connection.once('close', function() {
			debug('%s tunnel disconnected', eventPrefix);
			connector.emit(eventPrefix + 'Disconnect', connection);
			reconnect();
		});
	});
	client.connect(url, null, null, headers);
}

function getOrigin(headers) {
	var origin = headers['origin'] || headers['sec-websocket-origin'];
	if (origin) {
		return origin.split(',').map(function(url) {
			return parseUrl(url.trim()).host;
		}).filter(Boolean);
	}
}

function forwardWebsocketData(message) {
	if (!this.remoteClient) {
		return debug('skip ls message forward: no remote client');
	}

	if (!this.remoteClient.origin) {
		return debug('skip ls message forward: no origin');
	}

	var payload = readMessage(message);
	debug('got message %o', payload);
	if (!payload || !payload.data || allowedMessages.indexOf(payload.name) === -1) {
		return debug('skip ls message forward: unsupported message');
	}

	debug('received ls message "%s"', payload.name);

	// transmit messages that belong to current session
	if (!payload.data.uri) {
		return debug('skip ls message forward: no uri');
	}

	var messageUri = parseUrl(String(payload.data.uri));
	var isValidOrigin = this.remoteClient.origin.some(function(host) {
		return host === messageUri.host;
	});
	if (!isValidOrigin) {
		return debug('skip ls message forward: unmatched origin');
	}

	// everything seems ok, we can forward message
	debug('forward message "%s"', payload.name);
	this.remoteClient.sendUTF(message.utf8Data);
}

function readMessage(message) {
	if (message.type === 'utf8') {
		return JSON.parse(message.utf8Data);
	}
}

function onLocalConnect(connection) {
	this.localClient = connection.on('message', this._forwardMessage);
	if (this.remoteClient) {
		this.emit('connect');
	}
}

function onLocalDisconnect(connection) {
	connection.removeListener('message', this._forwardMessage);
	this.localClient = null;
	if (!this.remoteClient) {
		this.emit('disconnect');
	}
}

function onRemoteConnect(connection) {
	this.remoteClient = connection;
	if (this.localClient) {
		this.emit('connect');
	}
}

function onRemoteDisconnect() {
	this.remoteClient = null;
	if (!this.localClient) {
		this.emit('disconnect');
	}
}

function onDestroy() {
	this.localClient && this.localClient.drop();
	this.remoteClient && this.remoteClient.drop();
	this.removeListener('localConnect', onLocalConnect);
	this.removeListener('localDisconnect', onLocalDisconnect);
	this.removeListener('remoteConnect', onRemoteConnect);
	this.removeListener('remoteDisconnect', onRemoteDisconnect);
}