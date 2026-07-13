(async function () {
  const p = document.getElementById('movie_player');
  const before = p.getVideoData().video_id;
  const beforeIdx = p.getPlaylistIndex();
  p.nextVideo();
  let after = before, waited = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 5000) {
    await new Promise((r) => setTimeout(r, 150));
    if (p.getVideoData().video_id !== before) { after = p.getVideoData().video_id; waited = Date.now() - t0; break; }
  }
  await new Promise((r) => setTimeout(r, 500));
  return {
    before, after, advanced: after !== before, msToAdvance: waited,
    beforeIdx, afterIdx: p.getPlaylistIndex(),
    url: location.href.slice(0, 60),
    playerState: p.getPlayerState(), paused: (p.querySelector('video') || {}).paused,
  };
})()
