(async function () {
  const out = {};
  const rwsr = window.ytInitialReelWatchSequenceResponse;
  const ce = rwsr && rwsr.continuationEndpoint;
  out.ceKeys = ce ? Object.keys(ce) : null;
  // dig for a token inside continuationEndpoint specifically
  let token = null;
  const find = (o, d) => {
    if (!o || typeof o !== 'object' || d > 6 || token) return;
    for (const k of Object.keys(o)) {
      if (k === 'token' && typeof o[k] === 'string') { token = o[k]; return; }
      if (o[k] && typeof o[k] === 'object') find(o[k], d + 1);
    }
  };
  if (ce) find(ce, 0);
  out.tokenSample = token ? token.slice(0, 24) : null;

  const cfg = window.ytcfg;
  const apiKey = cfg && cfg.get('INNERTUBE_API_KEY');
  const ctx = cfg && cfg.get('INNERTUBE_CONTEXT');
  if (apiKey && ctx && token) {
    try {
      const res = await fetch(`https://www.youtube.com/youtubei/v1/reel/reel_watch_sequence?key=${apiKey}&prettyPrint=false`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: ctx, continuation: token }), credentials: 'include',
      });
      const txt = await res.text();
      let j = null; try { j = JSON.parse(txt); } catch (e) {}
      // find the NEXT continuation token in the response's continuationEndpoint
      let nextTok = null;
      const ce2 = j && j.continuationEndpoint;
      if (ce2) { const f2 = (o, d) => { if (!o || typeof o !== 'object' || d > 6 || nextTok) return; for (const k of Object.keys(o)) { if (k === 'token' && typeof o[k] === 'string') { nextTok = o[k]; return; } if (o[k] && typeof o[k] === 'object') f2(o[k], d + 1); } }; f2(ce2, 0); }
      out.refill = {
        status: res.status,
        ids: Array.from(new Set(Array.from(txt.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)).map((m) => m[1]))).slice(0, 15),
        idCount: new Set(Array.from(txt.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)).map((m) => m[1])).size,
        hasNextToken: !!nextTok,
      };
    } catch (e) { out.refill = { err: String(e) }; }
  }
  return out;
})()
