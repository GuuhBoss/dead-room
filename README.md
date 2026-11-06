# Dead Rooms

An unofficial tribute to Sean Cooper's *Boxhead: 2Play Rooms*, written from scratch with Canvas 2D and Web Audio. No original assets are used: every character is built from lit 3D boxes, and every sound is synthesized.

## Running

Needs Node 20 or newer. There are no dependencies, so there is nothing to install.

```sh
pnpm start        # build, then serve dist/ on http://localhost:3330
pnpm dev          # serve and rebuild whenever src/ changes
pnpm build        # only write dist/
pnpm test         # server tests
```

`PORT` and `HOST` override the defaults (3330 and 0.0.0.0). Under pm2, `pm2 start ecosystem.config.cjs --only dead-rooms` runs the production server on 3330 and `dead-rooms-dev` runs the watcher on 3331.

After a build you can also open `dist/index.html` straight from disk, or share `dist/dead-rooms.html`, a single file with the CSS and JS inlined that works offline (only the Lilita One font comes from Google Fonts).

## Playing

- **1 player:** WASD or arrow keys to move, Space to shoot, Q/E or 1–9 to switch weapons.
- **2 players:** P1 uses WASD, Space, and Q/E. P2 uses the arrow keys, Enter, and , / . to switch.
- **Gamepads:** stick or d-pad to move, A/X/RT to fire, LB/RB to switch, Start to pause.
- **Touch:** a floating stick on the left, plus FIRE and SWAP buttons.
- Esc or P pauses. M toggles sound.

You shoot in the direction you face, and characters face eight directions, as in the original. Zombies pour in through the doors. Each kill fills the multiplier ring, and the ring drains over time or when you get hit. New multiplier highs unlock weapons and upgrades:

| Multiplier | Unlock |
|---|---|
| x2 | Uzi |
| x3 | Pistol rapid fire |
| x4 | Shotgun |
| x5 | Uzi hollow points |
| x6 | Barrels (placeable, explosive) |
| x7 | Shotgun wide spread |
| x8 | Grenades |
| x9 | Pistol double damage |
| x10 | Fake walls (the horde has to claw through them) |
| x11 | Bigger barrel blasts |
| x12 | Rockets |
| x13 | Uzi rapid fire |
| x14 | Mines |
| x15 | Bigger rocket blasts |
| x16 | Railgun (pierces everything) |
| x17+ | Supply drops |

Red crates refill your ammo and white crates restore health. Health also regenerates slowly when you avoid damage. Devils show up from level 3 and throw fireballs. Explosions chain through barrels and mines, and they hurt you too. In co-op, a downed player gets back up if their partner stands next to them, or automatically at the next level.

There are four rooms: The Gates, Crossroads, The Bunker, and Pillar Hall. The best score is saved per room and per player count.

## Code

The source is in `src/`, split by concern (data, world and navigation, combat, box figures, scene, HUD and audio, input and flow). The files are plain scripts sharing one scope, loaded in numeric order. `build.mjs` joins them into `dist/game.js` and writes the single-file HTML; `server.mjs` is a small static server for `dist/`.

- Zombies follow a per-player flow field (Dijkstra on the room grid), chase directly when they have line of sight, and treat fake walls as expensive but passable.
- Characters are posed as rotated boxes, shaded by face normal, and drawn in depth order. Common zombie poses are cached as small images along with their shadows.
- Shadows are drawn with an opaque shade colour using the `darken` blend, so overlapping shadows merge instead of stacking.

`window.deadRooms` exposes snapshot, step, and freeze hooks for automated checks.
