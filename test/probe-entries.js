(async function () {
  const out = { url: location.href };
  const rwsr = window.ytInitialReelWatchSequenceResponse;
  out.rwsrPresent = !!rwsr;
  out.rwsrEntries = rwsr && rwsr.entries ? rwsr.entries.length : null;
  // clean reel ids from rwsr.entries
  const reelFrom = (obj) => {
    const ids = [];
    const walk = (o, d) => { if (!o || typeof o !== 'object' || d > 10) return; if (o.reelWatchEndpoint && o.reelWatchEndpoint.videoId) ids.push(o.reelWatchEndpoint.videoId); for (const k of Object.keys(o)) if (o[k] && typeof o[k] === 'object') walk(o[k], d + 1); };
    walk(obj, 0); return Array.from(new Set(ids));
  };
  out.rwsrReelIds = rwsr ? reelFrom(rwsr).slice(0, 12) : null;

  // Also hit the endpoint fresh using a token dug from rwsr, parse entries cleanly
  const digToken = (o, d) => { if (!o || typeof o !== 'object' || d > 8) return null; for (const k of Object.keys(o)) { if (k === 'token' && typeof o[k] === 'string') return o[k]; if (o[k] && typeof o[k] === 'object') { const t = digToken(o[k], d + 1); if (t) return t; } } return null; };
  const token = rwsr ? digToken(rwsr.continuationEndpoint, 0) : null;
  out.hasToken = !!token;
  const cfg = window.ytcfg; const apiKey = cfg && cfg.get('INNERTUBE_API_KEY'); const ctx = cfg && cfg.get('INNERTUBE_CONTEXT');
  if (apiKey && ctx && token) {
    try {
      const res = await fetch(`https://www.youtube.com/youtubei/v1/reel/reel_watch_sequence?key=${apiKey}&prettyPrint=false`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ context: ctx, continuation: token }), credentials: 'include' });
      const j = await res.json();
      out.endpointEntries = j.entries ? j.entries.length : null;
      out.endpointReelIds = reelFrom(j).slice(0, 12);
    } catch (e) { out.endpointErr = String(e); }
  }
  return out;
})()
