# Authoritative online backend

Run Node >=20 with `pnpm install`, then `pnpm start`. Development: `pnpm dev`.
The existing static files, traversal rejection, GET/HEAD behavior and single-file
build remain available. The standalone HTML requires a running same-origin server
for online play; offline play does not submit scores.

`HOST` defaults to `0.0.0.0`, `PORT` to `3330`. `DATA_DIR` defaults to `data/`,
which is ignored by Git. Put a custom DATA_DIR outside the checkout or ignore it.
Use one server process and one writer per DATA_DIR; this file store does not
coordinate multiple instances. Give the process a writable persistent volume.
Restarting aborts active sessions; completed scores survive. Clear or migrate
the board when changing gameplay rules/map identities; the wire format does not
separate scores by source version.

The backend follows [online-contract.md](online-contract.md). Deathmatch now has backend support and uses shared numeric mode 3 with two
players. Its local split view and online client are implemented.
Solo and two-player cooperative survival have separate leaderboard categories.

## Wire use

Connect to `ws://<same-host>/online` (or `wss://` through a TLS proxy). JSON text
only, no compression. Create and join names contain 1–24 Unicode letters/numbers,
spaces or `._'-`, normalized and trimmed. Codes are eight uppercase characters.
All messages have exact allowed keys; extra score, state, playerId, room code or
dt fields in an input are rejected.

```js
socket.send(JSON.stringify({ type: 'create', name: 'Alice', roomIndex: 0, mode: 'coop' }));
// Partner uses the code delivered in welcome:
partner.send(JSON.stringify({ type: 'join', code: 'ABCDEFGH', name: 'Bob' }));
// Optional cosmetic choice, only before the host starts:
partner.send(JSON.stringify({ type: 'character', character: 2 }));
// Only player 0 can start; cooperative mode requires both connected players.
socket.send(JSON.stringify({ type: 'start' }));
// Each socket controls only its assigned player; send held state around 30Hz.
socket.send(JSON.stringify({ type: 'input', seq: 0, input: {
  dx: 0, dy: -1, fire: true, prev: false, next: false, select: -1
} }));
```

`seq` must be a nonnegative safe integer, strictly increasing within a run.
Movement axes are exactly -1, 0 or 1. Fire/prev/next are booleans; select is -1
or a valid shared weapon index. Selection does not unlock a weapon or grant
ammo. An optional boolean `tap` preserves a fire press shorter than a network update.
Tap/prev/next/select are latched until one tick consumes them; repeated held
movement/fire persists only while fresh inputs arrive. Unknown/old input never
changes simulation state. Join/start/input never accept a target player or room.
Character selection accepts only an integer0–3, belongs to the sending socket's
slot and is locked after start. Lobby players include their character index;
the authoritative snapshot carries the same selection in game.characters and
player.look. The frontend selector is integrated and independently checked in
two browser clients, including cross-slot isolation. Online game
options otherwise remain the fixed defaults.

The server sends welcome and lobby messages as in the contract. Physics runs at
30 fixed steps/second; snapshots run at 20Hz plus initial and final snapshots.
Snapshots include the contract's game/entities/score/progression/effects fields,
including entity look objects. They omit particle bulk, navigation grids and
canvas caches. Pistol Infinity ammo serializes as null; restore it client-side.
Ticks count authoritative updates, never client frames. Clients hydrate and
render snapshots without advancing combat or submitting scores.

The shared original-game lifecycle produces a final snapshot with
`game.state: 'over'` after the original death delay. A downed cooperative player
can respawn while their partner survives. The backend does not force an earlier
game over. It records an authentic completed survival run once. A later
start is rejected; leave and create a new room. An aborted run sends
`{type:'ended',reason}` and releases all members. Leaving or disconnecting either
member ends the entire room, including a lobby. There is no host migration,
rejoin, client pause, score submission, or local fallback to online ranking.
`{type:'ping',at:<finite nonnegative number>}` returns pong with the same at.

