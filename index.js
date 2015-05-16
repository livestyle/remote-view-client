#!/usr/bin/env iojs
'use strict';

var TunnelCluster = require('./lib/tunnel-cluster');

var cluster = new TunnelCluster({
	url: 'http://localhost:9001',
	maxConnections: 6
});