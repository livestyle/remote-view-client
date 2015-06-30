'use strict';

var http = require('http');
var assert = require('assert');
var WebsocketServer = require('websocket').server;
var WebsocketClient = require('websocket').client;
var LiveStyleConnector = require('../lib/livestyle');
var env = require('./assets/test-server');

describe('LiveStyle connector', function() {
	var ws;
	before(function(done) {
		env.start(function() {
			var server = http.createServer();
			ws = new WebsocketServer({
				httpServer: server,
				autoAcceptConnections: true
			});
			ws.on('connect', function(connection) {
				connection.on('message', function(message) {
					if (message.utf8Data === 'ping') {
						connection.send('pong');
					}
				});
			});
			ws.server = server;
			server.listen(54009, done);
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
		var conn = new LiveStyleConnector('http://localhost:9001/sess-test', function() {

			new WebsocketClient()
			.once('connect', function(connection) {
				connection.send('ping');
				connection.on('message', function(message) {
					assert.equal(message.utf8Data, 'pong');
					conn.destroy();
					done();
				});
			})
			.once('connectFailed', function(err) {
				console.log('connection failed!');
				console.log(err.stack);
				done();
			})
			.connect('ws://localhost:9001/__livestyle__/');
		});
	});

	it('re-connect', function(done) {
		var connected = 0, disconnected = 0;
		var ls = new LiveStyleConnector('http://localhost:9001/sess-test', {reconnectTimeout: 100});
		ls.on('connect', function() {
			connected++;
			if (connected < 3) {
				env.livestyle.destroy();
			} else {
				assert.equal(connected, 3);
				assert.equal(disconnected, 2);
				done();
			}
		})
		.on('disconnect', function() {
			disconnected++;
		});
	});
});