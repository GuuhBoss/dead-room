# Frontend research: original Boxhead: 2Play Rooms evidence

Scope is the original **Boxhead: 2Play Rooms** (Sean Cooper, 2007) only. Later
games (The Zombie Wars, More Rooms, Nightmare) were not used as sources. Online
play and the server leaderboard are the requested additions. This file records
where every rule came from, what is still approximated, and what is missing.
It does not claim the recreation is indistinguishable from the original.

## Sources

| Source | Use |
| --- | --- |
| Publisher page, https://www.crazymonkeygames.com/Boxhead-2Play-Rooms.html | Modes (single, co-op, deathmatch), control list, release date (May 16, 2007) |
| Publisher guide, https://www.crazymonkeygames.com/guide/Boxhead-2Play-Rooms/ | +1 multiplier per kill, faster decay when high, devils interrupted by sustained hits, explosive self-damage |
| Original binary, https://www.crazymonkeygames.com/swf-nr2kjn-jekb/boxhead2play.swf | All numbers below |
| VideoGameGeek entry 159972 | Release date, series order (fourth game, first with multiplayer) |

The binary is Flash 8 (CWS v8), 640 × 480 stage, 50 frames a second, 1,943,061
bytes, SHA-256 `34ff145d96891ddea20278700c8b1fb6fd6273ca0e71b73d8bdf0df183fdbece`.
The copy in github.com/zmcj21/boxhead_res (`boxhead_series/boxhead4/boxhead2play.swf`)
is byte-identical to the publisher's file. The game's own art, character data,
sounds and fonts are extracted from it into `assets/` (see "Original resources"
below); publisher, developer and advertising art, links and site-lock code are
not. The SWF itself is not shipped or run.

## How the values were read

1. Decompiled with JPEXS Free Flash Decompiler 26.4.0 (`ffdec-cli.jar -export
   script`, `-format script:pcode -export script`, `-format script:pcodehex`,
   `-swf2xml`, `-export text`).
2. The ActionScript is obfuscated: control-flow flattening around each class and
   several constant pools per file, one of them a decoy. Class bodies were read
   after substituting `§§constant(N)` from the pool whose fifth entry is the class
   name (for example `"_global","Thing","Object","Weapon","CThing_Weapon_UZI",…`).
   Where the decompiled text was garbled, values come from the P-code; the UZI
   fire rate was confirmed from the raw push bytes (`96 09 00 04 01 08 05 07 04 00
   00 00`: register 1, constant 5 = `mFireRate`, integer 4).
3. Rooms come from `-swf2xml`: each exported `ROOM_Single_000N` sprite's frame-1
   placements were walked recursively, composing matrices, to find the
   `World_Init_*` marker clips (many collision markers sit inside `Piece.*` art
   clips), then converted with the original's own formulas (below).
4. Room names come from the level-select text fields (`-export text`).

To reproduce: download the binary, check the hash, run the exports above and read
`__Packages/World/CUpgrades.as`, `World/CWorld.as`, `World/Map/CMap*.as`,
`Thing/Creature/*.as`, `Thing/Weapon/*.as`, `Thing/Shot/*.as`,
`Thing/Object/*.as`, `Thing/Affect/*.as`, `CSaveData.as` and `CMain` P-code.

## Verified rules (implemented in src/01-data.js … 03-combat.js)

Units are the original's: positions in 32-pixel cells (`CMap_Cell.mCellSize`),
time in logic ticks. `CMain.mFPS` is 25 × game speed; one logic tick runs per
display frame at most, so normal speed is 25 ticks a second. The view is 20 × 15
cells and scrolls; the camera eases toward the players at 0.16 cells a frame plus
a fifth of any extra distance (`CWorld.Process_Tracking`) and stops at room edges.

### Rooms

18 symbols `ROOM_Single_0001` … `0018`, shared by every mode:
1 Boxy 22×17, 2 Buttons 25×21, 3 Mazey 34×38, 4 Gladiator 25×25, 5 Strip 46×17,
6 Tight 22×41, 7 Columns 33×30, 8 Castle 30×25, 9 Big Boxy 41×33, 10 Recty 58×17,
11 Patchy 41×33, 12 Forest Box 40×33, 13 Tight 2 38×34, 14 Massive 58×47,
15 Thin Line 84×17, 16 4 Castles 58×50, 17 The Strips 84×22, 18 Big One 87×87.

Conversion (CWorld.InitThings, CWorld_Init, CMap): size = round(`_Size` / 32);
the outer ring is solid; `World_Init_CollisionSolid` marks cells
[round(x/32), round((x+_width)/32)) × [round(y/32), round((y+_height)/32));
barrels, fake walls, zombie and devil entrances, player spawns and pickup boxes
use floor(position / 32). The last Player1 marker is the start; all player
markers are respawn points. Map barrels deal 100, placed ones 150.

