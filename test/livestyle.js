'use strict';

var http = require('http');
var assert = require('assert');
var WebSocketServer = require('websocket').server;
var WebSocketClient = require('websocket').client;
var LiveStyleConnector = require('../lib/livestyle');
var env = require('./assets/test-server');

describe('LiveStyle connector', function() {
	var ws;
	var localUrl = 'ws://localhost:54009/livestyle';
	var remoteUrl = 'ws://localhost:9001/sess-test';

	before(function(done) {
		env.start(function() {
			var server = http.createServer();
			ws = new WebSocketServer({
				httpServer: server,
				autoAcceptConnections: true
			});
			ws.server = server;
			server.listen(54009, done);
		});
	});
	after(function(done) {
		env.stop(function() {
			ws.shutDown();
			ws.server.close(done);
		});
	});

	function sendMessage(name, data) {
		ws.broadcast(JSON.stringify({name, data}));
	}

	it('establish connection', function(done) {
		var ls = new LiveStyleConnector(localUrl, remoteUrl, function() {
			var messageCount = 0;
			var messageNames = [];
			var messageURIs = [];
			// a fake client connected to LiveStyle messaging channel
			new WebSocketClient()
			.once('connect', function(connection) {
				connection.on('message', function(message) {
					messageCount++;
					var payload = JSON.parse(message.utf8Data);
					messageNames.push(payload.name);
					messageURIs.push(payload.data.uri);
				});

				// this message is ok
				sendMessage('diff', {
					uri: 'http://localhost:9999/style/main.css',
					patches: [{foo: 'bar'}]
				});

				// unsupported name
				sendMessage('foo');
				
				// unmatched origin
				sendMessage('diff', {uri: 'http://localhost:8888/style/main.css'});

				setTimeout(function() {
					assert.equal(messageCount, 1);
					assert.deepEqual(messageNames, ['diff']);
					assert.deepEqual(messageURIs, ['http://localhost:9999/style/main.css']);
					done()
				}, 70);
			})
			.once('connectFailed', function(err) {
				console.log('connection failed!');
				console.log(err.stack);
				done(err);
			})
			.connect('ws://localhost:9001/__livestyle__/');
		});
	});

	it('re-connect', function(done) {
		var connected = 0, disconnected = 0;
		var ls = new LiveStyleConnector(localUrl, remoteUrl, {reconnectTimeout: 100});
		ls.on('connect', function() {
			connected++;
			if (connected < 3) {
				env.livestyleConnection.drop();
			} else {
				assert.equal(connected, 3);
				assert.equal(disconnected, 2);
				done();
			}
		})
		.on('remoteDisconnect', function() {
			disconnected++;
		});
	});
});