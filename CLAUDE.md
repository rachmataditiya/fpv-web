# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Browser FPV drone racing simulator (Vite + TypeScript + Three.js, no backend, Chromium desktop). The differentiator is reading the **DJI FPV Remote Controller 3 over WebHID** (invisible to the Gamepad API) with a full sim-style calibration wizard. Also: GoldSrc BSP map support (CS 1.6 maps), an in-game race-track editor, and drone shooting (explosive barrels).

## Commands

```bash
npm run dev            # Vite dev server
npm test               # vitest run (all suites)
npx vitest run src/game/__tests__/weapon.test.ts   # single test file
npm run typecheck      # tsc --noEmit (strict)
npm run build          # typecheck + vite build → dist/
```

Dev/test aids:
- `?mockhid=1` — replaces WebHID with a mock DJI RC that synthesizes real 13-byte reports through the actual parse path (tests the whole calibration pipeline without hardware). Note: the mock outranks keyboard, so keyboard flying is dead in this mode.
- `?map=canyon|valley|custom:<name>|server:<name>` — force a map.
- `window.__fpv` — debug handle: `quad`, `race`, `barrels`, `input`, `settings`, and **`step(n)`** which advances n physics ticks + one render synchronously. Use `step()` for deterministic browser testing; rAF freezes when the tab is occluded (`visibilityState === 'hidden'`), so never rely on wall-clock waiting.
- To freeze the quad mid-air for screenshots: `quad.crashed = true; quad.crashTimer = 99999`.

## Deployment (production)

Live at **https://simulator.arkana.app** on `arkana-1` (Coolify/Traefik — never bind :80/:443). Stack: `/home/arkana/simulator-stack/` (nginx:alpine, static mount; compose + nginx.conf mirrored in `deploy/`).

```bash
# redeploy app (no container restart needed)
npm run build && rsync -az --delete dist/ arkana-1:/home/arkana/simulator-stack/dist/
# publish a server map (zero build steps — nginx autoindex JSON is the manifest)
rsync -az mymapdir/ arkana-1:/home/arkana/simulator-stack/maps/<name>/
```

Server map folder = one `.bsp` + any `.wad`s + optional `track.json` (a `TrackDef`). The `maps/` dir is a separate mount with an nginx `alias` — `rsync --delete dist/` cannot touch it.

## Architecture

**Main loop** (`loop.ts` + `main.ts`): fixed 240 Hz physics accumulator inside rAF, render interpolates between the last two physics states (pos lerp + quat slerp). `main.ts` is the only place subsystems meet; everything else is constructor-injected.

**Input pipeline** (`src/input/`): three sources (WebHID `hidSource`, `gamepadSource`, `keyboardSource`) all emit `NormalizedInput {axes, buttons}` with the repo-wide convention **up/right = positive**. `InputManager` picks by priority (hid > gamepad > keyboard), applies the per-device `Profile` (localStorage, keyed by device id): `norm(axcal)` → `deadzone` → `expo` → invert → rate scaling → `FlightInput` (rad/s + throttle 0..1 × limit). Button actions are edge-triggered; `prevBtn` is updated **before** the callback fires (re-entrant `sample()` must not re-fire — this was a real infinite-recursion bug).

⚠️ Sign conventions: `DJI-RC-WEBHID.md` documents `SIGN=[1,-1,-1,1,1]` for a gamepad-style up=negative convention. This repo deliberately diverges: the contract is up=positive, the DJI already reports that, so `hidSource.ts` uses identity signs and `gamepadSource` negates its vertical axes instead. Don't "fix" this back.

**Physics** (`physics/quad.ts`): hand-rolled rigid body, acro rate mode. Body frame X right / Y up (thrust) / −Z forward; stick rates map to ω as (−pitch, −yaw, −roll) — all negative, derived in the file header comment. Collision is pluggable via `CollisionWorld` (`floorAt` + optional `sweep`): flat plane (default) / terrain heightfield (built-in maps) / BSP BVH. The **sweep runs regardless of arming** — a disarmed quad falls fast enough (12+ cm/step) to tunnel through `floorAt`'s ray margin; arming only decides crash-vs-settle.

