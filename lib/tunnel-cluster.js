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
	idleTimeout: 5000
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
				while (self.tunnels.length > 1) {
					self.tunnels.pop().destroy();
				}
				self.state = STATE_IDLE;
			}
		}, this.options.idleTimeout);

		this._idleTimer.start();
		this.on('activity', this._idleTimer.restart);
		this.createTunnel();
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

		var tunnel = new Tunnel(this.options.url)
		.once('connect', function() {
			debug('tunnel connected to server, total tunnels: ' + self.tunnels.length);
		})
		.on('activity', function() {
			self.emit('activity', tunnel);
			self.state = STATE_ACTIVE;
			self.fill();
		})
		.once('close', function() {
			self.emit('close', tunnel);
			remove(tunnel);
			debug('tunnel closed, tunnels left: ' + self.tunnels.length);
			self.fill();
		})
		.once('error', function(err) {
			debug('got error %s', err);
			self.emit('error', err);
			remove(tunnel.destroy());
			self.fill();
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
	destroy() {
		this.state = STATE_DESTROYED;
		this._idleTimer.stop();
		this._idleTimer = null;
		while (this.tunnels.length) {
			this.tunnels.pop().destroy();
		}
		this.removeListener('data', this._idleTimer.restart);
	}
};