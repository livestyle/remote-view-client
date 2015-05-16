#!/usr/bin/env iojs
'use strict';

var TunnelCluster = require('./lib/tunnel-cluster');
var Tunnel = require('./lib/tunnel');

module.exports = function(options) {
	return new TunnelCluster(options);
};
module.exports.Tunnel = Tunnel;
module.exports.TunnelCluster = TunnelCluster;

if (require.main === module) {
	var cluster = new TunnelCluster({
		url: 'http://localhost:9001',
		maxConnections: 6
	});
}
