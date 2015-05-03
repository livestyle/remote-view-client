#!/usr/bin/env iojs --es-staging --harmony_arrow_functions
'use strict';

var SocketCluster = require('./lib/socket-cluster');

var cluster = new SocketCluster({
	url: 'http://localhost:9001',
	maxConnections: 6
});