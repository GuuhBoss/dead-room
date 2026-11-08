# Dead Rooms

A Canvas/Web Audio recreation targeting the original **Boxhead: 2Play Rooms**
(2007). Online multiplayer and server-verified rankings are the requested
additions. Original-version art, fonts and sound are bundled; ads and
publisher/developer branding are omitted.

Single player, local cooperative play and split-screen deathmatch are
implemented, along with online solo, 2–6-player co-op/deathmatch and persistent
survival rankings. The server controls combat, unlocks and scores; clients send inputs.
Original room geometry and progression were independently checked against the
publisher's binary. Original assets now drive the renderer and audio. Remaining
presentation differences and limits of the comparison are recorded below;
see the fidelity report.

## Run

Requires Node >=20 and pnpm.

```sh
pnpm install
pnpm start       # build and serve on http://localhost:3330
pnpm dev         # build, serve and watch src/
pnpm build       # dist/ plus standalone dist/dead-rooms.html
pnpm test
```

`HOST` and `PORT` override the listener. `DATA_DIR` sets persistent ranking
storage (default ignored `data/`). Run one server process per data directory.
Behind a TLS proxy set `ALLOWED_ORIGINS` to the exact public origin; see
[backend documentation](docs/backend.md) for limits and deployment settings.

## Controls and rules

Original P1 controls: arrows move, `/` fires, comma/period switch weapons.
Solo also supports Space and number keys 1–9,0. P2 uses WASD, Space, Q/E.
P pauses offline games; M toggles sound. The recreation also has
single-player WASD aliases, gamepad and touch controls.

On phones, portrait play uses a larger game view above a separate control deck;
landscape fills the screen. Menus reflow and scroll, controls use large touch
targets, and turning the screen releases held inputs. Fullscreen is available
where the browser supports it. Desktop retains the original stage layout.

Shared tables now contain eighteen original room symbols, ten weapons and all
58 upgrade milestones through x125. Unlocks: pistol x1, Uzi x5, shotgun x10,
barrels x15, grenades x20, fake walls x30, claymore x40, rockets x50, charge packs
x55, railgun x70. Each kill raises the multiplier by one; decay accelerates at
higher multipliers. Normal speed runs 25 original logic ticks per second.

The server consumes bounded input messages over WebSocket `/online`, runs the
same shared simulation, and records actual completed survival runs. Clients
cannot submit a score. GET `/api/leaderboard` provides filtered persistent
rankings; online solo and each co-op team size have separate categories.
Offline games are unranked. Online two-player deathmatch retains the original
ten-death duel; with 3–6 players it is first to ten attributed opponent kills.
Offline options allow 5/10/20/50. Deathmatch results stay out of survival rankings.
To play online, create a co-op or deathmatch room, choose a capacity of 2–6,
and share its code. The host can start once at least two players have joined;
only the connected players enter the game. New players cannot join after start.
After an online game, Retry / Replay asks everyone in the room to play again;
when all accept, the same room restarts as a new run. In the lobby each player
chooses a shared view (one party camera; two-player deathmatch uses split screen)
or their own view (the camera follows only them); V switches it
during play unless V is assigned to one of your controls. See the
[protocol](docs/online-contract.md).

## Fidelity and validation

[Original-game research and known gaps](docs/frontend-research.md) records the
publisher binary URL/hash, extracted rules, independent progression comparison,
browser checks and remaining differences. [Acceptance checklist](docs/fidelity-validation.md)
tracks the orchestrator's validation. No later Boxhead game's content is intended.
All 79 automated tests currently pass. Independent Chromium checks cover local
deathmatch, two-client co-op/deathmatch, six-client rooms and touch controls,
all-member rematches, aborts and exact-ID survival ranking by team size.
Original fonts,29 sprite strips,26 sound samples and18 room definitions load;
the standalone HTML plays with no HTTP requests. The original logo, menu
backdrops and four instruction sections are included. Every room's floor,
cover and mask decodes, and all four players plus zombies/devils render in
cardinal directions. Browser rendering/audio differences remain documented;
pixel-exact Flash Player parity is not claimed.

`src/01-data.js` contains rules/maps; `02-world.js` collision/navigation;
`03-combat.js` shared simulation; `04-figures.js` models; `05-scene.js` rendering;
`06-hud.js` HUD/audio; `07-main.js` input and UI; `08-net.js` online/rankings;
`09-boot.js` startup. Build joins numeric scripts.
The backend loads trusted shared simulation code in a per-room VM with graphics
stubs. `window.deadRooms` exposes local browser inspection hooks; no debug state
mutation is exposed over the network.
