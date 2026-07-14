(async function () {
  const cfg = window.ytcfg;
  const apiKey = cfg && cfg.get('INNERTUBE_API_KEY');
  const ctx = cfg && cfg.get('INNERTUBE_CONTEXT');
  const p = document.getElementById('shorts-player');
  const cur = p && p.getVideoData ? p.getVideoData().video_id : null;
  const seqBytes = [0x0a, 0x0b].concat(Array.from(cur).map((c) => c.charCodeAt(0))).concat([0x2a, 0x02, 0x18, 0x06, 0x50, 0x19, 0x68, 0x00]);
  const seqParams = btoa(String.fromCharCode.apply(null, seqBytes));
  const res = await fetch(`https://www.youtube.com/youtubei/v1/reel/reel_watch_sequence?key=${apiKey}&prettyPrint=false`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context: ctx, sequenceParams: seqParams }), credentials: 'include',
  });
  const txt = await res.text();
  const j = JSON.parse(txt);
  // marker searches for watch state
  const markers = {};
  for (const w of ['percentDurationWatched','watchedText','resume','progress','playbackProgress','seen','isWatched','viewedText','timestampSeconds','startTimeSeconds','thumbnailOverlayResumePlaybackRenderer']) {
    markers[w] = txt.includes(w);
  }
  // dump one entry's overlay keys deeply
  const e0 = j.entries && j.entries[0];
  const overlay = e0 && e0.command && e0.command.reelWatchEndpoint && e0.command.reelWatchEndpoint.overlay;
  return { markers, entryCount: j.entries ? j.entries.length : 0, overlayKeys: overlay ? Object.keys(overlay) : null, overlaySample: overlay ? JSON.stringify(overlay).slice(0, 400) : null };
})()
