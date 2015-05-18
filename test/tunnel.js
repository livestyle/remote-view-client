'use strict';

var assert = require('assert');
var Tunnel = require('../lib/tunnel');
var env = require('./assets/test-server');

function tunnel(url, callback) {
	return new Tunnel(url, callback);
}

describe('Tunnel', function() {
	var tunnelServer, httpServer, sockets = [];
	before(env.start);
	after(env.stop);
	afterEach(env.resetResponder);

	it('connect', function(done) {
		var t = tunnel(9001, function() {
			env.request('/foo', function(res) {
				console.log('got response\n' + res);
				assert.equal(res, '');
				done();
			});
		});
	});
});