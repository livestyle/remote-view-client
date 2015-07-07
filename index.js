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