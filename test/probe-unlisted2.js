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

  // contexts around each "unlisted" (case-insensitive)
  const contexts = [];
  const re = /.{60}unlisted.{60}/gi;
  let m;
  while ((m = re.exec(txt)) && contexts.length < 5) contexts.push(m[0]);

  // per-entry: does the entry's own JSON mention unlisted, and what's its id?
  const perEntry = (j.entries || []).map((e) => {
    const s = JSON.stringify(e);
    return { id: (e.command && e.command.reelWatchEndpoint && e.command.reelWatchEndpoint.videoId) || null, unlisted: /unlisted/i.test(s) };
  });

  // Does the overlay carry accessibility text we can key on?
  const overlayKeys = j.entries && j.entries[0] && j.entries[0].command.reelWatchEndpoint.overlay
    ? Object.keys(j.entries[0].command.reelWatchEndpoint.overlay) : null;

  return { contexts, perEntry, overlayKeys };
})()
