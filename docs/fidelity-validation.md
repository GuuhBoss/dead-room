# Orchestrator validation: original Boxhead: 2Play Rooms

Target: original 2007 **Boxhead: 2Play Rooms**. No mechanics or content from
More Rooms, Zombie Wars or subsequent games were intentionally added. Requested
extensions are online multiplayer and server-verified global rankings.

## Evidence independently checked by the parent

- Publisher page: https://www.crazymonkeygames.com/Boxhead-2Play-Rooms.html
- Publisher guide: https://www.crazymonkeygames.com/guide/Boxhead-2Play-Rooms/
- Publisher binary: https://www.crazymonkeygames.com/swf-nr2kjn-jekb/boxhead2play.swf
- SHA-256: `34ff145d96891ddea20278700c8b1fb6fd6273ca0e71b73d8bdf0df183fdbece`.

Parent read original CUpgrades.InitLists/GetTicks, CMain frame rate, player
control/death/respawn code and CWorld_Init coordinate conversion. All58 reward
milestones were independently re-extracted into original-progression.json.
All18 collision grids and barrel/wall/enemy/player/pickup markers were
independently reconverted from original exported marker data and compared by
per-room digests. Fixtures live in tests/fixtures. This validates the numerical
conversion against the exports, not every rendered shape or emergent behavior.

Parent also opened the publisher game in Ruffle and inspected its main menu,
single-play setup and in-game HUD. The frontend was corrected to the original's
white menu, four primary choices, room/character carousels and options windows.
This was a visual inspection, not pixel-by-pixel or exhaustive side-by-side
comparison. The same frontend agent subsequently replaced the substitute art,
fonts and synthesized audio with extracted original-version resources. Parent
inspected the integrated setup/play captures and the saved original Ruffle
reference. They show matching source art/HUD conventions; this is not a
controlled identical-pose or pixel-by-pixel comparison.

## Implemented and tested

Single play, cooperative survival and split-screen deathmatch. Local controls,
rebinding, options, pause, debrief/retry and room/character selection. Online
solo/co-op/deathmatch with host/join/start, authoritative input simulation,
snapshot rendering, abort handling and persistent survival rankings. Deathmatch
never enters survival rankings. Online frag default is10, matching original;
local options allow5/10/20/50.

61 automated tests pass. These include original progression,25Hz logic,
diagonal movement, semi-automatic pistol, kill scoring/decay/retained rewards,
regeneration, death delay, cooperative respawn and all18 room digests. All18
rooms run headlessly in all three modes. Transport/security checks cover input
injection/replay, membership, host-only starts, stale controls, disconnect/TTL
aborts, capacity/origin/rate limits, real survival defeat recorded once,
deathmatch winner/no survival entry, storage failures/restarts/corruption and
static-file paths/HEAD/methods. New tests cover the stepped line query's actual
target radius, centre-directed hit point, per-cell enumeration and endpoint
overshoot; five-ring navigation spread; grenade gravity/bounce; shots beginning
on the following tick; queued barrel damage/disposal; reverse affector order;
and slot-bound cosmetic character selection. Build, bundled JS syntax and diff
whitespace pass.

Parent traced CMap_Collide/CMap_Cell/CMap_Mapwho and CThing_Collection against
the shared implementation. Stepped line collision, registration ordering,
five-ring navigation with its original3ms work budget, deferred hitscans and
explosions, reverse entity/affector order and next-frame disposal are now ported.
The .04 line-query value is the scan rectangle radius; the step is one cell.
Grenade gravity, launch height, floor damping and obstacle height checks match
the extracted numbers. Tests establish these cases, not every emergent outcome.

Parent browser checks performed independently of the frontend owner's scripts:
local solo gameplay and game over; online two-client co-op join/start gating,
guest input visible on host, score agreement, disconnect unranked and no entry;
exact UUID ranking confirmation and truthful storage-failure messaging. Final
deathmatch/winner/solo completion checks passed using real backend servers with trusted
local copies of shared source arranged just before lethal damage. No fixture
controls or world mutations are exposed over the network. Final checks confirmed
local deathmatch options/split view/input/side swapping/quit; both online clients
showed the authoritative winner with ten-frag default; deathmatch left no
survival record; a solo run was confirmed against its exact server UUID; no
page errors occurred.
These local/online deathmatch, solo ranking and two-client co-op checks were
repeated successfully after the collision/navigation/order changes.
On7 November the parent repeated them again against the original-assets
frontend and checked the lobby's own-slot character buttons, both synchronized
choices and authoritative character snapshots.29 sprite strips,26 sound files,
18 room definitions, the texture atlas and original Calibri loaded with no
failed asset responses or page errors. The standalone HTML opened from file://,
loaded and played with zero HTTP requests. MP3/WOFF/JPEG MIME types were fixed
in the server and tested. Build, bundled JS syntax and whitespace checks pass.

