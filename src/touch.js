import { stickToAxes } from './controls.js';

// On-screen controls for phones and tablets: a virtual joystick on the left
// (throttle/brake and steering; pitch and spin in the air) and a button
// cluster on the right (jump, tricks, roll), plus camera and recover.

export function wantsTouch() {
  if (typeof window === 'undefined') return false;
  const forced = new URLSearchParams(window.location.search).get('touch');
  if (forced === '1') return true;
  if (forced === '0') return false;
  // Primary pointer only: touchscreen laptops report touch points but are driven by a mouse.
  return window.matchMedia('(pointer: coarse)').matches;
}

const ICONS = {
  jump: '<path d="M12 19V6M6 11l6-6 6 6"/>',
  kickflip: '<path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3"/><path d="M18 3v4h-4M6 21v-4h4"/>',
  backflip: '<path d="M12 4a8 8 0 1 0 8 8"/><path d="M20 6v6h-6"/>',
  rollL: '<path d="M8 7H4V3"/><path d="M4.5 7A8.5 8.5 0 1 1 3.5 13"/>',
  rollR: '<path d="M16 7h4V3"/><path d="M19.5 7A8.5 8.5 0 1 0 20.5 13"/>',
  camera: '<rect x="3" y="7" width="13" height="10" rx="2"/><path d="M16 11l5-3v8l-5-3"/>',
  reset: '<path d="M4 12a8 8 0 1 0 2.3-5.7"/><path d="M4 4v4h4"/>',
};

function icon(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
}

function haptic(ms = 10) {
  if (navigator.vibrate) navigator.vibrate(ms);
}

export function createTouchControls({ onCamera } = {}) {
  const state = { forward: 0, steer: 0, strafe: 0, climb: 0, trick: null, reset: false };
  const root = document.createElement('div');
  root.className = 'touch';
  root.innerHTML = `
    <div class="stick" aria-label="Drive: up throttle, down brake, sideways steer">
      <div class="stick-base"><div class="stick-knob"></div></div>
    </div>
    <div class="pad">
      <button class="tbtn big" data-act="jump" aria-label="Hop">${icon('jump')}<span>Hop</span></button>
      <button class="tbtn" data-act="kickflip" aria-label="Kickflip">${icon('kickflip')}<span>Flip</span></button>
      <button class="tbtn" data-act="backflip" aria-label="Backflip">${icon('backflip')}<span>Back</span></button>
      <button class="tbtn small" data-act="rollL" aria-label="Roll left">${icon('rollL')}</button>
      <button class="tbtn small" data-act="rollR" aria-label="Roll right">${icon('rollR')}</button>
    </div>
    <div class="tools">
      <button class="tool" data-act="camera" aria-label="Switch camera">${icon('camera')}</button>
      <button class="tool" data-act="reset" aria-label="Recover upright">${icon('reset')}</button>
    </div>
  `;
  document.body.appendChild(root);
  document.body.classList.add('touch-ui');

  // Joystick: a fixed base; the knob follows the thumb up to the rim.
  const stick = root.querySelector('.stick');
  const base = root.querySelector('.stick-base');
  const knob = root.querySelector('.stick-knob');
  let stickId = null;
  let cx = 0;
  let cy = 0;
  const moveKnob = (x, y) => {
    const r = base.clientWidth / 2;
    const dx = x - cx;
    const dy = y - cy;
    const len = Math.hypot(dx, dy);
    const k = len > r ? r / len : 1;
    knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    const axes = stickToAxes(dx, dy, r);
    state.forward = axes.forward;
    state.steer = axes.steer;
  };
  const releaseStick = () => {
    stickId = null;
    knob.style.transform = '';
    state.forward = 0;
    state.steer = 0;
    stick.classList.remove('active');
  };
  stick.addEventListener('pointerdown', (event) => {
    if (stickId !== null) return;
    const rect = base.getBoundingClientRect();
    cx = rect.left + rect.width / 2;
    cy = rect.top + rect.height / 2;
    stickId = event.pointerId;
    try {
      stick.setPointerCapture(event.pointerId);
    } catch {
      // Some synthetic pointers cannot be captured; the stick still tracks them.
    }
    stick.classList.add('active');
    moveKnob(event.clientX, event.clientY);
    event.preventDefault();
  });
  stick.addEventListener('pointermove', (event) => {
    if (event.pointerId === stickId) moveKnob(event.clientX, event.clientY);
  });
  stick.addEventListener('pointerup', (event) => {
    if (event.pointerId === stickId) releaseStick();
  });
  stick.addEventListener('pointercancel', releaseStick);

  // Hold-buttons set a flag while pressed; taps fire once.
  const press = {
    jump: (on) => { state.climb = on ? 1 : 0; },
    kickflip: (on) => { state.trick = on ? 'kickflip' : state.trick === 'kickflip' ? null : state.trick; },
    backflip: (on) => { state.trick = on ? 'backflip' : state.trick === 'backflip' ? null : state.trick; },
    rollL: (on) => { state.strafe = on ? -1 : state.strafe === -1 ? 0 : state.strafe; },
    rollR: (on) => { state.strafe = on ? 1 : state.strafe === 1 ? 0 : state.strafe; },
    reset: (on) => { state.reset = on; },
    camera: (on) => { if (on && onCamera) onCamera(); },
  };
  for (const button of root.querySelectorAll('[data-act]')) {
    const act = press[button.dataset.act];
    const down = (event) => {
      event.preventDefault();
      try {
        button.setPointerCapture(event.pointerId);
      } catch {
        // Some synthetic pointers cannot be captured; the press still registers.
      }
      button.classList.add('down');
      act(true);
      haptic(button.dataset.act === 'jump' ? 16 : 8);
    };
    const up = () => {
      button.classList.remove('down');
      act(false);
    };
    button.addEventListener('pointerdown', down);
    button.addEventListener('pointerup', up);
    button.addEventListener('pointercancel', up);
    button.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  // Leaving the app mid-press (home gesture, call, notification shade) may never
  // send pointerup or pointercancel, so let go of everything, like the keyboard does.
  const releaseAll = () => {
    releaseStick();
    for (const button of root.querySelectorAll('[data-act]')) {
      button.classList.remove('down');
      press[button.dataset.act](false);
    }
  };
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) releaseAll();
  });

  return { state, root };
}
