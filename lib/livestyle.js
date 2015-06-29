/**
 * A dedicated tunnel connector for LiveStyle messaging channel.
 * Unlike a regular, short-lived tunnel connection this must be persistent
 * and must automatically re-connect on any connection lost
 */
'use strict';

var EventEmitter = require('events');
var extend = require('xtend');
var debug = require('debug')('rv:livestyle');
var Tunnel = require('./tunnel');
var WebsocketClient = require('websocket').client;

const STATE_IDLE = 'idle';
const STATE_CONNECTING = 'connecting';
const STATE_CONNECTED = 'connected';

var defaultOptions = {
	tunnelReconnectTimeout: 5000,
	websocketReconnectTimeout: 1000
};

var tunnelOptions = {
	localConnect: false,
	headers: {
		'X-RV-Connection': 'livestyle'
	}
};

module.exports = class LiveStyleConnector extends EventEmitter {
	constructor(remoteUrl, localUrl, options, callback) {
		super();

		if (typeof options === 'function') {
			callback = options;
			options = {};
		}

		this.remoteUrl = remoteUrl;
		this.localUrl = localUrl;
		this.options = extend(defaultOptions, options || {});

		this._destroyed = false;
		this._tunnelState = STATE_IDLE;
		this._websocketState = STATE_IDLE;

		this._tunnel = null;
		this._websocket = null;

		if (typeof callback === 'function') {
			this.once('connect', callback);
		}

		var self = this
		.on('tunnelConnect', function(tunnel) {
			unpipe(self._tunnel, self._websocket);
			self._tunnel = tunnel;
			pipe(self._tunnel, self._websocket);
			if (self._tunnel && self._websocket) {
				self.emit('connect');
			}
		})
		.on('tunnelDisconnect', function(tunnel) {
			unpipe(tunnel, self._websocket);
			self._tunnel = null;;
			self.emit('disconnect');
		})
		.on('websocketConnect', function(websocket) {
			unpipe(self._tunnel, self._websocket);
			self._websocket = websocket;
			pipe(self._tunnel, self._websocket);
			if (self._tunnel && self._websocket) {
				self.emit('connect');
			}
		})
		.on('websocketDisconnect', function(websocket) {
			unpipe(self._tunnel, websocket);
			self._websocket = null;
			self.emit('disconnect');
		})
		.once('destroy', function() {
			unpipe(self._tunnel, self._websocket);
			self._tunnel && self._tunnel.destroy();
			self._websocket && self._websocket.close();
		});

		connectTunnel(this);
		connectWebsocket(this);
	}

	get destroyed() {
		return this._destroyed;
	}

	destroy() {
		if (this.destroyed) {
			this._destroyed = true;
			this.emit('destroy');
		}
	}
};

/**
 * Initiates remote tunnel connection sequence: connects to RV worker and 
 * auto-reconnects if connection is lost
 * @param {LiveStyleConnector} connector
 * @return {Tunnel}
 */
function connectTunnel(connector) {
	if (connector._tunnelState !== STATE_IDLE || connector.destroyed) {
		return;
	}

	connector._tunnelState = STATE_CONNECTING;
	return new Tunnel(connector.remoteUrl, tunnelOptions, function() {
		debug('tunnel connected');
		connector._tunnelState = STATE_CONNECTED;
		connector.emit('tunnelConnect', this);
	})
	.once('destroy', function() {
		debug('tunnel disconnected');
		connector._tunnelState = STATE_IDLE;
		connector.emit('tunnelDisconnect', this);
		if (!connector.destroyed) {
			connector._tunnelState = STATE_CONNECTING;
			setTimeout(connectTunnel, connector.options.tunnelReconnectTimeout, connector).unref();
		}
	});
}

/**
 * Initiates connection to local LiveStyle websocket server: opens connection
 * and auto-reconnects if connection is lost
 * @param {LiveStyleConnector} connector
 * @return {WebsocketClient}
 */
function connectWebsocket(connector) {
	if (connector._websocketState !== STATE_IDLE || connector.destroyed) {
		return;
	}

	connector._websocketState = STATE_CONNECTING;

	var reconnect = function() {
		if (!connector.destroyed) {
			connector._websocketState = STATE_CONNECTING;
			setTimeout(connectWebsocket, connector.options.websocketReconnectTimeout, connector).unref();
		}
	};

	return new WebsocketClient()
	.once('connect', function(connection) {
		debug('ws connected');
		connector._websocketState = STATE_CONNECTED;
		connector.emit('websocketConnect', connection);
		connection.once('close', function() {
			debug('ws disconnected');
			connector._websocketState = STATE_IDLE;
			connector.emit('websocketDisconnect', this);
			reconnect();
		});
	})
	.once('connectFailed', reconnect)
	.connect(connector.localUrl);
}

function pipe(tunnel, websocket) {
	connect(tunnel && tunnel.socket, websocket && websocket.socket);
}

function unpipe(tunnel, websocket) {
	disconnect(tunnel && tunnel.socket, websocket && websocket.socket);
}

function disconnect(stream1, stream2) {
	if (stream1 && stream2) {
		stream1.unpipe(stream2);
		stream2.unpipe(stream1);
	}
}

function connect(stream1, stream2) {
	if (stream1 && stream2) {
		stream1.pipe(stream2).pipe(stream1);
	}
}