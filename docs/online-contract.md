# Online protocol (implementation contract)

Parent owns src/01-03 shared gameplay, server.mjs, backend/**, build/package integration and tests. The same frontend agent owns src/04-09, HTML/CSS and visual/audio assets. Both work in the SAME checkout; preserve each other's changes.

Use WebSocket `/online` on the same origin. Server sends JSON messages.

Client -> server:
- `{type:'create', name:string, roomIndex:number, mode:'solo'|'coop'|'deathmatch',maxPlayers?:integer}`. Multiplayer capacity is 2–6 (default 6); solo accepts only 1 or omission. Capacity is a lobby limit, not the number of simulated players.
- `{type:'join', code:string, name:string}`
- `{type:'character',character:0|1|2|3}` changes only the sender's cosmetic selection while in the lobby. No playerId or extra keys accepted; locked after start.
- `{type:'start'}` host only; starts solo immediately or multiplayer with 2–6 connected members. It does not wait for full capacity. Membership locks at start; no mid-game join.
- `{type:'input', seq:nonnegative integer, input:{dx:-1|0|1,dy:-1|0|1,fire:boolean,prev:boolean,next:boolean,select:integer,tap?:boolean}}` (select -1 means none). Send current held input ~30Hz; tap/prev/next/select are edges consumed once per tick. No score/state/dt accepted.
- `{type:'rematch'}` only after the run is complete (otherwise an error). Records the sender's vote to play again; once every member of the room has voted, the server starts a new run in the same room (same mode, room index and characters, new `runId`).
- `{type:'leave'}`
- `{type:'ping', at:number}` -> `{type:'pong',at:number}`

Server -> client:
- `{type:'welcome',code,playerId:0|1|2|3|4|5,host:boolean,runId:string,mode,roomIndex,maxPlayers}` after create/join
- `{type:'lobby',code,mode,roomIndex,maxPlayers,players:[{id,name,character}],hostId:0}` after membership or character changes. Slots are contiguous and socket-bound. Host defaults to character 3; other slots use `(slot-1)%4`. Repeated character choices are allowed.
- `{type:'state',tick:number,snapshot:{game:{state:'playing'|'over',mode:1|2|3,roomIndex,demo:false},players,zombies,corpses,barrels,blocks,mines,pickups,shots,tracers,blasts,texts,score,kills,level,toSpawn,intermission,runTime,combo,upgrades,banner,toast,clock,shake,flashLight}}` at 20Hz. Entity shapes match shared src simulation, including look objects. Infinite ammo serialized null, client restores null to Infinity for pistol. Do not include navigation flow fields, canvas caches or particle bulk.
- `{type:'ended',reason:string}` on disconnect / timeout; abort does not rank.
- `{type:'rematch',ready:[playerId…]}` to every member when a vote is recorded and not everyone has voted yet.
- `{type:'restart',runId}` to every member when all have voted; the next `state` (tick 0) is the new run. Each run is ranked separately under its own `runId`. A rematch compiles a new simulation and spends one room creation from the creator's address budget; when that is exhausted every member gets `Rematch rate limit exceeded; try again shortly` and may vote again. Leaving or disconnecting still removes the room (`ended`), which cancels the vote. A completed room is kept for 60 seconds.
- `{type:'error',message:string}` safe user error.

Frontend must NOT call update() or endGame() / submit scores for online runs: hydrate state and render using server snapshots; locally animate visuals if desired. Network loss must stop online play, no silent offline ranking. All solo/local offline play explicitly unranked.

GET `/api/leaderboard?roomIndex=0&mode=coop&players=6` -> `{entries:[{id,names:string[],score,kills,level,bestMultiplier,duration,roomIndex,mode,createdAt}]}`. Optional filters; top 50. `players` is an integer 1–6 and refers to actual `names.length`, not lobby capacity. Solo only permits 1; co-op permits 2–6. Each map/mode/team size retains its own top 50, preserving two-player records. Omit `players` to browse across sizes. Only server inserts on genuine completed online survival run, never client score submission. Deathmatch results never enter survival rankings. Local persistence backend file under ignored data/ configurable DATA_DIR. Exact-run confirmation must query the run's actual size or omit the size filter; never search a stale two-player category for a six-player run.

Headless simulation approach: backend can evaluate src/01-data.js + src/02-world.js + src/03-combat.js in isolated node:vm with a no-op canvas/document, sfx Proxy, renderFloor/wallShadows stubs. Extract resetRun from 07-main.js or implement equivalent. Override gatherInput using server-held inputs. Shared simulation changes must remain compatible; frontend should not introduce browser dependencies into combat/data beyond existing stubbable graphics/audio calls. Backend loads shared sources for each new session, so do not duplicate weapon tables.

Original two-player deathmatch uses its own shared death-limit/winner rules and split view. Larger online parties use the free-for-all extension described below; co-op uses cooperative survival rules.

Snapshot extension after original-data integration: `snapshot.ticks` is the original logic counter (25 Hz at normal speed); `snapshot.game.options` and `.characters` carry default authoritative settings and character indices. The outer message `tick` remains the 30 Hz server counter. Entity schemas now follow original cell units and compact record.toJSON shapes. Server completion follows original playerDead(), including death delay and cooperative respawn.

## Original deathmatch integration

Create accepts `mode:'deathmatch'`; join/start require at least two members as
in co-op. Shared numeric mode is 3; online frag limit defaults to 10. Original
offline UI may select 5/10/20/50. With two players, the original opponent-death
limit decides the winner. With 3–6 players, the first player to earn 10 attributed
opponent kills wins; self/environment deaths grant no opponent a frag. Snapshots
include each player's `frags`, plus game `winner` (slot 0–5 or null), `fragLimit`
and `playerCount`. Deathmatch never enters survival rankings.

Welcome additionally carries `runId` (the server UUID). On authentic completion
server sends `{type:'result',runId,mode,recorded:boolean}` BEFORE final state.
For survival `recorded` is true only after storage succeeds; for deathmatch it
is always false. UI confirms records by exact runId, never by names/score/time.
A storage failure must not be presented as merely missing the top50.

## Six-player extension: integration contract

The authoritative simulation creates exactly the connected membership at start
and rematch. `snapshot.game.playerCount` and `snapshot.players.length` agree;
the lobby's `maxPlayers` may be larger. Character arrays cover every actual slot.
All current members must vote for a rematch; leaving any slot aborts the room
and cancels votes. Inputs still contain no player ID: each client reads its local
player-1 controls, and the server assigns the input to its own socket's slot.

Original local multiplayer stays at two players. Frontend `startLocal()` MUST
reset `game.playerCount` to 1 for solo or 2 for local multiplayer after online
play, and network hydration must copy the authoritative count. Keep the shared
`resetRun()` wrapper free of DOM dependencies.

For larger cooperative parties the original leash applies to every living pair,
and a downed player respawns near a living partner. Spawning uses distinct free
floor positions. Larger deathmatch parties use one shared camera or each
client's Own view; the original two-player shared split view stays intact.
Players need visible slot/name identifiers because six slots share four original
character designs. Lobby capacity/count, all character cards, every player's HUD,
all-member rematch votes and team-size board filters must work on phones too.

Frontend and backend support are implemented. The same Opus owner completed the
larger-party frontend after its provider reset. Parent six-browser checks cover
all-slot hydration, sixth-slot touch movement/fire and character isolation,
shared/own cameras, all-member rematches, actual-size rankings and disconnect
aborts. See fidelity-validation.md for validation details and deployment status.

## Authoritative XSI attachment state

Players now include `anim:{weapon:string,moving:boolean,frame:number}|null`.
Frame is a fractional index into the original stand/walk frame sequence; null
means the player has entered a hit pose. Weapon updates read the preceding
animation, then player control changes/advances it, matching the original order.
The server computes offsets from generated shared ORIGINAL_ATTACHMENTS in01;
clients must not supply animation, muzzle or projectile positions. Bullet/rail
tracers additionally include z1/z2 in cell units. Rockets carry their original
weapon-specific launch height; grenade launch height remains40/32. Devil hands
are empty in the original active animation, so its actual fallback is .63 cells
along the attack direction at height .84.
