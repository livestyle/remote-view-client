#!/usr/bin/env iojs
'use strict';

var TunnelCluster = require('./lib/tunnel-cluster');
var cluster = new TunnelCluster({
	url: `http://localhost:9001/__test-session`,
	maxConnections: 10
});

setInterval(stats, 100).unref();


var charm = require('charm')(process);
charm.reset();
function stats() {
	var dy = 1;
	var line = function(msg) {
		charm.position(1, dy++).write(msg);
	};
	charm.erase('screen').cursor(false);
	cluster.tunnels.forEach(function(tunnel, i) {
		var status = [];
		tunnel.rvSocket && status.push(tunnel.rvSocket.readyState);
		
		line(`Tunnel #${i}: ${status.join(', ')}`);
	});
	line('Total errors: ' + cluster.errors.length);
	cluster.errors.slice(0, 10).forEach(line);
}