### Player (CThing_Creature_Player)

Speed 0.16 cells a tick on each axis, so diagonals are √2 faster; life 200;
regeneration of max/(mFPS × 30) a tick (a full bar in 30 seconds, no delay);
200 ticks of invincibility at spawn, 125 after a respawn; radius 0.45, mass 2.
Co-op partners cannot move further than 19 × 13 cells apart (KeepDistance).
Death: knock-back, 5-frame fall, `State_Dead` for 4 s; `CWorld.PlayerDead` ends
the game during the last second if no player is alive; otherwise the dead player
respawns 1 s later at the nearest free player spawn at least two cells from the
partner and within one screen, with full life, a pistol and every other weapon
emptied (still unlocked). There is no proximity revive.

Default keys (CSaveData): P1 arrows, `/` shoot, `.` next, `,` previous; P2 WASD,
Space, E next, Q previous. Single player adds Space and number keys 1–9, 0.
P pauses. All seven actions per player can be rebound (Controls window).

### Weapons (CThing_Weapon_*)

| Key | Weapon (short) | Unlock | Rate (ticks) | Ammo | Damage | Other |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Pistol | x1 | 8 | ∞ | 26 | semi-auto, range 8 |
| 2 | UZI | x5 | 4 | 100 | 35 | automatic, range 8 |
| 3 | Shotgun | x10 | 12 | 20 | 51 per pellet | 3 pellets ±1.25°, range 7 |
| 4 | Barrels | x15 | 1 | 10 | 150 | placed |
| 5 | Grenades | x20 | 12 | 20 | 150 | thrown on key release |
| 6 | Fake Walls (Walls) | x30 | 1 | 5 | — | 1000 life |
| 7 | Claymore (Mines) | x40 | 1 | 10 | 100 | placed |
| 8 | Rocket Launcher (Rockets) | x50 | 12 | 20 | 250 | |
| 9 | Charge Packs (Charges) | x55 | 1 | 10 | 150 | place, then press again to detonate |
| 0 | Railgun | x70 | 5 | 15 | 100 | pierces, range 10 |

Bullets are instant lines to the first creature, player, barrel or fake wall
(CThing_Shot_Bullet); the railgun stops only at walls and hits everything on the
way. Rockets start at 0.5 cells a tick and speed up ×1.1 a tick. Grenade power is
the time the key was held, clamped to 0.25–0.75 s; they start 1.25 cells up,
bounce, and explode after 60 ticks. Explosions reach 2 + max(damage − 100, 0) ×
0.005 cells; full damage within half the radius, 75% to three quarters, 50% to
the edge. Big/Bigger Bang add 2/3 delayed blasts one cell out; Cluster Explode
throws 4 bouncing shells that each explode with full damage. Barrels go off when
shot, burnt or caught in any blast square; claymores trigger when a creature
enters their cell and explode 2 s later and are not set off by blasts. Placed
items need a cell holding at most one thing and wait for the player to step off.
A semi-automatic press made during the cool-down is kept and fires when it ends
(CInput latches presses). Switching weapons re-arms the fire key.

### Multiplier, score and upgrades (CUpgrades, CWorld.LogKill)

Each zombie or devil kill adds exactly one (LogKills), capped at 999. The
multiplier holds for GetTicks(n) = (100 − (min(n,100) − 1))^2.5 / 100000 ×
(mFPS × 3 − 3) + 3 ticks, then drops by one (3 s at x1, 0.66 s at x50, 0.12 s at
x100). A kill scores 100 (zombie) or 1000 (devil) × the multiplier after the
increment. The 58 rewards (9 weapons, 49 upgrades) fire once, the first time
their multiplier is reached, and stay for the game; names are verbatim,
including "UZI+: Infinate Range". Fast Fire makes a weapon automatic; Rapid Fire
sets rate round(max(rate/4, 2)); Double/Quad Damage ×2/×4; Double/Quad Ammo
×2/×4 and refill to the new capacity when the weapon is next used; Long Shot
range ×1.5; Infinate Range 100 cells; Wide/Wider Shot 5 pellets at 2.5°/3.75°
steps. A kill chain (kills within GetTicks(n)/6 ticks of each other) drops a box
on every fifth kill; devils always drop one. Pause shows the full upgrade list.

### Levels and enemies

Level n (to 100, then level 100 "(FOREVER)"): spawn every max(25 − (n − 1), 1)
ticks, up to min(10 + 5(n − 1), 60) alive, 10 + 5(n − 1) in total, zombie and
devil speed × min(1 + n/10, 5). Devils (when on) appear from level 2: alive cap
floor(1 + 0.3(n − 2)) up to 5, total floor(1 + 0.25(n − 2)), every
max(250 − (n − 1), 25) ticks. The next level starts as soon as every zombie and
devil, corpses included, is gone; there is no bonus or intermission. Message:
"-+-+-+- LEVEL n -+-+-+-".

