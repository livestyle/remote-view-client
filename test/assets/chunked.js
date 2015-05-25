'use strict';

var fs = require('fs');
var net = require('net');
var http = require('http');
var zlib = require('zlib');
var through = require('through2');
var gzip = require('../../lib/gzip');

var server = net.createServer(function(socket) {
	socket.on('data', function(chunk) {
		console.log('received request', chunk.length);
		var headerDumped = false;
		fs.createReadStream(__dirname + '/widgets.css')
		.pipe(zlib.createGzip())
		.pipe(through(function(chunk, enc, next) {
			if (!headerDumped) {
				console.log('dumping header');
				this.push([
					'HTTP/1.1 200 OK',
					'content-type: text/css',
					'Date: Mon, 25 May 2015 08:35:04 GMT',
					'Connection: close',
					'Transfer-Encoding: chunked',
					'Content-Encoding: gzip',
					'\r\n'
				].join('\r\n'));
				headerDumped = true;
			}
			console.log('writing chunk', chunk.length);
			this.push(chunk.length.toString(16) + '\r\n');
			this.push(chunk);
			this.push('\r\n');
			next();
		}, function(next) {
			console.log('finishing stream');
			this.push('0\r\n\r\n');
			next();
		}))
		.pipe(socket);
	});



	// res.writeHead(200, {'Content-Encoding': 'gzip'});
	// fs.createReadStream(__dirname + req.url)
	// .pipe(zlib.createGzip())
	// .on('data', function(chunk) {
	// 	console.log('Writing chunk', chunk.length);
	// })
	// .pipe(res);
});

server.listen(9002, function() {
	console.log('Server started');
	http.request('http://localhost:9002/widgets.css', function(res) {
		console.log('got response', res.headers);
		var buf;
		res.on('data', function(chunk) {
			buf = buf ? Buffer.concat([buf, chunk]) : chunk;
			console.log('response chunk', chunk.length);
		}).on('end', function() {
			console.log('response complete', buf.length);
			server.close();
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
});