**Maps** (3 kinds, resolved in `main.ts` from `settings.map` / `?map=`):
- Built-in `MapDef`s in `world/maps.ts` (canyon = race, valley = cinematic) with `EnvConfig` → `render/environment.ts` (CC0 Poly Haven HDRI as background+IBL, terrain from `render/terrain.ts`, instanced props from `render/scatter.ts`).
- `custom:<name>` — user-uploaded BSP from IndexedDB (`world/bsp/mapStore.ts`, two-store design so listing never deserializes blobs).
- `server:<name>` — fetched from `/maps/` via nginx autoindex JSON (`world/bsp/serverMaps.ts`).

**BSP pipeline**: `world/bsp/bspParser.ts` (GoldSrc v30 only; three-agnostic output, unit-testable in node) → `render/bspWorld.ts` (meshes + merged BVH via three-mesh-bvh). Quake Z-up → three Y-up via (x, z, −y); 1 unit = 1 inch (`BSP_SCALE`). External textures come from WAD3 files (`wadParser.ts`); missing ones get quiet plaster fallbacks. A solid base plane sits level with the map's lowest floor — `floorAt` falls back to it, so there is never space under the map.

**Racing** (`world/track.ts` + `world/race.ts`): data-driven `TrackDef`; gate pass = swept segment vs oriented gate plane (directional, tunnel-proof). Race time is **sim time** accumulated from ticks — pausing freezes everything for free. Gate `yawDeg` must be the **average of incoming and outgoing travel directions** (normal = (−sin yaw, 0, −cos yaw)); exit-direction-only orientation makes hairpin gates uncrossable. BSP maps get tracks from the in-game editor (T/G/U keys, localStorage `fpv_bsp_tracks`) or the folder's `track.json`; starting a BSP race force-clears `settings.freeFly`.

**Combat** (`game/weapon.ts`, `game/barrels.ts`): hitscan resolved in the physics tick — tap fires on the action edge, holding auto-fires (~9 rps) with heat-based spread. The aim direction is the **FPV camera** (body forward rotated by the uptilt setting), so shots land on the HUD crosshair — firing along raw body-forward is a bug, not a simplification. World `sweep` blocks shots; barrels are sphere targets on real floors via `floorAt`, seeded/deterministic. FX (`render/fx.ts`: tracer/muzzle/explosion/impact pools) and SFX (`audio/sfx.ts`, layered procedural WebAudio) are pooled/lazy.

**UI** (`src/ui/`): vanilla DOM, "pit-wall telemetry" design — tokens in `index.html` `:root` (race amber `--accent` is shared with the 3D next-gate color), uppercase micro-labels, tabular monospace numbers. HUD caches element refs and writes only changed values. The calibration wizard (`calibrationWizard.ts`) is a port of the proven `gamepad.js`; its learn mode **edge-detects buttons against a baseline snapshot** because the DJI RC has a bit (0x10) that rests high. Settings panel and wizard edit the *same* Profile objects.

## Three.js gotchas (all bitten in this repo)

- Raw byte vertex-color attributes bypass color management and read as **linear** — route hex through `THREE.Color` (sRGB→linear) or everything washes out pastel.
- `mergeGeometries` returns **null** when mixing indexed + non-indexed geometry (Cylinder is indexed, Icosahedron isn't) — `.toNonIndexed()` first.
- Raycasts respect material side: BSP collision meshes need `DoubleSide` or down-rays skip floors with flipped winding.
- Coplanar `GridHelper`s z-fight the ground plane — offset y slightly.
- The FPV camera is a child of the (hidden-in-FPV) drone group; invisible parents still update matrices.

## localStorage keys

`fpv_settings` (Settings incl. `map`), `fpv_input_profiles` (per-device calibration/rates), `fpv_bsp_tracks` (editor tracks per map id). IndexedDB `fpv_maps` (uploaded BSPs+WADs).

## Reference-only files

`DJI-RC-WEBHID.md` (device spec + calibration model) and `gamepad.js` (original implementation this was ported from) sit at repo root and are **not imported** — consult them for HID report layout questions, but remember the sign-convention divergence above.
