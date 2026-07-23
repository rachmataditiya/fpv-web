/** App bootstrap + the one place all subsystems meet.
 *  Flow per frame: input.sample() → stepQuad() → race.update()   (fixed 240 Hz)
 *                  interpolate transform → cameras/HUD/render     (rAF)          */
import * as THREE from 'three';
import { PHYS_DT, startLoop } from './loop';
import { loadSettings, saveSettings } from './state';
import { InputManager } from './input/inputManager';
import { HidSource } from './input/hidSource';
import { GamepadSource } from './input/gamepadSource';
import { KeyboardSource } from './input/keyboardSource';
import { MockHidSource } from './input/mockHidSource';
import type { InputSource } from './input/types';
import { createQuadState, resetQuad, stepQuad } from './physics/quad';
import { DEFAULT_PARAMS } from './physics/params';
import type { CollisionWorld } from './physics/quad';
import { Race } from './world/race';
import { MAPS, customMapDef, resolveMapId } from './world/maps';
import { parseBsp } from './world/bsp/bspParser';
import { parseWad } from './world/bsp/wadParser';
import { loadMap } from './world/bsp/mapStore';
import { saveProfile } from './input/profiles';
import { Weapon } from './game/weapon';
import { BarrelField, BARREL_BLAST_RADIUS } from './game/barrels';
import { FxSystem } from './render/fx';
import { Sfx } from './audio/sfx';
import { buildTrack, deleteTrackFor, exportTrackJson, fetchServerTrack, savedTrackFor, saveTrackFor } from './world/bsp/bspTracks';
import { listServerMaps } from './world/bsp/serverMaps';
import type { GateDef, TrackDef } from './world/track';
import type { RaceEvent } from './world/race';
import type { GateVisuals } from './render/gates';
import { fetchServerMap } from './world/bsp/serverMaps';
import { buildBspWorld } from './render/bspWorld';
import { createScene } from './render/scene';
import { applyEnvironment } from './render/environment';
import { createDroneMesh } from './render/drone';
import { createGates } from './render/gates';
import { CameraRig } from './render/cameras';
import { Hud } from './ui/hud';
import type { HudData } from './ui/hud';
import { ControllerPanel } from './ui/calibrationWizard';
import { SettingsPanel } from './ui/settingsPanel';
import { PauseMenu } from './ui/pauseMenu';
import { MapLibrary } from './ui/mapLibrary';

// ---------- settings + world ----------
const settings = loadSettings();
// ?map= URL param overrides the persisted choice (and re-persists it)
const rawMap = new URLSearchParams(location.search).get('map') ?? settings.map;
const customName = rawMap.startsWith('custom:') ? rawMap.slice('custom:'.length) : null;
const serverName = rawMap.startsWith('server:') ? rawMap.slice('server:'.length) : null;
const bspName = customName ?? serverName;
const mapDef = bspName ? customMapDef(bspName) : MAPS[resolveMapId(rawMap)];
if (settings.map !== mapDef.id) {
  settings.map = mapDef.id;
  saveSettings(settings);
}
const track = mapDef.track; // null on cinematic maps → no race, free-fly
const cinematic = track === null;
const params = DEFAULT_PARAMS;

const mount = document.getElementById('app')!;
const { renderer, scene, setQuality, resize } = createScene(mount);
setQuality(settings.quality);

const droneVisual = createDroneMesh();
scene.add(droneVisual);
let gates: GateVisuals | null = track ? createGates(track) : null;
if (gates) scene.add(gates.group);

// Environment dressing (HDRI sky, terrain, props) loads async — flyable meanwhile.
// Flat zones + prop exclusions = the racing corridor (or just the spawn area).
const corridor = track
  ? track.gates.flatMap((g, i) => {
      const n = track.gates[(i + 1) % track.gates.length];
      // gate circle + midpoint to the next gate, so the whole racing line stays clear
      return [
        { x: g.pos[0], z: g.pos[2], r: 35 },
        { x: (g.pos[0] + n.pos[0]) / 2, z: (g.pos[2] + n.pos[2]) / 2, r: 30 },
      ];
    })
  : [{ x: mapDef.spawn.pos[0], z: mapDef.spawn.pos[2], r: 40 }];
