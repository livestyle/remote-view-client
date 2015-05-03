/**
 * Performes proxied HTTP request:
 * buffers incoming data from socket connection, 
 * parses HTTP header and makes HTTP request for given data
 */
'use strict'

var http = require('http');
var httpParser = require('./http-parser');
var debug = require('debug')('rv-client');
var extend = require('xtend');
var errorResponse = require('./error-response');

const MAX_BODY_LENGTH = 1 * 1024 * 1024;
var headerSeparator = new Buffer('\r\n\r\n');
var noop = function() {};

module.exports = function(socket) {
	var data = new Buffer('');
	var httpHeader, request;
	var dataLength = 0;

	var onComplete = function() {
		data = null;
		socket.removeListener('data', onData);
		socket.removeListener('error', onComplete);
		socket.removeListener('end', onComplete);
		debug('closing socket for %s', httpHeader ? httpHeader.uri : '<empty>');
	};

	var onData = function(chunk) {
		if (!request) {
			data = Buffer.concat([data, chunk]);
			// try to parse HTTP header request
			let ix = data.indexOf(headerSeparator);
			if (ix !== -1) {
				httpHeader = httpParser(data.slice(0, ix).toString('utf8'));
				request = createProxyRequest(httpHeader, socket);
				chunk = data.slice(ix);
				data = null;
			}
		} 

		if (request) {
			// we have a request but we still receive data:
			// it’s a request body
			if (chunk.length) {
				request.write(chunk);
				dataLength += chunk.length;
			}

			if (dataLength >= getRequestBodyLength(httpHeader)) {
				// everything is received, make a request
				onComplete();
				request.end();
			}
		}
	};

	return socket
	.on('data', onData)
	.once('end', onComplete)
	.once('error', onComplete);
};

function createProxyRequest(httpHeader, socket) {
	debug('create proxy for %s', httpHeader.uri);

	return http.request({
		host: httpHeader.host,
		method: httpHeader.method,
		path: httpHeader.uri,
		headers: extend({}, httpHeader.headers || {}, {
			connection: 'close'
		})
	}, function(res) {
		debug('got response for %s', httpHeader.uri);

		// a no-op handler just to consume data from response
		res.on('data', noop).once('end', function() {
			socket.end();
			res.removeListener('data', noop);
		});
	})
	.once('socket', function(sock) {
		sock.pipe(socket);
	});
}

function getRequestBodyLength(httpHeader) {
	var cl = +(httpHeader.headers['content-length'] || 0);
	return isNaN(cl) ? 0 : cl;
}