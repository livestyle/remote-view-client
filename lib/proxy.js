/**
 * Proxy pipeline: redirects incoming HTTP request
 * to local web-server and outputs HTTP response
 * back
 */
'use strict';

var net = require('net');
var tls = require('tls');
var through = require('through2');
var combine = require('stream-combiner2');
var debug = require('debug')('rv-client');
var HTTPParser = require('./http-parser');

const CRLF = '\r\n';
const HEADER_END = new Buffer(CRLF + CRLF);
const reProto = /^https$/i;
const reConnection = /^connection$/i;

module.exports = function() {
	var duplex;
	var output = through();
	var input = inputStream(function(parser, next) {
		duplex.emit('active');
		debug('forwarding to %s://%s', parser.headers['X-Forwarded-Proto'] || 'http', parser.headers['Host']);
		var transport = reProto.test(parser.headers['X-Forwarded-Proto'] || '') ? tls : net;
		var socket = transport.connect(parseHttpHost(parser.headers['Host']), function() {
			next(null, parser.input);
			parser.destroy();
		});
		input.unpipe(output);
		input.pipe(socket).pipe(output);
	});
	return duplex = combine(input, output);
};

function inputStream(redirect) {
	var headerUpdated = false;
	var parser = new HTTPParser('request');
	return through(function(chunk, enc, next) {
		if (headerUpdated) {
			return next(null, chunk);
		}

		// first, we have to determine the endpoint for socket connection:
		// parse incoming data and get Host and forwarded protocol
		// from HTTP header
		var ret = parser.execute(chunk);
		if (ret instanceof Error) {
			// Possible reason why error occurred is that we received
			// HTTP response instead of HTTP request.
			// It means server blocks this connection for some reason
			// (mostly because session expired or doesn’t exist)
			// so we can’t continue with this tunnel
			return next(upgradeError(ret, parser));
		}

		if (parser.headers) {
			headerUpdated = true;
			return redirect(parser, next);
		}

		next();
	}, function(next) {
		if (parser.input) {
			this.push(parser.input);
		}
		parser.destroy();
		next();
	});
}

function parseHttpHost(str) {
	var parts = str.split(':');
	return {
		host: parts.shift(),
		port: parts[0] || 80,
		rejectUnauthorized: false
	};
}

function upgradeError(err, parser) {
	var lineIx = parser.input.indexOf(CRLF);
	if (lineIx !== -1) {
		let m = parser.input.slice(0, lineIx).toString().match(/^HTTP\/\d+\.\d+\s+(\d+)/);
		if (m) {
			err.code = 'ESERVERDISCONNECT';
			err.statusCode = +m[1];
		}
	}
	return err;
}