// Physics collision provider — set async: terrain (built-in maps) or BSP.
let collisionWorld: CollisionWorld | undefined;

void applyEnvironment(renderer, scene, mapDef.env, corridor, corridor)
  .then((env) => {
    if (env.terrain) {
      const t = env.terrain;
      collisionWorld = { floorAt: (x, _y, z) => t.heightAt(x, z) };
    }
  })
  .catch((err) => console.warn('environment failed to load, flying with the basic scene', err));

const rig = new CameraRig(scene, droneVisual, {
  fovDeg: settings.fovDeg,
  uptiltDeg: settings.uptiltDeg,
  stiffness: settings.chaseStiffness,
});
rig.setMode(settings.camera);

const hud = new Hud(document.getElementById('hud')!);

// ---------- input ----------
const keyboard = new KeyboardSource();
const gamepad = new GamepadSource();
const useMock = new URLSearchParams(location.search).has('mockhid');
const mock = useMock ? new MockHidSource('sweep') : null;
const hid = useMock ? null : new HidSource();
void hid?.reconnect();

const sources: InputSource[] = [keyboard, gamepad];
if (mock) sources.push(mock);
if (hid) sources.push(hid);
const input = new InputManager(sources);

// ---------- sim state ----------
const quad = createQuadState();
let race: Race | null = track ? new Race(track, settings.bestLapMsByTrack[track.name] ?? null) : null;

// combat (BSP maps get barrels; the weapon exists everywhere but needs targets)
const weapon = new Weapon();
let barrels: BarrelField | null = null;
const fx = new FxSystem(scene);
const sfx = new Sfx();

// track editor (BSP maps)
let editingTrack = false;
let editorGates: GateDef[] = [];
const spawnCheckpoint = {
  pos: new THREE.Vector3(...mapDef.spawn.pos),
  yawDeg: mapDef.spawn.yawDeg,
};
const checkpoint = () => race?.checkpoint ?? spawnCheckpoint;
resetQuad(quad, checkpoint().pos, checkpoint().yawDeg, 0.5);
race?.start();

let message: string | null = null;
let messageUntil = 0;
function flash(msg: string, ms = 1500): void {
  message = msg;
  messageUntil = performance.now() + ms;
}

const onRaceEvent = (e: RaceEvent): void => {
  if (!race) return;
  switch (e.type) {
    case 'go':
      flash('GO!', 800);
      break;
    case 'gate':
      gates?.setNext(race.nextGate);
      sfx.gate();
      break;
    case 'sector':
      flash(`S${e.index + 1}  ${(e.ms / 1000).toFixed(2)}s`, 1200);
      break;
    case 'lap':
      flash(e.best ? `LAP ${(e.ms / 1000).toFixed(2)}s — BEST!` : `LAP ${(e.ms / 1000).toFixed(2)}s`, 2000);
      sfx.lap();
      if (e.best) {
        settings.bestLapMsByTrack[race.track.name] = e.ms;
        saveSettings(settings);
      }
      break;
    case 'oob':
      flash('OUT OF BOUNDS');
      respawn();
      break;
  }
};
if (race) race.onEvent = onRaceEvent;

/** Install a race on the current (BSP) map: fresh Race + gate visuals. */
function startBspRace(t: TrackDef): void {
  // a race on this map is an explicit choice — free-fly would silently disable it
  if (settings.freeFly) {
    settings.freeFly = false;
    saveSettings(settings);
  }
  race = new Race(t, settings.bestLapMsByTrack[t.name] ?? null);
  race.onEvent = onRaceEvent;
  gates?.group.removeFromParent();
  gates = createGates(t);
  scene.add(gates.group);
  gates.setNext(0);
  race.start();
}

function respawn(): void {
  resetQuad(quad, checkpoint().pos, checkpoint().yawDeg, 0.5);
}

function restartRace(): void {
  if (!race) {
    respawn();
    return;
  }
  race.start();
  gates?.setNext(0);
  respawn();
  flash('RACE RESTARTED', 1000);
}