Zombies: life 100, speed 0.02 cells a tick, damage 50, walk cell to cell and
reserve the cell ahead; they cannot be shot until they step in from the
entrance. They follow a breadth-first distance wave from the players' cells
(four-neighbour, blocked by solid cells and objects) and choose among eight
directions without cutting corners. They turn at speed × 10 radians a tick.
They swing at a player in the next cell: the 4-frame swing lands after
⌈4 / min(11.25 × speed, 1)⌉ ticks on whatever is in the facing cell, then they
rest 10 ticks, so a player who steps away is missed.
Devils: life 1000, speed 0.04, mass 5; they shoot only when the player is in
their facing direction, within 5 cells and in sight; the fireball (50 damage,
0.15 cells a tick, ×1.02 a tick) leaves at frame 3 of a 4-frame cast, so any hit
before then (knock-back, then a 3-tick rest) cancels it. Devils also blast any
object in their way. Fireballs hurt zombies too.
Hits knock back by max(damage × 0.4 / 32, 0.3) / mass cells a tick (explosions
min(…, 0.3)), slowing ×0.65 a tick; a creature killed mid-slide dies when it
stops. Corpses stay 15 + 50 ticks.

### Options (CScreen_SelectWorld, CSaveData)

Difficulty Beginner/Intermediate/Expert/Nightmare starts at level 1/10/20/35 and
multiplier 1/10/30/50 with those rewards already given. Game speed Slow ×0.5,
Normal, Fast ×2. Devils, Friendly fire and Object collision on/off. Defaults:
Beginner, Normal, all on. Online games always use the defaults.

### HUD and debrief (CHud, CScreen_Debrief)

Positions, scales and fonts are the clips' own (`-swf2xml` placement matrices,
`DefineEditText` fields): Hud.ScoreTotal at (320, 0) with tfScore (Calibri Bold
40 px at 0.765, twelve digits), tfMultiple "xN" (24 px at 0.823) and mcTimer
(101 frames at 0.68, frame `1 + floor(mMultiplierTickRatio × 101)`), all with
GlowFilter(black, 2, 2, strength 10). Hud.Score "+N" leaves the kill at 5 px a
tick toward the total, ×1.05 a tick, fading below y = 140. Hud.Message lines
start at the bottom centre, climb a quarter of their remaining 100 px a tick,
push older lines 19 px up and last 3 s (white info and level, green upgrades,
red "… is out of ammo!"). HUD.Player over each player: mcAmmo "Short:ammo"
(22 px at 0.593, letter spacing −1) and mcLife at frame `life × 101 + 1`.
Death match Hud_PlayerFrags: "Player N" and that player's own deaths
(`PadFrags(mPlayerN_Deaths)`, two digits) at (9.9, 78.1) and (513.65, 78.1),
names following the view sides, and mcSwitchSides at (320, 432). Debrief end
lines are the original's ("YOU WERE EATEN!", "BLED TO DEATH", …).

### Death match (CWorld, CUpgrades, CThing_Creature_Player, CThing_Object_*)

Implemented as `game.mode = 3` with two players, locally and online.
- `CUpgrades.Process` returns at once: no zombies or devils, no levels, no
  multiplier decay. `SetDifficulty` sets x200, so every one of the 58 rewards is
  active; `ResetWeapons` then empties every weapon but the pistol, so weapons
  are owned but must be loaded from boxes (RandomPickup weights apply).
- Friendly damage is always on (`mDamageActive = true`), whatever the option.
- A player's death drops a box where they fell (`LogKill`); map boxes return
  after 10 s instead of 30 s.
- Respawn after the death delay at the free player spawn point farthest from
  the other player, still within 19 × 13 cells of them
  (`Spawn_ValidPosition_Far`), with 25 ticks of invincibility. Player 2 starts
  the same way relative to player 1. There is no co-op leash.
- Claymores wait until their own cell is clear, then go off for creatures or
  players (`Process_WaitForCollideFlags0`, `mTestFlags`).
- `PlayerDead`: when a player's death count equals the limit
  (`mNumberOfGameKills` = 5/10/20/50, saved default 10) the other player wins;
  checked during the dead player's last second, as in survival. `game.winner`
  holds the winning slot. Online games use 5.
- Split screen: two 480 × 480 views scaled to 320 × 320 at y = 80; with the
  saved default view side player 1 is on the right and player 2 (WASD) on the
  left; a button swaps them (`mcSwitchSides`). Each view follows its player
  directly.
- The level-1 message is shown at the start, as the original's InitLists does.

### Menus and screens (Screen_Main, Screen_SelectWorld, SubScreen_*, debriefs)

