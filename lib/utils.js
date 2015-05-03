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

	timer: function(fn, delay) {
		var timerId;
		var start = function() {
			if (!timerId) {
				timerId = setTimeout(fn, delay || 1);
			}
		};

		var stop = function() {
			if (timerId) {
				clearTimeout(timerId);
				timerId = null;
			}
		};

		return {
			start: start,
			stop: stop,
			restart: function() {
				stop();
				start();
			}
		}
	}
};