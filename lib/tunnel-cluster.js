/**
 * Tunnel cluster: manages reverse tunnel connections
 */
'use strict';

var assert = require('assert');
var EventEmitter = require('events').EventEmitter;
var extend = require('xtend');
var debug = require('debug')('rv:cluster');
var utils = require('./utils');
var Tunnel = require('./tunnel');

var defaultOptions = {
	maxConnections: 10,
	idleTimeout: 30000,
	retryCount: 5,
	retryDelay: 2000
};

const STATE_IDLE = 'idle';
const STATE_ACTIVE = 'active';
const STATE_DESTROYED = 'destroyed';

module.exports = class TunnelCluster extends EventEmitter {
	constructor(options, callback) {
		super();
		this.options = extend(defaultOptions, options || {});
		assert(this.options.url, 'Remote View server URL is not specified');
		debug('creating cluster');

		this._state = STATE_IDLE;
		this.tunnels = [];

		if (typeof callback === 'function') {
			this.once('connect', callback);
		}

		// setup idle state: close all sockets except one
		// after a period of inactivity to save resources
		this._idleTimer = createClusterIdleTimer(this, this.options.idleTimeout);

		// setup retry timer: will try to re-connect to
		// remote server when tunnel can’t be established
		this._reconnectAttempts = 0;
		this._reconnectTimer = createClusterReconnectTimer(this, this.options.retryCount, this.options.retryDelay);

		// create and cache event listeners for tunnels
		var self = this;
		this._onTunnelConnect = function() {
			debug('tunnel connected to server, total tunnels: ' + self.tunnels.length);
			self.emit('connect');
			self.fill();
		};

		this._onTunnelActivity = function() {
			self.emit('activity', this);
		};

		this._onTunnelDestroy = function(err) {
			self.emit('close', this);
			this.removeListener('activity', self._onTunnelActivity);
			utils.removeFromArray(self.tunnels, this);
			debug('tunnel closed%s, tunnels left: %d', err ? ' with error' : '', self.tunnels.length);
			if (!err) {
				this.removeListener('error', self._onTunnelError);
				self.fill();
			} else {
				self._onTunnelError(err);
			}
		};

		this._onTunnelError = function(err) {
			debug('got error %s', err);
			// do not emit 'error' event since in Node
			// it has a special meaning and may crash app
			// when unhandled
			self.emit('tunnelError', err);
		}

		this
		.on('connect', _onClusterConnect)
		.on('activity', _onClusterActivity)
		.on('tunnelError', _onClusterTunnerError)
		.once('error', _onClusterError)
		.on('state', _onClusterStateChange);

		this._idleTimer.start();
		this.fill();
	}

	get state() {
		return this._state;
	}

	set state(value) {
		if (this._state === STATE_DESTROYED) {
			// do not change state if cluster is destroyed
			return;
		}

		if (this._state !== value) {
			debug('state %s', value);
			this._state = value;
			this.emit('state', value);
		}
	}

	createTunnel() {
		if (this.state === STATE_DESTROYED) {
			return;
		}

		debug('creating tunnel');
		var tunnel = new Tunnel(this.options.url, this._onTunnelConnect)
		.on('activity', this._onTunnelActivity)
		.once('destroy', this._onTunnelDestroy)
		.once('error', this._onTunnelError);

		this.tunnels.push(tunnel);
		return tunnel;
	}

	fill() {
		process.nextTick(this._fill.bind(this));
	}

	/**
	 * Fills cluster with maximum amount of available socket connections
	 */
	_fill() {
		var max = 0;
		if (this.state === STATE_IDLE) {
			max = 1;
		} else if (this.state === STATE_ACTIVE) {
			max = this.options.maxConnections;
		}

		if (max < this.tunnels.length) {
			debug('fill tunnels up to %d (+%d)', max, max - this.tunnels.length);
		}

		while (this.tunnels.length < max) {
			this.createTunnel();
		}
	}

	/**
	 * Destroys current cluster: closes all tunnel connections
	 * and does not allow further tunnel initiation
	 */
	destroy(err) {
		while (this.tunnels.length) {
			this.tunnels.pop().destroy();
		}

		if (this.state !== STATE_DESTROYED) {
			this.state = STATE_DESTROYED;
			this._idleTimer.stop();
			this._idleTimer = null;
			this._reconnectTimer.stop();
			this._reconnectTimer = null;

			this.removeListener('connect', _onClusterConnect);
			this.removeListener('activity', _onClusterActivity);
			this.removeListener('tunnelError', _onClusterTunnerError);
			this.removeListener('error', _onClusterError);
			this.removeListener('state', _onClusterStateChange);

			this.emit('destroy', err);
		}
	}
};

function createClusterIdleTimer(cluster, timeout) {
	return utils.timer(function() {
		if (cluster.state === STATE_ACTIVE) {
			// keep only one connected socket, save some resources
			cluster.state = STATE_IDLE;
		}
	}, timeout);
}

function createClusterReconnectTimer(cluster, retryCount, timeout) {
	return utils.timer(function() {
		if (cluster.tunnels.length) {
			// seems like connection is established, everything OK
			return;
		}

		if (cluster._reconnectAttempts >= retryCount) {
			// max retires: aborting
			let err = new Error('Remote server is unreachable, unable to connect');
			err.code = 'ESERVERUNREACHABLE';
			return cluster.emit('error', err);
		}

		// try to connect
		cluster._reconnectAttempts++;
		debug('attempting to reconnect: %d of %d', cluster._reconnectAttempts, retryCount);
		cluster.state = STATE_IDLE;
		cluster._idleTimer.restart();
		cluster.emit('reconnect', cluster._reconnectAttempts);
		cluster.fill();
	}, timeout);
}

function _onClusterConnect() {
	this._reconnectTimer.stop();
	this._reconnectAttempts = 0;
}

function _onClusterActivity() {
	this._idleTimer.restart();
	this.state = STATE_ACTIVE;
	this.fill();
}

function _onClusterTunnerError(err) {
	if (err.code === 'EFORBIDDEN') {
		// EFORBIDDEN means there’s no valid session for this connection,
		// no need to try further
		this._reconnectTimer.stop();
		this.emit('error', err);
	} else {
		this._reconnectTimer.restart();
	}
}

function _onClusterError(err) {
	this.destroy(err);
}

function _onClusterStateChange(state) {
	if (state === STATE_IDLE) {
		while (this.tunnels.length > 1) {
			this.tunnels.pop().destroy();
		}
	}
}