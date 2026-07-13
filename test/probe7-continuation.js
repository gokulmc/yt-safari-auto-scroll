(async function () {
  const out = {};
  const s = JSON.stringify(window.ytInitialData || {});
  // Extract sequenceParams via regex (walk missed it due to depth).
  const sp = Array.from(new Set(Array.from(s.matchAll(/"sequenceParams":"([^"]+)"/g)).map((m) => m[1])));
  out.seqParamsCount = sp.length;
  out.seqParamSample = sp[0] ? sp[0].slice(0, 30) : null;

  const cfg = window.ytcfg;
  const apiKey = cfg && cfg.get('INNERTUBE_API_KEY');
  const ctx = cfg && cfg.get('INNERTUBE_CONTEXT');
  if (!apiKey || !ctx || !sp[0]) return { ...out, err: 'missing prerequisites' };

  try {
    const res = await fetch(`https://www.youtube.com/youtubei/v1/reel/reel_watch_sequence?key=${apiKey}&prettyPrint=false`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: ctx, sequenceParams: sp[0] }), credentials: 'include',
    });
    const txt = await res.text();
    let json = null; try { json = JSON.parse(txt); } catch (e) {}
    const ids = Array.from(new Set(Array.from(txt.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)).map((m) => m[1])));
    const nextSeq = Array.from(new Set(Array.from(txt.matchAll(/"sequenceParams":"([^"]+)"/g)).map((m) => m[1])));
    out.reelSeq = {
      status: res.status,
      topKeys: json ? Object.keys(json).slice(0, 12) : null,
      idCount: ids.length,
      ids: ids.slice(0, 12),
      hasNextSeqParams: nextSeq.length > 0,
    };
  } catch (e) { out.reelSeq = { err: String(e) }; }
  return out;
})()
