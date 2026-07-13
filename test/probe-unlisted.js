// Fetch the reel sequence and look for how UNLISTED videos are marked, so we
// can filter them at build time. Dumps: entry structure keys, any privacy/
// badge/unlisted markers found near reel entries, and the current player's
// isListed for reference.
(async function () {
  const out = {};
  const p = document.getElementById('shorts-player');
  out.curIsListed = p && p.getVideoData ? p.getVideoData().isListed : null;

  const cfg = window.ytcfg;
  const apiKey = cfg && cfg.get('INNERTUBE_API_KEY');
  const ctx = cfg && cfg.get('INNERTUBE_CONTEXT');
  const cur = p && p.getVideoData ? p.getVideoData().video_id : null;
  if (!apiKey || !ctx || !cur) return { err: 'no config/cur', out };

  const seqBytes = [0x0a, 0x0b].concat(Array.from(cur).map((c) => c.charCodeAt(0))).concat([0x2a, 0x02, 0x18, 0x06, 0x50, 0x19, 0x68, 0x00]);
  const seqParams = btoa(String.fromCharCode.apply(null, seqBytes));
  const res = await fetch(`https://www.youtube.com/youtubei/v1/reel/reel_watch_sequence?key=${apiKey}&prettyPrint=false`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context: ctx, sequenceParams: seqParams }), credentials: 'include',
  });
  const txt = await res.text();
  const j = JSON.parse(txt);

  out.topKeys = Object.keys(j);
  out.entryCount = j.entries ? j.entries.length : 0;
  // structure of a single entry
  if (j.entries && j.entries[0]) {
    out.entry0Keys = Object.keys(j.entries[0]);
    const cmd = j.entries[0].command;
    out.entry0CommandKeys = cmd ? Object.keys(cmd) : null;
    out.entry0 = JSON.stringify(j.entries[0]).slice(0, 600);
  }
  // marker searches across the raw response
  out.markers = {
    hasUnlistedWord: /unlisted/i.test(txt),
    hasUNLISTED_badge: txt.includes('UNLISTED'),
    hasBADGE_STYLE_UNLISTED: txt.includes('BADGE_STYLE_TYPE_UNLISTED'),
    hasPrivacy: /"privacy"/i.test(txt),
    hasIsListed: txt.includes('isListed'),
    hasMetadataBadge: txt.includes('metadataBadgeRenderer'),
  };
  return out;
})()
