(async function () {
  const out = {};
  const rwsr = window.ytInitialReelWatchSequenceResponse;
  if (!rwsr) return { err: 'no rwsr' };
  const t = JSON.stringify(rwsr);
  out.topKeys = Object.keys(rwsr).slice(0, 15);
  out.hasContinuationStr = t.includes('continuation');
  out.hasSeqParamsStr = t.includes('sequenceParams');
  out.continuationTokens = Array.from(new Set(Array.from(t.matchAll(/"continuation":"([^"]+)"/g)).map((m) => m[1]))).map((x) => x.slice(0, 20));
  out.continuationCmdTokens = Array.from(new Set(Array.from(t.matchAll(/"token":"([^"]{20,})"/g)).map((m) => m[1]))).slice(0, 3).map((x) => x.slice(0, 20));

  // Try continuation refill
  const cfg = window.ytcfg;
  const apiKey = cfg && cfg.get('INNERTUBE_API_KEY');
  const ctx = cfg && cfg.get('INNERTUBE_CONTEXT');
  const tokenMatch = t.match(/"(?:continuation|token)":"([^"]{20,})"/);
  const token = tokenMatch ? tokenMatch[1] : null;
  out.tokenSample = token ? token.slice(0, 24) : null;
  if (apiKey && ctx && token) {
    try {
      const res = await fetch(`https://www.youtube.com/youtubei/v1/reel/reel_watch_sequence?key=${apiKey}&prettyPrint=false`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: ctx, continuation: token }), credentials: 'include',
      });
      const txt = await res.text();
      out.contRefill = {
        status: res.status,
        ids: Array.from(new Set(Array.from(txt.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)).map((m) => m[1]))).slice(0, 12),
        hasNextContinuation: /"continuation":"[^"]+"/.test(txt),
      };
    } catch (e) { out.contRefill = { err: String(e) }; }
  }
  return out;
})()
