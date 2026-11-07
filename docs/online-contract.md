# Online protocol (implementation contract)

Parent owns src/01-03 shared gameplay, server.mjs, backend/**, build/package integration and tests. The same frontend agent owns src/04-09, HTML/CSS and visual/audio assets. Both work in the SAME checkout; preserve each other's changes.

Use WebSocket `/online` on the same origin. Server sends JSON messages.

Client -> server:
- `{type:'create', name:string, roomIndex:number, mode:'solo'|'coop'|'deathmatch'}`
- `{type:'join', code:string, name:string}`
- `{type:'character',character:0|1|2|3}` changes only the sender's cosmetic selection while in the lobby. No playerId or extra keys accepted; locked after start.
- `{type:'start'}` host only; starts solo immediately or two-player mode when two connected.
- `{type:'input', seq:nonnegative integer, input:{dx:-1|0|1,dy:-1|0|1,fire:boolean,prev:boolean,next:boolean,select:integer,tap?:boolean}}` (select -1 means none). Send current held input ~30Hz; tap/prev/next/select are edges consumed once per tick. No score/state/dt accepted.
- `{type:'leave'}`
- `{type:'ping', at:number}` -> `{type:'pong',at:number}`

Server -> client:
- `{type:'welcome',code,playerId:0|1,host:boolean,runId:string,mode,roomIndex}` after create/join
- `{type:'lobby',code,mode,roomIndex,players:[{id,name,character}],hostId:0}` after membership or character changes. Host defaults to character3; guest to0.
- `{type:'state',tick:number,snapshot:{game:{state:'playing'|'over',mode:1|2|3,roomIndex,demo:false},players,zombies,corpses,barrels,blocks,mines,pickups,shots,tracers,blasts,texts,score,kills,level,toSpawn,intermission,runTime,combo,upgrades,banner,toast,clock,shake,flashLight}}` at 20Hz. Entity shapes match shared src simulation, including look objects. Infinite ammo serialized null, client restores null to Infinity for pistol. Do not include navigation flow fields, canvas caches or particle bulk.
- `{type:'ended',reason:string}` on disconnect / timeout; abort does not rank.
- `{type:'error',message:string}` safe user error.

Frontend must NOT call update() or endGame() / submit scores for online runs: hydrate state and render using server snapshots; locally animate visuals if desired. Network loss must stop online play, no silent offline ranking. All solo/local offline play explicitly unranked.

GET `/api/leaderboard?roomIndex=0&mode=solo` -> `{entries:[{id,names:string[],score,kills,level,bestMultiplier,duration,roomIndex,mode,createdAt}]}`. Optional filters; top 50. Only server inserts on genuine completed online survival run, never client score submission. Deathmatch results never enter survival rankings. Local persistence backend file under ignored data/ configurable DATA_DIR.

Headless simulation approach: backend can evaluate src/01-data.js + src/02-world.js + src/03-combat.js in isolated node:vm with a no-op canvas/document, sfx Proxy, renderFloor/wallShadows stubs. Extract resetRun from 07-main.js or implement equivalent. Override gatherInput using server-held inputs. Shared simulation changes must remain compatible; frontend should not introduce browser dependencies into combat/data beyond existing stubbable graphics/audio calls. Backend loads shared sources for each new session, so do not duplicate weapon tables.

Deathmatch uses its own shared frag/winner rules and split view; co-op uses cooperative survival rules.

Snapshot extension after original-data integration: `snapshot.ticks` is the original logic counter (25 Hz at normal speed); `snapshot.game.options` and `.characters` carry default authoritative settings and character indices. The outer message `tick` remains the 30 Hz server counter. Entity schemas now follow original cell units and compact record.toJSON shapes. Server completion follows original playerDead(), including death delay and cooperative respawn.

## Original deathmatch integration

Create accepts `mode:'deathmatch'`; join/start require two members as in co-op.
The shared numeric mode is 3 (still TWO players); online frag limit defaults to
10. Original offline UI may select 5/10/20/50. Snapshot game adds winner (slot
0/1 on final state, null otherwise) and fragLimit. Deathmatch ends on the shared
frag rule, not when both players die. It never enters survival leaderboard.

Welcome additionally carries `runId` (the server UUID). On authentic completion
server sends `{type:'result',runId,mode,recorded:boolean}` BEFORE final state.
For survival `recorded` is true only after storage succeeds; for deathmatch it
is always false. UI confirms records by exact runId, never by names/score/time.
A storage failure must not be presented as merely missing the top50.

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
