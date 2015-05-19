var http = require('http');
var assert = require('assert');
var extend = require('xtend');
var TunnelCluster = require('../lib/tunnel-cluster');
var env = require('./assets/test-server');

function cluster(options, callback) {
	if (typeof options === 'function') {
		callback = options;
		options = {};
	}

	return new TunnelCluster(extend({url: 9001}, options || {}), callback);
}

describe('Cluster', function() {
	before(env.start);
	after(env.stop);

	it('connect', function(done) {
		cluster(function() {
			assert(this.tunnels.length, 1);
			assert.equal(this.state, 'idle');
			this.destroy();
			done();
		});
	});

	it('fill', function(done) {
		// open up to `maxConnections` tunnels when control tunnel
		// receives data, then close all tunnels except one after
		// `idleTimeout` period of inactivity
		var options = {
			maxConnections: 4, 
			idleTimeout: 200
		};
		var becameActive = 0, becameIdle = 0;

		var c = cluster(options, function() {
			env.request('/foo', function(raw, body) {
				assert.equal(body, 'Requested url: http://localhost:9002/foo');
				assert.equal(c.tunnels.length, options.maxConnections);
				assert.equal(becameIdle, 0);
				assert.equal(becameActive, 1);

				// wait for until cluster become idle
				setTimeout(function() {
					assert.equal(becameIdle, 1);
					assert.equal(becameActive, 1);
					assert.equal(c.tunnels.length, 1);

					c.destroy();
					done();
				}, options.idleTimeout + 10);
			});
		}).on('state', function(value) {
			if (value === 'idle') {
				becameIdle++;
			} else if (value === 'active') {
				becameActive++;
			}
		});
	});

	it('destroy', function(done) {
		// destroying scenario: remove all tunnels and do not 
		// allow any further tunnels creation
		cluster(function() {
			this.destroy();
			assert.equal(this.tunnels.length, 0);

			this.createTunnel();
			assert.equal(this.tunnels.length, 0);

			this.fill();
			assert.equal(this.tunnels.length, 0);
			done();
		});
	});

	it('no session', function(done) {
		// destroy cluster if one of the tunnels returned
		// ESERVERDISCONNECT error
		cluster(function() {
			// instead of sending HTTP request to tunnel,
			// send HTTP response, which means server explicitly 
			// closed connection (likely because of no session)
			env.getSocket(function(socket) {
				socket.write([
					'HTTP/1.1 403 ' + http.STATUS_CODES['403'],
					'Connection: close',
					'\r\n'
				].join('\r\n'));
			});
		}).on('error', function(err) {
			assert.equal(err.code, 'ESERVERDISCONNECT');
			assert.equal(this.state, 'destroyed');
			assert.equal(this.tunnels.length, 0);
			done();
		});
	});

	describe('Re-connect', function() {
		var options = {
			retryCount: 5,
			retryDelay: 100
		};

		it('no initial connection', function(done) {
			env.stop();
			setTimeout(env.start, 320);
			var retries = 0;
			cluster(options, function() {
				assert.equal(this.tunnels.length, 1);
				assert(retries > 2);
				this.destroy();
				done();
			}).on('reconnect', function() {
				retries++;
			});
		});

		it('restart after connection was dropped', function(done) {
			// re-connect to remote server if connection was dropped
			var retries = 0;
			cluster(options, function() {
				var self = this;
				assert.equal(self.tunnels.length, 1);
				env.stop();
				setTimeout(function() {
					// make sure there’s no active tunnels
					assert.equal(self.tunnels.length, 0);
					setTimeout(env.start, 320);
					self.once('connect', function() {
						assert.equal(self.tunnels.length, 1);
						assert(retries > 2);
						self.destroy();
						done();
					});
				}, 10);
			}).on('reconnect', function() {
				retries++;
			});
		});

		it('fail to connect', function(done) {
			// server did not become active or reachable, throw error
			env.stop();
			var retries = 0;
			cluster(options, function() {
				throw new Error('Should not connect');
			}).on('reconnect', function() {
				retries++;
			}).on('error', function(err) {
				assert.equal(err.code, 'ESERVERUNREACHABLE');
				assert.equal(this.tunnels.length, 0);
				assert.equal(retries, 5);
				assert.equal(this.state, 'destroyed');
				done();
			});
		});
	});
});