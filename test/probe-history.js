(async function () {
  const cfg = window.ytcfg;
  const apiKey = cfg && cfg.get('INNERTUBE_API_KEY');
  const ctx = cfg && cfg.get('INNERTUBE_CONTEXT');
  if (!apiKey || !ctx) return { err: 'no config' };
  try {
    const res = await fetch(`https://www.youtube.com/youtubei/v1/browse?key=${apiKey}&prettyPrint=false`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: ctx, browseId: 'FEhistory' }), credentials: 'include',
    });
    const txt = await res.text();
    const j = JSON.parse(txt);
    const ids = Array.from(new Set(Array.from(txt.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)).map((m) => m[1])));
    // is there a continuation token for more history pages?
    const hasCont = /"continuationCommand"|"token"/.test(txt);
    // detect shorts vs regular in the history (shorts have /shorts/ urls)
    const shortsUrlIds = Array.from(new Set(Array.from(txt.matchAll(/\/shorts\/([A-Za-z0-9_-]{11})/g)).map((m) => m[1])));
    return {
      status: res.status,
      len: txt.length,
      totalVideoIds: ids.length,
      sampleIds: ids.slice(0, 10),
      shortsUrlIdCount: shortsUrlIds.length,
      shortsSample: shortsUrlIds.slice(0, 8),
      hasContinuation: hasCont,
      topKeys: Object.keys(j).slice(0, 10),
    };
  } catch (e) { return { err: String(e) }; }
})()
