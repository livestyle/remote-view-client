'use strict';

var net = require('net');
var http = require('http');
var urlUtils = require('url');
var extend = require('xtend');

var defaultOptions = {
	url: 'http://localhost:9001',
	maxConnections: 2
};

function connectionOptions(data) {
	if (typeof data === 'number') {
		return {port: data};
	}

	if (typeof data === 'string') {
		data = urlUtils.parse(data);
		return {
			port: data.port,
			host: data.hostname
		};
	}

	return data;
}

class SocketCluster {
	constuctor(options) {
		this.options = extend({}, defaultOptions, options || {});
		this.sockets = [];
	}

	createSocket(url) {
		
	}
};