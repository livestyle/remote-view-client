'use strict';

var net = require('net');
var tls = require('tls');
var urlUtils = require('url');
var debug = require('debug')('rv:client');
var throught = require('through2');

module.exports = function(url) {
	if (typeof url === 'string') {
		url = urlUtils.parse(url);
	}

	debug('forwarding to %s//%s:%d', url.protocol, url.hostname, url.port);

	var transport = /^https:?$/i.test(url.protocol) ? tls : net;
	var socket = transport.connect({
		port: url.port,
		host: url.hostname,
		rejectUnauthorized: false
	}).on('data', function(chunk) {
		console.log(chunk.toString());
	});

	return socket;

	return throught(function(chunk, enc, next) {
		console.log('AAAA%s', chunk);
		next(null, chunk);
	});
};