After the final Opus menu/instructions changes, parent reran local deathmatch,
two-client deathmatch and solo completion, co-op movement/character isolation/
disconnect, original asset loading and the self-contained file:// build. All
passed with no page errors. Parent decoded all18 rooms' floor, cover and mask
images and checked aligned dimensions (up to2784×2784). All four player styles,
zombies and devils rendered nonempty frames in each cardinal direction. This
checks asset availability/rendering, not identical behavior in every room.

Parent found a sprite lookup mismatch at direction boundaries: frontend rounded
angle256 while the original and authoritative simulation truncate. The same
Opus agent corrected it. Its focused sweep found no mismatches across600,000
angles; parent independently checked negative/wrapped/boundary inputs through
the actual browser bundle. Original title-logo loading and all four instruction
tabs were also checked. The full suite passes61 tests; the focused lookup
validation and bundle syntax/whitespace checks pass after that final fix.

## Remaining limits on fidelity acceptance

- Source art, fonts, room previews, sampled effects, original game logo,
  faded menu backgrounds and archived instruction text are integrated. Opus
  compared Bambo and Bon/Swat against original Ruffle captures. The character
  shadow follows Ruffle's solid output; no real Flash Player capture resolved
  its disagreement with the soft-shadow filter parameters in the source.
- Source-derived gun offsets, angle256 lookup and animation timing now replace
  guessed muzzle positions. Parent checked their transforms and order against
  original source; three new tests pass. Devil hands are empty in the active
  original animation, making its true fallback .63 cells ahead at height .84.
  Visual alignment still needs verification with the frontend integration.
- Source-derived collision/navigation/order changes still need visual comparison
  against the original under representative play. The original wall-clock
  navigation budget can produce different wave timing under host load. A finite
  guard handles coincident body centres rather than permitting NaN.
- Dynamic grenade/camera/routing/respawn behavior and every animation in every
  room have not had exhaustive matched-input side-by-side comparison. Source
  ports and numerical regression tests cover their documented cases. Browser
  Web Audio mixing and scaling are not identical to Flash's renderer/mixer.
- Online uses fixed default options. Lobby character selection now works and
  was independently validated; offline has character and option selection.
- The original instructions opened publisher web pages; they now open four
  in-game tabs. Publisher submission and site locks are replaced. Intro/company
  credits, adverts and publisher navigation are omitted as requested. Random
  cosmetic hit poses can differ between online clients; authoritative damage,
  progression and scores stay on the server.

Functional mode and server validation passes. **Indistinguishable original-game
parity is not established.** Passing tests or reproducing extracted tables alone
cannot justify that claim. See frontend-research.md for class-level provenance
and the frontend owner's additional browser/fixture checks. The same Opus agent
completed frontend implementation and the final direction-boundary correction;
the parent completed backend integration and independent validation on
7 November2026. No resume schedule remains enabled. No claim of indistinguishable
Flash Player output is made.

## User-requested mobile layout improvement

The user subsequently requested a larger phone layout. Opus separated phone
menus and touch controls from the scaled desktop overlay and added a fluid
rendering viewport. This deliberately adapts mobile framing; original shared
simulation sources01-03, backend and network protocol were unchanged.

Parent measured the390×844 portrait game view increasing from390×292.5 to
390×591, with a separate thumb-control deck.844×390 landscape now uses the
entire844×390 instead of520×390. Layout checks covered390×844,360×800,
320×568,844×390 and568×320, without horizontal overflow. Fire/Swap/Pause fit
inside each viewport; menu arrow targets and Highscores were corrected to at
least44 pixels. Desktop retained640×480 logical framing at1280×960,640×480
and1024×768.

