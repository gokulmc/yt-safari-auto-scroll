(async function () {
  const out = { href: location.href };
  const cur = (location.pathname.match(/\/shorts\/([^/?]+)/) || [])[1] || null;
  out.currentId = cur;

  // 1) window globals that look reel/sequence related
  out.windowKeys = Object.keys(window).filter((k) => /reel|short|sequence|initialdata|watchnext/i.test(k)).slice(0, 30);

  // 2) stringify ytInitialData, extract candidate short ids + look for markers
  try {
    const s = JSON.stringify(window.ytInitialData || {});
    out.initialDataLen = s.length;
    out.hasSequenceParamsStr = s.includes('sequenceParams');
    out.hasReelWatchStr = s.includes('reelWatchEndpoint');
    const shortsUrlIds = Array.from(s.matchAll(/\/shorts\/([A-Za-z0-9_-]{11})/g)).map((m) => m[1]);
    const videoIdField = Array.from(s.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)).map((m) => m[1]);
    out.shortsUrlIds = Array.from(new Set(shortsUrlIds)).slice(0, 12);
    out.videoIdFieldIds = Array.from(new Set(videoIdField)).slice(0, 12);
  } catch (e) { out.initialDataErr = String(e); }

  // 3) ytd-shorts element polymer data
  const shortsEl = document.querySelector('ytd-shorts');
  const sd = shortsEl && (shortsEl.data || (shortsEl.polymerController && shortsEl.polymerController.data));
  out.shorts = { present: !!shortsEl, dataKeys: sd ? Object.keys(sd).slice(0, 25) : null };

  // 4) reel renderer count + their data ids
  const reels = Array.from(document.querySelectorAll('ytd-reel-video-renderer'));
  out.reelCount = reels.length;

  // 5) confirm loadVideoById swaps the stream: reload current id, watch state
  const p = document.getElementById('shorts-player');
  try {
    const st0 = p.getPlayerState();
    p.loadVideoById(cur);
    await new Promise((r) => setTimeout(r, 1200));
    out.loadVideoByIdTest = { before: st0, after: p.getPlayerState(), stillId: p.getVideoData().video_id };
  } catch (e) { out.loadVideoByIdTest = { err: String(e) }; }

  // 6) try youtubei/v1/next with current video, hunt for more short ids
  const cfg = window.ytcfg;
  const apiKey = cfg && cfg.get('INNERTUBE_API_KEY');
  const ctx = cfg && cfg.get('INNERTUBE_CONTEXT');
  if (apiKey && ctx && cur) {
    try {
      const res = await fetch(`https://www.youtube.com/youtubei/v1/next?key=${apiKey}&prettyPrint=false`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: ctx, videoId: cur }), credentials: 'include',
      });
      const txt = await res.text();
      const ids = Array.from(txt.matchAll(/\/shorts\/([A-Za-z0-9_-]{11})/g)).map((m) => m[1]);
      out.nextEndpoint = { status: res.status, len: txt.length, shortsIds: Array.from(new Set(ids)).slice(0, 12), hasReelWatch: txt.includes('reelWatchEndpoint') };
    } catch (e) { out.nextEndpoint = { err: String(e) }; }
  }
  return out;
})()
