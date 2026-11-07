# Rebuilding assets/ from the original SWF

These scripts turn `boxhead2play.swf` (SHA-256
`34ff145d96891ddea20278700c8b1fb6fd6273ca0e71b73d8bdf0df183fdbece`) into the
files in `assets/`. They read exported data only; the SWF's code is never run.
Paths are constants at the top of each script (`/tmp/bh-out`, `/tmp/bh-assets`);
adjust them to your machine. Provenance and the rules behind each step are in
`docs/frontend-research.md`, "Original resources".

1. Export with JPEXS Free Flash Decompiler (`ffdec-cli.jar`, headless):
   - `-swf2xml` (placements, filters, text fields) into `swf.xml`;
   - `-format sprite:svg -selectid <rooms, pieces, objects, effects> -export sprite svgall`;
   - `-format sprite:png -zoom 2 -selectid <objects, effects, HUD.*> -export sprite png2`,
     the HUD children (41, 44, 53) into `png3`, the textures (690–751) into
     `tex`, mcCharacter (520) into `cards`, button 63 with `-format button:png`,
     the title logo (10), the menu backdrop (198, which fades 197) and
     Screen_LoadingWorld (361) into `title`;
   - `-export sound snd`, `-format font:woff -export font fonts`, `-export image img`;
   - `-export script` for the XSI data sprite (755).
2. `node xsi.mjs <exported XSI frame script> xsi.json` evaluates only the data
   literals of that script (other lines are rejected) and writes the items.
3. `node xsi_compact.mjs xsi.json /tmp/bh-assets/xsi.json`.
4. `python3 -I rooms_svg.py <svgall> /tmp/bh-assets/rooms` composes each room's
   floor, cover and mask layers.
5. `node rooms_png.mjs /tmp/bh-assets/rooms /tmp/bh-assets/roompng` rasterises
   them at 1× in headless Chromium (Playwright); the PNGs were then re-saved
   with Pillow `optimize=True` (opaque floors as RGB, masks as LA).
6. `python3 -I build_assets.py <repo>/assets` writes the sprite strips, the
   texture atlas, sounds, fonts, previews, rooms and `manifest.json`.

Publisher, developer and advertising clips (logos, "More Games", trailer,
series banners, "exclusive content" overlay, intro) are never exported into
`assets/`.
