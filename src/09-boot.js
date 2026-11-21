// ─── Start ──────────────────────────────────────────────────────────────────
resize();
buildMenus();
toMenu();
if (document.fonts) document.fonts.addEventListener('loadingdone', () => labels.clear());
// The original resources arrive once; menus that show them repaint then.
loadArt().then(() => {
  $('swap-views').style.backgroundImage = `url("${art.sprites.swapUp.img.src}")`;
  document.documentElement.style.setProperty('--menu-bg', `url("${art.title.background.src}")`);
  $('title-logo').src = art.title.logo.src;
  $('title-logo').hidden = false;
  paintHelp();
  if (!$('setup').hidden) { showPreview(); buildChars(); fitHeadline(); }
  if (!$('online').hidden) net.drawLobby();
  if (room) roomArt(room.index);
  // Rooms are small: fetch the rest in the background.
  art.manifest.rooms.forEach((_, i) => setTimeout(() => roomArt(i), 300 + i * 120));
}).catch(() => {});
requestAnimationFrame(frame);
