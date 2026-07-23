# RFC 0001: Multiplayer — CS-style drone combat

- **Status:** accepted
- **Issue:** see the `multiplayer` milestone series on GitHub
- **Author:** @rachmataditiya

## Problem

FPV Web is single-player. The end goal since day one: **old-school Counter-Strike
nostalgia with drones** — join a room with friends, fly de_dust2, shoot each
other, plant the "bomb", win rounds. Everything until now (deterministic
240 Hz fixed-tick sim, abstracted `FlightInput`, event-based hitscan, seeded
world state, BSP maps) was groundwork for this.

## Proposal

### Netcode model (phased)

**Authoritative server, client-side prediction** — the CS classic:

- A small **Node.js room server** (`server/` in this repo, deployed on the same
  host behind Traefik at `ws.simulator.arkana.app`). Rooms are created with a
  6-char join code (LAN-party feel, no accounts).
- **Transport phase 1: WebSocket** (ordered, works everywhere, simplest to
  debug). **Phase 2: WebRTC DataChannel** (unordered/unreliable) for state
  snapshots once the game feel demands it; WS stays for reliable events
  (join/chat/kills/rounds).
- **Server tick 60 Hz**, client sim stays 240 Hz:
  - Own drone: client predicts locally with the existing `stepQuad` (already
    deterministic), server reconciles with authoritative snapshots
    (rewind+replay of the input buffer on mismatch).
  - Remote drones: **interpolation buffer (~100 ms)** between snapshots —
    remote quads don't need physics, just pose lerp (the render already
    interpolates poses).
- **Hits are server-authoritative** with **lag compensation**: server keeps
  ~250 ms of pose history and rewinds targets to the shooter's perceived time
  (the thing that made CS feel fair on dial-up).

### Shared simulation code

`src/game/`, `src/physics/`, `src/world/` must stay **browser-free** (they
already are — three's math classes run fine in Node). The server imports the
same `stepQuad`, `Weapon`, gate/track logic. One sim, two runtimes. This is
the invariant that keeps prediction honest — guard it with a CI check that
imports the sim modules in Node.

### Protocol (v1 sketch)

Binary-lean JSON first (measure before optimizing):

```
C→S  hello {name, room?, map}          S→C  welcome {playerId, room, map, seed}
C→S  input {tick, seq, FlightInput,    S→C  snapshot {serverTick, players:[{id,
      buttons}                                pos,quat,vel,hp,armed}], events}
C→S  fire {tick, seq}                  S→C  event {kill|hit|spawn|barrel|
                                              plant|defuse|round}
```

`seed` drives barrel placement (already seeded/deterministic) so all clients
build identical worlds. Map sync: room is pinned to a server-hosted map
(`server:<name>`) or the host uploads the BSP to the room (server relays).

### Game modes

1. **Free-for-all Deathmatch** (first playable): 100 hp drones, blaster does
   34 dmg (3-tap), barrels do area damage, killfeed, scoreboard (K/D), instant
   respawn at `info_player_deathmatch` spawns (parser already collects them).
2. **Team Deathmatch**: T/CT colors on the drone meshes + team scores.
3. **Drone Strike (bomb/defuse)** — the nostalgia centerpiece: T drones carry
   a beacon, fly it to bombsite A/B (zones authored like track gates), hold
   position 3 s to plant; CT defuses the same way; round timer, alive-count
   win conditions, round scoreboard. No economy in v1 (maybe throttle-limit
   "pistol round" flavor later).
4. **Multiplayer race**: everyone on the same track, live positions, shared
   start countdown — reuses `Race` wholesale.

### What this reuses (no rewrite)

- `stepQuad` + `CollisionWorld` — server-side physics per player.
- `Weapon.tick` — server-side hit resolution (targets become *drones* +
  barrels; `ShotTarget` already abstracts this).
- BSP pipeline — server parses the same map for collision (`bspParser` is
  three-agnostic; `bspWorld`'s BVH needs a Node-safe build or a server-side
  BVH on the same triangles).
- HUD/killfeed slot into the existing pit-wall telemetry design system.

## Alternatives considered

- **P2P lockstep (no server)**: breaks with >2 players at FPV speeds; cheating
  trivial; host migration pain. Lost.
- **Deterministic lockstep with input-delay**: our sim is deterministic, but
  240 Hz lockstep needs everyone's input every 4 ms — unplayable over WAN. Lost.
- **Third-party netcode SaaS**: conflicts with the self-hosted, no-accounts
  ethos. Lost.

## Verification plan

- Protocol + reconciliation unit tests (vitest, sim runs headless in Node).
- **Bot rooms**: server spins scripted bots (replayed `FlightInput` traces) —
  deterministic integration tests without two humans.
- Latency harness: artificial delay/jitter/loss injection in the WS layer;
  acceptance = flyable at 150 ms RTT + 2% loss.
- Manual matrix: 2 browsers same machine → 2 machines LAN → WAN, per milestone.