## Limits and origin policy

Defaults are in `backend/online.mjs`; the in-process createApp options permit
smaller limits and temporary source paths for integration tests, never via HTTP.

| Resource | Default |
| --- | --- |
| Concurrent connections | 128 total, 8 per socket IP |
| Rooms | 32 total, 3 per creating IP |
| Inbound JSON message | 2,048 bytes, at most 32 WS fragments |
| All inbound messages | 60/second, burst 90 per connection |
| Non-input commands | 2/second, burst 8 per connection |
| Room creations | 1/10 seconds, burst 2 per IP |
| Upgrade attempts | 2/second, burst 20 per IP |
| Outbound queued bytes | 256 KiB, then disconnect |
| Stale held input | 250 ms, then neutral movement/fire/edges |
| Connection inactivity / missing WS pong | 30 seconds |
| Lobby lifetime | 2 minutes from creation |
| Playing lifetime | 2 hours from start, then abort without ranking |
| Completed room retention | 30 seconds |
| IP limiter records | 1,024; idle records expire after 60 seconds |

Inactivity and TTL cleanup occurs at least once per second. WS ping is sent
around every 10 seconds; send application input or ping to maintain activity.
Binary input closes with 1003, oversized payloads with 1009, message floods with
1008. Three malformed JSON messages close the connection. Error messages do not
expose exception stacks, filesystem paths, secrets or other rooms' contents.

Upgrade requests require a non-null Origin matching the HTTP request's origin.
Native clients must supply Origin too. For TLS termination or an explicit public
host, set `ALLOWED_ORIGINS=https://rooms.example` (comma-separated exact origins).
When configured this replaces the same-origin default. No wildcard, credentials,
path or Origin:null is allowed. X-Forwarded-For and X-Forwarded-Proto are not
trusted. Per-IP limits use the actual socket IP; a proxy may place all players
in the same quota. Configure proxy admission limits for a public installation.
An origin check controls browser cross-site access; it is not player identity.

Elapsed server time drives a bounded accumulator; input spam cannot accelerate
it. Up to five overdue ticks are processed per pump. A timing gap over one
second aborts active runs without ranking. Disconnect, leave, expiry, simulation
failure, server shutdown and slow-consumer termination are abort paths. A
connection must still be open and have live activity/heartbeat leases when a
completed result is persisted. A physical network failure is detectable only
when the transport reports it or the heartbeat expires.

## Leaderboard and persistence

`GET /api/leaderboard?roomIndex=0&mode=solo` returns `{entries:[...]}`. Both filters
are optional. Entries contain exactly id, names, score, kills, level,
bestMultiplier, duration (simulation seconds), roomIndex, mode and createdAt
(UTC ISO time). Results are sorted by score descending, then kills descending,
then creation time/id, with a maximum of 50 returned. Storage retains up to 50
per room/mode and 1,000 total. Invalid/duplicate/unsupported query fields return
400. HEAD returns identical headers with no body. POST returns 405.

A fresh UUID identifies each run. Only server-observed defeat supplies its
score/health/kills/unlocks/time, and the room transitions to complete before
recording; repeated start/input/end messages cannot insert another result.
Scores are display-name/team records, not authenticated account identities.
There is no claim to detect bots or prevent a server administrator changing disk.

`DATA_DIR/leaderboard.json` is a versioned, validated store. Writes use a private,
exclusive temporary file, fsync, rename, then directory fsync. Readers see the
old or new complete JSON. Startup bounds file size at 1 MiB, rejects malformed
structure, filters invalid rows and duplicate ids, and bounds retained entries.
Corrupt files are moved to one `leaderboard.corrupt.json` backup and startup
continues empty. Storage failures do not accept client results or crash gameplay;
the completed player receives an error and the room remains complete. No retry
or alternate client submission is accepted. Orphan temporary files after a hard
crash are ignored. Back up the data directory using normal server operations.

## Shared simulation and original-game validation

