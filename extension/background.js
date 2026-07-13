// background.js — the extension's only background responsibility: keep the
// toolbar icon in sync with the auto-scroll toggle (full-color tile when
// on, grey/translucent when off). Everything functional lives in the
// content scripts; this worker just reacts to storage changes.
const iconPaths = (suffix) => ({
  16: `images/toolbar-16${suffix}.png`,
  19: `images/toolbar-19${suffix}.png`,
  32: `images/toolbar-32${suffix}.png`,
  38: `images/toolbar-38${suffix}.png`,
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

// Also run on every worker wake — setIcon state doesn't survive restarts.
syncIcon();
