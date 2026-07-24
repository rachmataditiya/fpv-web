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
import type { WeaponId } from './game/weapon';
import { BarrelField, BARREL_BLAST_RADIUS, BARREL_BLAST_BOT_DAMAGE } from './game/barrels';
import { PickupField } from './game/pickups';
import { TargetRegistry } from './game/targetRegistry';
import { PlayerHealth } from './game/playerHealth';
import { BotManager } from './game/bots/botManager';
import { DEFAULT_SQUAD } from './game/bots/types';
import { ReplayRecorder, ReplayPlayer } from './game/replay';
import type { QuadSnapshot } from './game/replay';
import { FxSystem } from './render/fx';
import { Sfx } from './audio/sfx';
import { EngineAudio } from './audio/engineAudio';
import { Atmosphere } from './render/atmosphere';
import { WEATHERS } from './game/weatherTable';
import type { WeatherId } from './game/weatherTable';
import { RagdollPool } from './render/ragdoll';
import { DecalPool } from './render/decals';
import { GrenadePool, GRENADE_BLAST_RADIUS, GRENADE_BOT_DAMAGE, GRENADE_PLAYER_DAMAGE } from './game/grenades';
import type { BotDiedEvent } from './game/bots/types';
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
// Persist the RAW map ref for BSP maps — mapDef.id collapses both sources to
// "custom:<name>", so a server map visited once would break every later plain
// visit ("map not found" in an empty IndexedDB).
const persistId = bspName ? rawMap : mapDef.id;
if (settings.map !== persistId) {
  settings.map = persistId;
  saveSettings(settings);
}
const track = mapDef.track; // null on cinematic maps → no race, free-fly
const cinematic = track === null;
const params = DEFAULT_PARAMS;

const mount = document.getElementById('app')!;
const { renderer, scene, setQuality, resize } = createScene(mount);
setQuality(settings.quality);

// player quad keeps the friendly orange accent — red is the enemy read
const droneVisual = createDroneMesh({ accent: 0xff8800 });
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
const targetRegistry = new TargetRegistry();
const playerHealth = new PlayerHealth(100);
let barrels: BarrelField | null = null;
let pickups: PickupField | null = null;
let pickupMeshes: THREE.Group[] = [];
let pickupPhase = 0; // render-only bob/spin accumulator (frameDt-driven)
let bots: BotManager | null = null;
/** Builds bots identical to the live set — stored by the BSP-load closure so
 *  killcam playback bots match exactly (world/bounds/spawns/squad/seed/diff). */
let makeBots: (() => BotManager) | null = null;
const fx = new FxSystem(scene);
const sfx = new Sfx();
sfx.setVolume(settings.volume);
const engine = new EngineAudio();
engine.setVolume(settings.volume);
const atmosphere = new Atmosphere(scene);
const ragdolls = new RagdollPool(scene);
const decals = new DecalPool(scene);
const grenades = new GrenadePool();
scene.add(grenades.group);

/** Grenade detonation: FX + bots + barrel chain + the pilot if they linger. */
function onGrenadeBlast(pos: THREE.Vector3): void {
  fx.explosion(pos);
  sfx.explode();
  if (bots) {
    for (const died of bots.blast(pos, GRENADE_BLAST_RADIUS, GRENADE_BOT_DAMAGE)) {
      recorder.logEvent('bot-died', [died.pos.x, died.pos.y, died.pos.z]);
      fx.explosion(died.pos);
      spawnCorpse(died);
      hud.pulseKill();
      flash(`${died.kind === 'drone' ? 'DRONE' : 'SOLDIER'} BOMBED — ${bots.kills}`, 900);
    }
  }
  if (barrels) {
    // chain reaction: barrels inside the blast go up too
    const bt = barrels.targets;
    for (let i = 0; i < bt.length; i++) {
      if (bt[i].alive && bt[i].pos.distanceTo(pos) < GRENADE_BLAST_RADIUS) {
        onBarrelBoom(barrels.explode(i));
      }
    }
  }
  if (!quad.crashed && quad.pos.distanceTo(pos) < GRENADE_BLAST_RADIUS) {
    hud.pulseDamage();
    if (playerHealth.damage(GRENADE_PLAYER_DAMAGE)) killPlayer(-1);
    else flash('TOO CLOSE TO YOUR OWN GRENADE!');
  }
}
const _corpseImpulse = new THREE.Vector3();

