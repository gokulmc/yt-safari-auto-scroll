(async function () {
  const cfg = window.ytcfg;
  if (!cfg || !cfg.get) return { err: 'no ytcfg on this page', url: location.href.slice(0,40) };
  const apiKey = cfg.get('INNERTUBE_API_KEY');
  const ctx = cfg.get('INNERTUBE_CONTEXT');
  const res = await fetch(`https://www.youtube.com/youtubei/v1/browse?key=${apiKey}&prettyPrint=false`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context: ctx, browseId: 'FEhistory' }), credentials: 'include',
  });
  const txt = await res.text();
  const renderers = {};
  for (const r of ['videoRenderer','shortsLockupViewModel','lockupViewModel','reelItemRenderer','gridVideoRenderer','richItemRenderer']) renderers[r] = (txt.match(new RegExp(r,'g'))||[]).length;
  // try several id shapes
  const idSets = {
    videoIdField: Array.from(new Set(Array.from(txt.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)).map(m=>m[1]))),
    shortsUrl: Array.from(new Set(Array.from(txt.matchAll(/\/shorts\/([A-Za-z0-9_-]{11})/g)).map(m=>m[1]))),
    watchUrl: Array.from(new Set(Array.from(txt.matchAll(/watch\?v=([A-Za-z0-9_-]{11})/g)).map(m=>m[1]))),
    entityKey: Array.from(new Set(Array.from(txt.matchAll(/"onTap"[\s\S]{0,200}?"videoId":"([A-Za-z0-9_-]{11})"/g)).map(m=>m[1]))),
  };
  return {
    status: res.status, len: txt.length, renderers,
    counts: Object.fromEntries(Object.entries(idSets).map(([k,v])=>[k,v.length])),
    watchSample: idSets.watchUrl.slice(0,6), shortsSample: idSets.shortsUrl.slice(0,6), videoIdSample: idSets.videoIdField.slice(0,6),
  };
})()
