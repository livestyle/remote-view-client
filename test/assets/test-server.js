'use strict';

var fs = require('fs');
var path = require('path');
var http = require('http');
var parseUrl = require('url').parse;
var extend = require('xtend');

var stubServer, rvServer;
var tunnels = [];
var livestyleConnection = null;

var defaultOptions = {
	port: 9001,
	remoteUrl: 'http://localhost:9999',
	livestyleUrl: 'http://localhost:54009'
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

		if (req.headers['x-rv-connection'] === 'livestyle') {
			// a LiveStyle dedicated connector, keep it separately
			connectLivestyle(socket, options);
		} else {
			connectTunnel(socket, options);
		}
	})
	.on('upgrade', function(req, socket) {
		if (/^\/__livestyle__\b/.test(req.url)) {
			// requested connection to LiveStyle tunnel
			if (livestyleConnection) {
				redirectWS(livestyleConnection, options.livestyleUrl, req);
			} else {
				socket.end(`HTTP/1.1 404 No Connected LiveStyle Client\r\n\r\n`);
				socket.destroy();
			}
			return;
		}

		if (tunnels.length) {
			redirectWS(tunnels[0], options.remoteUrl, req);
		} else {
			socket.end(`HTTP/1.1 404 No Tunnel\r\n\r\n`);
			socket.destroy();
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

	if (livestyleConnection) {
		livestyleConnection.destroy();
	}
	
	stubServer.close(function() {
		rvServer.close(callback);
	});
};

Object.defineProperties(module.exports, {
	tunnels: {
		get() {
			return tunnels;
		}
	},
	livestyle: {
		get() {
			return livestyleConnection;
		}
	}
});

function headerPayload(req, url) {
	var headers = extend(req.headers, {
		host: parseUrl(url).host
	});

	var payload = [`${req.method} ${req.url} HTTP/1.1`];
	Object.keys(headers).forEach(function(header) {
		payload.push(`${header}: ${headers[header]}`);
	});
	payload.push('\r\n');

	return payload.join('\r\n');
}

function redirect(socket, url, req, res) {
	socket.write(headerPayload(req, url));
	req.pipe(socket, {end: false}).pipe(res.connection);
}

function redirectWS(socket, url, req) {
	socket.write(headerPayload(req, url));
	req.connection.pipe(socket).pipe(req.connection);
}

function connectLivestyle(socket, options) {
	if (livestyleConnection) {
		// there’s already active LS connection
		socket.end('HTTP/1.1 409 Already Connected\r\n\r\n');
		return socket.destroy();
	}

	livestyleConnection = socket;
	rvServer.emit('livestyle', socket);
	socket
	.once('close', function() {
		if (livestyleConnection) {
			livestyleConnection.destroy();
			livestyleConnection = null;
		}
	})
	.write(
		'HTTP/1.1 200 Connection Established\r\n' +
		`X-RV-Host: ${options.livestyleUrl}\r\n` +
		'\r\n'
	);
}

function connectTunnel(socket, options) {
	tunnels.push(socket);
	rvServer.emit('tunnel', socket);
	socket
	.once('end', function() {
		var ix = tunnels.indexOf(this);
		~ix && tunnels.splice(ix, 1);
		this.destroy();
	})
	.write(
		'HTTP/1.1 200 Connection Established\r\n' +
		`X-RV-Host: ${options.remoteUrl}\r\n` +
		'\r\n'
	);
}