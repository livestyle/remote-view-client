/**
 * A tiny wrapper for built-in HTTP header parser
 */

'use strict';
var EventEmitter = require('events');
var extend = require('xtend/mutable');

const HTTPParser = process.binding('http_parser').HTTPParser;
const kOnHeadersComplete = HTTPParser.kOnHeadersComplete | 0;
const kOnBody = HTTPParser.kOnBody | 0;

var headerCompleteArgMap = [
	'versionMajor', 'versionMinor', 'headers', 'method',
	'url', 'statusCode', 'statusMessage', 'upgrade', 'shouldKeepAlive'
];

module.exports = class Parser extends EventEmitter {
	constructor(type) {
		super();

		var self = this;
		this.input = new Buffer('');
		this._parser = new HTTPParser(type === 'request' ? HTTPParser.REQUEST : HTTPParser.RESPONSE);
		this._parser[kOnHeadersComplete] = function() {
			extend(self, mapArgs(arguments, headerCompleteArgMap));
			self.rawHeaders = self.headers || [];
			self.headers = compactHeaders(self.rawHeaders);
			self.emit('header');
		};
		this._parser[kOnBody] = function(chunk, start, len) {
			chunk = chunk.slice(start, start + len);
			if (!self.body) {
				self.body = chunk;
			} else {
				self.body = Buffer.concat([self.body, chunk]);
			}
			self.emit('body');
		};
	}

	execute(chunk) {
		this.input = Buffer.concat([this.input, chunk]);
		return this._parser.execute(chunk);
	}

	destroy() {
		this._parser = this.input = this.body = null;
	}
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
