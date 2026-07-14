(async function () {
  const cfg = window.ytcfg;
  const apiKey = cfg.get('INNERTUBE_API_KEY');
  const ctx = cfg.get('INNERTUBE_CONTEXT');
  const res = await fetch(`https://www.youtube.com/youtubei/v1/browse?key=${apiKey}&prettyPrint=false`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context: ctx, browseId: 'FEhistory' }), credentials: 'include',
  });
  const txt = await res.text();
  // pull any human-readable "text" strings + look for history-off messaging
  const texts = Array.from(new Set(Array.from(txt.matchAll(/"text":"([^"]{4,80})"/g)).map((m) => m[1]))).slice(0, 20);
  return {
    mentionsPausedOrOff: /pause|isn't working|turn on|history is off|not watch/i.test(txt),
    hasVideoRenderer: txt.includes('videoRenderer'),
    hasReelItem: txt.includes('reelItemRenderer') || txt.includes('shortsLockupViewModel'),
    hasContinuationItem: txt.includes('continuationItemRenderer'),
    texts,
  };
})()
