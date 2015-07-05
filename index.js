#!/usr/bin/env iojs
'use strict';

var TunnelCluster = require('./lib/tunnel-cluster');
var Tunnel = require('./lib/tunnel');
var LiveStyleConnector = require('./lib/livestyle');

module.exports = function(options) {
	return new TunnelCluster(options);
};
module.exports.Tunnel = Tunnel;
module.exports.TunnelCluster = TunnelCluster;
module.exports.LiveStyleConnector = LiveStyleConnector;

if (require.main === module) {
	var sessionId = process.argv[2] || '';
	var cluster = new TunnelCluster({
		url: `http://localhost:9001/${sessionId}`,
		maxConnections: 10,
		livestyleConnector: true
	});
}