Layouts were read from the exported sprites' placements (`-swf2xml`) and
rendered to PNG for reference only. The UI layer uses the 640 × 480 stage at
twice the size, so positions match.
- Main: white page, four centred grey items SINGLE PLAY / COOPERATIVE /
  DEATH MATCH / INSTRUCTIONS at y = 226, 259, 293, 326.
- Room screen: "Back to menu" top left; red "OBJECTIVE KILL ZOMBIES" with the
  rewards line, or "OBJECTIVE KILL EACH OTHER" with the boxes line (verbatim,
  including "upto" and "90+ upgrades", though the table has 49 upgrades);
  character card(s) with arrows on the left; one room picture with arrows,
  "1/18" counter, name tab, "View Highscores" (hidden in death match, as the
  original) and "CLICK TO PLAY LEVEL"; Options and Controls buttons below.
  Each mode remembers its room; single play starts on room 9, Big Boxy
  (`_LevelIndex_Single = 8`).
- Options window: Difficulty, Object collision, Devils, Friendly Fire, Game
  speed, Number of games rows with Reset and Close. Controls window: both
  players' seven keys, player 2 covered in single play, Reset and Close.
- Debrief: end line, score, links View Highscores / Select new level / Retry.
  Winner debrief: "PLAYER n WINS" band, Select new level / Replay. Both place
  the menu backdrop (198), not the room.
- Screen_LoadingWorld (backdrop, logo, "LOADING THE ROOM ...please wait...")
  shows while a room's layers load.
- HUD.Paused: translucent brown bar (0x983300 at 80 %) with "PAUSED!" and a red
  "QUIT?", a near-black panel with "UPGRADE LIST" and every reward boxed with
  its multiplier, at 25 % until reached, "New Weapon" names in 0x00FF00.
- Clicks: main-menu items, the level picture and debrief links play `Click`
  (which the original registers as World.End.wav); arrows and options play
  `Click2` (CLICK.wav). The debrief and each new level also play World.End.

## Original resources (assets/)

Exported with JPEXS (`-format sprite:png -zoom 2`, `sprite:svg`, `-export
sound|font|image`, `-swf2xml`) and assembled by the scripts in
`tools/original-assets/` (paths at the top of each). `assets/manifest.json`
lists every file with its registration point; `build.mjs` copies `assets/` to
`dist/assets/` and embeds all of it in `dist/dead-rooms.html` as
`window.DEAD_ROOMS_ASSETS` (text as text, binaries as data URLs). The game
loads them through `loadArt()` in 04-figures.js; nothing is fetched from
another site (the Google Fonts link is gone).

