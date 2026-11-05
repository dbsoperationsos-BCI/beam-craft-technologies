/**
 * A double tap, told apart by hand. Phone browsers do not reliably turn two taps into a
 * `dblclick` - iOS Safari spends the gesture on zooming - so a table row that opens on double
 * click never opened on a phone. Two taps on the same target, close in time and without the finger
 * having moved (a scroll is not a tap), count as one double tap.
 */
export const DOUBLE_TAP_MS = 350;
export const TAP_SLOP_PX = 10;

export function createDoubleTap({ delay = DOUBLE_TAP_MS, slop = TAP_SLOP_PX } = {}) {
  let start = null;
  let last = null;
  return {
    start(x, y) {
      start = { x, y };
    },
    /** True when this tap completes a double tap on `target`. */
    end(x, y, target, now) {
      const moved = !start || Math.abs(x - start.x) > slop || Math.abs(y - start.y) > slop;
      start = null;
      if (moved) {
        last = null;
        return false;
      }
      if (last && last.target === target && now - last.at <= delay) {
        last = null;
        return true;
      }
      last = { target, at: now };
      return false;
    },
  };
}
