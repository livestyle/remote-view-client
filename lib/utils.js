'use strict';

module.exports = {
	toArray: function(obj, ix) {
		return Array.prototype.slice.call(obj, ix || 0);
	},
	removeFromArray: function(arr, item) {
		var ix = arr.indexOf(item);
		if (ix !== -1) {
			arr.splice(ix, 1);
		}
		return arr;
	},

	timer(fn, delay) {
		return new ResumableTimer(fn, delay);
	},
};

class ResumableTimer {
	constructor(fn, delay) {
		this.fn = fn;
		this.delay = delay;
		this._timerId = null;
	}

	start(unref) {
		if (!this._timerId) {
			this._timerId = setTimeout(this.fn, this.delay || 1);
			if (unref) {
				this._timerId.unref();
			}
		}
		return this;
	}

	stop() {
		if (this._timerId) {
			clearTimeout(this._timerId);
			this._timerId = null;
		}
		return this;
	}

	restart(unref) {
		return this.stop().start(unref);
	}
};