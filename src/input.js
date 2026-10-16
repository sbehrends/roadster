const down = new Set();

const BLOCKED = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (event) => {
    if (BLOCKED.has(event.code)) event.preventDefault();
    down.add(event.code);
  });
  window.addEventListener('keyup', (event) => {
    down.delete(event.code);
  });
  window.addEventListener('blur', () => down.clear());
}

function axis(positive, negative) {
  return (positive ? 1 : 0) - (negative ? 1 : 0);
}

export function readInput() {
  let trick = null;
  if (down.has('KeyF')) trick = 'kickflip';
  else if (down.has('KeyB')) trick = 'backflip';
  return {
    forward: axis(down.has('KeyW') || down.has('ArrowUp'), down.has('KeyS') || down.has('ArrowDown')),
    steer: axis(down.has('KeyA') || down.has('ArrowLeft'), down.has('KeyD') || down.has('ArrowRight')),
    strafe: axis(down.has('KeyE'), down.has('KeyQ')),
    climb: down.has('Space') ? 1 : 0,
    trick,
    reset: down.has('KeyR'),
  };
}