// GoldSrc BSP world (uploaded via IndexedDB or hosted in the server's /maps/
// folder): load → parse → meshes + BVH collision.
if (bspName) {
  void (async () => {
    try {
      const stored = serverName ? await fetchServerMap(serverName) : await loadMap(bspName);
      if (!stored) throw new Error(`map "${bspName}" not found`);
      const wadTex = new Map<string, import('./world/bsp/bspParser').BspTexture>();
      for (const wad of stored.wads) {
        try {
          for (const [k, v] of parseWad(wad)) if (!wadTex.has(k)) wadTex.set(k, v);
        } catch (e) {
          console.warn('WAD skipped:', e);
        }
      }
      const bsp = parseBsp(stored.bsp, wadTex);
      const world = buildBspWorld(bsp);
      scene.add(world.group);
      collisionWorld = world.collision;
      if (bsp.spawns.length) {
        spawnCheckpoint.pos.set(...bsp.spawns[0].pos);
        spawnCheckpoint.yawDeg = bsp.spawns[0].yawDeg;
      }
      respawn();

      // explosive barrels scattered on real floors across the map footprint
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const g of bsp.groups)
        for (let i = 0; i < g.positions.length; i += 3) {
          minX = Math.min(minX, g.positions[i]); maxX = Math.max(maxX, g.positions[i]);
          minZ = Math.min(minZ, g.positions[i + 2]); maxZ = Math.max(maxZ, g.positions[i + 2]);
        }
      barrels = new BarrelField(world.collision, { minX, maxX, minZ, maxZ }, spawnCheckpoint.pos);
      scene.add(barrels.group);

      // race track: player-edited first, then the map folder's published track.json
      let bspTrack = savedTrackFor(rawMap);
      if (!bspTrack && serverName) {
        const sm = (await listServerMaps()).find((m) => m.name === serverName);
        if (sm?.trackUrl) bspTrack = await fetchServerTrack(sm.trackUrl);
      }
      if (bspTrack) {
        startBspRace(bspTrack);
        flash('RACE TRACK LOADED', 1200);
      }
      if (bsp.missingTextures.length)
        flash(`${bsp.missingTextures.length} TEXTURES NEED WADS`, 3000);
      else flash(bspName.toUpperCase(), 1500);
    } catch (err) {
      console.error('BSP load failed', err);
      flash('MAP FAILED TO LOAD — SEE CONSOLE', 4000);
    }
  })();
}

input.onAction = (a) => {
  // While paused only 'pause' (resume) is allowed — edges are still sampled from
  // renderTick so the sim stays controllable, but arming/respawning is blocked.
  if (loop.paused && a !== 'pause') return;
  switch (a) {
    case 'arm':
      if (!quad.armed) {
        // safety: require low throttle to arm (like a real FC). Uses the throttle
        // from the current sample — onAction fires from inside sample(), so
        // calling input.sample() here again would be re-entrant.
        if (lastThrottle < 0.1) {
          quad.armed = true;
          flash('ARMED', 700);
        } else {
          flash('LOWER THROTTLE TO ARM');
        }
      } else {
        quad.armed = false;
        flash('DISARMED', 700);
      }
      break;
    case 'respawn':
      respawn();
      break;
    case 'camera':
      settings.camera = rig.toggle();
      saveSettings(settings);
      break;
    case 'pause':
      togglePause();
      break;
    case 'shoot':
      if (quad.armed && !quad.crashed) weapon.requestFire();
      break;
  }
};

// ---------- controller panel (calibration wizard) ----------
const ui = document.getElementById('ui')!;
const panel = new ControllerPanel(ui, {
  input,
  hid,
  onProfileChanged: () => input.applyProfile(),
});
// Bottom dock — pit-wall style: uppercase micro-labels, hairline separators.
const dock = document.createElement('div');
dock.innerHTML = `
  <style>
    .dock{position:fixed;left:16px;bottom:12px;z-index:25;display:flex;align-items:stretch;
      pointer-events:auto;background:var(--panel);border:1px solid var(--line2);border-radius:9px;
      overflow:hidden;backdrop-filter:blur(6px)}
    .dock button{appearance:none;background:none;border:none;color:var(--mut);cursor:pointer;
      font:700 9.5px system-ui;letter-spacing:.16em;text-transform:uppercase;padding:9px 14px;
      border-right:1px solid var(--line)}
    .dock button:last-child{border-right:none}
    .dock button:hover{color:var(--fg);background:var(--panel2)}
    .dock button:focus-visible{outline:2px solid var(--amber);outline-offset:-2px}
    .dock button b{color:var(--amber);font-weight:800}
  </style>
  <div class="dock">
    <button data-d="ctrl">Controller <b>C</b></button>
    <button data-d="map"></button>
    <button data-d="lib">Custom maps</button>
    <button data-d="set">Settings</button>
  </div>`;
