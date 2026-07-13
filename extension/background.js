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
        const active = document.querySelector('ytd-reel-video-renderer[is-active]');
        const next = active && active.nextElementSibling;
        const d = next && next.data;
        const videoId =
          (d && d.command && d.command.reelWatchEndpoint && d.command.reelWatchEndpoint.videoId) ||
          (d && d.reelWatchEndpoint && d.reelWatchEndpoint.videoId) ||
          (d && d.onTap && d.onTap.innertubeCommand && d.onTap.innertubeCommand.reelWatchEndpoint &&
            d.onTap.innertubeCommand.reelWatchEndpoint.videoId) ||
          null;
        if (!videoId) {
          return { ok: false, reason: 'no-videoId-on-next-reel', hasNext: !!next, hasData: !!d };
        }
        const a = document.createElement('a');
        a.href = '/shorts/' + videoId;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        a.remove();
        return { ok: true, videoId };
      },
    })
    .then((results) => (results && results[0] && results[0].result) || { ok: false, reason: 'no-result' })
    .catch((err) => ({ ok: false, reason: String(err) }));
});

// Also run on every worker wake — setIcon state doesn't survive restarts.
syncIcon();
