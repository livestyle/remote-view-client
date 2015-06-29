'use strict';

var http = require('http');
var assert = require('assert');
var WebsocketServer = require('websocket').server;
var WebsocketClient = require('websocket').client;
var LiveStyleConnector = require('../lib/livestyle');
var env = require('./assets/test-server');

describe.skip('LiveStyle connector', function() {
	var ws;
	before(function(done) {
		env.start(function() {
			var server = http.createServer();
			ws = new WebsocketServer({
				httpServer: server,
				autoAcceptConnections: true
			});
			ws.on('connect', function(connection) {
				console.log('connection received');
				connection.on('message', function(message) {
					console.log('Received Message: ' + message.utf8Data);
				});
			});
			ws.server = server;
			server.listen(57009, done);
		});
	});
	after(function(done) {
		env.stop(function() {
			ws.shutDown();
			ws.server.close();
			done();
		});
	});

	it('establish connection', function(done) {
		var conn = new LiveStyleConnector('http://localhost:9001/sess-test', 'ws://localhost:57009/livestyle', function() {
			console.log('connected!');

			new WebsocketClient()
			.once('connect', function(connection) {
				console.log('socket connected');
				connection.on('message', function(message) {
					console.log('got message', message.utf8Data);
					conn.destroy();
					done();
				});
				connection.send('Hello world!');
			})
			.once('connectFailed', function(err) {
				console.log('connection failed!', err);
				console.log(err.stack);
				done();
			})
			.connect('ws://localhost:9001/livestyle');
		});
	});
});