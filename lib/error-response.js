/**
 * Writes HTTP error response for given raw socket 
 */
'use strict'

var http = require('http');

var errorMessages = {
	'body-too-large': {
		code: 413,
		message: 'The request body is too large'
	},
	'request-timeout': {
		code: 408,
		message: 'Request timeout'
	}
};

module.exports = function(socket, error, message) {
	var code = 500;
	var responseMessage = message || 'Unknown error';
	if (typeof error === 'number') {
		code = error;
	} else if (error in errorMessages) {
		code = errorMessages[error].code;
		responseMessage = errorMessages[error].message;
	}

	socket.end(new Buffer([
		`HTTP/1.1 ${code} ${http.STATUS_CODES[code]}`,
		`Content-Length: ${responseMessage.length}`,
		`Content-Type: text/plain`,
		`Connection: close`,
		`X-Error-Origin: rv-client`,
		'',
		responseMessage
	].join('\r\n')));
};