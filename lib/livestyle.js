/**
 * A dedicated tunnel connector for LiveStyle messaging channel.
 * Unlike a regular, short-lived cluster tunnel, this channel
 * must be persistent, with higher priority, not controlled by idle state 
 * and must automatically re-connect on connection lost
 */
'use strict';

var EventEmitter = require('events');
var extend = require('xtend');
var debug = require('debug')('rv:livestyle');
var Tunnel = require('./tunnel');
var LiveStyleFilterStream = require('./stream/livestyle-filter');
var WebSocketClient = require('./websocket/client');

const STATE_IDLE = 'idle';
const STATE_CONNECTING = 'connecting';
const STATE_CONNECTED = 'connected';
const STATE_DESTROYED = 'destroyed';

var defaultOptions = {
	reconnectTimeout: 1000
};

module.exports = class LiveStyleConnector extends EventEmitter {
	constructor(url, options) {
		super();

		this.remoteUrl = url;
		this.options = extend(defaultOptions, options || {});
		this.localClient = null;
		this.remoteClient = null;
		this._destroyed = false;

		this
		.on('connect', onConnect)
		.on('disconnect', onDisconnect)
		.once('destroy', onDestroy);

		connectTunnel(this, 'http://localhost:54000/livestyle', 'local');
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
		debug('%s tunnel connected', eventPrefix);
		connector.emit(eventPrefix + 'Connect', connection);
		connection.once('close', function() {
			debug('%s tunnel disconnected', eventPrefix);
			connector.emit(eventPrefix + 'Disconnect', connection);
			reconnect();
		});
	});
}

function onConnect(tunnel) {
	this.tunnel = tunnel;
}

function onDisconnect(tunnel) {
	this.tunnel = null;
}

function onDestroy() {
	this.localClient && this.localClient.drop();
	this.remoteClient && this.remoteClient.drop();
	this.removeListener('localConnect', onLocalConnect);
	this.removeListener('localDisconnect', onLocalDisconnect);
	this.removeListener('remoteConnect', onRemoteConnect);
	this.removeListener('remoteDisconnect', onRemoteDisconnect);
}