/** Soldier deaths hand the corpse to the ragdoll pool (manager skips its
 *  crumple via externalSoldierCorpses); drones keep the tumble+smoke anim. */
function spawnCorpse(died: BotDiedEvent): void {
  if (died.kind !== 'soldier') return;
  _corpseImpulse.subVectors(died.pos, quad.pos);
  const d = _corpseImpulse.length() || 1;
  _corpseImpulse.multiplyScalar(4.5 / d).y = 2.5; // shot direction + a pop upward
  ragdolls.spawn(died.pos, _corpseImpulse);
}

const ragdollFloor = (x: number, z: number): number | null =>
  collisionWorld ? collisionWorld.floorAt(x, 200, z) : null;

/** Weather is the BSP war-mode dressing — built-in maps keep their HDRI sky. */
function applyWeather(w: WeatherId): void {
  if (!bspName) return;
  atmosphere.apply(w);
  bots?.setWeather(WEATHERS[w].visibilityFactor, WEATHERS[w].hearingFactor);
}

// heavy-rocket visuals — additive sprites synced to whichever bot manager is
// on screen (live, or the killcam playback manager)
const rocketSprites: THREE.Sprite[] = [];
for (let i = 0; i < 8; i++) {
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({
      color: 0xff5522,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    }),
  );
  s.scale.setScalar(0.35);
  s.visible = false;
  scene.add(s);
  rocketSprites.push(s);
}

// replay recording (Wave 2): inputs + full-state snapshots every sim tick —
// the sim is deterministic from (snapshot + input stream), so this is all the
// killcam needs. Zero behavioral impact on the live path.
const recorder = new ReplayRecorder();
const snapQuad = (): QuadSnapshot => ({
  pos: quad.pos.toArray(),
  vel: quad.vel.toArray(),
  quat: quad.q.toArray(),
  angVel: quad.omega.toArray(),
  thrust: quad.thrust,
  armed: quad.armed,
  crashed: quad.crashed,
  crashTimer: quad.crashTimer,
});
recorder.captureFn = () => ({
  quad: snapQuad(),
  hp: playerHealth.hp,
  weapon: weapon.serialize(),
  bots: bots ? bots.serialize() : null,
});

// track editor (BSP maps)
let editingTrack = false;
let editorGates: GateDef[] = [];
/** BSP maps: a track that exists but hasn't been started (war mode default). */
let pendingBspTrack: TrackDef | null = null;
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

// ---------- player arsenal (Wave 4): blaster / burst / railgun ----------
const WEAPON_CYCLE: readonly WeaponId[] = ['blaster', 'burst', 'railgun'];
let currentWeapon: WeaponId = 'blaster';
function switchWeapon(id: WeaponId): void {
  if (id === currentWeapon) return;
  currentWeapon = id;
  weapon.setConfig(id);
  flash(weapon.config.name, 700);
}

/** Procedural pickup icon: octahedron core + wireframe shell ring, tinted
 *  per weapon (blaster green / burst amber / railgun cyan). */
const PICKUP_COLORS: Record<WeaponId, number> = { blaster: 0x3ddc84, burst: 0xffb020, railgun: 0x49c8ff };
function createPickupMesh(id: WeaponId): THREE.Group {
  const color = PICKUP_COLORS[id];
  const core = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.25),
    new THREE.MeshBasicMaterial({ color }),
  );
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.42, 0.02, 8, 32),
    new THREE.MeshBasicMaterial({ color, wireframe: true }),
  );
  const g = new THREE.Group();
  g.add(core, ring);
  return g;
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
  playerHealth.reset();
}

// ---------- killcam (Wave 2): replay the last ~5s from the killer's POV ----------
let killcam: { player: ReplayPlayer; killerIdx: number } | null = null;

