(async function () {
  const p = document.getElementById('movie_player');
  const results = [];
  for (let i = 0; i < 6; i++) {
    const v = p.querySelector('video');
    // wait for metadata
    let w = 0, tries = 0;
    while (w === 0 && tries < 20) { await new Promise(r => setTimeout(r, 200)); w = v.videoWidth; tries++; }
    const d = p.getVideoData();
    results.push({ i: p.getPlaylistIndex(), id: d.video_id, w: v.videoWidth, h: v.videoHeight, portrait: v.videoHeight > v.videoWidth, dur: Math.round(v.duration) });
    p.nextVideo();
    await new Promise(r => setTimeout(r, 1800));
  }
  return { plLen: (p.getPlaylist() || []).length, items: results };
})()
