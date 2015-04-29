#!/usr/bin/env iojs --es-staging --harmony_arrow_functions
'use strict';

var net = require('net');
var http = require('http');

var client = net.connect({port: 9001}, function() {
	console.log('connected to server');
})
client.on('data', function(data) {
	console.log('received data', data.toString());
	http.get('http://download.emmet.io/hello.txt', function(res) {
		res.pipe(client);
	});
})
.on('end', function() {
	console.log('client closed');
});