function startKillcam(killerIdx: number): void {
  if (!bots || !collisionWorld || !makeBots || killerIdx < 0) return;
  const player = new ReplayPlayer({
    world: collisionWorld,
    params,
    checkpoint: checkpoint(),
    oobY: bspName ? -80 : null,
    uptiltDeg: settings.uptiltDeg,
    makeBots,
    fx,
  });
  // ~5s back; load clamps to the oldest snapshot when the buffer is younger
  if (!player.load(recorder.data(), recorder.tickIndex - 1200)) return;
  if (!player.bots) return; // snapshot predates the bot spawn — nothing to watch
  scene.add(player.bots.group);
  bots.group.visible = false;
  // the shared camera is driven directly this frame on: re-parent it to the
  // scene root (FPV mode parents it to the drone group, so a plain
  // position/lookAt would be in drone-local space)
  scene.add(rig.camera);
  rig.camera.rotation.set(0, 0, 0);
  droneVisual.visible = true; // your own drone is the star of the replay
  killcam = { player, killerIdx };
}

function endKillcam(): void {
  if (!killcam) return;
  if (killcam.player.bots) scene.remove(killcam.player.bots.group);
  if (bots) bots.group.visible = true;
  killcam = null;
  // restore the rig's camera parenting/transforms (setMode no-ops on the same
  // mode, so hop away and back to force applyMode)
  const mode = rig.getMode();
  rig.setMode(mode === 'fpv' ? 'chase' : 'fpv');
  rig.setMode(mode);
  respawn();
  flash('YOU DIED', 900);
}

/** Lethal damage to the player (bot shot or heavy-rocket blast): crash +
 *  death cam. killerIdx < 0 (blasts) skips the killer-POV killcam. */
function killPlayer(killerIdx: number): void {
  quad.crashed = true;
  quad.crashTimer = params.respawnDelay;
  quad.vel.set(0, 0, 0);
  quad.thrust = 0;
  flash('YOU DIED');
  recorder.logEvent('player-died', [quad.pos.x, quad.pos.y, quad.pos.z]);
  if (killerIdx >= 0 && settings.killcam) startKillcam(killerIdx);
}

/** A barrel went boom at pos (player shot or blast chain reaction): FX, bot
 *  area damage, and the too-close player crash check. */
function onBarrelBoom(pos: THREE.Vector3): void {
  fx.explosion(pos);
  const boomDist = quad.pos.distanceTo(pos);
  if (boomDist > 30) sfx.explodeFar(Math.min(1, boomDist / 100));
  else sfx.explode();
  if (bots) {
    for (const died of bots.blast(pos, BARREL_BLAST_RADIUS, BARREL_BLAST_BOT_DAMAGE)) {
      recorder.logEvent('bot-died', [died.pos.x, died.pos.y, died.pos.z]);
      fx.explosion(died.pos);
      spawnCorpse(died);
      hud.pulseKill();
      flash(`${died.kind === 'drone' ? 'DRONE' : 'SOLDIER'} CAUGHT IN THE BLAST — ${bots.kills}`, 900);
    }
  }
  if (quad.pos.distanceTo(pos) < BARREL_BLAST_RADIUS) {
    quad.crashed = true;
    quad.crashTimer = params.respawnDelay;
    quad.vel.set(0, 0, 0);
    quad.thrust = 0;
    flash('CAUGHT IN THE BLAST!');
  }
}

