/**
 * Tries to encode transmitted data with gzip
 */
'use strict';

var zlib = require('zlib');
var stream = require('stream');
var debug = require('debug')('rv:client-gzip');
var headerParser = require('./http-header-parser');
var DuplexStream = require('./stream/duplex').DuplexStream;

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
	var stream = new DuplexStream({
		writable: new GzipInput(state),
		readable: new GzipOutput(state)
	});

	stream.inject(socket);
	return stream;
};

class GzipInput extends stream.Transform {
	constructor(state) {
		super();
		this._state = state;
		this._parser = headerParser('request');
	}

	_transform(chunk, enc, next) {
		if (this._parser) {
			this._parser.execute(chunk);
			if (this._parser.headers) {
				this._state.supportedEncoding = !this._parser.upgrade && getEncoding(this._parser.headers);
				debug('supported encoding: %s', this._state.supportedEncoding);
				this._parser.reset();
				this._parser = null;
			}
		}
		next(null, chunk);
	}

	_flush(next) {
		if (this._parser) {
			this._parser.reset();
			this._parser = null;
		}
		this._state = null;
		next();
	}
}

class GzipOutput extends DuplexStream {
	constructor(state, options) {
		super(options);
		this._state = state;
		this._parser = null;
		this._buf = null;
		this.on('end', this.onEnd);
		this._write = this._maybeEncode;
	}

	_maybeEncode(chunk, enc, next) {
		var encoding = this._state.supportedEncoding;
		if (!encoding) {
			// client does not support content encoding,
			// bailing out
			return this.switchToRawWriter(chunk, enc, next);
		}

		this._buf = this._buf ? Buffer.concat([this._buf, chunk]) : chunk;
		if (!this._parser) {
			this._parser = headerParser('response');
		}

		var ret = this._parser.execute(chunk);
		debug('parser result: %o', ret);
		if (ret instanceof Error) {
			// got error while parsing HTTP response:
			// cannot handle request, pass it through
			this.switchToRawWriter(this._buf, enc, next);
			return this.reset();
		}

		if (this._parser.headers) {
			debug('parsed headers %o', this._parser.headers);
			// received response HTTP header, decide if we should encode 
			// incoming content
			if (shouldEncode(this._parser.headers)) {
				debug('content should be encoded');
				let httpHeader = createHTTPResponseHeader(this._parser, encoding);
				this.inject(
					encoding === 'gzip' ? zlib.createGzip() : zlib.createDeflate(),
					new ChunkedOutputStream(httpHeader)
				);

				this.switchToHTTPWriter(this._parser.body, enc, next);
				this._parser.body = null;
				return;
			} else {
				debug('no need to encode');
				this.switchToRawWriter(this._buf, enc, next);
			}

			return this.reset();
		}

		// unable to decide yet, accumulate data
		next();
	}

	_writeRawData(chunk, enc, next) {
		super._write(chunk, enc, next);
	}

	_writeHTTPData(chunk, enc, next) {
		var ret = this._parser.execute(chunk);
		debug('parser result: %o', ret);
		if (ret instanceof Error) {
			// got error while parsing HTTP response:
			// cannot handle request, pass it through
			this.switchToRawWriter(chunk, enc, next);
			return this.reset();
		}

		if (this._parser.body) {
			super._write(this._parser.body, enc, next);
			this._parser.body = null;
		} else {
			next();
		}
	}

	switchToHTTPWriter(chunk, enc, next) {
		this._buf = null;
		this._write = this._writeHTTPData;
		if (chunk) {
			super._write(chunk, enc, next);
		} else {
			next();
		}
	}

	switchToRawWriter(chunk, enc, next) {
		this._write = this._writeRawData;
		if (chunk) {
			this._write(chunk, enc, next);
		} else if (next) {
			next();
		}
	}

	reset() {
		this._buf = null;
		this.resetParser();
	}

	resetParser() {
		debug('reset parser');
		if (this._parser) {
			this._parser.reset();
			this._parser = null;
		}
	}

	onEnd() {
		debug('stream finished');
		if (this._parser && this._buf) {
			debug('non-clean exit code');
			// parser is not cleared: it means we received 
			// unknown or corrupted HTTP response. Pass it
			// through to receiver
			this.push(this._buf);
		}
		this.reset();
	}
}

class ChunkedOutputStream extends stream.Transform {
	constructor(header) {
		super();
		this._header = header;
	}

	_transform(chunk, enc, next) {
		if (this._header) {
			debug('dumping http header');
			this.push(this._header);
			this._header = null;
		}

		debug('output chunk of size %d', chunk.length);
		this.push(chunk.length.toString(16) + CRLF);
		this.push(chunk);
		this.push(CRLF);
		next();
	}

	_flush(next) {
		debug('closing chunked stream');
		this.push('0' + CRLF + CRLF);
		next();
	}
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
function createHTTPResponseHeader(parser, encoding) {
	var status = `HTTP/${parser.versionMajor}.${parser.versionMinor} ${parser.statusCode} ${parser.statusMessage}`;
	// in order to keep HTTP header in more or less pristine state,
	// work with raw headers: strip ones we will override and then add
	// overridden headers
	var reOverride = /^(transfer\-encoding|content\-length)$/i;
	var headers = [status];
	var rawHeaders = parser.rawHeaders;
	for (var i = 0, il = rawHeaders.length; i < il; i += 2) {
		if (!reOverride.test(rawHeaders[i])) {
			headers.push(`${rawHeaders[i]}: ${rawHeaders[i + 1]}`);
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