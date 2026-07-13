(async function () {
  const out = {};
  const p = document.getElementById('shorts-player');
  const vid = p && p.getVideoData ? p.getVideoData().video_id : (location.pathname.match(/\/shorts\/([^/?]+)/) || [])[1];
  out.vid = vid;
  if (!vid || vid.length !== 11) return { err: 'no 11-char video id', vid };

  // sequenceParams = protobuf: field1=videoId, then constant suffix
  // (0x2a 02 18 06 = field5{field3:6}, 0x50 19 = field10:25, 0x68 00 = field13:0)
  const bytes = [0x0a, 0x0b].concat(Array.from(vid).map((c) => c.charCodeAt(0))).concat([0x2a, 0x02, 0x18, 0x06, 0x50, 0x19, 0x68, 0x00]);
  const seqParams = btoa(String.fromCharCode.apply(null, bytes));
  out.seqParams = seqParams;

  const cfg = window.ytcfg;
  const apiKey = cfg && cfg.get('INNERTUBE_API_KEY');
  const ctx = cfg && cfg.get('INNERTUBE_CONTEXT');
  if (!apiKey || !ctx) return { ...out, err: 'no apiKey/ctx' };

  const reelFrom = (obj) => {
    const ids = [];
    const walk = (o, d) => { if (!o || typeof o !== 'object' || d > 10) return; if (o.reelWatchEndpoint && o.reelWatchEndpoint.videoId) ids.push(o.reelWatchEndpoint.videoId); for (const k of Object.keys(o)) if (o[k] && typeof o[k] === 'object') walk(o[k], d + 1); };
    walk(obj, 0); return Array.from(new Set(ids));
  };

  try {
    const res = await fetch(`https://www.youtube.com/youtubei/v1/reel/reel_watch_sequence?key=${apiKey}&prettyPrint=false`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: ctx, sequenceParams: seqParams }), credentials: 'include',
    });
    const j = await res.json();
    out.status = res.status;
    out.entries = j.entries ? j.entries.length : null;
    out.reelIds = reelFrom(j);
    out.reelCount = out.reelIds.length;
    out.reelIds = out.reelIds.slice(0, 15);
  } catch (e) { out.fetchErr = String(e); }
  return out;
})()
