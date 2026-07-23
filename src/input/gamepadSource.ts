import { InputSource, NormalizedInput } from './types';

export class GamepadSource implements InputSource {
  readonly kind = 'gamepad';

  // Pre‑allocated buffers (sized for typical gamepads)
  private readonly axes = [0, 0, 0, 0];
  private readonly buttons = new Array<boolean>(32).fill(false);
  private readonly result: NormalizedInput = {
    id: '',
    axes: this.axes,
    buttons: this.buttons,
  };

  /**
   * Polls `navigator.getGamepads()` and returns a snapshot of the first active
   * gamepad, or `null` if none is connected / supported.
   *
   * The returned object is reused – copy its contents if you need to keep it.
   */
  read(): NormalizedInput | null {
    // Environment guard
    if (typeof navigator === 'undefined' || !navigator.getGamepads) {
      return null;
    }

    const gamepads = navigator.getGamepads();
    if (!gamepads) return null;

    // Find first non‑null gamepad
    for (let i = 0; i < gamepads.length; i++) {
      const gp = gamepads[i];
      if (gp) {
        // --- Axes ---
        // Copy first 4 axes, negating vertical sticks (indices 1 & 3)
        this.axes[0] = gp.axes[0] ?? 0;
        this.axes[1] = -(gp.axes[1] ?? 0);   // up = positive
        this.axes[2] = gp.axes[2] ?? 0;
        this.axes[3] = -(gp.axes[3] ?? 0);   // up = positive

        // --- Buttons ---
        // Reset all buttons to false, then set pressed ones
        this.buttons.fill(false);
        const len = gp.buttons.length;
        for (let b = 0; b < len; b++) {
          this.buttons[b] = gp.buttons[b].pressed;
        }

        // --- ID ---
        this.result.id = gp.id;

        return this.result;
      }
    }

    return null;   // no active gamepad found
  }
}