ui.appendChild(dock);
const dockMapBtn = dock.querySelector('[data-d="map"]') as HTMLButtonElement;
dockMapBtn.innerHTML = bspName
  ? `Map: ${bspName} — go <b>Race</b>`
  : mapDef.id === 'canyon'
    ? 'Map: Race — go <b>Cinematic</b>'
    : 'Map: Cinematic — go <b>Race</b>';
(dock.querySelector('[data-d="ctrl"]') as HTMLButtonElement).onclick = () =>
  panel.isOpen ? panel.close() : panel.open();
dockMapBtn.onclick = () => {
  settings.map = bspName ? 'canyon' : mapDef.id === 'canyon' ? 'valley' : 'canyon';
  saveSettings(settings);
  const url = new URL(location.href);
  url.searchParams.delete('map');
  location.href = url.toString();
};
(dock.querySelector('[data-d="set"]') as HTMLButtonElement).onclick = () => settingsPanel.open();
function flyTo(mapId: string): void {
  settings.map = mapId;
  saveSettings(settings);
  const url = new URL(location.href);
  url.searchParams.set('map', mapId);
  location.href = url.toString();
}
const mapLibrary = new MapLibrary(ui, {
  flyMap: (name) => flyTo(`custom:${name}`),
  flyServerMap: (name) => flyTo(`server:${name}`),
});
(dock.querySelector('[data-d="lib"]') as HTMLButtonElement).onclick = () => mapLibrary.open();

// ---------- pause menu + settings panel ----------
function togglePause(): void {
  if (loop.paused) {
    pauseMenu.hide();
    loop.setPaused(false);
  } else {
    loop.setPaused(true);
    pauseMenu.show();
  }
}
const pauseMenu = new PauseMenu(ui, {
  resume: () => togglePause(),
  restart: () => {
    restartRace();
    togglePause();
  },
  openSettings: () => settingsPanel.open(), // stays paused underneath
});
const settingsPanel = new SettingsPanel(ui, {
  settings,
  apply: {
    quality: (q) => setQuality(q),
    uptilt: (deg) => rig.setUptilt(deg),
    fov: (deg) => rig.setFov(deg),
    chaseStiffness: (w) => rig.setStiffness(w),
    freeFly: (on) => {
      if (!on) restartRace(); // leaving free-fly = fresh race
    },
  },
  save: () => saveSettings(settings),
  rates: {
    get: () => {
      const pad = input.activePad();
      const prof = input.activeProfile();
      return pad && prof ? { deviceId: pad.id, profile: prof } : null;
    },
    persist: () => {
      const pad = input.activePad();
      const prof = input.activeProfile();
      if (pad && prof) saveProfile(pad.id, prof); // same object the manager reads — live immediately
    },
  },
  bspTrack: bspName
    ? {
        toggleEditor: toggleTrackEditor,
        canExport: () => savedTrackFor(rawMap) !== null,
        exportJson: () => {
          const t = savedTrackFor(rawMap);
          if (t) exportTrackJson(t);
        },
      }
    : undefined,
  openControllerPanel: () => panel.open(),
  restartRace,
});

// ---------- BSP track editor: T toggle, G place gate at drone, U undo ----------
function editorPreview(): void {
  gates?.group.removeFromParent();
  gates = null;
  if (editorGates.length > 0) {
    const preview = buildTrack('preview', editorGates, { pos: [...spawnCheckpoint.pos.toArray()] as [number, number, number], yawDeg: spawnCheckpoint.yawDeg });
    gates = createGates(preview);
    scene.add(gates.group);
    gates.setNext(editorGates.length - 1); // highlight the newest gate
  }
}

