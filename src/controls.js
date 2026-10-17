// Pure input maths shared by the keyboard and the touch overlay.

const DEADZONE = 0.15;
// Per-axis deadzone: physics treats exactly-zero axes specially (the in-air
// key latch, self-levelling), so a thumb slightly off-axis must not leak.
const AXIS_DEADZONE = 0.2;

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
  return { forward: axisDeadzone(-vy * k), steer: axisDeadzone(-vx * k) };
}

// Zero inside the band, then a smooth ramp so full deflection is still 1.
function axisDeadzone(v) {
  const a = Math.abs(v);
  if (a <= AXIS_DEADZONE) return 0;
  return (Math.sign(v) * (a - AXIS_DEADZONE)) / (1 - AXIS_DEADZONE);
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
