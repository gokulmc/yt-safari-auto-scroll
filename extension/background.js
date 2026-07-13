// background.js
//  - Keeps the toolbar icon in sync with the auto-scroll toggle.
//  - Handles the hidden-tab / PiP Shorts advance: content.js can't reach
//    YouTube's page-world player, so on `ended` in a hidden tab it asks us
//    to advance in the page's MAIN world. We swap the next Short's stream
//    into the same player element via loadVideoById — proven to work while
//    the tab is hidden and to keep an active PiP window alive (PiP is bound
//    to that element). The scroll-based advance content.js uses in a
//    visible tab is frozen by WebKit when the page isn't rendering, which
//    is why the hidden case needs this different mechanism entirely.

// Root-relative paths: Safari resolves setIcon paths against the calling
// context's directory rather than the extension root.
const iconPaths = (suffix) => ({
  16: `/images/toolbar-16${suffix}.png`,
  19: `/images/toolbar-19${suffix}.png`,
  32: `/images/toolbar-32${suffix}.png`,
  38: `/images/toolbar-38${suffix}.png`,
});

const syncIcon = () =>
  browser.storage.local
    .get({ enabled: true })
    .then(({ enabled }) => browser.action.setIcon({ path: iconPaths(enabled ? '' : '-off') }))
    .catch(() => {});

browser.runtime.onInstalled.addListener(syncIcon);
browser.runtime.onStartup.addListener(syncIcon);
browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'enabled' in changes) syncIcon();
});

const injectMain = (tabId, func, args) =>
  browser.scripting
    .executeScript({ target: { tabId }, world: 'MAIN', func, args: args || [] })
    .then((r) => (r && r[0] ? r[0].result : null))
    .catch((err) => ({ ok: false, reason: String(err) }));