function toggleTrackEditor(): void {
  if (!bspName) return;
  if (!editingTrack) {
    editingTrack = true;
    race = null;
    editorGates = savedTrackFor(rawMap)?.gates.map((g) => ({ ...g, pos: [...g.pos] as [number, number, number], size: { ...g.size } })) ?? [];
    editorPreview();
    flash('TRACK EDITOR — G: GATE · U: UNDO · T: SAVE', 3000);
  } else {
    editingTrack = false;
    if (editorGates.length >= 2) {
      const t = buildTrack(`${bspName} circuit`, editorGates, {
        pos: [...spawnCheckpoint.pos.toArray()] as [number, number, number],
        yawDeg: spawnCheckpoint.yawDeg,
      });
      saveTrackFor(rawMap, t);
      startBspRace(t);
      flash(`TRACK SAVED — ${editorGates.length} GATES, RACE ON`, 2000);
    } else if (editorGates.length === 0) {
      deleteTrackFor(rawMap);
      gates?.group.removeFromParent();
      gates = null;
      flash('TRACK CLEARED — FREE FLY', 1500);
    } else {
      flash('NEED ≥2 GATES — NOT SAVED', 2000);
    }
  }
}

const _eEuler = new THREE.Euler();
function placeEditorGate(): void {
  if (!editingTrack) return;
  _eEuler.setFromQuaternion(quad.q, 'YXZ');
  editorGates.push({
    pos: [+quad.pos.x.toFixed(2), +quad.pos.y.toFixed(2), +quad.pos.z.toFixed(2)],
    yawDeg: +((_eEuler.y * 180) / Math.PI).toFixed(1),
    size: { w: 4, h: 4 },
    kind: 'square',
  });
  editorPreview();
  flash(`GATE ${editorGates.length} PLACED`, 800);
}

// Shift+R restarts the whole race (R alone = respawn at checkpoint); C = controller panel.
addEventListener('keydown', (e) => {
  if (e.code === 'KeyR' && e.shiftKey) restartRace();
  if (e.code === 'KeyC' && !panel.isOpen) panel.open();
  if (panel.isOpen || settingsPanel.isOpen || mapLibrary.isOpen) return; // no editor keys under panels
  if (e.code === 'KeyT') toggleTrackEditor();
  if (e.code === 'KeyG') placeEditorGate();
  if (e.code === 'KeyU' && editingTrack && editorGates.length) {
    editorGates.pop();
    editorPreview();
    flash(`UNDO — ${editorGates.length} GATES`, 700);
  }
});

// ---------- non-Chromium notice ----------
if (!useMock && !HidSource.supported()) {
  const n = document.createElement('div');
  n.style.cssText =
    'position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:30;background:var(--panel2);' +
    'border:1px solid var(--line2);border-radius:8px;padding:8px 14px;font-size:12px;color:var(--mut)';
  n.textContent = 'WebHID not available in this browser — DJI RC needs Chrome/Edge on desktop. Keyboard & gamepads still work.';
  document.getElementById('ui')!.appendChild(n);
  setTimeout(() => n.remove(), 8000);
}

// ---------- fixed-timestep sim + interpolated render ----------
const prevPos = new THREE.Vector3();
const prevQ = new THREE.Quaternion();
const renderPos = new THREE.Vector3();
const renderQ = new THREE.Quaternion();
let lastThrottle = 0;

const hudData: HudData = {
  armed: false,
  throttle: 0,
  speedMs: 0,
  altitudeM: 0,
  rollRad: 0,
  pitchRad: 0,
  lapMs: null,
  lastLapMs: null,
  bestLapMs: null,
  lap: 0,
  gateIndex: 0,
  gateCount: track ? track.gates.length : 0,
  mode: cinematic || settings.freeFly ? 'freefly' : 'race',
  camera: settings.camera,
  countdown: null,
  message: null,
  score: null,
};

const _e = new THREE.Euler();
const _aimQ = new THREE.Quaternion();
const _uptiltQ = new THREE.Quaternion();
const _aimX = new THREE.Vector3(1, 0, 0);

