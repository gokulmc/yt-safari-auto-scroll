(async function () {
  const p = document.getElementById('shorts-player');
  const cur = p.getVideoData().video_id;
  const s = JSON.stringify(window.ytInitialData || {});
  const ids = Array.from(new Set(Array.from(s.matchAll(/\/shorts\/([A-Za-z0-9_-]{11})/g)).map((m) => m[1])));
  const target = ids.filter((x) => x !== cur)[0];
  const t0 = Date.now();
  p.loadVideoById(target);
  let after = null;
  while (Date.now() - t0 < 5000) {
    await new Promise((r) => setTimeout(r, 150));
    if (p.getVideoData().video_id === target) { after = target; break; }
  }
  // give it a moment to actually start playing
  await new Promise((r) => setTimeout(r, 800));
  return {
    documentHidden: document.hidden,
    cur, target, after, success: after === target,
    playerState: p.getPlayerState(),   // 1 = playing, 2 = paused, 3 = buffering
    videoPaused: (p.querySelector('video') || {}).paused,
    msToSwap: Date.now() - t0,
  };
})()
