'use strict';

var http = require('http');
var assert = require('assert');
var Tunnel = require('../').Tunnel;
var env = require('./assets/test-server');

function tunnel(url, callback) {
	return new Tunnel(url, callback);
}

describe('Tunnel', function() {
	before(env.start);
	after(env.stop);

	it('connect', function(done) {
		var hadActivity = false;
		var responseReceived = false;
		var t = tunnel('http://localhost:9001/sess-test', function() {
			assert(t.connected);
			http.request('http://localhost:9001/foo', function(res) {
				var body = '';
				res.on('data', function(chunk) {
					body += chunk.toString();
				}).on('end', function() {
					responseReceived = true;
					assert.equal(body, 'Requested URL: http://localhost:9999/foo');
					assert(hadActivity);
				});
			}).end();
		})
		.on('activity', function() {
			hadActivity = true;
		})
		.on('destroy', function() {
			// tunnel must be terminated
			assert(responseReceived);
			assert(t.destroyed);
			assert.equal(env.tunnels.length, 0);
			done();
		});
	});

	it('handle closed session', function(done) {
		tunnel('http://localhost:9001/no-session', function() {
			throw new Error('Should not connect');
		}).on('destroy', function(err) {
			assert.equal(err.code, 'EFORBIDDEN');
			assert.equal(err.statusCode, 412);
			assert.equal(env.tunnels.length, 0);
			done();
		});
	});
});