# DJI FPV Remote Controller over WebHID — reference

Reading the **DJI FPV Remote Controller 3** sticks/buttons in a **browser**, for gimbal control in
the web player and as a reference for building a **web-based FPV simulator**. Reverse-engineered
on-device (2026-07-22) and cross-checked against the [`v3rm0n/dji-fpv3`](https://github.com/v3rm0n/dji-fpv3)
macOS DriverKit descriptor and [`Matsemann/mDjiController`](https://github.com/Matsemann/mDjiController).

Implementation in this repo: `appliance/bridge/src/web/gamepad.js` (the `hid*` functions). This doc
is the standalone spec.

---

## TL;DR

- The DJI FPV RC in USB "virtual joystick" mode is a **vendor-defined HID device** — **not serial**,
  and the browser **Gamepad API can't see it**. Use **WebHID** (`navigator.hid`).
- WebHID needs a **one-time user-gesture permission** (device picker). After that the site
  auto-reconnects silently (`navigator.hid.getDevices()`), so it feels like auto-detect.
- One input report, **13 bytes**: 3 button bytes + **5 × int16-LE axes** (±660):
  roll, pitch, throttle, yaw, gimbal-wheel.
- Two gotchas: **vertical stick axes read up = positive** (opposite the gamepad convention), and
  the axis order is **not** gamepad "Mode-2".

---

## 1. Why not Gamepad API or Web Serial

| Approach | Works? | Why |
|---|---|---|
| **Gamepad API** (`navigator.getGamepads()`) | ❌ | The RC's HID usage page is **`0xFF00` (vendor-defined)**. The Gamepad API only surfaces devices with a **Generic-Desktop** usage (Joystick `0x04` / Gamepad `0x05`). So `getGamepads()` returns `[]`. |
| **Web Serial** (`navigator.serial`) | ❌ | The RC is **HID**, not a CDC/ACM serial device — it creates **no `/dev/tty.*` / `/dev/cu.*`** node. (An *older* DJI RC line — Phantom / the one `mDjiController` targets — does speak DUML over a serial COM port at 76-byte frames; that is a **different transport**, not this device.) |
| **WebHID** (`navigator.hid`) | ✅ | Opens vendor-defined HID devices and delivers raw input reports. This is the path. |

**Native simulators auto-detect; a browser can't (silently).** DJI Virtual Flight / Liftoff /
Velocidrone are native apps with full HID access, so they enumerate the RC with zero prompts. A web
page is sandboxed: WebHID requires an explicit user click (`requestDevice`) the first time, for
privacy. After the grant the origin remembers the device and can open it on load — so from the
second visit on it's effectively automatic.

Browser support: **Chromium only** (Chrome / Edge / Brave / Opera). **No Firefox, no Safari, no iOS**.
Secure context required (`https://` or `http://localhost`).

---

## 2. Device identity

```
USB Vendor  0x2CA3  (DJI)
USB Product 0x1021  ("DJI Virtual Joystick")
Model       DJI FPV Remote Controller 3
```

macOS `ioreg -p IOUSB -l | grep -A5 "DJI Virtual Joystick"` shows `bDeviceClass = 0` and the HID
interface exposes a single collection **usage page `0x01` (Generic Desktop) / usage `0x05` (Game
Pad)** once a relabeling driver is active, or the raw vendor page `0xFF00` otherwise. Either way the
**report bytes are identical** — only the descriptor's usage labels differ.

---

## 3. Input report layout (13 bytes, report id 0)

The device sends **one input report**, id `0`, length **13 bytes**, at ~60–70 Hz.

```
byte:  0   1   2   3   4   5   6   7   8   9  10  11  12
      └── buttons ──┘ └ax0─┘ └ax1─┘ └ax2─┘ └ax3─┘ └ax4─┘
       (24 bits)      roll   pitch  thr    yaw    wheel
```

### 3.1 Axes — 5 × signed 16-bit little-endian, range ±660

| Axis | Bytes | Physical control | Flight meaning | HID usage (driver) |
|---|---|---|---|---|
| 0 | 3–4 | right stick L/R | **roll** | X (0x30) |
| 1 | 5–6 | right stick U/D | **pitch** | Rz (0x35) |
| 2 | 7–8 | left stick U/D | **throttle** | Y (0x31) |
| 3 | 9–10 | left stick L/R | **yaw** | Z (0x32) |
| 4 | 11–12 | camera **dial / gimbal wheel** | camera tilt | Slider (0x36) |

- **Encoding**: `int16` little-endian, two's-complement, **centered at 0**, logical range
  **−660 … +660** (from the HID descriptor `Logical Min/Max`).
- **Decode**: `v = lo | (hi << 8); if (v >= 32768) v -= 65536;` then `v / 660` for a −1…1 float.

### 3.2 Buttons — 24 bits across bytes 0–2

The descriptor declares **24 buttons** (Report Count 24 × Report Size 1) in bytes 0, 1, 2. On the
FPV RC 3 **only byte 0 is populated**; bytes 1–2 stay `0x00` (headroom for other models).

Observed byte-0 bits (bit index = button number − 1):

| bit | mask | control |
|---|---|---|
| 1 | 0x02 | button (C1 / customizable) |
| 2 | 0x04 | button (C2 / customizable) |
| 3 | 0x08 | **left-center switch** (one position asserts this bit) |
| 4 | 0x10 | a switch position that **rests HIGH** at idle (see gotcha 3) |
| 5 | 0x20 | record / shutter, etc. |

Decode all 24: `for b in 0..3: for i in 0..8: pressed[b*8+i] = (report[b] >> i) & 1`.

---

## 4. Gotchas (the non-obvious bits)

1. **Vertical sticks report up = POSITIVE.** The two vertical axes (pitch = axis 1, throttle =
   axis 2) increase when you push the stick **up**, which is the *opposite* of the usual gamepad
   convention (up = negative). If your UI/crosshair assumes gamepad convention, **negate axes 1 and
   2**. Horizontal axes (roll 0, yaw 3) and the wheel are already conventional.

2. **Axis order is not gamepad "Mode-2".** A standard Mode-2 gamepad is left = axes 0/1, right =
   axes 2/3. The DJI RC is **right = axes 0/1, left = axes 2/3** (see §3.1). A naive Mode-2 stick
   widget shows the sticks swapped. Assign by the table, not by position.

3. **One button bit rests HIGH.** Byte 0 idles at `0x10` (bit 4 set) — it's a latched switch
   position, not an "always-on flag". If you auto-detect button mappings by "first pressed wins",
   snapshot the button state when learning starts and only accept a bit that transitions
   **unpressed → pressed**, or that rest-high bit gets mislatched.

4. **Not every physical control is exposed.** The **top-right switch** produces **no change in any
   byte** (verified: single Gamepad collection, report id 0 only, no feature reports) — the RC
   handles it internally (drone/goggles function) and never forwards it over USB HID. It cannot be
   read. The **left-center switch** *is* exposed (byte-0 bit 3) but is momentary in one position.

5. **The camera dial IS the 5th axis** (bytes 11–12) — the most natural analog control to map to a
   camera-gimbal tilt in a sim. It just reads 0 until you spin it.

---

## 5. Minimal WebHID reader (copy-paste reference)

```js
const DJI_VID = 0x2ca3;
const FULL = 660;                 // logical full-scale
const SIGN = [1, -1, -1, 1, 1];   // negate pitch(1) + throttle(2) → up = +1

function parse(dv) {
  const b = new Uint8Array(dv.buffer);
  const s16 = (lo, hi) => { const v = b[lo] | (b[hi] << 8); return v >= 32768 ? v - 65536 : v; };
  const axes = [s16(3,4), s16(5,6), s16(7,8), s16(9,10), s16(11,12)]
    .map((v, i) => Math.max(-1, Math.min(1, SIGN[i] * v / FULL)));
  const buttons = [];
  for (let byte = 0; byte < 3; byte++) for (let i = 0; i < 8; i++) buttons.push(!!((b[byte] >> i) & 1));
  return { axes, buttons };        // axes[5] in −1..1, buttons[24] bool
}

// axis semantics: [0]=roll  [1]=pitch  [2]=throttle  [3]=yaw  [4]=gimbal wheel
let device = null, state = { axes: [0,0,0,0,0], buttons: [] };

// (1) one-time grant — MUST be called from a user gesture (click)
async function connect() {
  const [d] = await navigator.hid.requestDevice({ filters: [{ vendorId: DJI_VID }] });
  if (d) await attach(d);
}
// (2) auto-reconnect on load — no gesture needed once granted
async function reconnect() {
  const ds = await navigator.hid.getDevices();
  const d = ds.find(x => x.vendorId === DJI_VID);
  if (d) await attach(d);
}
async function attach(d) {
  if (!d.opened) await d.open();
  device = d;
  d.addEventListener('inputreport', e => { state = parse(e.data); });
}
navigator.hid?.addEventListener('connect',    e => { if (e.device.vendorId === DJI_VID) attach(e.device); });
navigator.hid?.addEventListener('disconnect', e => { if (e.device === device) device = null; });
reconnect();                       // try silent reconnect at startup
// wire connect() to a button's click handler for the first-time grant
```

Read `state.axes` / `state.buttons` in your render/physics loop (rAF). No polling of the device is
needed — `inputreport` fires on every HID frame.

---

## 6. Calibration — complete reference

Raw axis values aren't directly usable: sticks don't reach exactly ±660, centers drift a few counts,
the throttle stick may not self-center, and every unit differs slightly. Calibration turns the raw
per-axis-index value into a clean, per-function control signal. This is the exact model implemented
in `gamepad.js` and it's what makes a controller *feel* right in a sim.

### 6.1 Two layers: hardware calibration vs function mapping

Keep these separate — it's the key design idea (same as a real sim):

- **Hardware calibration** is keyed by **physical axis index** (0–4). It captures each stick's real
  travel (`lo` / `hi` / `center`) once, so `raw → −1…1` is correct regardless of unit spread. Do it
  **once per controller**.
- **Function mapping** is keyed by **logical function** (tilt / pan / roll, or roll/pitch/yaw/throttle
  in a sim). It says *which* axis index drives a function, plus per-function **invert, deadzone,
  expo, mode, rate, min/max**. Re-map freely without re-calibrating.

A function reads its axis by: `raw = pad.axes[map.axis]` → `norm(raw, map.axis)` (hardware cal) →
`deadzone` → `expo` → `invert` → scale to `rate`/`min`/`max`.

### 6.2 Profile data model (localStorage, one per `device.id`)

```jsonc
{
  "enabled": true,
  "axcal": {                    // HARDWARE calibration, keyed by axis INDEX
    "0": { "lo": -0.98, "hi": 1.00, "center": 0.01 },
    "1": { "lo": -1.00, "hi": 0.99, "center": -0.02 }
    // … one entry per physical axis actually used
  },
  "axes": {                     // FUNCTION mapping, keyed by function
    "tilt": { "axis": 1, "invert": false, "deadzone": 0.10, "expo": 0.30,
              "mode": "rate", "rate": 80,  "min": -90,  "max": 25 },
    "pan":  { "axis": 3, "invert": false, "deadzone": 0.10, "expo": 0.30,
              "mode": "rate", "rate": 120, "min": -160, "max": 160 },
    "roll": { "axis": null, "…": "…" }        // null = unmapped
  },
  "buttons": { "arm": 0, "record": 4, "menu_up": 12, "…": null },
  "sens": 1.0                   // runtime sensitivity multiplier
}
```

Store it as `localStorage['tw_gamepad_profiles'] = { "<device.id>": <profile>, … }`. Keying by
`device.id` means each physical controller keeps its own calibration; a new pad gets sensible
defaults on first sight and the user tunes from there. Ship an **export/import** (a plain JSON file)
so profiles move between machines with no server.

### 6.3 The math (exact functions)

```js
// (1) hardware normalize: raw (−1..1 from the parser) → calibrated −1..1 using captured travel.
//     Splitting the span at center handles asymmetric/off-center sticks (e.g. non-self-centering
//     throttle) correctly.
function norm(raw, cal) {                       // cal = axcal[axisIndex] or {lo:-1,hi:1,center:0}
  const r = raw - cal.center;
  const span = r >= 0 ? (cal.hi - cal.center) : (cal.center - cal.lo);
  return Math.max(-1, Math.min(1, r / Math.abs(span || 1)));
}

// (2) deadzone: kill jitter near center, then RESCALE so the usable range still reaches ±1
//     (a plain "if |v|<d then 0" would leave a dead step at the edge of the zone).
function deadzone(v, d) {                        // d in 0..0.5
  return Math.abs(v) < d ? 0 : (v - Math.sign(v) * d) / (1 - d);
}

// (3) expo: soften response near center for fine control, keep full throw at the ends.
//     e=0 → linear, e=1 → pure cubic. Blend keeps monotonic, passes through ±1.
function expo(v, e) { return (1 - e) * v + e * v * v * v; }

// (4) full chain for one mapped function:
function readFunction(pad, map, axcal, sens = 1) {
  if (map.axis == null || map.axis >= pad.axes.length) return 0;
  let v = norm(pad.axes[map.axis], axcal[map.axis] || { lo:-1, hi:1, center:0 });
  v = deadzone(v, map.deadzone);
  v = expo(v, map.expo);
  if (map.invert) v = -v;
  return v * sens;                              // −1..1; scale to rate·dt or min..max next
}
```

- **Rate mode** (recommended for roll/pitch/yaw in FPV): integrate `v` over time —
  `angle += readFunction()·rate·dt`, clamp to `[min,max]`. Full deflection → `rate` deg/s. This is
  how quads/gimbals actually behave and what pilots expect.
- **Absolute mode**: `angle = lerp(min, max, (v+1)/2)` — the stick position *is* the angle. Good for
  a self-centering camera tilt or a throttle bar.

### 6.4 Guided calibration flow (the UX we built)

A sim-style wizard, one screen each, so a first-time user gets a correct profile without knowing any
of the above:

1. **Connect** — pick the device (WebHID grant on first use). Show live per-axis bars + button dots
   so the user can confirm it's alive and see which controls move.
2. **Calibrate sticks** (hardware cal): *"sweep both sticks fully to every corner, then let them
   center."* While sweeping, track `lo = min(raw)`, `hi = max(raw)` per axis index; on the final
   center press, capture `center = raw`. Store into `axcal`. This is the one step that makes ±1
   correct on any unit. Draw a live extent box so the user sees each axis reach its edges.
3. **Map axes** (function mapping): for each function (tilt/pan/roll or roll/pitch/yaw/throttle), a
   **Learn** button — *"move the control for `<function>` toward its POSITIVE direction (up/right),
   fully."* Pick the axis index whose excursion from a start-baseline is largest; if that excursion
   is **negative**, set `invert = true` automatically (sticks read up = negative on most pads;
   auto-invert removes a common footgun). Or let the user pick the axis from a dropdown.
4. **Map buttons**: **Learn** per action. **Edge-detect** — snapshot which buttons are already held
   when Learn starts, and accept only a button that transitions unpressed→pressed. (Essential for
   the DJI RC's rest-high bit; see §4.3.)
5. **Response curve** (per axis): a live plot of input→output through deadzone+expo, recomputed on
   each slider move, with a **magenta dot showing the current stick position through the curve** so
   the user *sees* the feel. Sliders: deadzone, expo, rate, min/max.
6. **Test**: two crosshair stick visualizers + the mapped-function readouts (or the live sim) so the
   user validates everything end-to-end before flying. Arm and confirm the aircraft/gimbal responds.

### 6.5 Practical defaults

- Deadzone `0.08–0.12` (dial/throttle can go lower). Expo `0.2–0.4` for roll/pitch, `0` for
  throttle. Rate: roll/pitch `~200–400 °/s`, yaw `~150 °/s` for a smooth cinematic feel; racers run
  higher. Sensitivity multiplier defaults to `1.0`, exposed as a runtime ±.
- Seed a **per-device default profile** on first connection (e.g. DJI RC → tilt = right-stick
  vertical) so it's usable *before* calibration, then let the wizard refine it.
- Persist on every change; never require a "save" click. Auto-reconnect + auto-load the profile by
  `device.id`.

This repo's `gamepad.js` implements all of §6 (the wizard, the live curve editor, per-axis-index
hardware calibration, edge-detect learn, export/import, and per-device default seeding), and the
`TW.gimbal` arbiter streams the mapped tilt to the bridge — a working end-to-end example.

---

## 7. Reverse-engineering method (to map a different DJI RC / mode)

The device may differ by model/firmware. To re-derive the layout live in the browser:

```js
// after connect(): log distinct per-byte values + which bytes move
const seen = Array.from({length: 13}, () => new Set());
device.addEventListener('inputreport', e => {
  const b = new Uint8Array(e.data.buffer);
  for (let i = 0; i < b.length; i++) seen[i].add(b[i]);
});
// then: move ONE control at a time; the bytes whose Set grows are that control's bytes.
// - a control spanning 2 adjacent bytes across the full 0..255 range = an int16 axis
// - a byte toggling a single bit = a button/switch
```

Guided one-control-at-a-time capture (move left stick only, then right stick only, then each button)
disambiguates axis order and button bits without guessing. Confirm ranges against the HID descriptor
(`device.collections[].inputReports[].items[].logicalMinimum/Maximum`).

---

## 8. Building a web FPV simulator on this

- **Inputs**: `axes[0..3]` = roll/pitch/throttle/yaw → feed a flight model; `axes[4]` = gimbal wheel
  → camera tilt; `buttons` → arm/reset/menu.
- **Feel**: apply calibration → deadzone → expo → rates before the physics step. FPV pilots expect
  **rates** (deg/s at full deflection), not absolute angles, for roll/pitch/yaw.
- **Latency**: `inputreport` is ~60–70 Hz; render on rAF and sample the latest `state` — don't await
  reports in the loop.
- **Fallback**: also support the Gamepad API for non-DJI pads (Xbox/PS) — same normalized
  `{axes, buttons}` shape, so one control layer serves both. In this repo, `activeGp()` returns the
  WebHID pad when present, else a Gamepad-API pad, and the whole calibration/mapping pipeline is
  source-agnostic.
- **Distribution**: Chromium desktop only. Detect with `if (!('hid' in navigator)) …` and show a
  "use Chrome/Edge on desktop" notice on unsupported browsers.

---

## References

- `appliance/bridge/src/web/gamepad.js` — the working implementation (WebHID source + calibration).
- [`v3rm0n/dji-fpv3`](https://github.com/v3rm0n/dji-fpv3) — macOS DriverKit descriptor (authoritative
  byte→usage + ±660 range + 24-button layout).
- [`Matsemann/mDjiController`](https://github.com/Matsemann/mDjiController) — the older serial-DUML
  RC (different transport; useful for the general stick-mapping idea).
- [WebHID API](https://wicg.github.io/webhid/) — spec.
- Repo memory `[[dji-rc-webhid]]`; wire-protocol context in `docs/research/DUML-PROTOCOL.md`.