const hooks = {
  simTick(dt: number) {
    keyboard.tick(dt);
    mock?.tick(performance.now());

    const cmd = input.sample();
    lastThrottle = cmd.throttle;

    prevPos.copy(quad.pos);
    prevQ.copy(quad.q);

    const crashedNow = stepQuad(quad, cmd, params, dt, collisionWorld);
    // BSP maps have no track bounds — falling off the world respawns
    if (bspName && quad.pos.y < -80) respawn();
    if (crashedNow) flash('CRASHED');
    if (quad.crashed && quad.crashTimer <= 0) respawn();

    if (race && !settings.freeFly && !editingTrack) race.update(dt, prevPos, quad.pos);

    // weapon + barrels — hold to auto-fire; aim follows the FPV CAMERA (body
    // forward rotated up by the camera uptilt) so shots land on the crosshair.
    if (quad.armed && !quad.crashed && input.held('shoot')) weapon.requestFire();
    _uptiltQ.setFromAxisAngle(_aimX, (settings.uptiltDeg * Math.PI) / 180);
    _aimQ.copy(quad.q).multiply(_uptiltQ);
    const shot = weapon.tick(dt, quad.pos, _aimQ, collisionWorld, barrels?.targets ?? []);
    if (shot) {
      fx.tracer(shot.from, shot.to);
      fx.muzzle(shot.from);
      if (shot.hitWorld) fx.impact(shot.to);
      sfx.shoot();
      if (shot.targetIndex !== null && barrels) {
        const boomAt = barrels.explode(shot.targetIndex);
        fx.explosion(boomAt);
        sfx.explode();
        flash(`BARREL ${barrels.score}`, 700);
        if (quad.pos.distanceTo(boomAt) < BARREL_BLAST_RADIUS) {
          quad.crashed = true;
          quad.crashTimer = params.respawnDelay;
          quad.vel.set(0, 0, 0);
          quad.thrust = 0;
          flash('CAUGHT IN THE BLAST!');
        }
      }
    }
    barrels?.tick(dt);
  },

  renderTick(alpha: number, frameDt: number) {
    // Paused: simTick stops, so keep sampling here or mapped buttons (incl. the
    // pause button itself) would go dead and the game could never resume.
    if (loop.paused) {
      keyboard.tick(frameDt);
      input.sample();
    }
    // interpolate between the last two physics states for smooth rendering
    renderPos.lerpVectors(prevPos, quad.pos, alpha);
    renderQ.slerpQuaternions(prevQ, quad.q, alpha);
    droneVisual.position.copy(renderPos);
    droneVisual.quaternion.copy(renderQ);

    rig.update(frameDt);
    fx.update(frameDt);

    // HUD (attitude from render quaternion; YXZ = yaw→pitch→roll order)
    _e.setFromQuaternion(renderQ, 'YXZ');
    hudData.armed = quad.armed;
    hudData.throttle = lastThrottle;
    hudData.speedMs = quad.vel.length();
    hudData.altitudeM = renderPos.y;
    hudData.pitchRad = _e.x;
    hudData.rollRad = -_e.z;
    const lapMs = race?.currentLapMs() ?? null;
    hudData.lapMs = lapMs;
    hudData.lastLapMs = race?.lastLapMs ?? null;
    hudData.bestLapMs = race?.bestLapMs ?? null;
    hudData.lap = race ? race.lap + (lapMs !== null ? 1 : 0) : 0;
    hudData.gateIndex = race?.nextGate ?? -1;
    hudData.gateCount = race ? race.track.gates.length : 0;
    hudData.mode = race && !settings.freeFly && !editingTrack ? 'race' : 'freefly';
    hudData.score = barrels ? barrels.score : null;
    hudData.camera = rig.getMode();
    const cd = race && !settings.freeFly ? race.countdownLeft() : null;
    hudData.countdown = cd !== null ? Math.ceil(cd) : null;
    if (message && performance.now() > messageUntil) message = null;
    hudData.message = loop.paused ? 'PAUSED — ESC TO RESUME' : message;
    hud.update(hudData);

    renderer.render(scene, rig.camera);
  },
};

const loop = startLoop(hooks);

gates?.setNext(0);

addEventListener('resize', () => {
  resize();
  rig.resize();
});

// expose for console debugging
Object.assign(window as unknown as Record<string, unknown>, {
  __fpv: {
    quad, settings, params, input, weapon, fx, dt: PHYS_DT,
    get race() { return race; },
    get barrels() { return barrels; },
    /** Drive N physics ticks + one render manually (rAF-independent test hook). */
    step(n = 240): void {
      for (let i = 0; i < n; i++) hooks.simTick(PHYS_DT);
      hooks.renderTick(0, PHYS_DT);
    },
  },
});
