// popup.js — toggle + universal "PiP this page" button.
// Uses the promise-based browser.* API throughout (fully supported in
// Safari Web Extensions).

const enabledToggle = document.getElementById('enabled-toggle');
const pipButton = document.getElementById('pip-button');
const bgShortsButton = document.getElementById('bg-shorts-button');
const pipMessage = document.getElementById('pip-message');

const showPipMessage = (text) => {
  pipMessage.textContent = text;
  pipMessage.hidden = false;
};

// Set the toolbar icon from here as well as background.js: Safari doesn't
// reliably wake the background worker for storage.onChanged, but the popup
// is guaranteed to be alive at the exact moment the toggle changes.
const TOOLBAR_SIZES = [16, 19, 32, 38];

const setToolbarIcon = (enabled) => {
  const suffix = enabled ? '' : '-off';
  // Root-relative: Safari resolves setIcon paths against the calling page
  // (popup/), not the extension root — "images/..." becomes "popup/images/...".
  const paths = Object.fromEntries(TOOLBAR_SIZES.map((s) => [s, `/images/toolbar-${s}${suffix}.png`]));
  return browser.action
    .setIcon({ path: paths })
    .catch(() => {
      // Safari has been flaky about path-based setIcon — hand over raw
      // pixels drawn on a canvas instead.
      const loads = TOOLBAR_SIZES.map(
        (size) =>
          new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
              const c = document.createElement('canvas');
              c.width = size;
              c.height = size;
              const ctx = c.getContext('2d');
              ctx.drawImage(img, 0, 0, size, size);
              resolve([size, ctx.getImageData(0, 0, size, size)]);
            };
            img.onerror = () => resolve(null);
            img.src = browser.runtime.getURL(`images/toolbar-${size}${suffix}.png`);
          })
      );
      return Promise.all(loads).then((pairs) =>
        browser.action.setIcon({ imageData: Object.fromEntries(pairs.filter(Boolean)) })
      );
    })
    .catch(() => {});
};

browser.storage.local.get({ enabled: true }).then((res) => {
  enabledToggle.checked = res.enabled;
  setToolbarIcon(res.enabled); // re-sync in case background.js never ran
});

enabledToggle.addEventListener('change', () => {
  browser.storage.local.set({ enabled: enabledToggle.checked });
  setToolbarIcon(enabledToggle.checked);
});

// Build a temporary playlist of the upcoming Shorts and hand off to the
// content script, which navigates to watch_videos and prompts for PiP.
// YouTube's native playlist autoplay then advances through real Shorts
// with PiP preserved, even in the background.
const BG_SETUP_SECONDS = 10; // fixed reassurance countdown while it sets up
bgShortsButton.addEventListener('click', () => {
  pipMessage.hidden = true;
  const label = bgShortsButton.textContent;
  bgShortsButton.disabled = true;
  pipButton.disabled = true;
  // Setting up a background Shorts playlist takes several seconds (fetch the
  // Shorts, load the playlist player, enter PiP). Show a countdown so people
  // know to wait rather than thinking nothing happened.
  let remaining = BG_SETUP_SECONDS;
  bgShortsButton.textContent = `Setting up… ${remaining}s`;
  const timer = setInterval(() => {
    remaining -= 1;
    if (remaining > 0) {
      bgShortsButton.textContent = `Setting up… ${remaining}s`;
    } else {
      clearInterval(timer);
      window.close();
    }
  }, 1000);

  browser.tabs
    .query({ active: true, currentWindow: true })
    .then((tabs) => {
      const tab = tabs[0];
      if (!tab || typeof tab.id !== 'number') throw new Error('no active tab');
      return browser.tabs.sendMessage(tab.id, { type: 'background-shorts-pip' });
    })
    .catch(() => {
      clearInterval(timer);
      bgShortsButton.disabled = false;
      pipButton.disabled = false;
      bgShortsButton.textContent = label;
      showPipMessage('Open a youtube.com Short first, then tap this to start a background Shorts playlist.');
    });
});

pipButton.addEventListener('click', () => {
  pipMessage.hidden = true;

  browser.tabs
    .query({ active: true, currentWindow: true })
    .then((tabs) => {
      const tab = tabs[0];
      if (!tab || typeof tab.id !== 'number') throw new Error('no active tab');
      // Only ever use tab.id — tab.url is redacted without the "tabs"
      // permission, which this extension deliberately doesn't request.
      return browser.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['pip-inject.js'],
      });
    })
    .then(() => {
      // Close immediately so the user sees the page (and the PiP window)
      // instead of the popup.
      window.close();
    })
    .catch(() => {
      showPipMessage('Safari blocked this page — grant the extension access, or this page has no video.');
    });
});
