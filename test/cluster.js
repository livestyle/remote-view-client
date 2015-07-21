var http = require('http');
var assert = require('assert');
var extend = require('xtend');
var TunnelCluster = require('../').TunnelCluster;
var env = require('./assets/test-server');

function cluster(options, callback) {
	if (typeof options === 'function') {
		callback = options;
		options = {};
	}

	if (typeof options === 'string') {
		options = {connectUrl: options};
	}

	return new TunnelCluster(options, callback);
}

describe('Cluster', function() {
	before(env.start);
	after(env.stop);

	it('connect', function(done) {
		cluster('http://localhost:9001/sess-test', function() {
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
			connectUrl: 'http://localhost:9001/sess-test',
			maxConnections: 4, 
			idleTimeout: 200
		};
		var becameActive = 0, becameIdle = 0;

		var c = cluster(options, function() {
			http.request('http://localhost:9001/foo', function(res) {
				var body = '';
				res.on('data', function(chunk) {
					body += chunk.toString();
				}).on('end', function() {
					assert.equal(body, 'Requested URL: http://localhost:9999/foo');
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
			}).end();
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
		cluster('http://localhost:9001/sess-test', function() {
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
		// EFORBIDDEN error
		cluster('http://localhost:9001/no-session')
		.on('error', function(err) {
			assert.equal(err.code, 'EFORBIDDEN');
			assert.equal(this.state, 'destroyed');
			assert.equal(this.tunnels.length, 0);
			done();
		});
	});

	describe('Re-connect', function() {
		var options = {
			connectUrl: 'http://localhost:9001/sess-test',
			retryCount: 5,
			retryDelay: 100
		};

		it('no initial connection', function(done) {
			env.stop(function() {
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
		});

		it('restart after connection was dropped', function(done) {
			// re-connect to remote server if connection was dropped
			var retries = 0;
			cluster(options, function() {
				var self = this;
				assert.equal(self.tunnels.length, 1);
				env.stop(function() {
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
					}, 50);
				});
			}).on('reconnect', function() {
				retries++;
			});
		});

		it('fail to connect', function(done) {
			// server did not become active or reachable, throw error
			env.stop(function() {
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
					// restore connection for other tests
					env.start(done);
				});
			});
		});
	});
});