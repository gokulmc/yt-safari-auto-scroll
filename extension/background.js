// background.js — the extension's only background responsibility: keep the
// toolbar icon in sync with the auto-scroll toggle (full-color tile when
// on, grey/translucent when off). Everything functional lives in the
// content scripts; this worker just reacts to storage changes.
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

// Content scripts run in an isolated world and can't see YouTube's JS
// component data, and hidden tabs freeze the scroll pipeline that the
// next-button relies on. When asked, inject into the page's MAIN world,
// read the next reel's videoId off YouTube's own element data, and
// navigate through a real anchor click (SPA router — works while hidden).
browser.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== 'advance-shorts' || !sender || !sender.tab || typeof sender.tab.id !== 'number') return;
  return browser.scripting
    .executeScript({
      target: { tabId: sender.tab.id },
      world: 'MAIN',
      func: () => {
        const currentId = (location.pathname.match(/\/shorts\/([^/?]+)/) || [])[1] || null;
        // YouTube sometimes hides Polymer state behind .polymerController.
        const dataOf = (el) => (el && (el.data || (el.polymerController && el.polymerController.data))) || null;
        const idFromEntry = (e) => {
          if (!e) return null;
          const c =
            e.command ||
            (e.onTap && e.onTap.innertubeCommand) ||
            e;
          return (c && c.reelWatchEndpoint && c.reelWatchEndpoint.videoId) || null;
        };
        const navigate = (videoId, via) => {
          const a = document.createElement('a');
          a.href = '/shorts/' + videoId;
          a.style.display = 'none';
          document.body.appendChild(a);
          a.click();
          a.remove();
          return { ok: true, via, videoId };
        };

        // Strategy 1: sibling reel renderers carrying their own data.
        const reels = Array.from(document.querySelectorAll('ytd-reel-video-renderer'));
        for (let i = 0; i < reels.length; i++) {
          const id = idFromEntry(dataOf(reels[i]));
          if (id && id === currentId && i + 1 < reels.length) {
            const nid = idFromEntry(dataOf(reels[i + 1]));
            if (nid) return navigate(nid, 'sibling-reel-data');
          }
        }

        // Strategy 2: the ytd-shorts feed component holds the upcoming
        // entries even when only one reel element is rendered.
        const shorts = document.querySelector('ytd-shorts');
        const sd = dataOf(shorts);
        const entries = sd && (sd.entries || sd.contents);
        if (Array.isArray(entries)) {
          const ids = entries.map((e) => idFromEntry(e));
          const idx = ids.indexOf(currentId);
          if (idx !== -1) {
            const nid = ids.slice(idx + 1).find((x) => x);
            if (nid) return navigate(nid, 'shorts-entries');
          }
        }

        // Strategy 3: the player app's own next-video API.
        const pEl = document.getElementById('shorts-player') || document.getElementById('movie_player');
        const player = pEl && (typeof pEl.getPlayer === 'function' ? pEl.getPlayer() : pEl);
        if (player && typeof player.nextVideo === 'function') {
          player.nextVideo();
          return { ok: true, via: 'player.nextVideo' };
        }

        return {
          ok: false,
          reason: 'no-strategy-worked',
          currentId,
          reelCount: reels.length,
          reelHasData: reels.map((r) => !!dataOf(r)),
          shortsPresent: !!shorts,
          shortsDataKeys: sd ? Object.keys(sd).slice(0, 25) : null,
          entriesLen: Array.isArray(entries) ? entries.length : null,
          playerEl: pEl ? pEl.id : null,
          playerHasNextVideo: !!(player && typeof player.nextVideo === 'function'),
        };
      },
    })
    .then((results) => (results && results[0] && results[0].result) || { ok: false, reason: 'no-result' })
    .catch((err) => ({ ok: false, reason: String(err) }));
});

// Also run on every worker wake — setIcon state doesn't survive restarts.
syncIcon();
