# FPV Web

[![CI](https://github.com/rachmataditiya/fpv-web/actions/workflows/ci.yml/badge.svg)](https://github.com/rachmataditiya/fpv-web/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Live demo](https://img.shields.io/badge/play-simulator.arkana.app-orange)](https://simulator.arkana.app)

**▶ Play it now: [simulator.arkana.app](https://simulator.arkana.app)** — fly with keyboard, gamepad, or a real DJI FPV RC 3 over USB. Race the built-in tracks, free-fly the cinematic valley, or upload a classic Counter-Strike 1.6 map and shoot barrels in it.

FPV Web is a browser-based FPV drone racing simulator running entirely in-browser (Chromium desktop) without a backend. Its key differentiator is native DJI FPV RC 3 support via WebHID (Gamepad API cannot see it) and a full calibration wizard (hardware calibration + per-axis mappings). It renders with Three.js and uses a hand-rolled 240 Hz rigid-body flight model in acro/rate mode.

## Quick Start

```bash
npm install
npm run dev       # Vite dev server (http://localhost:5173)
npm test          # Vitest runner
npm run build     # production build (tsc --noEmit && vite build)
```

To test DJI input without hardware, open the dev server with `?mockhid=1` appended to the URL — a mock HID source fakes the 13-byte report.

## Controls

| Input          | Action          | Keys / Mapping                                               |
| -------------- | --------------- | ----------------------------------------------------------- |
| **Keyboard**   | Roll / Pitch    | Arrow keys (↑ ↓ ← →)                                       |
|                | Yaw             | A / D                                                       |
|                | Throttle        | W / S                                                       |
|                | Arm / Disarm    | Enter                                                       |
|                | Respawn         | R                                                           |
|                | Restart race    | Shift + R                                                   |
|                | Camera view     | V                                                           |
|                | Controller panel| C                                                           |
|                | Pause           | Esc                                                         |
| **Gamepad**    | (Mode 2)        | Left stick = yaw/throttle; right stick = pitch/roll        |
| **DJI RC 3**   |                 | Click **"Connect DJI RC (USB)"** in controller panel once   |

## DJI RC over WebHID

The DJI FPV Remote Controller 3 presents as a **vendor-defined HID device** (`vid:0x2ca3`) that the Gamepad API cannot enumerate. WebHID reads a 13-byte input report at ~60–70 Hz:

- 5 × `int16`-LE axes (±660 range): roll, pitch, throttle, yaw, gimbal wheel  
- 24 button bits packed in bytes 0–2

Permissions are requested once via `navigator.hid.requestDevice()`; subsequent sessions auto-reconnect using `navigator.hid.getDevices()`. Support is **Chromium-only** (Chrome/Edge/Brave/Opera) with graceful fallback on other browsers — keyboard or gamepad input remains available.

One gotcha: vertical stick axes report positive when moved up (opposite the Gamepad API convention). The `HidSource` class normalizes all five axes to the contract "up/right = +1".

See `DJI-RC-WEBHID.md` for the full protocol description.

## Calibration

Controller calibration has **two layers**, stored per-device in `localStorage`:

1. **Hardware calibration** — per-axis minimum, maximum, and centre values.  
2. **Function mapping** — per-axis invert flag, deadzone, exponential curve, and rate multiplier (deg/s for acro). Button assignments also stored.

A **learn mode** in the calibration panel auto-detects hardware ranges (including auto-invert of axis directions) and can detect the latched switch bit used on the DJI RC for arming. All profiles are keyed by device ID (e.g., `"DJI RC (USB)"`, `"keyboard"`, generic `"gamepad"`).

Use **Export / Import JSON** to transfer or merge calibrations; imported profiles are merged by device ID, leaving existing profiles untouched.

## Custom maps (Counter-Strike 1.6 / Half-Life BSP)

Upload community-made **GoldSrc v30** `.bsp` maps (CS 1.6, Half-Life era) via the **Custom maps** button in the dock — Source-engine maps (CS:S/CS:GO) are not supported. Add the map's `.wad` texture archives in the same drop if it needs them; missing textures get readable fallbacks. Maps persist in IndexedDB and load as free-fly worlds with full collision (BVH mesh — walls crash you like the real thing), spawning at the map's `info_player_start`. Scale is authentic: 1 unit = 1 inch, so de_dust is ~120 m across. A tiny sample arena ships at `public/assets/demo_arena.bsp`.

## Architecture

```
src/
  input/          hidSource.ts (WebHID), profiles.ts (calibration), 
                  gamepad.ts, keyboard.ts
  physics/        loop.ts (fixed-timestep 240 Hz), params.ts (tuning)
  world/          race mode, gates, checkpoint/lap timing
  render/         Three.js scene, camera rig, interpolation
  ui/             ControllerPanel (calibration wizard), HUD
```

The core loop (`loop.ts`) runs a fixed-timestep physics tick at `PHYS_DT` (1/240 s) followed by rendering with linear interpolation of the current transform state. For deterministic testing without RAF, use:

```js
window.__fpv.step(n)  // advance n physics frames manually
```

## Flight Model

The model is pure acro/rate mode — sticks command angular velocity (deg/s) around each axis. Roll/pitch stick commands are smoothed with a first-order lag, and thrust is sent through a motor model.

| Parameter            | Value              |
| -------------------- | ------------------ |
| Mass                 | 0.65 kg            |
| Max thrust           | 26 N (T/W ≈ 4.1)   |
| Hover throttle       | ~25%               |
| Motor lag (τ)        | 0.04 s             |
| Rate lag R/P (τ)     | 0.02 s             |
| Rate lag yaw (τ)     | 0.03 s             |
| Linear drag coeff    | 0.15               |
| Quadratic drag coeff | 0.012              |
| Max level speed      | ~30 m/s            |
| Crash threshold      | 8 m/s impact       |

All tuning constants are defined in `src/physics/params.ts`. Adjust mass, thrust, drag coefficients, or rate-mode tau values to change handling characteristics.

## Contributing

FPV Web is MIT-licensed and open to contributions — maps and tracks, physics tuning, input devices, UI, and the active **multiplayer drone combat** roadmap ([RFC 0001](docs/rfcs/0001-multiplayer.md) · [milestones](https://github.com/rachmataditiya/fpv-web/milestones)): CS-style rooms with join codes, deathmatch, and a bomb/defuse "Drone Strike" mode on dust2. Start with [CONTRIBUTING.md](CONTRIBUTING.md) and the [Game Development Life Cycle](docs/GDLC.md) for how the project is built and where to plug in. Community map submissions welcome via the map-submission issue template (freely-redistributable map files only).

## License

[MIT](LICENSE). Bundled environment assets (HDRIs, ground textures) are CC0 from [Poly Haven](https://polyhaven.com) — see `public/assets/CREDITS.txt`. No copyrighted game content is included in this repository.
