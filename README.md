# Dead Rooms

A Canvas/Web Audio recreation targeting the original **Boxhead: 2Play Rooms**
(2007). Online multiplayer and server-verified rankings are the requested
additions. Original-version art, fonts and sound are bundled; ads and
publisher/developer branding are omitted.

Single player, local cooperative play and split-screen deathmatch are
implemented, along with online solo/co-op/deathmatch and persistent survival
rankings. The server controls combat, unlocks and scores; clients send inputs.
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
rankings; online solo and co-op are separate categories. Offline games are
unranked. Online deathmatch defaults to ten frags, matching the original;
offline options allow 5/10/20/50. Deathmatch results stay out of survival rankings.
See the [protocol](docs/online-contract.md).

## Fidelity and validation

[Original-game research and known gaps](docs/frontend-research.md) records the
publisher binary URL/hash, extracted rules, independent progression comparison,
browser checks and remaining differences. [Acceptance checklist](docs/fidelity-validation.md)
tracks the orchestrator's validation. No later Boxhead game's content is intended.
All61 automated tests currently pass. Independent Chromium checks cover local
deathmatch, two-client co-op/deathmatch, aborts and exact-ID survival ranking.
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
