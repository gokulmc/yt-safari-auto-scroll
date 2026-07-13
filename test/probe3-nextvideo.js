(async function () {
  const p = document.getElementById('shorts-player');
  const before = p.getVideoData().video_id;
  const t0 = Date.now();
  p.nextVideo();
  // Poll up to 4s for the current video id to change.
  let changed = null, waited = 0;
  while (Date.now() - t0 < 4000) {
    await new Promise((r) => setTimeout(r, 150));
    const now = p.getVideoData().video_id;
    if (now !== before) { changed = now; waited = Date.now() - t0; break; }
  }
  return {
    before,
    after: changed,
    advanced: !!changed,
    msToChange: waited,
    urlAfter: location.href,
    playerState: p.getPlayerState(),
  };
})()
