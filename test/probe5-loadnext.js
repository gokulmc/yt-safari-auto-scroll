(async function () {
  const p = document.getElementById('shorts-player');
  const cur = p.getVideoData().video_id;
  const s = JSON.stringify(window.ytInitialData || {});
  const ids = Array.from(new Set(Array.from(s.matchAll(/\/shorts\/([A-Za-z0-9_-]{11})/g)).map((m) => m[1])));
  const queue = ids.filter((x) => x !== cur);
  const target = queue[0];
  if (!target) return { err: 'no target', cur, idsLen: ids.length };

  const t0 = Date.now();
  p.loadVideoById(target);
  let after = null;
  while (Date.now() - t0 < 5000) {
    await new Promise((r) => setTimeout(r, 150));
    const now = p.getVideoData().video_id;
    if (now === target) { after = now; break; }
  }
  return {
    cur,
    target,
    after,
    success: after === target,
    msToSwap: Date.now() - t0,
    playerState: p.getPlayerState(),
    inPiP: (p.querySelector('video') || {}).webkitPresentationMode || 'inline',
    queuePreview: queue.slice(0, 8),
    queueLen: queue.length,
  };
})()
