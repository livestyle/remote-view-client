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

const STATE_IDLE = 'idle';
const STATE_CONNECTING = 'connecting';
const STATE_CONNECTED = 'connected';
const STATE_DESTROYED = 'destroyed';

var defaultOptions = {
	headers: {
		'X-RV-Connection': 'livestyle'
	},
	reconnectTimeout: 1000
};

module.exports = class LiveStyleConnector extends EventEmitter {
	constructor(url, options, callback) {
		super();

		if (typeof options === 'function') {
			callback = options;
			options = {};
		}

		this.url = url;
		this.options = extend(defaultOptions, options || {});
		this.tunnel = null;
		this._state = STATE_IDLE;

		this
		.on('connect', onConnect)
		.on('disconnect', onDisconnect)
		.once('destroy', onDestroy);

		if (typeof callback === 'function') {
			this.once('connect', callback);
		}

		connectTunnel(this);
	}

	get destroyed() {
		return this._state === STATE_DESTROYED;
	}

	destroy() {
		if (!this.destroyed) {
			this._state = STATE_DESTROYED;
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
	if (connector._state !== STATE_IDLE) {
		return;
	}

	connector._state = STATE_CONNECTING;
	return new Tunnel(connector.url, connector.options, function() {
		debug('tunnel connected');
		connector._state = STATE_CONNECTED;
		connector.emit('connect', this);
	})
	.once('destroy', function(err) {
		if (err) {
			debug('tunnel disconnected with error %s', err);
		} else {
			debug('tunnel disconnected');
		}
		connector.emit('disconnect', this);
		if (!connector.destroyed) {
			connector._state = STATE_IDLE;
			setTimeout(connectTunnel, connector.options.reconnectTimeout, connector).unref();
		}
	});
}

function onConnect(tunnel) {
	this.tunnel = tunnel;
}

function onDisconnect(tunnel) {
	this.tunnel = null;
}

function onDestroy() {
	this.tunnel && this.tunnel.destroy();
	this.removeListener('connect', onConnect);
	this.removeListener('disconnect', onDisconnect);
}