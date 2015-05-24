'use strict';

var http = require('http');
var assert = require('assert');
var request = require('request');
var parseUrl = require('url').parse;
var Tunnel = require('../').Tunnel;
var env = require('./assets/test-server');

describe.skip('Gzip content', function() {
	before(env.start);
	after(env.stop);

	it('compress on-the-fly', function(done) {
		var start = Date.now();
		new Tunnel('http://localhost:9001/sess-test', function() {
			var end = Date.now();

			var opt = parseUrl('http://localhost:9001/widgets.css');
			opt.headers = {
				'Accept-Encoding': 'gzip'
			};

			http.request(opt, function(res) {
				var data;
				res.on('data', function(chunk) {
					data = data ? Buffer.concat([data, chunk]) : chunk;
				}).on('end', function() {
					console.log('total response size', data.length);
					setTimeout(done, 500);
				});
			})
			.on('socket', function(socket) {
				var sep = new Buffer('\r\n\r\n');
				socket.on('data', function(chunk) {
					console.log('socket chunk', chunk.length);
					var ix = chunk.indexOf(sep);
					if (ix !== -1) {
						console.log(chunk.slice(0, ix).toString());
						console.log(chunk.slice(ix + sep.length, ix + sep.length + 20));
					}
				});
			})
			.end();

			// request('http://localhost:9001/codemirror.js', opt, function(err, res, body) {
			// 	console.log('tunnel handshake: %dms', end - start);
			// 	if (err) {
			// 		console.error(err);
			// 	} else {
			// 		console.log(res.headers);
			// 		console.log(body.length);
			// 	}
			// 	done();
			// });
		});
	});
});