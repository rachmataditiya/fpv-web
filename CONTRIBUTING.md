# Contributing to FPV Web

Thank you for your interest in contributing! FPV Web is a browser‑based FPV drone racing simulator built with Vite, TypeScript, and Three.js. This document helps you get started.

## Development Setup

```bash
git clone https://github.com/rachmataditiya/fpv-web.git
cd fpv-web
npm install
npm run dev          # starts Vite dev server
```

**Browser requirement**: WebHID support (for DJI RC 3) needs a **Chromium‑based browser** (Chrome, Edge, etc.). Keyboards and gamepads work in any modern browser.

## Before Submitting a PR

- **Verification bar**: Run both checks and ensure they pass:
  ```bash
  npm run typecheck   # tsc --noEmit
  npm test            # Vitest (use ?mockhid=1 to test HID paths)
  ```
- CI runs the same on every pull request – your PR must be **green**.

## Manual Testing

- Simulate a DJI RC 3 without hardware: append `?mockhid=1` to the URL. The mock injects fake HID reports through the real parsing code.
- Deterministic physics debugging: open the browser console and use the global debug hook:
  ```js
  window.__fpv.step(10)   // advances exactly 10 physics ticks synchronously
  ```
  All physics run on a fixed 240 Hz timestep and use **sim‑time** (accumulated ticks), not wall‑clock time.

## Code Style & Conventions

- **TypeScript**: strict mode, **no `any`**. All interfaces must be explicit.
- Follow existing patterns:
  - **Pooled / zero‑allocation rendering** for the HUD and world elements.
  - **Cached DOM references** (query once, reuse, no live HTML collections).
  - **Deterministic seeded randomness** where reproducibility matters (e.g., barrel spawns, track generation).
- Read `src/physics/params.ts` before changing flight behaviour.

## Project Conventions That Bite Newcomers

1. **Axis convention**: **up = positive Y, right = positive X**. DJI hardware reports are already normalised; gamepad source **negates the vertical axis** (see `hidSource` vs `gamepadSource`).
2. **Gate yaw direction**: a gate's facing direction is the **average of its incoming and outgoing travel directions**.
3. **Physics timestep**: fixed at 240 Hz (`sim‑time`). Do **not** use `performance.now()` inside the sim.
4. **Collision sweep** is always active, even while disarmed – this prevents tunneling when you re‑arm inside a wall.

## Where Can I Help?

- **Maps & tracks** – add new `MapDefs` or a `track.json` inside a folder. **You must not include copyrighted game assets**. BSP/WAD files are user‑provided or server‑hosted (under `/maps/`).
- **Physics tuning** – tweak params in `src/physics/params.ts` and verify with `window.__fpv.step(n)`.
- **UI** – the HUD uses a "pit‑wall telemetry" style: tokens defined in `index.html` `:root`, uppercase micro‑labels, monospace numbers.
- **Input devices** – extend the input pipeline (WebHID > gamepad > keyboard priority). Device profiles are stored per device ID in `localStorage`.
- **Multiplayer** – see the roadmap in `docs/GDLC.md` (work in progress).

## Branch & PR Flow

1. Fork the repo.
2. Create a feature branch (`feat/short-description`).
3. Make focused, small changes.
4. Run `npm run typecheck && npm test` locally.
5. Open a PR against `main` and fill the template.

CI must pass. Maintainers will review.

## License

By contributing, you agree that your code will be licensed under the project's [MIT License](LICENSE).