Independent CDP multi-touch checks passed at three sizes: simultaneous move
and fire, lifting Fire while movement continues, lifting all fingers stops,
weapon swap, pause/resume, blur cancellation and rotation cancellation. A
portrait host and landscape guest both moved their authoritative player on
the other client, sent touch fire through the actual WebSocket protocol, and
released controls; disconnect remained unranked. No page errors occurred.
All61 automated tests, bundle syntax and whitespace checks pass. These checks
used Chromium phone emulation; real iPhone/Safari and physical notches/soft
keyboards have not been independently tested.

## Online camera preferences and rematches

The user requested per-player Shared/Own views and unanimous play-again votes.
Opus implemented the UI and rematch handler; the parent independently reviewed
the server state transitions, membership checks, input reset, creation-budget
enforcement and per-run ranking. Four network tests cover cooperative voting,
solo restart, departure cancellation, fresh UUIDs and separate recorded runs,
deathmatch winner reset/ranking exclusion, outsider votes and exhausted budgets.
All65 tests pass.

Parent two-client browser checks confirmed that the host's Own view does not
change the guest's Shared view, that own-view deathmatch uses one camera while
shared-view deathmatch stays split, that V switches and persists the preference,
and that one rematch vote cannot restart both players. After both accepted, the
same room restarted with a new shared run ID, and both survival games appeared
under distinct leaderboard IDs. Selecting a new level cancelled the partner's
retry. No page errors occurred. A final Opus fix preserves custom V bindings
and ignores key repeats; its nine focused browser checks pass.

The live3330 process was restarted to load the rematch handler. The parent
verified HTTP200 over the LAN and the new protocol's rejection of a rematch
without a completed room. The camera preference is client presentation only;
original cooperative distance limits and authoritative gameplay are unchanged.

## User-requested online parties of up to six

The user requested up to six players. Backend support now covers online co-op
and free-for-all deathmatch, with capacity 2–6 and actual membership fixed at
start. Original local multiplayer and two-player online rules remain intact.
Three-or-more-player deathmatch is a deliberate extension: first to10 credited
opponent kills, without credit for self/environment deaths. Larger cooperative
teams apply the original pairwise leash and revive near a living partner.

All 79 automated tests pass. Added checks exercise six-player free-floor spawns
in all18 maps in both modes, sixth-slot input/character isolation, seventh-member
rejection, invalid capacities, starting below capacity without ghost slots,
departure aborts, all-six rematch unanimity with fresh ranked UUIDs, larger-team
respawn and a slot5 deathmatch winner without survival ranking. Board filters
and persistence separate actual team sizes while retaining old records. An
additional ownership check covers explosive projectile, placed barrel, map
barrel and chain-reaction kills without granting frags to another player.

The same Opus frontend agent completed six-player UI after its usage reset.
Parent independently checked six real Chromium contexts, including320×568 and
844×390 phones: six lobby cards with arrows only on the assigned slot, character
isolation, all-slot state/count hydration, sixth-slot simultaneous touch movement
and fire observed by the host, own-camera following, one shared party camera and
disconnect-unranked behavior. Starting local deathmatch after online six-player
play restored two players and the original split view.

Separate server-side fixtures exercised genuine damage and completion while
shortening the death animation: all six clients showed a slot5 free-for-all
winner, all six co-op clients confirmed the exact run UUID in their6-player
table, and both modes required all six rematch votes. The new run UUID matched
on all clients; rematches preserved six slots. The phone board selected Team6,
highlighted the exact run and kept Team2 empty. Deathmatch never entered the
survival board. No browser page errors occurred. One parent script initially
used an incorrect offline navigation path; correcting that script required no
game change.

Parent found a presentation gap with wide24-character names overlapping the
free-for-all kill count. The same frontend owner fixed it using actual HUD-font
width measurements, preserving the P# prefix and own-player marker. Parent then
checked six rendered online rows and wide Latin, CJK, Hangul, Arabic, Greek and
accented samples: every label fit136 pixels with a clear gap before kill counts.
Phone and desktop rendering passed the frontend owner's targeted checks. Tags
above nearby players can still overlap spatially. A natural six-human match
through10 kills and physical phone/Safari testing have not been observed. This
user-requested extension adds no claim of original-game parity.

On8 November2026 the parent restarted the live3330 process with the integrated
build. HTTP200 over http://192.168.1.29:3330 and six actual LAN WebSocket clients
confirmed capacity6, unique slots, sixth-slot character application, snapshots
with six players, seventh-member rejection and all-member departure cleanup.
The aborted smoke run was not ranked. Build, bundle syntax and whitespace
checks pass; the server listens on0.0.0.0:3330.
