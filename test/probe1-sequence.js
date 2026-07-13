// Discovery #1: find the next-Short sequence. Returns a diagnostic object.
// This is a Promise-returning expression for run-async-in-safari.sh.
(async function () {
  const out = { href: location.href };
  const cur = (location.pathname.match(/\/shorts\/([^/?]+)/) || [])[1] || null;
  out.currentId = cur;

  // ytcfg innertube context
  const cfg = window.ytcfg && typeof window.ytcfg.get === 'function' ? window.ytcfg : null;
  const apiKey = cfg ? cfg.get('INNERTUBE_API_KEY') : null;
  const ctx = cfg ? cfg.get('INNERTUBE_CONTEXT') : null;
  out.ytcfg = { present: !!cfg, hasApiKey: !!apiKey, hasContext: !!ctx, clientVersion: cfg ? cfg.get('INNERTUBE_CONTEXT_CLIENT_VERSION') : null };

  // Search ytInitialData for sequenceParams + reelWatchEndpoint ids
  const seqParams = [];
  const reelIds = [];
  const seen = new Set();
  const walk = (o, d) => {
    if (!o || typeof o !== 'object' || d > 14 || seen.has(o)) return;
    seen.add(o);
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (k === 'sequenceParams' && typeof v === 'string') seqParams.push(v);
      if (k === 'reelWatchEndpoint' && v && v.videoId) reelIds.push(v.videoId);
      if (v && typeof v === 'object') walk(v, d + 1);
    }
  };
  try { if (window.ytInitialData) walk(window.ytInitialData, 0); } catch (e) { out.walkErr = String(e); }
  out.ytInitialDataPresent = !!window.ytInitialData;
  out.seqParamsCount = seqParams.length;
  out.seqParamSample = seqParams[0] ? seqParams[0].slice(0, 40) : null;
  out.reelIdsInInitialData = reelIds.slice(0, 6);

  // Player API surface
  const pEl = document.getElementById('shorts-player') || document.getElementById('movie_player');
  out.player = {
    elId: pEl ? pEl.id : null,
    hasLoadVideoById: !!(pEl && typeof pEl.loadVideoById === 'function'),
    hasNextVideo: !!(pEl && typeof pEl.nextVideo === 'function'),
    hasGetPlaylist: !!(pEl && typeof pEl.getPlaylist === 'function'),
  };

  // Live fetch: reel_watch_sequence with first seqParams
  if (apiKey && ctx && seqParams[0]) {
    try {
      const res = await fetch(`https://www.youtube.com/youtubei/v1/reel/reel_watch_sequence?key=${apiKey}&prettyPrint=false`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: ctx, sequenceParams: seqParams[0] }),
        credentials: 'include',
      });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch (e) {}
      const ids = [];
      const walkIds = (o, d) => {
        if (!o || typeof o !== 'object' || d > 10) return;
        for (const k of Object.keys(o)) {
          if (k === 'videoId' && typeof o[k] === 'string') ids.push(o[k]);
          else if (o[k] && typeof o[k] === 'object') walkIds(o[k], d + 1);
        }
      };
      if (json) walkIds(json, 0);
      out.reelSeq = {
        status: res.status,
        topKeys: json ? Object.keys(json).slice(0, 15) : null,
        bodyHead: json ? null : text.slice(0, 200),
        videoIds: Array.from(new Set(ids)).slice(0, 12),
        idCount: new Set(ids).size,
      };
    } catch (e) {
      out.reelSeq = { fetchError: String(e) };
    }
  } else {
    out.reelSeq = { skipped: true };
  }

  return out;
})()
