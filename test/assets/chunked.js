'use strict';

var fs = require('fs');
var http = require('http');
var zlib = require('zlib');

var server = http.createServer(function(req, res) {
	res.writeHead(200, {'Content-Encoding': 'gzip'});
	fs.createReadStream(__dirname + req.url)
	.pipe(zlib.createGzip())
	.on('data', function(chunk) {
		console.log('Writing chunk', chunk.length);
	})
	.pipe(res);
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
