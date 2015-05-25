/**
 * Creates parser for reading raw HTTP headers into 
 * convenient objects
 */
'use strict';

const HTTPParser = process.binding('http_parser').HTTPParser;
const kOnHeadersComplete = HTTPParser.kOnHeadersComplete | 0;
const kOnBody = HTTPParser.kOnBody | 0;
const uniqueHeaders = [
	'Content-Type', 'Content-Length', 'User-Agent', 'Referer',
	'Host', 'Authorization', 'Proxy-Authorization', 'If-Modified-Since', 
	'If-Unmodified-Since', 'From', 'Location', 'Max-Forwards'
];

var headerCompleteArgMap = [
	'versionMajor', 'versionMinor', 'rawHeaders', 'method',
	'url', 'statusCode', 'statusMessage', 'upgrade', 'shouldKeepAlive'
];

/**
 * Creates parser object
 * @param  {String} type HTTP header type ('request' or 'response')
 * @return {Object}
 */
module.exports = function(type) {
	var parser = new HTTPParser(type === 'request' ? HTTPParser.REQUEST : HTTPParser.RESPONSE);
	var out = {
		execute(chunk) {
			return parser.execute(chunk);
		},
		reset() {
			parser[kOnHeadersComplete] = parser[kOnBody] = null;
			parser = null;
		}
	};

	parser[kOnHeadersComplete] = function() {
		mapArgs(arguments, headerCompleteArgMap, out);
		out.headers = compactHeaders(out.rawHeaders);
	};

	parser[kOnBody] = function(chunk, start, len) {
		chunk = chunk.slice(start, start + len);
		out.body = out.body ? Buffer.concat([out.body, chunk]) : chunk;
	};
	return out;
};

function mapArgs(args, map, target) {
	return map.reduce(function(obj, name, i) {
		obj[name] = args[i];
		return obj;
	}, target || {});
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

		if (name === 'Set-Cookie') {
			if (name in headers) {
				headers[name].push(value);
			} else {
				headers[name] = [value];
			}
			continue;
		}

		if (name in headers) {
			if (uniqueHeaders.indexOf(name) !== -1) {
				continue;
			}
			headers[name] += ', ' + value;
		} else {
			headers[name] = value;
		}
	}

	return headers;
}