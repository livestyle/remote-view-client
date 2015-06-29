'use strict';

var fs = require('fs');
var path = require('path');
var http = require('http');
var parseUrl = require('url').parse;
var extend = require('xtend');

var stubServer, rvServer;
var tunnels = [];

var defaultOptions = {
	port: 9001,
	remoteUrl: 'http://localhost:9999'
};

var mimeTypes = {
	css: 'text/css', 
	html: 'text/html',
	js: 'text/javascript'
};

module.exports.start = function(options, callback) {
	if (typeof options === 'function') {
		callback = options;
		options = {};
	}

	options = extend(defaultOptions, options || {});

	// stub HTTP server
	stubServer = http.createServer(function(req, res) {
		var fileName = __dirname + req.url;
		try {
			// try to return a file
			if (fs.statSync(fileName)) {
				var ext = path.extname(fileName).slice(1);
				res.writeHead(200, {
					'content-type': mimeTypes[ext] || 'text/plain'
				});
				return fs.createReadStream(fileName).pipe(res);
			}
		} catch(e) {}

		// return a stub response
		var msg = `Requested URL: http://${req.headers['host']}${req.url}`;
		var headers = Object.keys(req.headers).reduce(function(prev, header) {
			if (/^x\-/i.test(header)) {
				prev[header] = req.headers[header];
			}
		}, {'content-length': msg.length});
		res.writeHead(200, headers);
		res.end(msg);
	});

	// Remote View proxy server
	rvServer = http.createServer(function(req, res) {
		if (tunnels.length) {
			redirect(tunnels[0], options.remoteUrl, req, res);
		} else {
			res.writeHead(500);
			res.end('No available tunnel');
		}
	})
	.on('connect', function(req, socket, head) {
		if (req.url === '/no-session') {
			// a special case for testing non-existing sessions
			socket.end('HTTP/1.1 412 No Session\r\n\r\n');
			return socket.destroy();
		}

		tunnels.push(socket);
		rvServer.emit('tunnel', socket);
		socket
		.once('end', function() {
			var ix = tunnels.indexOf(this);
			~ix && tunnels.splice(ix, 1);
			socket.destroy();
		})
		.write(
			'HTTP/1.1 200 Connection Established\r\n' +
			`X-RV-Host: ${options.remoteUrl}\r\n` +
			'\r\n'
		);
	})
	.on('upgrade', function(req, socket, head) {
		console.log('got upgrade');
		if (tunnels.length) {
			var payload = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
			for (var i = 0, il = req.rawHeaders.length; i < il; i+=2) {
				payload += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
			}

			payload += '\r\n';
			console.log(payload);
			tunnels[0].write(payload);

			socket.pipe(tunnels[0]).pipe(socket);
		} else {
			res.writeHead(500);
			res.end('No available tunnel');
		}
	});

	rvServer.listen(options.port, function() {
		stubServer.listen(parseUrl(options.remoteUrl).port, callback);
	});
	return rvServer;
};

module.exports.stop = function(callback) {
	// explicitly destroy tunnels, required for Linux
	// to properly shut down server
	while (tunnels.length) {
		tunnels.pop().destroy();
	}
	
	stubServer.close(function() {
		rvServer.close(callback);
	});
};

module.exports.tunnels = tunnels;

function redirect(socket, url, req, res) {
	var headers = extend(req.headers, {
		host: parseUrl(url).host
	});

	var payload = [`${req.method} ${req.url} HTTP/1.1`];
	Object.keys(headers).forEach(function(header) {
		payload.push(`${header}: ${headers[header]}`);
	});
	payload.push('\r\n');

	socket.write(payload.join('\r\n'));
	req.pipe(socket, {end: false}).pipe(res.connection);
}