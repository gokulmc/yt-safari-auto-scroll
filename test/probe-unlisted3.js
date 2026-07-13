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
  const j = JSON.parse(await res.text());

  // candidate detector
  const isUnlistedEntry = (e) => {
    const s = JSON.stringify(e);
    if (/"isUnlisted"\s*:\s*true/i.test(s)) return true;
    return /unlisted/i.test(s.replace(/"isUnlisted"\s*:\s*false/gi, ''));
  };

  const rows = (j.entries || []).map((e) => {
    const s = JSON.stringify(e);
    const id = e.command && e.command.reelWatchEndpoint && e.command.reelWatchEndpoint.videoId;
    const ctxAround = (s.match(/.{0,30}unlisted.{0,30}/i) || [null])[0];
    return { id, flaggedUnlisted: isUnlistedEntry(e), context: ctxAround };
  });
  return { rows };
})()