Each new room reads src/01-data.js, 02-world.js, 03-combat.js and the plain
resetRun wrapper in07-main.js. Trusted shared code runs in an isolated Node VM
with no-op canvas/audio stubs. Existing rooms remain pinned to loaded code.
VM isolation separates room state; it is not a sandbox for untrusted plugins.
Original logic accumulates at25Hz normal speed inside30Hz server updates;
snapshots publish at20Hz. Entity positions are cells, not pixels. Compact
records omit private navigation/canvas/particle work. Snapshots include ticks,
game options/characters, winner and fragLimit.

Parent independently compared all58 progression milestones and all18 room
collision grids and spawn/item markers against the publisher binary exports.
Regression fixtures are in tests/fixtures. Eight original-rule tests exercise
progression, movement/ticks, pistol press behavior, kill scoring/decay, health
regeneration, death delay, partner respawn and room data. All18 rooms run
headlessly in all three modes. See frontend-research.md for provenance and
remaining approximations; passing security tests does not prove full parity.

The parent subsequently ported the original one-cell stepped line queries,
per-cell registration order, five-ring navigation waves, deferred hitscan and
explosion processing, reverse insertion order for entities/affectors and
next-frame object disposal. Eight geometry/order tests pin source-derived edge
cases, including projectile gravity and floor bounce. Navigation retains the
original3ms work budget, so scheduling under CPU pressure can affect the wave's
completion frame; seeded simulation is not a promise of identical routing
under arbitrary host load. A finite guard avoids NaN on coincident body centres.
The full suite currently passes61 tests. Static serving now recognizes the
original MP3 audio, WOFF fonts and JPEG previews; an HTTP regression check
verifies their MIME types and HEAD behavior.

Original XSI attachment positions are now shared authoritative data, generated
by scripts/generate-attachments.mjs from docs/original-attachments.json. Parent
checked FillXSIInfo scaling, the angle256 lookup, player control's fire-before-
animation order and the devil's empty-model fallback against the source. Gun
offsets vary by weapon, stand/walk sequence and quantized direction. Empty gun
models fall back to the body position. Devil fireballs start .63 cells ahead
at height .84. Three new regression tests cover these facts. Snapshots include
player.anim and tracer z1/z2 so the frontend can render the same pose/heights.
These source checks do not establish side-by-side visual parity.

Deathmatch is numeric mode3 with TWO players. All rewards are active, nonpistol
weapons start empty, enemy spawns are disabled, and friendly damage is always
on. The shared lifecycle decides the winner. Server completion validates a
winner0/1 and defeated opponent with deaths at the frag limit. Online defaults
to10 frags, matching original; local options allow5/10/20/50. Deathmatch never
enters the survival leaderboard, whose filters remain solo/coop only.

Welcome includes runId, the room's UUID. Completion sends
`{type:'result',runId,mode,recorded}` before the final state. Survival recorded
is true only after successful storage; deathmatch always sends false. The UI
confirms the exact UUID and reports failed storage honestly. A recorded result
can still be below the retained top50. Names and matching scores alone never
identify a run.

Local inspection, never exposed as network mutation:

```js
import { createSimulation } from './backend/simulation.mjs';
import { neutralInput } from './backend/protocol.mjs';
const sim = createSimulation({ mode: 'solo', roomIndex: 0, seed: 123 });
console.log(sim.sourceHash, sim.rules());
for (let tick = 0; tick < 300; tick++) sim.step([neutralInput()]);
console.log(sim.snapshot());
```

Seed/options/sourceDir fixture controls are trusted local APIs, not HTTP inputs.
Production has no score, teleport, seed, damage or debug scenario endpoint.
`pnpm test` covers authoritative simulation, input injection/replay, room
isolation, host checks, connection/origin/rate/capacity limits, stale controls,
abort paths, survival completion exactly once, deathmatch exclusion, atomic
persistence/restarts/corruption/storage failures, and static file security.
