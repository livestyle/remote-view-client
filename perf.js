#!/usr/bin/env iojs
'use strict';

var TunnelCluster = require('./lib/tunnel-cluster');
var cluster = new TunnelCluster({
	url: `http://localhost:9001/__test-session`,
	maxConnections: 10
});

setInterval(stats, 300).unref();


var charm = require('charm')(process);
charm.reset();
function stats() {
	var dy = 1;
	charm.erase('screen').cursor(false);
	cluster.tunnels.forEach(function(tunnel, i) {
		var status = [];
		tunnel.connected && status.push('connected');
		tunnel.destroyed && status.push('destroyed');
		status.push('traffic: ' + tunnel.traffic);
		
		charm.position(1, dy++)
		.write(`Tunnel #${i}: ${status.join(', ')}`);
	});
}