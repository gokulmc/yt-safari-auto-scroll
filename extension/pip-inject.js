// pip-inject.js — universal "PiP this page"
//
// Injected on demand via scripting.executeScript, on any site, possibly
// more than once per page. Repeated executeScript runs share one
// persistent isolated world (and on youtube.com, share it with
// content.js), so everything must live inside this one IIFE — a top-level
// const/let/function here would throw "redeclaration" on the second run
// (or collide with content.js) since the world's global scope never resets
// between calls. The IIFE itself is the only top-level statement, so
// re-running this file is always safe: each call gets a fresh function
// scope.
(() => {
  const OVERLAY_ID = 'yt-sas-pip-overlay';

  // Idempotency: strip any overlay a previous run left behind before doing
  // anything else.
  const prior = document.getElementById(OVERLAY_ID);
  if (prior) prior.remove();

  const isInPiP = (v) =>
    document.pictureInPictureElement === v || v.webkitPresentationMode === 'picture-in-picture';

  const visibleArea = (v) => {
    const r = v.getBoundingClientRect();
    const left = Math.max(0, r.left);
    const top = Math.max(0, r.top);
    const right = Math.min(window.innerWidth, r.right);
    const bottom = Math.min(window.innerHeight, r.bottom);
    if (right <= left || bottom <= top) return 0;
    return (right - left) * (bottom - top);
  };

  const pickBestVideo = () => {
    // On YouTube Shorts the active reel is unambiguous — prefer it over any
    // generic "biggest visible" heuristic (neighboring reels can be
    // larger/more visible mid-scroll-snap).
    const shortsActive = document.querySelector('ytd-reel-video-renderer[is-active] video');
    if (shortsActive instanceof HTMLVideoElement) return shortsActive;

    const videos = Array.from(document.querySelectorAll('video'));
    if (videos.length === 0) return null;

    const playing = videos.find((v) => !v.paused && v.readyState >= 2);
    if (playing) return playing;

    let best = null;
    let bestArea = 0;
    for (const v of videos) {
      const area = visibleArea(v);
      if (area > bestArea) {
        bestArea = area;
        best = v;
      }
    }
    if (best) return best;

    return videos.find((v) => v.readyState >= 2) || null;
  };

  const showOverlayButton = (v) => {
    const existing = document.getElementById(OVERLAY_ID);
    if (existing) existing.remove();

    const overlay = document.createElement('button');
    overlay.id = OVERLAY_ID;
    overlay.type = 'button';
    overlay.textContent = 'Click to pop out video';
    Object.assign(overlay.style, {
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      zIndex: '2147483647',
      background: 'rgba(20,20,20,0.92)',
      color: '#fff',
      border: 'none',
      padding: '12px 20px',
      borderRadius: '8px',
      font: '14px/1.4 -apple-system, BlinkMacSystemFont, sans-serif',
      cursor: 'pointer',
      boxShadow: '0 2px 16px rgba(0,0,0,0.5)',
    });

    let cleanupTimer = null;
    const cleanup = () => {
      if (cleanupTimer) clearTimeout(cleanupTimer);
      overlay.remove();
      document.removeEventListener('scroll', onOutsideActivity, true);
      document.removeEventListener('click', onOutsideActivity, true);
    };
    const onOutsideActivity = (e) => {
      if (e.target === overlay || overlay.contains(e.target)) return;
      cleanup();
    };

    overlay.addEventListener(
      'click',
      (e) => {
        e.stopPropagation();
        cleanup();
        // A real user gesture lands here, so the PiP APIs (gesture-gated
        // when called from script on a page with zero prior interaction)
        // are safe to call directly.
        if (typeof v.requestPictureInPicture === 'function') {
          v.requestPictureInPicture().catch(() => {});
        }
        if (typeof v.webkitSetPresentationMode === 'function') {
          v.webkitSetPresentationMode('picture-in-picture');
        }
      },
      { once: true }
    );

    document.body.appendChild(overlay);
    document.addEventListener('scroll', onOutsideActivity, true);
    document.addEventListener('click', onOutsideActivity, true);
    cleanupTimer = setTimeout(cleanup, 10000);
  };

  const enterPiP = (v) => {
    if (typeof v.webkitSetPresentationMode === 'function') {
      v.webkitSetPresentationMode('picture-in-picture');
      // Fails silently (e.g. page has had zero user interactions yet) —
      // verify the mode actually changed before falling through.
      setTimeout(() => {
        if (v.webkitPresentationMode === 'picture-in-picture') return;
        if (typeof v.requestPictureInPicture === 'function') {
          v.requestPictureInPicture().catch(() => showOverlayButton(v));
        } else {
          showOverlayButton(v);
        }
      }, 250);
      return;
    }
    if (typeof v.requestPictureInPicture === 'function') {
      v.requestPictureInPicture().catch(() => showOverlayButton(v));
      return;
    }
    showOverlayButton(v);
  };

  const exitPiP = (v) => {
    if (document.pictureInPictureElement === v && typeof document.exitPictureInPicture === 'function') {
      document.exitPictureInPicture().catch(() => {});
      return;
    }
    if (typeof v.webkitSetPresentationMode === 'function') {
      v.webkitSetPresentationMode('inline');
    }
  };

  const video = pickBestVideo();
  if (!video) return; // nothing to do; return value is unused either way

  if (isInPiP(video)) {
    exitPiP(video);
  } else {
    enterPiP(video);
  }
  // Deliberately no return value — Safari's executeScript result plumbing
  // is buggy, so the popup only relies on the call's promise
  // resolving/rejecting, never on a returned value.
})();