function restartRace(): void {
  if (!race) {
    // war mode with a track waiting → the restart button STARTS the race
    if (pendingBspTrack) {
      startBspRace(pendingBspTrack);
      respawn();
      flash('RACE ON!', 1200);
      return;
    }
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
      // custom: falls back to the server folder — heals settings persisted by
      // the old build that collapsed server:<name> into custom:<name>
      const stored = serverName
        ? await fetchServerMap(serverName)
        : (await loadMap(bspName)) ?? (await fetchServerMap(bspName).catch(() => null));
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
      const bf = new BarrelField(world.collision, { minX, maxX, minZ, maxZ }, spawnCheckpoint.pos, 1337, world.geometryFloorAt);
      barrels = bf;
      scene.add(bf.group);
      targetRegistry.register({
        get targets() { return bf.targets; },
        onHit: (i) => {
          const boomAt = bf.explode(i);
          flash(`BARREL ${bf.score}`, 700);
          onBarrelBoom(boomAt);
        },
      });

      // weapon pickups scattered on real floors (burst/railgun/blaster mix)
      const pf = new PickupField(world.collision, { minX, maxX, minZ, maxZ }, spawnCheckpoint.pos, 7331, world.geometryFloorAt);
      pickups = pf;
      pickupMeshes = pf.pickups.map((p) => {
        const m = createPickupMesh(p.weapon);
        m.position.copy(p.pos);
        m.visible = p.alive;
        scene.add(m);
        return m;
      });

      // enemy bots (war mode): the 5-bot squad (rifle/sniper/heavy soldiers +
      // scout/rifle drones), spawned on real floors
      if (settings.bots) {
        // factory preserved for killcam playback bots (identical construction)
        const botDifficulty = settings.botDifficulty;
        makeBots = () =>
          new BotManager(
            world.collision,
            { minX, maxX, minZ, maxZ },
            spawnCheckpoint.pos,
            world.geometryFloorAt,
            bsp.spawns.slice(1), // the map's unused player spawns make natural bot posts
            DEFAULT_SQUAD,
            4242,
            { difficulty: botDifficulty, fx },
          );
        const bm = makeBots();
        bots = bm;
        bm.externalSoldierCorpses = true; // live deaths ragdoll; killcam bots keep the crumple
        scene.add(bm.group);
        applyWeather(settings.weather);
        targetRegistry.register({
          get targets() { return bm.targets; },
          onHit: (i, damage) => {
            const died = bm.hit(i, damage);
            if (died) {
              recorder.logEvent('bot-died', [died.pos.x, died.pos.y, died.pos.z]);
              fx.explosion(died.pos);
              sfx.explode();
              spawnCorpse(died);
              hud.pulseKill();
              flash(`${died.kind === 'drone' ? 'DRONE' : 'SOLDIER'} DOWN — ${bm.kills}`, 900);
            } else {
              fx.impact(bm.targets[i].pos);
            }
          },
        });
      }

      // race track: player-edited first, then the map folder's published
      // track.json. NOT auto-started — BSP maps default to WAR mode (free fly
      // + barrels); the restart button starts the race when wanted.
      pendingBspTrack = savedTrackFor(rawMap);
      if (!pendingBspTrack && serverName) {
        const sm = (await listServerMaps()).find((m) => m.name === serverName);
        if (sm?.trackUrl) pendingBspTrack = await fetchServerTrack(sm.trackUrl);
      }
      if (pendingBspTrack) flash('WAR MODE — RESTART BUTTON STARTS THE RACE', 2500);
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
  // Killcam: FIRE/RESPAWN skips back to live; every other action except pause
  // is swallowed so the frozen live sim isn't touched mid-replay.
  if (killcam) {
    if (a === 'shoot' || a === 'respawn') endKillcam();
    if (a !== 'pause') return;
  }
  // While paused only 'pause' (resume) is allowed — edges are still sampled from
  // renderTick so the sim stays controllable, but arming/respawning is blocked.
  if (loop.paused && a !== 'pause') return;
  switch (a) {
    case 'arm':
      recorder.recordAction('arm');
      if (!quad.armed) {
        // safety: require low throttle to arm (like a real FC). Uses the throttle
        // from the current sample — onAction fires from inside sample(), so
        // calling input.sample() here again would be re-entrant.
        if (lastThrottle < 0.1) {
          quad.armed = true;
          flash('ARMED', 700);
          if (!ambienceOn) {
            sfx.startAmbience(bspName ? 'desert' : 'nature');
            ambienceOn = true;
          }
        } else {
          flash('LOWER THROTTLE TO ARM');
        }
      } else {
        quad.armed = false;
        flash('DISARMED', 700);
      }
      break;
    case 'respawn':
      recorder.recordAction('respawn');
      respawn();
      break;
    case 'grenade':
      if (quad.armed && !quad.crashed) {
        if (grenades.drop(quad.pos, quad.vel)) flash('GRENADE OUT', 600);
        else flash('GRENADE RELOADING…', 500);
      }
      break;
    case 'camera':
      settings.camera = rig.toggle();
      saveSettings(settings);
      break;
    case 'pause':
      togglePause();
      break;
    case 'shoot':
      recorder.recordAction('shoot');
      if (quad.armed && !quad.crashed) weapon.requestFire();
      break;
    case 'restart':
      restartRace();
      break;
    case 'weapon1':
      switchWeapon('blaster');
      break;
    case 'weapon2':
      switchWeapon('burst');
      break;
    case 'weapon3':
      switchWeapon('railgun');
      break;
    case 'weaponNext':
      switchWeapon(WEAPON_CYCLE[(WEAPON_CYCLE.indexOf(currentWeapon) + 1) % WEAPON_CYCLE.length]);
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
    bots: (on) => flash(on ? 'BOTS ON — NEXT MAP LOAD' : 'BOTS OFF — NEXT MAP LOAD'),
    botDifficulty: (d) => flash(`BOT DIFFICULTY: ${d.toUpperCase()} — NEXT MAP LOAD`),
    volume: (v) => {
      sfx.setVolume(v);
      engine.setVolume(v);
    },
    killcam: (on) => flash(on ? 'KILLCAM ON' : 'KILLCAM OFF', 700),
    weather: (w) => {
      if (!bspName) {
        flash('WEATHER APPLIES ON BSP MAPS', 1200);
        return;
      }
      applyWeather(w);
      flash(WEATHERS[w].label.toUpperCase(), 900);
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
      pendingBspTrack = t;
      startBspRace(t);
      flash(`TRACK SAVED — ${editorGates.length} GATES, RACE ON`, 2000);
    } else if (editorGates.length === 0) {
      deleteTrackFor(rawMap);
      pendingBspTrack = null;
      race = null;
      gates?.group.removeFromParent();
      gates = null;
      flash('TRACK CLEARED — WAR MODE', 1500);
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
  hp: null,
  kills: null,
  weaponName: null,
  weaponMeter: null,
  weaponMeterLabel: null,
};

const _e = new THREE.Euler();
const _hitEuler = new THREE.Euler();
const _aimQ = new THREE.Quaternion();
const _uptiltQ = new THREE.Quaternion();
const _aimX = new THREE.Vector3(1, 0, 0);
const _kcEye = new THREE.Vector3(); // killcam killer-eye anchor
const _decalDir = new THREE.Vector3();
const _decalEnd = new THREE.Vector3();
let whirrAcc = 0; // sim seconds since the last enemy-drone whirr ping
let ambienceOn = false;

const hooks = {
  simTick(dt: number) {
    keyboard.tick(dt);
    mock?.tick(performance.now());

    if (killcam) {
      // sample() can END the killcam synchronously (FIRE/RESPAWN skip fires
      // from inside it) — re-check before dereferencing, or this null-derefs.
      input.sample();
      if (killcam && !killcam.player.step(dt)) endKillcam();
      return; // live sim is frozen while the replay runs
    }

    const cmd = input.sample();
    lastThrottle = cmd.throttle;
    recorder.recordTick(cmd, input.held('shoot'));

    prevPos.copy(quad.pos);
    prevQ.copy(quad.q);

    const crashedNow = stepQuad(quad, cmd, params, dt, collisionWorld);
    // BSP maps have no track bounds — falling off the world respawns
    if (bspName && quad.pos.y < -80) respawn();
    if (crashedNow) flash('CRASHED');
    if (quad.crashed && quad.crashTimer <= 0) respawn();

    if (race && !settings.freeFly && !editingTrack) race.update(dt, prevPos, quad.pos);

    // weapon + barrels — trigger level drives auto-fire (instant configs) or
    // the railgun charge; aim follows the FPV CAMERA (body forward rotated up
    // by the camera uptilt) so shots land on the crosshair.
    weapon.setTriggerHeld(quad.armed && !quad.crashed && input.held('shoot'));
    const chargeWas = weapon.charge01();
    _uptiltQ.setFromAxisAngle(_aimX, (settings.uptiltDeg * Math.PI) / 180);
    _aimQ.copy(quad.q).multiply(_uptiltQ);
    const shot = weapon.tick(dt, quad.pos, _aimQ, collisionWorld, targetRegistry.collect());
    if (chargeWas === 0 && weapon.charge01() > 0) sfx.chargeUp(); // charge-start edge
    if (shot) {
      recorder.logEvent('shot', [shot.from.x, shot.from.y, shot.from.z, shot.to.x, shot.to.y, shot.to.z]);
      if (currentWeapon === 'railgun') {
        fx.tracerThick(shot.from, shot.to); // includes the bigger muzzle
        sfx.railgun();
      } else {
        fx.tracer(shot.from, shot.to);
        fx.muzzle(shot.from);
        if (currentWeapon === 'burst') sfx.burst();
        else sfx.shoot();
      }
      if (shot.hitWorld) {
        fx.impact(shot.to);
        // bullet mark: re-sweep a hair past the impact to recover the surface normal
        if (collisionWorld?.sweep) {
          _decalDir.subVectors(shot.to, shot.from).normalize();
          _decalEnd.copy(shot.to).addScaledVector(_decalDir, 0.2);
          const dh = collisionWorld.sweep(shot.from, _decalEnd);
          if (dh) decals.add(dh.point, dh.normal);
        }
      }
      if (shot.targetIndex !== null) targetRegistry.dispatchHit(shot.targetIndex, shot.damage);
      bots?.suppressNear(shot.from, shot.to); // near misses rattle soldiers' aim
    }
    barrels?.tick(dt);
    for (const g of grenades.tick(dt, collisionWorld)) onGrenadeBlast(g.pos);
    if (pickups) {
      for (const ev of pickups.tick(dt, quad.pos, !quad.crashed)) {
        switchWeapon(ev.weapon);
        sfx.pickup();
        flash(`${weapon.config.name} ACQUIRED`, 900);
      }
    }
    if (bots) {
      bots.passive = editingTrack;
      // player's shot resolved above — a bot killed this tick cannot return fire
      const botEvents = bots.tick(dt, {
        playerPos: quad.pos,
        playerVel: quad.vel,
        playerAlive: !quad.crashed,
        playerNoise: !!shot,
      });
      for (const ev of botEvents) {
        if (ev.type === 'projectile-blast') {
          // heavy rocket went off: FX, player splash, barrel chain reactions
          fx.explosion(ev.pos);
          sfx.explode();
          if (!quad.crashed && quad.pos.distanceTo(ev.pos) < 4) {
            if (playerHealth.damage(ev.damage)) killPlayer(-1);
          }
          for (const boomPos of barrels?.blastNear(ev.pos, 4) ?? []) onBarrelBoom(boomPos);
          continue;
        }
        if (ev.type === 'bot-died') {
          // blast friendly fire — no kill credit, but the body still drops
          recorder.logEvent('bot-died', [ev.pos.x, ev.pos.y, ev.pos.z]);
          fx.explosion(ev.pos);
          sfx.explode();
          spawnCorpse(ev);
          flash(`${ev.kind === 'drone' ? 'DRONE' : 'SOLDIER'} DOWN`, 900);
          continue;
        }
        if (ev.type !== 'bot-shot') continue; // bot-mark: squad-internal
        recorder.logEvent('bot-shot', [ev.from.x, ev.from.y, ev.from.z, ev.to.x, ev.to.y, ev.to.z, ev.hitPlayer ? 1 : 0]);
        fx.tracer(ev.from, ev.to);
        fx.muzzle(ev.from);
        // gunfire behind geometry reaches the ear muffled
        if (collisionWorld?.sweep && collisionWorld.sweep(quad.pos, ev.from)) sfx.botShootOccluded();
        else sfx.botShoot();
        if (ev.hitPlayer && !quad.crashed) {
          // bearing of the shooter relative to the camera yaw → edge chevron
          _hitEuler.setFromQuaternion(quad.q, 'YXZ');
          const sy = Math.atan2(-(ev.from.x - quad.pos.x), -(ev.from.z - quad.pos.z));
          hud.pulseDamage(Math.atan2(Math.sin(sy - _hitEuler.y), Math.cos(sy - _hitEuler.y)));
          if (playerHealth.damage(ev.damage)) killPlayer(bots.targets.indexOf(ev.shooter));
        }
      }
      // enemy rotor whirr — a ping every ~2s of sim time while a drone is near
      const wd = bots.nearestAliveDroneDist(quad.pos);
      if (wd < 30 && !quad.crashed) {
        whirrAcc += dt;
        if (whirrAcc >= 2) {
          whirrAcc = 0;
          sfx.droneWhirr(wd / 30);
        }
      } else {
        whirrAcc = 0;
      }
    }
  },

  renderTick(alpha: number, frameDt: number) {
    // Paused: simTick stops, so keep sampling here or mapped buttons (incl. the
    // pause button itself) would go dead and the game could never resume.
    if (loop.paused) {
      keyboard.tick(frameDt);
      input.sample();
    }
    if (killcam) {
      // replay interpolation (playback prev→cur) and the killer's eye as the
      // camera — rig.update is skipped so it can't fight the direct drive
      const kp = killcam.player;
      renderPos.lerpVectors(kp.prevPos, kp.quad.pos, alpha);
      renderQ.slerpQuaternions(kp.prevQ, kp.quad.q, alpha);
      droneVisual.position.copy(renderPos);
      droneVisual.quaternion.copy(renderQ);
      fx.update(frameDt);
      kp.bots?.updateVisuals(frameDt, renderPos); // playback bots, not live
      if (kp.botEye(killcam.killerIdx, _kcEye)) rig.camera.position.copy(_kcEye);
      rig.camera.lookAt(renderPos);
    } else {
      // interpolate between the last two physics states for smooth rendering
      renderPos.lerpVectors(prevPos, quad.pos, alpha);
      renderQ.slerpQuaternions(prevQ, quad.q, alpha);
      droneVisual.position.copy(renderPos);
      droneVisual.quaternion.copy(renderQ);

      rig.update(frameDt);
      fx.update(frameDt);
      ragdolls.update(frameDt, ragdollFloor);
      // engine hum + wind follow arm state, throttle and airspeed
      if (quad.armed && !quad.crashed && !engine.running) engine.start();
      else if ((!quad.armed || quad.crashed) && engine.running) engine.stop();
      engine.update(lastThrottle, quad.vel.length());
      bots?.updateVisuals(frameDt, renderPos);
    }

    // pickup icons: float bob + spin (render-only phase, frameDt-accumulated),
    // positions/visibility synced from sim state
    if (pickups) {
      pickupPhase += frameDt;
      for (let i = 0; i < pickupMeshes.length; i++) {
        const p = pickups.pickups[i];
        const m = pickupMeshes[i];
        m.visible = p.alive;
        if (p.alive) {
          m.position.set(p.pos.x, p.pos.y + Math.sin(pickupPhase * 2 + i * 1.7) * 0.15, p.pos.z);
          m.rotation.y = pickupPhase * 1.5 + i;
        }
      }
    }

    // heavy-rocket sprites follow whichever bot manager is on screen (during
    // killcam the live bots are hidden — the playback manager owns the pool)
    const shownBots = killcam ? killcam.player.bots : bots;
    const projs = shownBots?.projectiles.list;
    for (let i = 0; i < rocketSprites.length; i++) {
      const p = projs?.[i];
      if (p?.alive) {
        rocketSprites[i].position.copy(p.pos);
        rocketSprites[i].visible = true;
      } else {
        rocketSprites[i].visible = false;
      }
    }

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
    hudData.hp = bots ? playerHealth.hp : null;
    hudData.kills = bots ? bots.kills : null;
    // weapon chip: heat on instant configs; charge while charging, else
    // cooldown recovery on the railgun
    hudData.weaponName = weapon.config.name;
    if (weapon.config.chargeS > 0) {
      hudData.weaponMeter = weapon.charge01() > 0 ? weapon.charge01() : 1 - weapon.cooldown01();
      hudData.weaponMeterLabel = 'CHG';
    } else {
      hudData.weaponMeter = weapon.heat01();
      hudData.weaponMeterLabel = 'HEAT';
    }
    hudData.camera = rig.getMode();
    const cd = race && !settings.freeFly ? race.countdownLeft() : null;
    hudData.countdown = cd !== null ? Math.ceil(cd) : null;
    if (message && performance.now() > messageUntil) message = null;
    hudData.message = killcam ? 'WATCH KILLCAM — FIRE TO SKIP' : loop.paused ? 'PAUSED — ESC TO RESUME' : message;
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
    quad, settings, params, input, weapon, fx, playerHealth, dt: PHYS_DT,
    recorder,
    get killcam() { return killcam; },
    get race() { return race; },
    get barrels() { return barrels; },
    get pickups() { return pickups; },
    get bots() { return bots; },
    get collisionWorld() { return collisionWorld; },
    /** Drive N physics ticks + one render manually (rAF-independent test hook). */
    step(n = 240): void {
      for (let i = 0; i < n; i++) hooks.simTick(PHYS_DT);
      hooks.renderTick(0, PHYS_DT);
    },
  },
});
