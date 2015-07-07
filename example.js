#!/usr/bin/env iojs
'use strict';

var TunnelCluster = require('./lib/tunnel-cluster');

var url = 'http://localhost:9001/__test-session';
var cluster = new TunnelCluster({
	url,
	maxConnections: 10,
	livestyleConnector: true
});

console.log('Created tunnel cluster for', url);