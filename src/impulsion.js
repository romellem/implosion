const stopThresholdDefault = 0.3;
const bounceDeceleration = 0.04;
const bounceAcceleration = 0.11;

/**
 * @see http://www.paulirish.com/2011/requestanimationframe-for-smart-animating/
 */
const requestAnimFrame = (function() {
	return (
		window.requestAnimationFrame ||
		window.webkitRequestAnimationFrame ||
		window.mozRequestAnimationFrame ||
		function(callback) {
			window.setTimeout(callback, 1000 / 60);
		}
	);
})();

const passiveSupported = (() => {
	let _passiveSupported = false;

	try {
		let options = Object.defineProperty({}, 'passive', {
			get: function() {
				_passiveSupported = true;
			},
		});

		window.addEventListener('test', null, options);
	} catch (err) {}

	return _passiveSupported;
})();

// Enables us to add the iOS hacky 'touchmove' empty listener fix to the window only once
let iosNoopTouchmoveAdded = false;

export default class Impulsion {
	constructor({
		source: sourceEl = window,
		onUpdate: updateCallback,
		onStart: startCallback,
		onStartDecelerating: startDeceleratingCallback,
		onEndDecelerating: endDeceleratingCallback,
		multiplier = 1,
		friction = 0.92,
		initialValues,
		boundX,
		boundY,
		bounce = true,
		window: win = window,
		addIosTouchmoveFix = true,
	}) {
		let boundXmin,
			boundXmax,
			boundYmin,
			boundYmax,
			pointerLastX,
			pointerLastY,
			pointerCurrentX,
			pointerCurrentY,
			pointerId,
			decVelX,
			decVelY;
		let targetX = 0;
		let targetY = 0;
		let prevTargetX = null;
		let prevTargetY = null;
		let stopThreshold = stopThresholdDefault * multiplier;
		let ticking = false;
		let pointerActive = false;
		let paused = false;
		let decelerating = false;
		let trackingPoints = [];

		if (addIosTouchmoveFix && !iosNoopTouchmoveAdded) {
			// fixes weird safari 10 bug where preventDefault is prevented
			// @see https://github.com/metafizzy/flickity/issues/457#issuecomment-254501356
			win.addEventListener('touchmove', function() {}, passiveSupported ? { passive: false } : false);

			iosNoopTouchmoveAdded = true;
		}

		/**
		 * Initialize instance
		 */
		(function init() {
			sourceEl = typeof sourceEl === 'string' ? document.querySelector(sourceEl) : sourceEl;
			if (!sourceEl) {
				throw new Error('IMPETUS: source not found.');
			}

			if (!updateCallback) {
				throw new Error('IMPETUS: onUpdate function not defined.');
			}

			if (initialValues) {
				if (initialValues[0]) {
					targetX = initialValues[0];
				}
				if (initialValues[1]) {
					targetY = initialValues[1];
				}
				callUpdateCallback();
			}

			// Initialize bound values
			if (boundX) {
				boundXmin = boundX[0];
				boundXmax = boundX[1];
			}
			if (boundY) {
				boundYmin = boundY[0];
				boundYmax = boundY[1];
			}

			sourceEl.addEventListener('touchstart', onDown, passiveSupported ? { passive: true } : false);
			sourceEl.addEventListener('mousedown', onDown, passiveSupported ? { passive: true } : false);
		})();

		/**
		 * In edge cases where you may need to
		 * reinstanciate Impulsion on the same sourceEl
		 * this will remove the previous event listeners
		 */
		this.destroy = function() {
			// Stop any stray animations that may be happening
			decelerating = false;
			sourceEl.removeEventListener('touchstart', onDown, passiveSupported ? { passive: true } : false);
			sourceEl.removeEventListener('mousedown', onDown, passiveSupported ? { passive: true } : false);

			cleanUpRuntimeEvents();

			return null;
		};

		/**
		 * Disable movement processing
		 * @public
		 */
		this.pause = function() {
			cleanUpRuntimeEvents();

			pointerActive = false;
			paused = true;
		};

		/**
		 * Enable movement processing
		 * @public
		 */
		this.resume = function() {
			paused = false;
		};

		/**
		 * Force a call of `callUpdateCallback`. Useful
		 * if you want the update the environment immediately after calling `this.setValues()`. 
		 * @public
		 */
		this.forceUpdate = function() {
			callUpdateCallback();
		};

		/**
		 * Update the current or previous x and y values
		 * @public
		 * @param {Number} x
		 * @param {Number} y
		 * @param {Number|null} previousX
		 * @param {Number|null} previousY
		 */
		this.setValues = function(x, y, previousX, previousY) {
			const n = 'number';

			if (typeof x === n) {
				targetX = x;
			}
			if (typeof y === n) {
				targetY = y;
			}
			if (typeof previousX === n || previousX === null) {
				prevTargetX = previousX;
			}
			if (typeof previousY === n || previousY === null) {
				prevTargetY = previousY;
			}
		};

		/**
		 * Update the multiplier value
		 * @public
		 * @param {Number} val
		 */
		this.setMultiplier = function(val) {
			multiplier = val;
			stopThreshold = stopThresholdDefault * multiplier;
		};

		/**
		 * Update boundX value
		 * @public
		 * @param {Number[]} boundX
		 */
		this.setBoundX = function(boundX) {
			boundXmin = boundX[0];
			boundXmax = boundX[1];
		};

		/**
		 * Update boundY value
		 * @public
		 * @param {Number[]} boundY
		 */
		this.setBoundY = function(boundY) {
			boundYmin = boundY[0];
			boundYmax = boundY[1];
		};

		/**
		 * Removes all events set by this instance during runtime
		 */
		function cleanUpRuntimeEvents() {
			// Remove all touch events added during 'onDown' as well.
			win.removeEventListener('touchmove', onMove, passiveSupported ? { passive: false } : false);
			win.removeEventListener('touchend', onUp, passiveSupported ? { passive: true } : false);
			win.removeEventListener('touchcancel', stopTracking, passiveSupported ? { passive: true } : false);
			win.removeEventListener('mousemove', onMove, passiveSupported ? { passive: false } : false);
			win.removeEventListener('mouseup', onUp, passiveSupported ? { passive: true } : false);
		}

		/**
		 * Add all required runtime events
		 */
		function addRuntimeEvents() {
			cleanUpRuntimeEvents();

			// @see https://developers.google.com/web/updates/2017/01/scrolling-intervention
			win.addEventListener('touchmove', onMove, passiveSupported ? { passive: false } : false);
			win.addEventListener('touchend', onUp, passiveSupported ? { passive: true } : false);
			win.addEventListener('touchcancel', stopTracking, passiveSupported ? { passive: true } : false);
			win.addEventListener('mousemove', onMove, passiveSupported ? { passive: false } : false);
			win.addEventListener('mouseup', onUp, passiveSupported ? { passive: true } : false);
		}

		/**
		 * Executes the update function
		 */
		function callUpdateCallback() {
			updateCallback.call(sourceEl, targetX, targetY, prevTargetX, prevTargetY);
			prevTargetX = targetX;
			prevTargetY = targetY;
		}

		/**
		 * Executes the start function
		 */
		function callStartCallback() {
			if (!startCallback) {
				return;
			}
			startCallback.call(sourceEl, targetX, targetY, prevTargetX, prevTargetY);
		}

		/**
		 * Executes the start decelerating function
		 */
		function callStartDeceleratingCallback() {
			if (!startDeceleratingCallback) {
				return;
			}
			startDeceleratingCallback.call(sourceEl, targetX, targetY, prevTargetX, prevTargetY);
		}

		/**
		 * Executes the end decelerating function
		 */
		function callEndDeceleratingCallback() {
			if (!endDeceleratingCallback) {
				return;
			}
			endDeceleratingCallback.call(sourceEl, targetX, targetY, prevTargetX, prevTargetY);
		}

		/**
		 * Creates a custom normalized event object from touch and mouse events
		 * @param  {Event} ev
		 * @returns {Object} with x, y, and id properties
		 */
		function normalizeEvent(ev) {
			if (ev.type === 'touchmove' || ev.type === 'touchstart' || ev.type === 'touchend') {
				let touch = ev.changedTouches[0];
				return {
					x: touch.clientX,
					y: touch.clientY,
					id: touch.identifier,
				};
			} else {
				// mouse events
				return {
					x: ev.clientX,
					y: ev.clientY,
					id: null,
				};
			}
		}

		/**
		 * Initializes movement tracking
		 * @param  {Object} ev Normalized event
		 */
		function onDown(ev) {
			let event = normalizeEvent(ev);
			if (!pointerActive && !paused) {
				callStartCallback();
				pointerActive = true;
				decelerating = false;
				pointerId = event.id;

				pointerLastX = pointerCurrentX = event.x;
				pointerLastY = pointerCurrentY = event.y;
				trackingPoints = [];
				addTrackingPoint(pointerLastX, pointerLastY);

				addRuntimeEvents();
			}
		}

		/**
		 * Handles move events
		 * @param  {Object} ev Normalized event
		 */
		function onMove(ev) {
			ev.preventDefault();
			let event = normalizeEvent(ev);

			if (pointerActive && event.id === pointerId) {
				pointerCurrentX = event.x;
				pointerCurrentY = event.y;
				addTrackingPoint(pointerLastX, pointerLastY);
				requestTick();
			}
		}

		/**
		 * Handles up/end events
		 * @param {Object} ev Normalized event
		 */
		function onUp(ev) {
			let event = normalizeEvent(ev);

			if (pointerActive && event.id === pointerId) {
				stopTracking();
			}
		}

		/**
		 * Stops movement tracking, starts animation
		 */
		function stopTracking() {
			pointerActive = false;
			addTrackingPoint(pointerLastX, pointerLastY);
			startDecelAnim();

			cleanUpRuntimeEvents();
		}

		/**
		 * Records movement for the last 100ms
		 * @param {number} x
		 * @param {number} y [description]
		 */
		function addTrackingPoint(x, y) {
			let time = Date.now();
			while (trackingPoints.length > 0) {
				if (time - trackingPoints[0].time <= 100) {
					break;
				}
				trackingPoints.shift();
			}

			trackingPoints.push({ x, y, time });
		}

		/**
		 * Calculate new values, call update function
		 */
		function updateAndRender() {
			let pointerChangeX = pointerCurrentX - pointerLastX;
			let pointerChangeY = pointerCurrentY - pointerLastY;

			targetX += pointerChangeX * multiplier;
			targetY += pointerChangeY * multiplier;

			if (bounce) {
				let diff = checkBounds();
				if (diff.x !== 0) {
					targetX -= pointerChangeX * dragOutOfBoundsMultiplier(diff.x) * multiplier;
				}
				if (diff.y !== 0) {
					targetY -= pointerChangeY * dragOutOfBoundsMultiplier(diff.y) * multiplier;
				}
			} else {
				checkBounds(true);
			}

			callUpdateCallback();

			pointerLastX = pointerCurrentX;
			pointerLastY = pointerCurrentY;
			ticking = false;
		}

		/**
		 * Returns a value from around 0.5 to 1, based on distance
		 * @param {Number} val
		 */
		function dragOutOfBoundsMultiplier(val) {
			return 0.000005 * Math.pow(val, 2) + 0.0001 * val + 0.55;
		}

		/**
		 * prevents animating faster than current framerate
		 */
		function requestTick() {
			if (!ticking) {
				requestAnimFrame(updateAndRender);
			}
			ticking = true;
		}

		/**
		 * Determine position relative to bounds
		 * @param {Boolean} restrict Whether to restrict target to bounds
		 */
		function checkBounds(restrict) {
			let xDiff = 0;
			let yDiff = 0;

			if (boundXmin !== undefined && targetX < boundXmin) {
				xDiff = boundXmin - targetX;
			} else if (boundXmax !== undefined && targetX > boundXmax) {
				xDiff = boundXmax - targetX;
			}

			if (boundYmin !== undefined && targetY < boundYmin) {
				yDiff = boundYmin - targetY;
			} else if (boundYmax !== undefined && targetY > boundYmax) {
				yDiff = boundYmax - targetY;
			}

			if (restrict) {
				if (xDiff !== 0) {
					targetX = xDiff > 0 ? boundXmin : boundXmax;
				}
				if (yDiff !== 0) {
					targetY = yDiff > 0 ? boundYmin : boundYmax;
				}
			}

			return {
				x: xDiff,
				y: yDiff,
				inBounds: xDiff === 0 && yDiff === 0,
			};
		}

		/**
		 * Initialize animation of values coming to a stop
		 */
		function startDecelAnim() {
			let firstPoint = trackingPoints[0];
			let lastPoint = trackingPoints[trackingPoints.length - 1];

			let xOffset = lastPoint.x - firstPoint.x;
			let yOffset = lastPoint.y - firstPoint.y;
			let timeOffset = lastPoint.time - firstPoint.time;

			let D = timeOffset / 15 / multiplier;

			decVelX = xOffset / D || 0; // prevent NaN
			decVelY = yOffset / D || 0;

			let diff = checkBounds();

			callStartDeceleratingCallback();
			if (Math.abs(decVelX) > 1 || Math.abs(decVelY) > 1 || !diff.inBounds) {
				decelerating = true;
				requestAnimFrame(stepDecelAnim);
			} else {
				callEndDeceleratingCallback();
			}
		}

		/**
		 * Animates values slowing down
		 */
		function stepDecelAnim() {
			if (!decelerating) {
				return;
			}

			decVelX *= friction;
			decVelY *= friction;

			targetX += decVelX;
			targetY += decVelY;

			let diff = checkBounds();

			if (Math.abs(decVelX) > stopThreshold || Math.abs(decVelY) > stopThreshold || !diff.inBounds) {
				if (bounce) {
					let reboundAdjust = 2.5;

					if (diff.x !== 0) {
						if (diff.x * decVelX <= 0) {
							decVelX += diff.x * bounceDeceleration;
						} else {
							let adjust = diff.x > 0 ? reboundAdjust : -reboundAdjust;
							decVelX = (diff.x + adjust) * bounceAcceleration;
						}
					}
					if (diff.y !== 0) {
						if (diff.y * decVelY <= 0) {
							decVelY += diff.y * bounceDeceleration;
						} else {
							let adjust = diff.y > 0 ? reboundAdjust : -reboundAdjust;
							decVelY = (diff.y + adjust) * bounceAcceleration;
						}
					}
				} else {
					if (diff.x !== 0) {
						if (diff.x > 0) {
							targetX = boundXmin;
						} else {
							targetX = boundXmax;
						}
						decVelX = 0;
					}
					if (diff.y !== 0) {
						if (diff.y > 0) {
							targetY = boundYmin;
						} else {
							targetY = boundYmax;
						}
						decVelY = 0;
					}
				}

				callUpdateCallback();

				requestAnimFrame(stepDecelAnim);
			} else {
				decelerating = false;
				callEndDeceleratingCallback();
			}
		}
	}
}
