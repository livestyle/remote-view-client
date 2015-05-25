'use strict';

var fs = require('fs');
var path = require('path');
var http = require('http');
var assert = require('assert');
var request = require('request');
var Tunnel = require('../').Tunnel;
var env = require('./assets/test-server');

describe('Gzip content', function() {
	var originalFile;
	before(function(done) {
		originalFile = fs.readFileSync(path.join(__dirname, 'assets', 'codemirror.js'), 'utf8');
		env.start(done);
	});

	after(function(done) {
		originalFile = null;
		env.stop(done);
	});

	it('compress', function(done) {
		new Tunnel('http://localhost:9001/sess-test', function() {
			// send request and tell we support compression
			request('http://localhost:9001/codemirror.js', {gzip: true}, function(err, res, body) {
				assert.equal(res.headers['content-encoding'], 'gzip');
				assert.equal(res.headers['transfer-encoding'], 'chunked');
				assert.equal(body, originalFile);
				done();
			});
		});
	});

	it('do not compress', function(done) {
		new Tunnel('http://localhost:9001/sess-test', function() {
			// send request and DO NOT tell we support compression
			request('http://localhost:9001/codemirror.js', function(err, res, body) {
				assert.equal(res.headers['content-encoding'], undefined);
				assert.equal(res.headers['transfer-encoding'], 'chunked');
				assert.equal(body, originalFile);
				done();
			});
		});
	});
});