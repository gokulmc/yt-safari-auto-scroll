// Mirrors extension/background.js `shorts-advance-inplace` so this harness
// run exercises the shipped logic against the live tab.
(async function () {
  const VID_RE = /"videoId":"([A-Za-z0-9_-]{11})"/g;
  const ID_RE = /\/shorts\/([A-Za-z0-9_-]{11})/g;
  const uniq = (a) => Array.from(new Set(a));
  const digToken = (o, d) => {
    if (!o || typeof o !== 'object' || d > 8) return null;
    for (const k of Object.keys(o)) {
      if (k === 'token' && typeof o[k] === 'string') return o[k];
      if (o[k] && typeof o[k] === 'object') { const t = digToken(o[k], d + 1); if (t) return t; }
    }
    return null;
  };

  const p = document.getElementById('shorts-player');
  if (!p || typeof p.loadVideoById !== 'function' || typeof p.getVideoData !== 'function') {
    return { ok: false, reason: 'no-shorts-player' };
  }
  const cur = p.getVideoData().video_id;

  const st = (window.__ytsasQ = window.__ytsasQ || {});
  if (!st.queue) {
    st.queue = []; st.token = null;
    const rwsr = window.ytInitialReelWatchSequenceResponse;
    if (rwsr) {
      const t = JSON.stringify(rwsr);
      st.queue = uniq(Array.from(t.matchAll(VID_RE)).map((m) => m[1]));
      st.token = digToken(rwsr.continuationEndpoint, 0);
    }
    if (!st.queue.length) {
      let s = '{}'; try { s = JSON.stringify(window.ytInitialData || {}); } catch (e) {}
      st.queue = uniq(Array.from(s.matchAll(ID_RE)).map((m) => m[1]));
    }
  }

  let idx = st.queue.indexOf(cur);
  if (idx === -1) { st.queue.push(cur); idx = st.queue.length - 1; }
  let next = st.queue[idx + 1];

  if (!next && st.token) {
    const cfg = window.ytcfg;
    const apiKey = cfg && cfg.get('INNERTUBE_API_KEY');
    const ctx = cfg && cfg.get('INNERTUBE_CONTEXT');
    if (apiKey && ctx) {
      try {
        const res = await fetch(`https://www.youtube.com/youtubei/v1/reel/reel_watch_sequence?key=${apiKey}&prettyPrint=false`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ context: ctx, continuation: st.token }), credentials: 'include',
        });
        const txt = await res.text();
        let json = null; try { json = JSON.parse(txt); } catch (e) {}
        const more = uniq(Array.from(txt.matchAll(VID_RE)).map((m) => m[1]));
        for (const id of more) if (!st.queue.includes(id)) st.queue.push(id);
        st.token = json ? digToken(json.continuationEndpoint, 0) : null;
        next = st.queue[idx + 1];
      } catch (e) { return { ok: false, reason: 'refill-failed: ' + e }; }
    }
  }

  if (!next) return { ok: false, reason: 'queue-exhausted', queueLen: st.queue.length };
  p.loadVideoById(next);

  const t0 = Date.now();
  let became = null;
  while (Date.now() - t0 < 5000) {
    await new Promise((r) => setTimeout(r, 150));
    if (p.getVideoData().video_id === next) { became = next; break; }
  }
  await new Promise((r) => setTimeout(r, 600));
  return {
    ok: became === next, hidden: document.hidden,
    from: cur, to: next, became,
    playerState: p.getPlayerState(), videoPaused: (p.querySelector('video') || {}).paused,
    queueLen: st.queue.length, index: idx + 1, hasToken: !!st.token,
  };
})()
