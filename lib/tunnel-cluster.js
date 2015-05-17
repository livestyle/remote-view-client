/**
 * Tunnel cluster: manages reverse tunnel connections
 */
'use strict';

var assert = require('assert');
var EventEmitter = require('events').EventEmitter;
var extend = require('xtend');
var debug = require('debug')('rv-client');
var utils = require('./utils');
var Tunnel = require('./tunnel');

var defaultOptions = {
	maxConnections: 2,
	idleTimeout: 5000,
	retryCount: 2,
	retryDelay: 1000
};

const STATE_IDLE = 'idle';
const STATE_ACTIVE = 'active';
const STATE_DESTROYED = 'destroyed';

module.exports = class TunnelCluster extends EventEmitter {
	constructor(options) {
		super();
		this.options = extend({}, defaultOptions, options || {});
		assert(this.options.url, 'Remote View server URL is not specified');
		debug('creating cluster');

		this._state = STATE_IDLE;
		this.tunnels = [];

		// setup idle state: close all sockets except one
		// after a period of inactivity to save resources
		var self = this;
		this._idleTimer = utils.timer(function() {
			if (self.state === STATE_ACTIVE) {
				debug('going to idle state');
				// keep only one connected socket, save some resources
				self.state = STATE_IDLE;
			}
		}, this.options.idleTimeout);

		// setup retry timer: will try to re-connect to
		// remote server when tunnel can’t be established
		this._reconnectAttempts = 0;
		this._reconnectTimer = utils.timer(function() {
			if (self.tunnels.length) {
				// seems like connection is established, everything OK
				return;
			}

			if (self._reconnectAttempts >= self.options.retryCount) {
				// max retires: aborting
				return self.destroy(new Error('Remote server is unreachable, unable to connect'));
			}

			// try to connect
			self._reconnectAttempts++;
			debug('attempting to reconnect: %d of %d', self._reconnectAttempts, self.options.retryCount);
			self.state = STATE_IDLE;
			self._idleTimer.restart();
			self.fill();
		}, this.options.retryDelay);

		this
		.on('activity', this._idleTimer.restart)
		.on('tunnelError', function(err) {
			// in case of "no-session" error do not try to reconnect 
			// because all subsequent requests will fail too
			if (err.message === 'no-session') {
				self.destroy(err);
			} else {
				self._reconnectTimer.restart();
			}
		})
		.on('state', function(state) {
			if (state === STATE_IDLE) {
				while (self.tunnels.length > 1) {
					self.tunnels.pop().destroy();
				}
			}
		})
		.on('available', function() {
			self._reconnectTimer.stop();
			this._reconnectAttempts = 0;
		});

		this._idleTimer.start();

		process.nextTick(function() {
			self.fill();
		});
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
			this._state = value;
			this.emit('state', value);
		}
	}

	createTunnel() {
		if (this.state === STATE_DESTROYED) {
			return;
		}

		var self = this;
		var remove = function(tunnel) {
			utils.removeFromArray(self.tunnels, tunnel);
		};

		var fill = function() {
			process.nextTick(function() {
				self.fill();
			});
		};

		var tunnel = new Tunnel(this.options.url)
		.once('connect', function() {
			debug('tunnel connected to server, total tunnels: ' + self.tunnels.length);
			self.emit('connect');
		})
		.on('activity', function() {
			if (this.available) {
				self.emit('activity', tunnel);
				self.state = STATE_ACTIVE;
				fill();
			}
		})
		.once('destroy', function(err) {
			self.emit('close', tunnel);
			remove(tunnel);
			debug('tunnel closed%s, tunnels left: %d', err ? ' with error' : '', self.tunnels.length);
			if (!err) {
				fill();
			} else {
				self.emit('tunnelError', err);
			}
		})
		.once('error', function(err) {
			debug('got error %s', err);
			// do not emit 'error' event since in Node
			// it has a special meaning and may crash app
			// when unhandled
			remove(tunnel.destroy());
			self.emit('tunnelError', err);
		});

		self.tunnels.push(tunnel);
		return tunnel;
	}

	/**
	 * Fills cluster with maximum amount of available socket connections
	 */
	fill() {
		var max = 0;
		if (this.state === STATE_IDLE) {
			max = 1;
		} else if (this.state === STATE_ACTIVE) {
			max = this.options.maxConnections;
		}

		debug('fill tunnels up to %d (+%d)', max, max - this.tunnels.length);
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
			this.removeListener('data', this._idleTimer.restart);
			this._idleTimer.stop();
			this._idleTimer = null;
			this._reconnectTimer.stop();
			this._reconnectTimer = null;

			if (err) {
				var self = this;
				process.nextTick(function() {
					console.log('report cluster error');
					self.emit('error', err);
				});
			}
		}
	}
};