browser.runtime.onMessage.addListener((msg, sender) => {
  const tabId = sender && sender.tab && sender.tab.id;
  if (!msg || typeof tabId !== 'number') return;

  // Advance the current Short in place, staying on the Shorts page. All of
  // this runs in the page's MAIN world; every piece — reading ytInitialData,
  // fetch, loadVideoById — stays alive in a hidden tab, so this is the one
  // path that advances Shorts while backgrounded. A persistent per-document
  // queue (window.__ytsasQ) is seeded from ytInitialData and refilled from
  // the reel_watch_sequence endpoint so playback continues indefinitely.
  if (msg.type === 'shorts-advance-inplace') {
    return injectMain(tabId, async () => {
      const VID_RE = /"videoId":"([A-Za-z0-9_-]{11})"/g;
      const ID_RE = /\/shorts\/([A-Za-z0-9_-]{11})/g;
      const uniq = (a) => Array.from(new Set(a));
      // First `token` string found anywhere under a continuationEndpoint —
      // this is the reel sequence's continuation (NOT the comments panel's,
      // which lives elsewhere in the tree).
      const digToken = (o, d) => {
        if (!o || typeof o !== 'object' || d > 8) return null;
        for (const k of Object.keys(o)) {
          if (k === 'token' && typeof o[k] === 'string') return o[k];
          if (o[k] && typeof o[k] === 'object') {
            const t = digToken(o[k], d + 1);
            if (t) return t;
          }
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
        st.queue = [];
        st.token = null;
        // Primary source: the reel sequence response YouTube loads for every
        // Short (present on both direct loads and organic browsing). Falls
        // back to any /shorts/ ids in ytInitialData.
        const rwsr = window.ytInitialReelWatchSequenceResponse;
        if (rwsr) {
          const t = JSON.stringify(rwsr);
          st.queue = uniq(Array.from(t.matchAll(VID_RE)).map((m) => m[1]));
          st.token = digToken(rwsr.continuationEndpoint, 0);
        }
        if (!st.queue.length) {
          let s = '{}';
          try { s = JSON.stringify(window.ytInitialData || {}); } catch (e) {}
          st.queue = uniq(Array.from(s.matchAll(ID_RE)).map((m) => m[1]));
        }
      }

      let idx = st.queue.indexOf(cur);
      if (idx === -1) {
        st.queue.push(cur);
        idx = st.queue.length - 1;
      }
      let next = st.queue[idx + 1];

      if (!next && st.token) {
        // Refill via the reel continuation token (fetch works while hidden);
        // capture the NEXT token from the response so this chains forever.
        const cfg = window.ytcfg && typeof window.ytcfg.get === 'function' ? window.ytcfg : null;
        const apiKey = cfg ? cfg.get('INNERTUBE_API_KEY') : null;
        const ctx = cfg ? cfg.get('INNERTUBE_CONTEXT') : null;
        if (apiKey && ctx) {
          try {
            const res = await fetch(
              `https://www.youtube.com/youtubei/v1/reel/reel_watch_sequence?key=${apiKey}&prettyPrint=false`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ context: ctx, continuation: st.token }),
                credentials: 'include',
              }
            );
            const txt = await res.text();
            let json = null;
            try { json = JSON.parse(txt); } catch (e) {}
            const more = uniq(Array.from(txt.matchAll(VID_RE)).map((m) => m[1]));
            for (const id of more) if (!st.queue.includes(id)) st.queue.push(id);
            st.token = json ? digToken(json.continuationEndpoint, 0) : null;
            next = st.queue[idx + 1];
          } catch (e) {
            return { ok: false, reason: 'refill-failed: ' + e };
          }
        }
      }

      if (!next) return { ok: false, reason: 'queue-exhausted', queueLen: st.queue.length };
      p.loadVideoById(next);
      return { ok: true, from: cur, to: next, queueLen: st.queue.length, index: idx + 1 };
    });
  }

  // Gather up to ~50 upcoming Short ids (current first) so the popup can
  // build a temporary watch_videos playlist. YouTube's native playlist
  // autoplay then advances through these Shorts in the watch player,
  // preserving an active PiP window even in a hidden tab — the one path
  // that plays Shorts hands-free in background PiP (verified).
  if (msg.type === 'build-shorts-playlist') {
    return injectMain(tabId, async () => {
      // Extract ONLY reel videoIds (inside a reelWatchEndpoint) — extracting
      // every "videoId" in the response pulls in recommended/promoted
      // LANDSCAPE videos, which polluted the playlist.
      const reelIdsFrom = (obj) => {
        const ids = [];
        const walk = (o, d) => {
          if (!o || typeof o !== 'object' || d > 10) return;
          if (o.reelWatchEndpoint && o.reelWatchEndpoint.videoId) ids.push(o.reelWatchEndpoint.videoId);
          for (const k of Object.keys(o)) if (o[k] && typeof o[k] === 'object') walk(o[k], d + 1);
        };
        walk(obj, 0);
        return Array.from(new Set(ids));
      };
      const digToken = (o, d) => {
        if (!o || typeof o !== 'object' || d > 8) return null;
        for (const k of Object.keys(o)) {
          if (k === 'token' && typeof o[k] === 'string') return o[k];
          if (o[k] && typeof o[k] === 'object') {
            const t = digToken(o[k], d + 1);
            if (t) return t;
          }
        }
        return null;
      };

      const p = document.getElementById('shorts-player');
      const cur = p && p.getVideoData ? p.getVideoData().video_id : (location.pathname.match(/\/shorts\/([^/?]+)/) || [])[1];
      if (!cur || cur.length !== 11) return { ok: false, reason: 'no-current-short' };

      const cfg = window.ytcfg && typeof window.ytcfg.get === 'function' ? window.ytcfg : null;
      const apiKey = cfg ? cfg.get('INNERTUBE_API_KEY') : null;
      const ctx = cfg ? cfg.get('INNERTUBE_CONTEXT') : null;
      if (!apiKey || !ctx) return { ok: false, reason: 'no-innertube-config' };

      const fetchSeq = async (body) => {
        const res = await fetch(
          `https://www.youtube.com/youtubei/v1/reel/reel_watch_sequence?key=${apiKey}&prettyPrint=false`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ context: ctx }, body)), credentials: 'include' }
        );
        return res.json();
      };

      const ids = [];
      let token = null;

      // Prefer the user's REAL personalized reel sequence — it's in
      // ytInitialReelWatchSequenceResponse while they're browsing the Shorts
      // feed. A sequenceParams seed CONSTRUCTED from just the videoId loses
      // that personalization and returns generic, repetitive content (the
      // "it repeats social videos" bug). Only fall back to the constructed
      // seed if the real one isn't there (e.g. a cold/hard load).
      const rwsr = window.ytInitialReelWatchSequenceResponse;
      let source = 'none';
      if (rwsr) {
        const seed = reelIdsFrom(rwsr);
        if (seed.length) {
          source = 'ytInitialReelWatchSequenceResponse';
          for (const id of seed) if (!ids.includes(id)) ids.push(id);
          token = digToken(rwsr.continuationEndpoint, 0);
        }
      }
      if (!ids.length) {
        source = 'constructed-seqParams';
        const seqBytes = [0x0a, 0x0b]
          .concat(Array.from(cur).map((c) => c.charCodeAt(0)))
          .concat([0x2a, 0x02, 0x18, 0x06, 0x50, 0x19, 0x68, 0x00]);
        const seqParams = btoa(String.fromCharCode.apply(null, seqBytes));
        try {
          const first = await fetchSeq({ sequenceParams: seqParams });
          for (const id of reelIdsFrom(first)) if (!ids.includes(id)) ids.push(id);
          token = digToken(first.continuationEndpoint, 0);
        } catch (e) {
          return { ok: false, reason: 'seed-fetch-failed: ' + e };
        }
      }

      // Chain the personalized continuation, but STOP once it stops yielding
      // new videos — padding with a looping/exhausted sequence is exactly
      // what makes the playlist feel repetitive.
      let guard = 0;
      let dryRounds = 0;
      while (ids.length < 50 && token && guard < 12 && dryRounds < 2) {
        guard += 1;
        const before = ids.length;
        try {
          const more = await fetchSeq({ continuation: token });
          for (const id of reelIdsFrom(more)) if (!ids.includes(id)) ids.push(id);
          token = digToken(more.continuationEndpoint, 0);
        } catch (e) {
          break;
        }
        dryRounds = ids.length > before ? 0 : dryRounds + 1;
      }

      // Current Short first, then the clean upcoming reels, capped at 50.
      const ordered = Array.from(new Set([cur].concat(ids))).slice(0, 50);
      return { ok: true, ids: ordered, count: ordered.length, source };
    });
  }
});

// Also run on every worker wake — setIcon state doesn't survive restarts.
syncIcon();
