// This file was copied from https://github.com/substack/node-bufferlist
// and modified to be able to copy bytes from the bufferlist directly into
// a pre-existing fixed-size buffer without an additional memory allocation.

// bufferlist.js
// Treat a linked list of buffers as a single variable-size buffer.
'use strict';

module.exports = class BufferList {
	constructor(options) {
		options = options || {};
		// default encoding to use for take(). Leaving as 'undefined'
		// makes take() return a Buffer instead.
		this.encoding = options.encoding;

		// length can get negative when advanced past the end
		// and this is the desired behavior
		this._length = 0;

		this.head = { next : null, buffer : null };
		this.last = { next : null, buffer : null };
		// keep an offset of the head to decide when to head = head.next
		this.offset = 0;
	}

	get length() {
		return this._length;
	}

	// Write to the bufferlist. Emits 'write'. Always returns true.
	write(buf) {
		if (!this.head.buffer) {
			this.head.buffer = buf;
			this.last = this.head;
		} else {
			this.last.next = { next : null, buffer : buf };
			this.last = this.last.next;
		}
		this._length += buf.length;
		return true;
	}
	
	end(buf) {
		if (Buffer.isBuffer(buf)) {
			this.write(buf);
		}
	}

	// Push buffers to the end of the linked list. (deprecated)
	// Return this (self).
	push() {
		var args = Array.prototype.slice.call(arguments, 0);
		args.forEach(this.write, this);
		return this;
	}

	// For each buffer, perform some action.
	// If fn's result is a true value, cut out early.
	// Returns this (self).
	forEach(fn) {
		if (!this.head.buffer) {
			return new Buffer(0);
		}
		
		if (this.head.buffer.length - this.offset <= 0) {
			return this;
		}

		var firstBuf = this.head.buffer.slice(this.offset);
		
		var b = { buffer : firstBuf, next : this.head.next };
		
		while (b && b.buffer) {
			var r = fn(b.buffer);
			if (r) break;
			b = b.next;
		}
		
		return this;
	}

	// Create a single Buffer out of all the chunks or some subset specified by
	// start and one-past the end (like slice) in bytes.
	join(start, end) {
		if (!this.head.buffer) {
			return new Buffer(0);
		}
		if (start == undefined) start = 0;
		if (end == undefined) end = this.length;
		
		var big = new Buffer(end - start);
		var ix = 0;
		this.forEach(function(buffer) {
			if (start < (ix + buffer.length) && ix < end) {
				// at least partially contained in the range
				buffer.copy(
					big,
					Math.max(0, ix - start),
					Math.max(0, start - ix),
					Math.min(buffer.length, end - ix)
				);
			}
			ix += buffer.length;
			if (ix > end) {
				return true; // stop processing past end
			}
		});
		
		return big;
	}

	joinInto(targetBuffer, targetStart, sourceStart, sourceEnd) {
		if (!this.head.buffer) {
			return new Buffer(0);
		}
		if (sourceStart == undefined) sourceStart = 0;
		if (sourceEnd == undefined) sourceEnd = this.length;
		
		var big = targetBuffer;
		if (big.length - targetStart < sourceEnd - sourceStart) {
			throw new Error('Insufficient space available in target Buffer.');
		}

		var ix = 0;
		this.forEach(function(buffer) {
			if (sourceStart < (ix + buffer.length) && ix < sourceEnd) {
				// at least partially contained in the range
				buffer.copy(
					big,
					Math.max(targetStart, targetStart + ix - sourceStart),
					Math.max(0, sourceStart - ix),
					Math.min(buffer.length, sourceEnd - ix)
				);
			}
			ix += buffer.length;
			if (ix > sourceEnd) {
				return true; // stop processing past end
			}
		});
		
		return big;
	}

	// Advance the buffer stream by n bytes.
	// If n the aggregate advance offset passes the end of the buffer list,
	// operations such as .take() will return empty strings until enough data is
	// pushed.
	// Returns this (self).
	advance(n) {
		this.offset += n;
		this._length -= n;
		while (this.head.buffer && this.offset >= this.head.buffer.length) {
			this.offset -= this.head.buffer.length;
			this.head = this.head.next || { buffer : null, next : null };
		}
		return this;
	}

	// Take n bytes from the start of the buffers.
	// Returns a string.
	// If there are less than n bytes in all the buffers or n is undefined,
	// returns the entire concatenated buffer string.
	take(n, encoding) {
		if (n == undefined) {
			n = this.length;
		} else if (typeof n !== 'number') {
			encoding = n;
			n = this.length;
		}

		var b = this.head;
		encoding = encoding || this.encoding;
		
		if (encoding) {
			var acc = '';
			this.forEach(function(buffer) {
				if (n <= 0) {
					return true;
				}
				acc += buffer.toString(encoding, 0, Math.min(n, buffer.length));
				n -= buffer.length;
			});
			return acc;
		} else {
			// If no 'encoding' is specified, then return a Buffer.
			return this.join(0, n);
		}
	}

	// The entire concatenated buffer as a string.
	toString() {
		return this.take('binary');
	}
};