| Asset | Source (character id) | How it is used |
| --- | --- | --- |
| `rooms/NN-floor.png`, `-cover.png`, `-mask.png` | ROOM_Single_0001…0018 (99 … 139) and Piece.* | CWorld's bmFloor / bmCover / bmDecalMask at 1×: the room clip without its CWorld_Init markers (74, 82, 85, 88, 91, 94, 96, 112) or `_Size`; each piece drawn with its translation only and without `_Cover` (CWorld_Init_Piece.Draw); covers at the piece positions; the mask is the pieces' alpha. Composed from the SVG export (`rooms_svg.py`, defs deduplicated) and rasterised with the room's own filters (`rooms_png.mjs`). Drawn floor → decals → things → bullet lines → cover. |
| `xsi.json` | TMP XSI data sprite (755), `mItems` | All 40 animation sets (Player, Player_Alternate1, the five weapon sets, Zombie, Devil): per direction and frame, each model's projected polygons, materials, bitmap-fill matrices, brightness, profile edges and shadow polygons; frame sequences and render partners. |
| `textures.png` | Bambo_/Bond_/GIJOE_/Swat_/Zombie_/Devil_* and Head_/Body_*_MC (690–751) | 64 × 64 material clips at 2×, for bitmap fills. |
| `sprites/*.png` | Object.Barrel 631, ChargePack 637, Mine 642, Pickup 645, Wall 660; Shot.ClusterShell 662, Grenade 667, Rocket 673; Effect.BloodSplat 600, ScorchMark 614, Explosion 568, RocketSmoke 580, FireBall 591, BulletHit 611, SmokeCloud 627 (plus BloodPool 594, BloodHitBack 572, WallMark 616, Explosion_MidAir 573, unused by the original's code paths here); Pistol/UZI/Shotgun/Railgun.MuzzleFlash 678–687; HUD mcTimer 53, mcLife 41, mcAmmo 44; mcSwitchSides 63; mcCharacter 520 | Frame strips at 2× with filters rendered, placed by registration point. The timer ring gets the ScoreTotal glow. |
| `previews/NN.*` | LevelIcons_Single frame bitmaps (409 … 492, 350 × 182) | Room pictures on the room screen; the "exclusive content" overlay (418) is a separate clip and is not included. Under the pointer they redden, as the original's button. |
| `sounds/*.mp3` | 539–564 | See the sound table below. The five unnamed streams (174–193) belong to the intro/logo clips and are not used. |
| `fonts/*.woff` | DefineFont3 23 (Calibri), 25 (Calibri Bold), 370 (Arial Rounded MT Bold) | The three complete embedded fonts (the others are subsets of them): HUD text, menus, windows. |

Licensing note: the art, sounds and data are Sean Cooper's; Calibri and Arial
Rounded MT Bold are commercial fonts embedded in the SWF. They are included
because the brief asks for the original resources; distribution rights are the
project owner's call.

### Characters (CDrawPrimitive_XSI_DI, CDrawPrimitive_XSI_StyleSheet)

- Style sheets, verbatim: Bambo (Bandana 0xFF0000, arms 0xFFCC99, hands and
  hair black), Bond (Bandana, cloth and arms 0x000033), G.I. Joe and Swat (Head
  and feet from Player_Alternate1; 14601386 resp. 0x000033 cloth), Zombie (Head
  from the Zombie group, 11584734 arms, white upper arms) and Devil (Head from
  Devil, red arms, scale 0.42 from CThing_Creature_Devil.mDefault_Scale); all
  hide GunPosition_Right, Body_Front and Body_Back, zombies and devils also
  Weapon_Right. Scale 0.35 for people and zombies.
- The SWF has no Bond_, GIJOE_ or Swat_Head_* clips; each material bitmap is
  shared and a style's clip is drawn over the default, so those three keep the
  default (Bambo) face, as their portrait cards show.
- Frames: Empty models come from the render partner (Player); a style's
  remapped models come from its group. Models stack with the first one on top
  (AS2 enumerates in creation order into depth 10000 − n), polygons paint in
  order; the profile edge (black, 2) goes under the faces; each face gets a
  white (brightness ≥ 0) or black overlay at |brightness| × 0.5. Shadow
  polygons are filled one by one. The frame is rasterised once with a black
  GlowFilter(4, 4, strength 2) and copied to whole pixels.
- Shadows: the shadow clip carries DropShadowFilter(0, 0, black, 1, 4, 4, 0.25,
  hideObject). The reference player (Ruffle 0.7.1, wgpu) shows the plain black
  polygons, which is what is reproduced; pixel rows of a standing Bambo match
  the reference capture (head 0x272727, bandana 0x880000, black shadow).
- Sets: players use Player_Handgun/UZI/Shotgun/Rocket/Railgun Stand and Walk for
  those guns and the plain Player sets otherwise (GetCollection's MimicItem),
  `p.anim` from the simulation picks the set and frame; a null anim shows
  HitRear or HitFront at random, as `"shothit_" + (random(2) + 1)`. Zombies:
  Zombie_Stand/Walk/Attack with Player hits, Dying and Dead; devils: Player
  sets with Devil_Attack. A state changes the set only when it starts
  (CellToCell → walk; Turn, Sleep, Wait → stand). Corpses play Dying at 0.34 a
  tick, then Dead on the floor (mFlag_SortFloor), fading over the last second.
- Direction: `round(angle256 / (256 / n)) mod n` (CThing_Angle.mLookup256).
- Frames are rendered ahead from a queue a few milliseconds per frame, like the
  original's render stack.

### Effects, decals and sound (CThing_Effect_*, CMap_Decal, CSound, CWorld)

- Decals: Effect.BloodSplat and ScorchMark turned to one of three angles and
  squashed to 0.6 high, through the piece mask. Blood when a creature is hit,
  every tick of State_BulletHit and State_Dying, and on State_Dead; a scorch
  under every explosion.
- Effect things per logic tick: Explosion (18 frames at 2.5 a tick),
  RocketSmoke behind every rocket (6 frames, drifting back 0.6 cells a tick),
  BulletHit for one tick on one bullet collision in three, a muzzle flash for
  one tick at the gun (rotated), SmokeCloud when a fake wall breaks. Bullet
  lines: 0.5 px 0xCCCCCC at 75 %; railgun 2 px 0x9966FF at 56 %. Fake walls show
  frame `floor((1 − life / max) × 10)`; claymores blink once a second, every
  tick once triggered; dropped boxes fade over their last second.
- Sound: one voice per registered sample (replaying restarts it), always centred
  at full volume times the registered volume.

| Event | Sample (volume) |
| --- | --- |
| Pistol, UZI, shotgun, railgun shot | Weapon.*.Fire (1) |
| Rocket launched | Weapon.Rocket.Fire (1) |
| Bullet hits a wall or a creature | Shot.HitWall.1–3 at random (1) |
| Grenade or cluster shell bounce | Shot.Grenade.Bounce (0.4) |
| Explosion | Effect.Explosion (1) |
| Claymore or charge pack goes off | Object.Mine.Detonate (1) |
| Barrel or fake wall placed | Object.Barrel.Place (1) |
| Claymore or charge pack placed | Weapon.Mine.Place (1) |
| Box picked up | Object.Pickup (1) |
| Zombie or devil hurt and killed | its own Creature.Zombie.Ambience.1–4 clip (0.4) |
| A dying creature hits the floor | Creature.HitFloor (1) |
| Player dies | Creature.Player.Scream.1 (0.7) |
| New level, debrief, main-menu choice | World.End (1) |
| Arrows and options | CLICK (1) |
| Zombies on screen | Ambience 1–4 in turn: 1 voice every 150 ticks up to 2 zombies, 2 up to 4, 3 every 60 up to 8, 3 every tick beyond |

Creature.Zombie.Attack, Creature.Zombie.Hit, Creature.Player.Scream.2 and
Shot.Rocket.Fire are registered by CSound but never played by the game code;
they are not used either.

## Former tribute mechanics: audit

| Before | Original evidence | Now |
| --- | --- | --- |
| Fractional multiplier bar, levels every few kills | LogKills: +1 per kill | Replaced |
| 3 HP/s regeneration after 4 s | Continuous, full bar per 30 s | Replaced |
| Proximity revive; revive at wave start | Timed respawn beside partner | Removed |
| Random supply crates every 7–11 s; extra drops above x16 | Map boxes (respawn 30 s) and chain/devil drops (last 10 s) | Removed |
| Separate health and ammo crates | One box, weighted reward | Replaced |
| Level-clear bonus and 3.5 s intermission | None | Removed |
| Four invented rooms | 18 original rooms | Replaced |
| Nine weapons, seven upgrades, unlocks x2–x16 | Ten weapons, 58 rewards to x125 | Replaced |
| Free-moving zombies, per-player flow fields | Cell-to-cell, shared wave | Replaced |
| Mines set off by blasts; zombies clawing fake walls | Neither happens | Removed |
| Attract-mode AI demo | None | Removed (menu pans over the room) |

## Approximations

The earlier approximations in the shared simulation (gun offsets, a navigation
wave rebuilt every 5 ticks, exact-ray line collision, a guessed update order)
are gone: the parent ported gun and devil-hand origins from the XSI attachment
data (docs/original-attachments.json), the stepped CMap_Collide line query
(one-cell steps, 0.04 scan radius), five-ring frame-spread navigation with the
original 3 ms budget, mapwho registration order, newest-first entity order and
deferred hitscans, explosions and disposal. See docs/fidelity-validation.md for
what those ports cover and what is still unverified. What remains approximate
on the frontend:

- The navigation budget is wall-clock in the original, so wave timing can
  differ under load (parent note).
- Sounds play through Web Audio with the registered volumes; Flash's mixer,
  its MP3 decoder and the stage's sound buffer are not imitated.
- Room layers above 1× and character frames are drawn at the window's
  resolution; the original's 640 × 480 bitmaps were scaled by the player.
- Hit animations pick HitRear or HitFront at random on the client, as the
  original does, so two online clients may show different ones.

## Not reproduced or different

- Menus use the original title logo (sprite 10), the faded backdrop every
  menu, debrief and loading screen places (198), the original fonts, previews
  and portrait cards. Left out: the trailer button, "More Games", the series
  banners, "A SEAN COOPER GAME" and the "exclusive content" overlay; small
  "Play online" and "Global leaderboard" buttons sit where the banners were,
  with a one-line credit for this recreation.
- INSTRUCTIONS in the original opens four pages on the publisher's site
  (instr/boxhead2play/: Movement and Controls, How to Play, Characters, Tips
  and Tricks). Their text is reproduced verbatim (original spelling) from the
  Wayback Machine captures of 19–22 May 2007, as an in-game page with the same
  four sections; the site's logo, adverts and its photos (boxImg/*.jpg) are
  not included; the characters are shown with the game's own portrait cards
  and zombie and devil frames. One added line notes rebinding, gamepads and
  touch.
- Option texts: the Friendly Fire note's "damage from barrels is still
  applicable" is dropped, because the original code gates explosion damage to
  players on the same switch; "esculates" is spelled "escalates".
- Character shadows match the reference player (solid), not the softer 25 %
  shadow the DropShadowFilter parameters would give in Flash Player; see
  "Characters". No Flash Player capture was available to settle which is right.
- Room layers are 1× pictures as in the original (bmFloor and bmCover are
  640 × 480-stage bitmaps); at larger window sizes they are scaled with
  smoothing, characters and HUD text are drawn at the window's resolution.
- Explosion_MidAir, BloodPool, BloodHitBack and WallMark are exported but not
  shown: no code path of the original that this recreation reaches uses them.
- The original's intro, publisher high-score submission and site-lock
  "exclusive" rooms are replaced or dropped: every room is open, and online
  scores go to this project's server leaderboard.
- Extras that change no rules: single-player WASD/Q/E with default keys, gamepads,
  touch controls, Esc to pause, offline best scores per device, sound on/off.
- Phones and small windows (viewport under 640 × 480, or a touch screen under
  600 px on its short side) get a presentation of their own; desktop keeps the
  original 640 × 480 stage. The game fills the screen at a zoom that keeps about
  the original 20 × 15 cells' area in view, shaped to the screen (about 14 × 21
  cells in portrait, 25 × 12 in landscape; at least 0.72 while 12 cells fit
  across, never fewer than 10), with no stretching. Portrait touch screens keep
  a control deck under the game (stick on the left, Fire and Swap on the right);
  landscape lays the controls over the game's corners; both keep clear of the
  safe areas. Death match views stack in portrait and sit side by side in
  landscape. Menus become scrolling columns with 44 px targets instead of a
  scaled 1280 × 960 page; the landscape room screen keeps the original
  characters-left, room-right arrangement. Touch controls let go when lifted,
  cancelled, when the page loses focus or is hidden, and when the screen turns.
  A Full screen button appears on phones whose browser supports it. The
  simulation never reads the view, so rules and online play are unchanged.
- Online only: each player chooses a shared view (the original's one camera,
  split screen in death match) or their own view (the camera follows only them,
  one full view in death match with both players' deaths at the top); V
  switches during play. After an online game Retry / Replay is a vote: when
  everyone accepts, the room restarts as a new, separately ranked run.

## Shared simulation notes for the backend

- Sources 01-03 contain no DOM, Path2D, console or storage use; sounds, blood,
  smoke and flashes are derived on the client from state changes (05-scene.js,
  `syncEffects`), so the server spends nothing on them.
- `resetRun(mode, roomIndex)` in 07-main.js is a three-line wrapper around the
  shared `startRun()`.
- Entities carry `toJSON` records with fractions rounded to 0.001: snapshots are
  2–15 KB. At Nightmare with 64 zombies a logic tick costs about 0.5 ms (Node 22).
- Inputs may carry `tap: true` so a press shorter than a network update still
  counts once (grenade release included).
- Death match is `resetRun(3, room)`; `game.winner` and `game.fragLimit` are
  plain fields on `game` (default limit 10).
- The client takes the welcome's `runId` and the server's `result` message
  (sent before the final state) as the only evidence of a record; it confirms a
  leaderboard entry by that exact id, and reports a storage failure as such.
  Death match results are never looked up.

## Validation performed by the frontend owner

- Scratch harness against the shared sources (not committed): +1 per kill,
  UZI at x5 with 100 rounds, GetTicks(1) = 75 ticks and one-step decay, x3 Fast
  Fire, held pistol fires once, a fresh press fires again, zombie swing 50 of 200,
  level and devil tables, Nightmare start (level 35, x50, rockets owned), blast
  tiers on the player.
- `pnpm test`: 48 of 48 pass, including the parent's original-rules, room
  digest and death match tests.
- Death match harness on the shared sources: two players, all weapons owned and
  empty, all rewards at x200, no spawns or decay after 20 s, a box refills the
  UZI to 400, friendly damage despite the option, box dropped on death, 25-tick
  respawn invincibility, winner at the fifth death, claymore arming.
- Headless Chromium (Playwright) against the real server: local single player
  start, movement, zombies, pause with all 58 upgrades, quit; co-op setup layout;
  two online clients create/join with code, co-op start gated on a partner, both
  render the same game, each client's input moves its own player on the other
  screen, a guest disconnect ends the host's game as unranked; on a fixture
  server (real backend, players start at 1 life beside a zombie) the death delay
  holds, both clients show the debrief, the server stores one entry, the client
  confirms "#1" and the leaderboard opens on that room and mode with it
  highlighted; key rebinding, reserved keys, persistence and reset. No console
  errors in any of these runs.
- After the death match and menu work (same harness): local death match from
  the new room screen (first to 5 chosen in Options, split views, independent
  WASD and arrow players, side swap, real lethal hit to the winner screen,
  Replay); two-client online death match (lobby gated, both clients show the
  server's winner, result ack `recorded: false`, debrief says not ranked, no
  death match entry on the leaderboard); online survival confirmed by exact
  runId; a read-only data directory reported as "storage was unavailable";
  Controls window covering player 2 in single play, rebind and reset; room
  carousel by keyboard.
- After the original-resources work (same harnesses, 2026-11-07): `pnpm test`
  60 of 60; local single, co-op and death match flows, two-client co-op and
  death match online, exact-runId confirmation and the storage-failure report
  all pass with no console errors; the online lobby character selector (host
  defaults BAMBO, guest BON, each client has arrows on its own card only, both
  picks reach both lobbies and the server's game uses them); the standalone
  `dist/dead-rooms.html` opened from `file://` loads every asset with no
  network request and plays; sound triggers counted in play (weapon fire, wall
  hits, zombie damage and death clips, HitFloor, explosions, ambience, scream).
- Reference comparison: the original was run headless in Ruffle 0.7.1 (wgpu
  renderer, local page serving the hash-checked SWF; the canvas renderer cannot
  run it because it lacks BitmapData.draw) and captured on its main menu, room
  screen and in Big Boxy. Same-room captures of the recreation match the floor
  art, barrels, boxes, HUD score and ring, and a standing Bambo's pixel rows.
- Performance (headless Chromium, software rendering, 1280 × 960, 80 zombies
  under fire): about 20 ms drawing, 1 ms simulation and 1.4 ms effects per frame;
  frames of new characters render from a warm-up queue at 3–12 ms per frame.

Parent checks (recorded by the parent): independent hash check;
CUpgrades.InitLists, GetTicks, CMain frame rate and player control/death/respawn
read independently; all 58 milestones re-extracted into
`tests/fixtures/original-progression.json`; all 18 rooms' collision grids and
marker placements re-converted and compared through
`tests/fixtures/original-room-digests.json`; the original menus inspected in
Ruffle (white main menu, red objective headline, single room carousel).

## Still to validate against the running original

Side-by-side play in a Flash emulator (for example Ruffle) of: zombie routing
around objects, devil fire timing, grenade arcs and bounces, barrel placement
cells, camera feel, every room's spawn and solid layout and death match respawn
spots. Visuals were compared in Big Boxy (Bambo, and Bon facing east: face,
white collar line, helmet and solid shadow match) and on the main menu and
room screen; other rooms, zombie and devil animation timing, Bind and Bert in
play, and whether real Flash Player softened the shadows (see "Characters")
were not compared.

## Final parent integration correction

The online deathmatch limit is now10, matching CSaveData._GameAmount=1 and
CWorld.mNumberOfGameKills=[5,10,20,50]. Earlier frontend-owner checks above
used the former five-frag online default; offline5 remains selectable.

## Subsequent parent gameplay corrections

The parent now owns shared01-03. Earlier approximation notes about exact rays,
navigation refreshed every five ticks, and guessed entity processing order are
superseded by the following source-derived ports:

- CMap_Collide.Collide_Line: one-cell steps, .04 scan radius, expanded cell
  bounds, original endpoint overshoot, newest cell registrations first, actual
  target radius and centre-directed impact point. Railgun queries preserve
  per-cell target enumeration.
- CMap_Cell.Nav_Update: five distance rings per frame, retained old distances,
  continuation batches and original3ms budget. Freshness lasts two seconds;
  original local-direction fallback and five full scans per frame are retained.
- CThing_Collection.Process: previous-frame disposal, a frozen newest-first
  collection, deferred new shots/effects and navigation after entity processing.
  Damage affectors are consumed newest first; barrels/blocks apply queued
  damage on their own turn. Shots exclude their owner in body collision.
- CThing_Shot_Grenade: launch height40/32, gravity.06 before movement, halved
  floor-bounce velocity and original object/creature collision heights verified.

Eight regression cases in tests/original-geometry.test.mjs cover these changes.
Together with a new lobby-character network test, all57 tests pass. The parent
repeated real Chromium local deathmatch, online two-client deathmatch and co-op,
disconnect-unranked and exact-runId solo recording after these changes. There
were no page errors. These checks do not replace side-by-side original play.

Backend now accepts lobby-only `{type:'character',character:0..3}`, assigned to
the sending socket's own slot. Lobby players include character; snapshots carry
the selected game.characters and player.look. Frontend wiring was completed
and independently validated on7 November2026.
Fixed default game options still apply online.

The subsequent7 November integration replaced guessed attachment offsets with
decoded XSI data and completed original art/font/audio and menu integration.
See fidelity-validation.md for the final evidence and remaining comparison
limits. Ads/company/developer branding remain omitted as requested.

## Online party extension (8 November 2026)

The user requested up to six online players after the original two-player
implementation. Online co-op and deathmatch now support capacities 2–6 while
local play stays at one/two. Larger deathmatches use attributed opponent kills;
the original two-player duel retains its death-limit rule. The lobby shows all
slots, each client controls its assigned player, shared/own cameras support all
slots, rematches need every vote, and co-op boards separate actual team sizes.
Slot/name labels distinguish six players sharing four original character designs.
Wide-name HUD labels are measured and truncated before the kill column.
This is a deliberate multiplayer extension, not an original-game fidelity claim.
See fidelity-validation.md for parent six-browser and live-LAN checks.
