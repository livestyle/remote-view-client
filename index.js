#!/usr/bin/env iojs --es-staging --harmony_arrow_functions
'use strict';

var SocketCluster = require('./lib/socket-cluster');

var cluster = new SocketCluster();