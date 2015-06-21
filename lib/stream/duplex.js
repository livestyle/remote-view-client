'use strict';

var stream = require('stream');

var trf = {transform(chunk, enc, next) {
	return next(null, chunk, enc);
}};

module.exports = function(options) {
	return new DuplexStream(options);
};

class DuplexStream extends stream.Duplex {
	constructor(options) {
		options = options || {};
		options.objectMode = true;

		super(options);
		// console.log(options);

		var readable = this._readable = options.readable || new stream.PassThrough();
		var writable = this._writable = options.writable || new stream.PassThrough();
		writable.pipe(readable);

		this._bubbleErrors = (typeof options.bubbleErrors === "undefined") || !!options.bubbleErrors;

		var self = this;
		var emitError = function(err) {
			self.emit('error', err);
		};

		writable.once('finish', function() {
			self.end();
		});

		this.once('finish', function() {
			writable.end();
			writable.removeListener('error', emitError);
			readable.removeListener('error', emitError);
		});

		readable.on('data', function(e) {
			if (!self.push(e)) {
				this.pause();
			}
		});

		readable.once('end', function() {
			return self.push(null);
		});

		if (this._bubbleErrors) {
			writable.on("error", emitError);
			readable.on("error", emitError);
		}
	}

	inject() {
		this._writable.unpipe(this._readable);
		var stream = this._writable;
		for (var i = 0, il = arguments.length; i < il; i++) {
			if (arguments[i]) {
				stream = stream.pipe(arguments[i]);
			}
		}
		stream.pipe(this._readable);
	}

	_write(input, encoding, done) {
		this._writable.write(input, encoding, done);
	}

	_read(n) {
		this._readable.resume();
	}
};

module.exports.DuplexStream = DuplexStream;