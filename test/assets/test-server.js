'use strict';

var net = require('net');
var http = require('http');

const CRLF = '\r\n';
const HEADER_SEP = new Buffer(CRLF + CRLF);

var tunnelServer, httpServer, sockets = [];
var responder;

module.exports.start = function(options, callback) {
	if (typeof options === 'function') {
		callback = options;
		options = {};
	}

	tunnelServer = net.createServer(function(socket) {
		sockets.push(socket);
		socket.on('close', function() {
			var ix = sockets.indexOf(socket);
			if (ix !== -1) {
				sockets.splice(ix, 1);
			} else {
				console.error('Socket is not in pool');
			}
		});
	}).listen(9001, function() {
		httpServer = http.createServer(function(req, res) {
			// we have to explicitly call respond() method
			if (typeof responder === 'function') {
				return responder(req, res);
			}

			let out = 'Requested url: ' + req.url;
			res.writeHead(200, {
				'Content-Length': out.length
			});
			res.end(out);
		}).listen(9002, callback);
	});
};

module.exports.stop = function() {
	tunnelServer.close();
	httpServer.close();
};

module.exports.setResponder = function(fn) {
	responder = fn;
};

module.exports.resetResponder = function() {
	responder = null;
};

/**
 * Sends HTTP request via plain TCP tunnel socket
 * @param  {String} path 
 */
module.exports.request = function(path, callback) {
	setTimeout(function() {
		if (sockets.length) {
			return request(sockets[0], path, callback);
		}

		// connected sockets are not immediately available,
		// wait a bit until first free socket become available
		// before throwing error 
		var retries = 15;
		process.nextTick(function next() {
			if (sockets.length) {
				return request(sockets[0], path, callback);
			}

			if (--retries <= 0) {
				throw new Error('No available socket');
			}
			process.nextTick(next);
		});
	}, 10);
};

module.exports.sockets = sockets;

function request(socket, path, callback) {
	var resp = new Buffer('');
	socket
	.on('data', function(chunk) {
		resp = Buffer.concat([resp, chunk]);
	})
	.on('end', function() {
		var body = resp.slice(resp.indexOf(HEADER_SEP) + HEADER_SEP.length).toString();
		var str = resp.toString();
		resp = null;
		callback(str, body);
	})
	.write([
		`GET ${path} HTTP/1.1`,
		`Host: localhost:9002`,
		`Content-Type: text/plain`,
		`Connection: close`,
		CRLF
	].join(CRLF));
}