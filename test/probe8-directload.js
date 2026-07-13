(async function () {
  const out = {};
  let s = '{}';
  try { s = JSON.stringify(window.ytInitialData || {}); } catch (e) {}
  out.initialDataLen = s.length;
  out.shortsIdsInInitial = Array.from(new Set(Array.from(s.matchAll(/\/shorts\/([A-Za-z0-9_-]{11})/g)).map((m) => m[1]))).length;
  out.seqParamsInInitial = Array.from(new Set(Array.from(s.matchAll(/"sequenceParams":"([^"]+)"/g)).map((m) => m[1]))).length;

  // other candidate globals
  out.windowDataKeys = Object.keys(window).filter((k) => /reel|sequence|initial|ytInitial/i.test(k)).slice(0, 30);
  // ytInitialReelWatchSequenceResponse?
  const rwsr = window.ytInitialReelWatchSequenceResponse;
  if (rwsr) {
    const t = JSON.stringify(rwsr);
    out.rwsr = { present: true, ids: Array.from(new Set(Array.from(t.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)).map((m) => m[1]))).slice(0, 12), seq: Array.from(new Set(Array.from(t.matchAll(/"sequenceParams":"([^"]+)"/g)).map((m) => m[1]))).length };
  } else out.rwsr = { present: false };

  // player: does it expose a way to get next / getVideoData sequence?
  const p = document.getElementById('shorts-player');
  out.player = {
    videoId: p && p.getVideoData ? p.getVideoData().video_id : null,
    hasNextVideo: !!(p && typeof p.nextVideo === 'function'),
    stateVars: p ? Object.keys(p).filter((k) => /seq|reel|next/i.test(k)).slice(0, 20) : null,
  };

  // Try reel_watch_sequence with a seqParam if any exists in initial data
  const seq = Array.from(new Set(Array.from(s.matchAll(/"sequenceParams":"([^"]+)"/g)).map((m) => m[1])));
  const cfg = window.ytcfg;
  const apiKey = cfg && cfg.get('INNERTUBE_API_KEY');
  const ctx = cfg && cfg.get('INNERTUBE_CONTEXT');
  out.canFetch = { apiKey: !!apiKey, ctx: !!ctx, seqParam: !!seq[0] };
  if (apiKey && ctx && seq[0]) {
    try {
      const res = await fetch(`https://www.youtube.com/youtubei/v1/reel/reel_watch_sequence?key=${apiKey}&prettyPrint=false`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: ctx, sequenceParams: seq[0] }), credentials: 'include',
      });
      const txt = await res.text();
      out.reelSeq = { status: res.status, ids: Array.from(new Set(Array.from(txt.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)).map((m) => m[1]))).slice(0, 12) };
    } catch (e) { out.reelSeq = { err: String(e) }; }
  }
  return out;
})()
