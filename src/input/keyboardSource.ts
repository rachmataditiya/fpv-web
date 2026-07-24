import { InputSource, NormalizedInput } from './types';

export class KeyboardSource implements InputSource {
  readonly kind = 'keyboard';
  
  // Reused result – updated every tick and returned by read()
  private readonly result: NormalizedInput = {
    id: 'keyboard',
    axes: [0, 0, 0, 0],
    buttons: new Array<boolean>(11).fill(false),
  };

  // Convenience references
  private readonly axes = this.result.axes;   // [roll, pitch, throttle, yaw]
  private readonly buttons = this.result.buttons;

  // Key‑hold tracking
  private readonly held = new Set<string>();

  // Throttle is persistent (0..1) – maps to axis value t*2-1
  private throttleValue = 0;

  // Ramp speeds (units / second)
  private static readonly RAMP_UP_SPEED = 1 / 0.15;   // 6.667
  private static readonly DECAY_SPEED = 1 / 0.1;      // 10

  // Throttle change speed (units / second on the 0‑1 range)
  private static readonly THROTTLE_SPEED = 1.2;

  // Axis mapping helpers
  private static readonly AXIS_KEYS = {
    roll:  { pos: 'ArrowRight', neg: 'ArrowLeft' },
    pitch: { pos: 'ArrowUp',    neg: 'ArrowDown' },
    yaw:   { pos: 'KeyD',       neg: 'KeyA' },
  } as const;

  // All keys that should be preventedDefault()
  private static readonly HANDLED_CODES = new Set<string>([
    'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
    'KeyA', 'KeyD', 'KeyW', 'KeyS',
    'Enter', 'KeyR', 'KeyV', 'Escape', 'Space', 'Backspace',
    'Digit1', 'Digit2', 'Digit3', 'KeyQ', 'KeyF',
  ]);

  constructor() {
    // Bind to ensure correct `this` and allow easy removal if needed
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onBlur = this.onBlur.bind(this);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  // ----------------------------------------------------------------------
  // Public API
  // ----------------------------------------------------------------------

  /**
   * Advances the internal state by `dt` seconds.
   * Called once per physics / game frame before `read()`.
   */
  tick(dt: number): void {
    // 1. Spring‑loaded axes: roll (0), pitch (1), yaw (3)
    this.updateSpringAxis(0, {
      pos: KeyboardSource.AXIS_KEYS.roll.pos,
      neg: KeyboardSource.AXIS_KEYS.roll.neg,
    }, dt);
    this.updateSpringAxis(1, {
      pos: KeyboardSource.AXIS_KEYS.pitch.pos,
      neg: KeyboardSource.AXIS_KEYS.pitch.neg,
    }, dt);
    this.updateSpringAxis(3, {
      pos: KeyboardSource.AXIS_KEYS.yaw.pos,
      neg: KeyboardSource.AXIS_KEYS.yaw.neg,
    }, dt);

    // 2. Persistent throttle (index 2)
    this.updateThrottle(dt);

    // 3. Buttons
    this.buttons[0] = this.held.has('Enter');
    this.buttons[1] = this.held.has('KeyR');
    this.buttons[2] = this.held.has('KeyV');
    this.buttons[3] = this.held.has('Escape');
    this.buttons[4] = this.held.has('Space');     // shoot
    this.buttons[5] = this.held.has('Backspace'); // restart race
    this.buttons[6] = this.held.has('Digit1');    // weapon 1 (blaster)
    this.buttons[7] = this.held.has('Digit2');    // weapon 2 (burst)
    this.buttons[8] = this.held.has('Digit3');    // weapon 3 (railgun)
    this.buttons[9] = this.held.has('KeyQ');      // next weapon
    this.buttons[10] = this.held.has('KeyF');     // grenade drop
  }

  /**
   * Returns the current input snapshot without allocation.
   * The returned object is reused – copy its contents if you need to keep it.
   */
  read(): NormalizedInput {
    return this.result;
  }

  // ----------------------------------------------------------------------
  // Event handlers
  // ----------------------------------------------------------------------
  private onKeyDown(e: KeyboardEvent): void {
    if (e.repeat) return;
    if (KeyboardSource.HANDLED_CODES.has(e.code)) {
      e.preventDefault();
      this.held.add(e.code);
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    if (KeyboardSource.HANDLED_CODES.has(e.code)) {
      e.preventDefault();
      this.held.delete(e.code);
    }
  }

  private onBlur(): void {
    this.held.clear();
  }

  // ----------------------------------------------------------------------
  // Private helpers
  // ----------------------------------------------------------------------

  /**
   * Update one spring‑loaded axis given the codes for positive/negative directions.
   */
  private updateSpringAxis(
    index: number,
    keys: { pos: string; neg: string },
    dt: number
  ): void {
    // Determine target:  1, -1, or 0
    const wantsPos = this.held.has(keys.pos) ? 1 : 0;
    const wantsNeg = this.held.has(keys.neg) ? 1 : 0;
    const target = wantsPos - wantsNeg;   // simultaneous = 0

    const current = this.axes[index];

    if (target !== 0) {
      // Move toward target (±1)
      const delta = KeyboardSource.RAMP_UP_SPEED * dt;
      if (current < target) {
        this.axes[index] = Math.min(current + delta, target);
      } else {
        this.axes[index] = Math.max(current - delta, target);
      }
    } else {
      // Decay toward 0
      const delta = KeyboardSource.DECAY_SPEED * dt;
      if (current > 0) {
        this.axes[index] = Math.max(current - delta, 0);
      } else {
        this.axes[index] = Math.min(current + delta, 0);
      }
    }
  }

  /**
   * Update the persistent throttle axis.  Internal value 0..1 → axis -1..1.
   */
  private updateThrottle(dt: number): void {
    const wantsUp = this.held.has('KeyW') ? 1 : 0;
    const wantsDown = this.held.has('KeyS') ? 1 : 0;
    const net = wantsUp - wantsDown;

    this.throttleValue += net * KeyboardSource.THROTTLE_SPEED * dt;
    if (this.throttleValue > 1) this.throttleValue = 1;
    if (this.throttleValue < 0) this.throttleValue = 0;

    this.axes[2] = this.throttleValue * 2 - 1;   // map 0..1 → -1..1
  }
}
