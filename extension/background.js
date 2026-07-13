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
      const ID_RE = /\/shorts\/([A-Za-z0-9_-]{11})/g;
      const SEQ_RE = /"sequenceParams":"([^"]+)"/g;
      const VID_RE = /"videoId":"([A-Za-z0-9_-]{11})"/g;
      const uniq = (a) => Array.from(new Set(a));

      const p = document.getElementById('shorts-player');
      if (!p || typeof p.loadVideoById !== 'function' || typeof p.getVideoData !== 'function') {
        return { ok: false, reason: 'no-shorts-player' };
      }
      const cur = p.getVideoData().video_id;

      const st = (window.__ytsasQ = window.__ytsasQ || {});
      if (!st.queue) {
        let s = '{}';
        try {
          s = JSON.stringify(window.ytInitialData || {});
        } catch (e) {
          /* ignore */
        }
        st.queue = uniq(Array.from(s.matchAll(ID_RE)).map((m) => m[1]));
        st.seq = uniq(Array.from(s.matchAll(SEQ_RE)).map((m) => m[1]));
      }

      let idx = st.queue.indexOf(cur);
      if (idx === -1) {
        // Current Short isn't in our list (e.g. the user scrolled manually);
        // anchor the queue at it so we can move forward from here.
        st.queue.push(cur);
        idx = st.queue.length - 1;
      }
      let next = st.queue[idx + 1];

      if (!next) {
        // Refill from the reel sequence endpoint (fetch works while hidden).
        const cfg = window.ytcfg && typeof window.ytcfg.get === 'function' ? window.ytcfg : null;
        const apiKey = cfg ? cfg.get('INNERTUBE_API_KEY') : null;
        const ctx = cfg ? cfg.get('INNERTUBE_CONTEXT') : null;
        const seqParam = st.seq && st.seq[st.seq.length - 1];
        if (apiKey && ctx && seqParam) {
          try {
            const res = await fetch(
              `https://www.youtube.com/youtubei/v1/reel/reel_watch_sequence?key=${apiKey}&prettyPrint=false`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ context: ctx, sequenceParams: seqParam }),
                credentials: 'include',
              }
            );
            const txt = await res.text();
            const more = uniq(Array.from(txt.matchAll(VID_RE)).map((m) => m[1]));
            const moreSeq = uniq(Array.from(txt.matchAll(SEQ_RE)).map((m) => m[1]));
            for (const id of more) if (!st.queue.includes(id)) st.queue.push(id);
            if (moreSeq.length) st.seq = moreSeq; // chain forward for the next refill
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
});

// Also run on every worker wake — setIcon state doesn't survive restarts.
syncIcon();
