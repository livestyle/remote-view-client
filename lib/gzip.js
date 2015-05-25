/**
 * Tries to encode transmitted data with gzip
 */
'use strict';

var zlib = require('zlib');
var through = require('through2');
var combine = require('stream-combiner2');
var headerParser = require('./http-header-parser');
var debug = require('debug')('rv:client-gzip');

const CRLF = '\r\n';
const reEncoding = /\bgzip\b|\bdeflate\b/i;
// supported content types for compression
const mimeTypes = [
	'text/plain', 'text/css', 'text/html',
	'text/javascript', 'application/x-javascript', 'application/javascript',
	'application/xml', 'text/xml'
];

module.exports = function(socket) {
	var state = {};
	return combine(inputStream(state), socket, outputStream(state));
};

function inputStream(state) {
	var processed = false;
	var parser = headerParser('request');
	return through(function(chunk, enc, next) {
		// parse and store HTTP request headers
		if (!processed) {
			parser.execute(chunk);
			if (parser.headers) {
				processed = true;
				state.encoding = !parser.upgrade && getEncoding(parser.headers);
				debug('supported encoding: %s', state.encoding);
				parser.reset();
			}
		}

		next(null, chunk);
	}, function(next) {
		state = parser = null;
		next();
	});
}

function outputStream(state) {
	var parser = headerParser('response');
	var buf = null;
	var encode = false, processed = false;

	var output = through();
	var input = through(function(chunk, enc, next) {
		debug('received chunk of %d bytes', chunk.length);
		if (!state.encoding || (processed && !encode)) {
			debug('should not encode chunk, pass though');
			return next(null, chunk);
		}

		buf = buf ? Buffer.concat([buf, chunk]) : chunk;
		var ret = parser.execute(chunk);
		debug('parser result: %o', ret);
		if (!processed && parser.headers) {
			debug('parsed headers %o', parser.headers);
			processed = true;
			// received response HTTP header, decide if we should encode 
			// incoming content
			if (shouldEncode(parser.headers)) {
				debug('content should be encoded');
				encode = true;
				input.unpipe(output);

				input
				.pipe(state.encoding === 'gzip' ? zlib.createGzip() : zlib.createDeflate())
				.pipe(chunkedTransferStream(parser, state.encoding))
				.pipe(output);
			} else {
				// do not encode data, simply pass through
				debug('no need to encode');
				this.push(buf);
				buf = null;
				return next();
			}
		}

		if (encode) {
			debug('pushing body chunk of size %d to encoder', parser.body ? parser.body.length : 0);
			this.push(parser.body);
			buf = parser.body = null;
			next();
		}
	}, function(next) {
		// non-empty `buf` means there’s something wrong, push this
		// buffer into stream
		this.push(buf);
		buf = null;
		parser.reset();
		state = parser = null;
		next();
	});

	return combine(input, output);
}

/**
 * Creates HTTP chunked transfer stream
 * @param  {String} encoding Encoding name (gzip or deflate)
 * @param  {httpHeaderParser} parser   Current HTTP header parser state
 * @return {stream.Transform}
 */
function chunkedTransferStream(parser, encoding) {
	var headerFlushed = false;
	return through(function(chunk, enc, next) {
		debug('got encoded chunk of size %d', chunk.length);
		if (!headerFlushed) {
			this.push(new Buffer(createResponseHeader(parser, encoding)));
			headerFlushed = true;
		}

		this.push(chunk.length.toString(16) + CRLF);
		this.push(chunk);
		this.push(CRLF);
		next();
	}, function(next) {
		debug('closing chunked stream');
		this.push('0' + CRLF + CRLF);
		next();
	});
}

/**
 * Returns encoding type supported by client
 * @param  {Object} headers 
 * @return {Strung}
 */
function getEncoding(headers) {
	var accept = headers && headers['Accept-Encoding'];
	var m = (accept || '').match(reEncoding);
	return m ? m[0].toLowerCase() : undefined;
}

/**
 * Check if resource can be encoded
 * @param  {Object} headers HTTP response headers
 * @return {Boolean}
 */
function shouldEncode(headers) {
	return !headers['Content-Encoding'] && supportedMime(headers['Content-Type']);
}

function supportedMime(mime) {
	mime =  (mime || '').split(';')[0].toLowerCase();
	return mimeTypes.indexOf(mime) !== -1;
}

/**
 * Creates HTTP response raw header for compressed resource based on
 * given HTTP response header parser state
 * @param  {httpHeaderParser} parser   Current HTTP header parser state
 * @param  {String} encoding Encoding name (gzip or deflate)
 * @return {Buffer}
 */
function createResponseHeader(parser, encoding) {
	// in order to keep HTTP header in more or less pristine state,
	// work with raw headers: strip ones we will override and then add
	// overridden headers
	var reOverride = /^(transfer\-encoding|content\-length)$/i;
	var headers = [`HTTP/${parser.versionMajor}.${parser.versionMinor} ${parser.statusCode} ${parser.statusMessage}`];
	var raw = parser.rawHeaders;
	for (var i = 0, il = raw.length; i < il; i += 2) {
		if (!reOverride.test(raw[i])) {
			headers.push(`${raw[i]}: ${raw[i + 1]}`);
		}
	}

	headers.push('Transfer-Encoding: chunked');
	if (encoding) {
		headers.push('Content-Encoding: ' + encoding);
	}
	headers.push(CRLF);

	var httpHeader = headers.join(CRLF);
	debug('final response header:\n%s', httpHeader);
	return httpHeader;
}