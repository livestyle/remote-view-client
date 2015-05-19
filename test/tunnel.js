'use strict';

var http = require('http');
var assert = require('assert');
var Tunnel = require('../lib/tunnel');
var env = require('./assets/test-server');

function tunnel(url, callback) {
	return new Tunnel(url, callback);
}

function nextTick(fn) {
	// do not use process.nextTick: we need to give Node more time
	// to close connected sockets
	setTimeout(fn, 1);
}

describe('Tunnel', function() {
	var tunnelServer, httpServer, sockets = [];
	before(env.start);
	after(env.stop);

	it('connect', function(done) {
		var t = tunnel(9001, function() {
			var hadActivity = false;
			t.on('activity', function() {
				hadActivity = true;
			});
			env.request('/foo', function(raw, body) {
				assert(t.connected);
				assert.equal(body, 'Requested url: http://localhost:9002/foo');
				nextTick(function() {
					assert(hadActivity);
					// socket must be terminated
					assert(t.destroyed);
					assert.equal(env.sockets.length, 0);
					done();
				});
			});
		});
	});

	it('handle closed session', function(done) {
		tunnel(9001, function() {
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
		}).on('destroy', function(err) {
			assert.equal(err.code, 'ESERVERDISCONNECT');
			assert.equal(err.statusCode, 403);
			done();
		});
	});
});