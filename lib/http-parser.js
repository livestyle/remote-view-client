/**
 * Parses HTTP request header
 */
'use strict'

module.exports = function(str) {
	var result = {};
	var lines = str.split('\r\n');
	var requestLine = parseRequestLine(lines.shift());

	result['method'] = requestLine.method.toUpperCase();
	result['uri'] = requestLine.uri;

	var headers = {};
	while (lines.length) {
		let line = lines.shift();
		if (!line) {
			break;
		}

		let header = parseHeader(line);
		headers[header.name] = header.value;
		if (header.name === 'host') {
			result['host'] = header.value;
		}
	}

	result['headers'] = headers;
	result['body'] = lines.join('\r\n');

	return result;
};

function parseRequestLine(line) {
	var parts = line.split(' ');
	return {
		method: parts[0],
		uri: parts[1],
		protocol: parts[2]
	};
}

function parseHeader(line) {
	var parts = line.split(':');
	return {
		name: parts.shift().toLowerCase().trim(),
		value: parts.join(':').trim()
	};
}