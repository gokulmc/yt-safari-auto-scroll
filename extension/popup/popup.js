// popup.js — toggle + universal "PiP this page" button.
// Uses the promise-based browser.* API throughout (fully supported in
// Safari Web Extensions).

const enabledToggle = document.getElementById('enabled-toggle');
const pipButton = document.getElementById('pip-button');
const pipMessage = document.getElementById('pip-message');

const showPipMessage = (text) => {
  pipMessage.textContent = text;
  pipMessage.hidden = false;
};

browser.storage.local.get({ enabled: true }).then((res) => {
  enabledToggle.checked = res.enabled;
});

enabledToggle.addEventListener('change', () => {
  browser.storage.local.set({ enabled: enabledToggle.checked });
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
