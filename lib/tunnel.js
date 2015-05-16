/**
 * A reverse tunnel: creates socket connection to
 * RV server 
 */
'use strict'

var net = require('net');
var tls = require('tls');
var domain = require('domain');
var urlUtils = require('url');
var debug = require('debug')('rv-client');
var EventEmitter = require('events').EventEmitter;
var through = require('through2');
var combine = require('stream-combiner2');

const HTTPParser = process.binding('http_parser').HTTPParser;
const kOnHeadersComplete = HTTPParser.kOnHeadersComplete | 0;
const kOnBody = HTTPParser.kOnBody | 0;
const CRLF = '\r\n';

var headerCompleteArgMap = [
	'versionMajor', 'versionMinor', 'headers', 'method',
	'url', 'statusCode', 'statusMessage', 'upgrade', 'shouldKeepAlive'
];

module.exports = class Tunnel extends EventEmitter {
	constructor(url, callback) {
		super();
		this.connected = false;
		this._destroyed = false;

		if (typeof callback === 'function') {
			this.once('connect', callback);
		}

		var self = this;
		domain.create().on('error', function(err) {
			debug(err);
			self.emit('error', err);
			self.destroy();
		})
		.run(function() {
			var endpoint = parseEndpoint(url);
			var transport = endpoint.protocol === 'https' ? tls : net;

			// a reverse tunnel to RV server
			self.socket = transport.connect(endpoint, function() {
				self.connected = true;
				debug('reverse tunnel connected');
				self.emit('connect');
			})
			.on('data', function() {
				self.emit('activity');
			})
			.once('close', function(err) {
				debug('reverse tunnel closed');
				self.emit('close', err);
				self.destroy();
			})
			.once('destroy', function() {
				debug('reverse tunnel destroyed');
				self.destroy();
			});

			self.socket.pipe(proxy()).pipe(self.socket);
		});
	}

	get destroyed() {
		return this._destroyed;
	}

	destroy() {
		if (!this._destroyed) {
			debug('destroying tunnel');
			this._destroyed = true;
			if (!this.socket.destroyed) {
				this.socket.destroy();
			}
			this.socket = null;
			this.emit('destroy');
		}
		return this;
	}
};

/**
 * Creates a proxy pipeline that transmits data
 * from reverse tunnel proxy to target local host
 * @return {stream.Transform}
 */
function proxy() {
	var buf = new Buffer('');
	var remote = null, headers = null;

	var parser = new HTTPParser(HTTPParser.REQUEST);
	parser[kOnHeadersComplete] = function() {
		var data = mapArgs(arguments, headerCompleteArgMap);
		headers = compactHeaders(data.headers);
		parser = null;
	};
	parser[kOnBody] = function(chunk, start, len) {};

	var output = through();
	var input = through(function(chunk, enc, next) {
		if (!remote) {
			// first, we have to determine the endpoint for socket connection:
			// parse incoming data and get Host and forwarded protocol
			// from HTTP header
			buf = Buffer.concat([buf, chunk]);
			let ret = parser.execute(chunk);
			if (ret instanceof Error) {
				return this.destroy(ret);
			}

			if (headers) {
				// headers parsed, get destination data
				let transport = /^https$/i.test(headers['X-Forwarded-Proto'] || '') ? tls : net;
				debug('forwarding to %s://%s', headers['X-Forwarded-Proto'], headers['Host']);
				remote = transport.connect(parseHttpHost(headers['Host']), function() {
					next(null, buf);
					buf = null;
				});
				input.unpipe(output);
				return input.pipe(remote).pipe(output);
			}
		} else {
			this.push(chunk, enc);
		}

		next();
	}, function(next) {
		if (buf) {
			this.push(buf);
		}
		buf = remote = null;
		next();
	});
	return combine(input, output);
}

function parseEndpoint(endpoint) {
	if (typeof endpoint === 'number') {
		return {port: endpoint};
	}

	if (typeof endpoint === 'string') {
		endpoint = urlUtils.parse(endpoint);
		return {
			protocol: endpoint.protocol.replace(/:$/, '').toLowerCase(),
			port: endpoint.port,
			host: endpoint.hostname,
			rejectUnauthorized: false
		};
	}

	return endpoint;
}

function parseHttpHost(str) {
	var parts = str.split(':');
	return {
		host: parts.shift(),
		port: parts[0] || 80,
		rejectUnauthorized: false
	};
}

function mapArgs(args, map) {
	return map.reduce(function(obj, name, i) {
		obj[name] = args[i];
		return obj;
	}, {});
}

function _toUpperCase(str) {
	return str.toUpperCase();
}

function normalizeHeaderName(name) {
	return name.toLowerCase().replace(/^\w|\-\w/g, _toUpperCase);
}

function compactHeaders(data) {
	var headers = {};
	for (var i = 0; i < data.length; i += 2) {
		let name = normalizeHeaderName(data[i]);
		let value = data[i + 1];
		if (name in headers) {
			if (!Array.isArray(headers[name])) {
				headers[name] = [headers[name]];
			}
			headers[name].push(value);
		} else {
			headers[name] = value;
		}
	}

	return headers;
}