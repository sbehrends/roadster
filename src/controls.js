// Pure input maths shared by the keyboard and the touch overlay.

const DEADZONE = 0.15;

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

// Joystick knob offset in pixels (screen y grows downward) to drive axes.
// Up is throttle, down is brake/reverse; left is +steer (like A), right is −steer.
export function stickToAxes(dx, dy, radius) {
  const vx = dx / radius;
  const vy = dy / radius;
  const len = Math.hypot(vx, vy);
  if (len < DEADZONE) return { forward: 0, steer: 0 };
  const scaled = (Math.min(len, 1) - DEADZONE) / (1 - DEADZONE);
  const k = scaled / len;
  return { forward: -vy * k, steer: -vx * k };
}

// Keyboard and touch together: axes add and clamp, buttons OR.
export function mergeInput(keys, touch) {
  return {
    forward: clamp(keys.forward + touch.forward, -1, 1),
    steer: clamp(keys.steer + touch.steer, -1, 1),
    strafe: clamp(keys.strafe + touch.strafe, -1, 1),
    climb: Math.max(keys.climb, touch.climb),
    trick: keys.trick || touch.trick,
    reset: keys.reset || touch.reset,
  };
}
