// Mirrors background.js build-shorts-playlist to verify a clean ~50-Short list.
(async function () {
  const reelIdsFrom = (obj) => {
    const ids = [];
    const walk = (o, d) => { if (!o || typeof o !== 'object' || d > 10) return; if (o.reelWatchEndpoint && o.reelWatchEndpoint.videoId) ids.push(o.reelWatchEndpoint.videoId); for (const k of Object.keys(o)) if (o[k] && typeof o[k] === 'object') walk(o[k], d + 1); };
    walk(obj, 0); return Array.from(new Set(ids));
  };
  const digToken = (o, d) => { if (!o || typeof o !== 'object' || d > 8) return null; for (const k of Object.keys(o)) { if (k === 'token' && typeof o[k] === 'string') return o[k]; if (o[k] && typeof o[k] === 'object') { const t = digToken(o[k], d + 1); if (t) return t; } } return null; };

  const p = document.getElementById('shorts-player');
  const cur = p && p.getVideoData ? p.getVideoData().video_id : (location.pathname.match(/\/shorts\/([^/?]+)/) || [])[1];
  if (!cur || cur.length !== 11) return { ok: false, reason: 'no-current-short', cur };
  const cfg = window.ytcfg; const apiKey = cfg && cfg.get('INNERTUBE_API_KEY'); const ctx = cfg && cfg.get('INNERTUBE_CONTEXT');
  const seqBytes = [0x0a, 0x0b].concat(Array.from(cur).map((c) => c.charCodeAt(0))).concat([0x2a, 0x02, 0x18, 0x06, 0x50, 0x19, 0x68, 0x00]);
  const seqParams = btoa(String.fromCharCode.apply(null, seqBytes));
  const fetchSeq = async (body) => { const res = await fetch(`https://www.youtube.com/youtubei/v1/reel/reel_watch_sequence?key=${apiKey}&prettyPrint=false`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ context: ctx }, body)), credentials: 'include' }); return res.json(); };

  const ids = []; let token = null; let rounds = 0;
  try { const first = await fetchSeq({ sequenceParams: seqParams }); for (const id of reelIdsFrom(first)) if (!ids.includes(id)) ids.push(id); token = digToken(first.continuationEndpoint, 0); } catch (e) { return { ok: false, reason: 'seed: ' + e }; }
  let guard = 0;
  while (ids.length < 50 && token && guard < 8) { guard += 1; rounds++; try { const more = await fetchSeq({ continuation: token }); for (const id of reelIdsFrom(more)) if (!ids.includes(id)) ids.push(id); token = digToken(more.continuationEndpoint, 0); } catch (e) { break; } }
  const ordered = Array.from(new Set([cur].concat(ids))).slice(0, 50);
  return { ok: true, cur, count: ordered.length, rounds, first10: ordered.slice(0, 10), allUnique: ordered.length === new Set(ordered).size };
})()
