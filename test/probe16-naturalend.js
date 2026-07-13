// Seek near the end and let the video END naturally; confirm the playlist
// auto-advances to the next Short (the PiP-preserving native mechanism).
(async function () {
  const p = document.getElementById('movie_player');
  const v = p.querySelector('video');
  const before = p.getVideoData().video_id;
  const dur = v.duration;
  if (!dur || !isFinite(dur)) return { err: 'no duration', before };
  v.currentTime = Math.max(0, dur - 2);
  const t0 = Date.now();
  let after = before;
  while (Date.now() - t0 < 8000) {
    await new Promise((r) => setTimeout(r, 200));
    const now = p.getVideoData().video_id;
    if (now !== before) { after = now; break; }
  }
  await new Promise((r) => setTimeout(r, 500));
  return {
    before, after, advanced: after !== before,
    ms: Date.now() - t0,
    url: location.href.slice(0, 62),
    playerState: p.getPlayerState(),
    plLen: (p.getPlaylist() || []).length,
  };
})()
