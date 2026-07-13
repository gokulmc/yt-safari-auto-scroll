// content.js — YT Shorts Auto-Scroll
//
// Structure (matches the design doc): selectors -> synchronous listener
// install -> settings reconcile -> startup scan -> advance -> PiP tracking
// -> SPA nav -> watchdog.
//
// Everything here is event-driven off the media pipeline (ended/timeupdate/
// playing/etc.), not a poll loop. Safari clamps setInterval to >=1s and
// suspends timers in hidden/occluded tabs, which is exactly why a
// poll-based approach dies the moment a Short goes into Picture-in-Picture;
// media events keep firing from the pipeline regardless.
(() => {
  const log = (...args) => console.log('[yt-auto-scroll]', ...args);

  const SELECTORS = {
    activeVideo: 'ytd-reel-video-renderer[is-active] video',
    fallbackVideo: '#shorts-player video',
    nextButton: '#navigation-button-down button',
    nextButtonFallback: 'button[aria-label="Next video"]',
  };

  // ---- State -----------------------------------------------------------
  // `enabled` starts optimistically true and is reconciled against
  // storage below. Listener install must not wait on that reconciliation:
  // combined with WebKit bug FB9157626 (document_start can inject late),
  // waiting on the async storage read risks missing an `ended` that fires
  // before the promise resolves.
  let enabled = true;

  let currentVideo = null;
  let currentVideoSrc = null;

  let lastAdvanceTime = 0;
  let lastTrustedInputTime = 0;
  let advancePending = false;
  let advanceMechanism = null;

  let pipActive = false;
  let pipArmedForAdvance = false;
  let pipRestoreAttemptedForAdvance = false;

  let stallTimer = null;
  let stallRetryCount = 0;

  // Per-element last-seen currentTime, used by the loop-restart guard.
  // Reset on durationchange/loadedmetadata/emptied — YouTube reuses <video>
  // nodes across Shorts, so without a reset a recycled element inherits a
  // near-the-end timestamp from the *previous* Short and the guard fires
  // instantly (double-advance/skip) on the new one's first timeupdate.
  const lastTimeByVideo = new WeakMap();

  // Elements that already have direct (non-capture) listeners attached as
  // the shadow-DOM hedge (see attachDirectListeners) so we don't attach
  // twice.
  const directListenerVideos = new WeakSet();

  // Advance attempts per video id (location.pathname — each Short has its
  // own /shorts/<id> URL), so the watchdog's ended-state retry gives up
  // instead of hammering forever on a dead Short.
  const attemptCounts = new Map();

  // ---- Predicates --------------------------------------------------------
  const isOnShorts = () => location.pathname.startsWith('/shorts/');

  const isElementInPiP = (v) =>
    document.pictureInPictureElement === v || v.webkitPresentationMode === 'picture-in-picture';

  // Must NOT match inactive/preload reels — YouTube keeps neighboring
  // ytd-reel-video-renderer elements (and their <video>s) around off-screen.
  const isActiveShortsVideo = (v) => {
    if (v === currentVideo) return true;
    return v.closest('ytd-reel-video-renderer[is-active], #shorts-player') !== null;
  };

  const videoIdKey = () => location.pathname;

  // ---- Stall recovery (advance() didn't take within ~1.5s) --------------
  const clearStallTimer = () => {
    if (stallTimer !== null) {
      clearTimeout(stallTimer);
      stallTimer = null;
    }
  };

  const checkStall = (v) => {
    stallTimer = null;
    if (!enabled || !isOnShorts()) return;
    if (v.paused && !v.ended) {
      if (stallRetryCount >= 3) {
        log('stall recovery: gave up after 3 retries');
        return;
      }
      stallRetryCount += 1;
      log(`stall recovery: play() retry ${stallRetryCount}/3`);
      v.play().catch(() => {});
      scheduleStallCheck(v);
    }
  };

  const scheduleStallCheck = (v) => {
    clearStallTimer();
    stallTimer = setTimeout(() => checkStall(v), 1500);
  };

  // ---- PiP restore --------------------------------------------------------
  const TOAST_ID = 'yt-auto-scroll-pip-restore-toast';

  const showRestoreToast = (v) => {
    const existing = document.getElementById(TOAST_ID);
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = TOAST_ID;
    toast.textContent = 'Click to restore Picture-in-Picture';
    Object.assign(toast.style, {
      position: 'fixed',
      bottom: '24px',
      right: '24px',
      zIndex: '2147483647',
      background: 'rgba(20,20,20,0.92)',
      color: '#fff',
      padding: '10px 16px',
      borderRadius: '8px',
      font: '13px/1.4 -apple-system, BlinkMacSystemFont, sans-serif',
      cursor: 'pointer',
      boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
    });

    // The click handler runs from a real user gesture, so the PiP APIs
    // (gesture-gated when called from script) are safe to call here even
    // though the automatic attempts above silently failed.
    toast.addEventListener(
      'click',
      () => {
        toast.remove();
        if (typeof v.webkitSetPresentationMode === 'function') {
          v.webkitSetPresentationMode('picture-in-picture');
        }
        if (typeof v.requestPictureInPicture === 'function') {
          v.requestPictureInPicture().catch(() => {});
        }
      },
      { once: true }
    );

    document.body.appendChild(toast);
    log('PiP restore: injected click-to-restore toast (automatic attempts failed silently)');
  };

  const tryRequestPictureInPicture = (v) => {
    if (typeof v.requestPictureInPicture !== 'function') {
      showRestoreToast(v);
      return;
    }
    v.requestPictureInPicture()
      .then(() => log('PiP restore: succeeded via requestPictureInPicture'))
      .catch(() => showRestoreToast(v));
  };

  const restorePictureInPicture = (v) => {
    log('PiP restore: attempting on new video');
    if (typeof v.webkitSetPresentationMode === 'function') {
      v.webkitSetPresentationMode('picture-in-picture');
      // webkitSetPresentationMode fails silently on the gesture restriction
      // (or any other reason) — there's no rejection to catch, so verify
      // the mode actually changed before assuming success.
      setTimeout(() => {
        if (v.webkitPresentationMode === 'picture-in-picture') {
          log('PiP restore: succeeded via webkitSetPresentationMode');
          return;
        }
        tryRequestPictureInPicture(v);
      }, 250);
      return;
    }
    tryRequestPictureInPicture(v);
  };

  // ---- Advance ------------------------------------------------------------
  function advance(v, reason) {
    const now = Date.now();
    // Direct per-element listeners (shadow-DOM hedge, see
    // attachDirectListeners) fire *in addition to* the document capture
    // listener for any video that isn't actually behind a shadow boundary,
    // i.e. the common case — without this guard every "ended" would
    // double-advance. A real video can't end twice in 300ms.
    if (now - lastAdvanceTime < 300) return;

    lastAdvanceTime = now;
    advancePending = true;
    advanceMechanism = null;
    pipArmedForAdvance = isElementInPiP(v);
    pipRestoreAttemptedForAdvance = false;
    stallRetryCount = 0;
    clearStallTimer();

    const nextBtn =
      document.querySelector(SELECTORS.nextButton) || document.querySelector(SELECTORS.nextButtonFallback);
    if (nextBtn) {
      advanceMechanism = 'next-button click';
      nextBtn.click();
    } else {
      advanceMechanism = 'synthetic ArrowDown';
      // Never history.pushState (invisible to YouTube's isolated-world
      // router) and never location.href (full reload kills PiP and burns
      // the page's user-activation).
      const evt = new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        code: 'ArrowDown',
        keyCode: 40,
        which: 40,
        bubbles: true,
      });
      document.dispatchEvent(evt);
    }

    attemptCounts.set(videoIdKey(), (attemptCounts.get(videoIdKey()) || 0) + 1);
    log(`advance() reason=${reason} mechanism=${advanceMechanism}`);
    scheduleStallCheck(v);
  }

  // ---- Loop-restart guard --------------------------------------------------
  // Catches the case where YouTube's own loop wins the race against our
  // `loop = false` forcing and restarts the Short instead of firing
  // `ended`. Mirrors the classic poll-based detection (currentTime jumps
  // backward after sitting near the end) but driven off timeupdate instead
  // of a timer.
  const checkLoopRestartGuard = (v) => {
    const duration = v.duration;
    if (!duration || !Number.isFinite(duration)) return;

    const prevTime = lastTimeByVideo.get(v);
    lastTimeByVideo.set(v, v.currentTime);
    if (prevTime === undefined) return;

    const wasNearEnd = prevTime >= duration - 0.5;
    const jumpedBack = v.currentTime < prevTime - 1;
    if (!wasNearEnd || !jumpedBack || v.paused) return;

    const now = Date.now();
    if (now - lastAdvanceTime < 2000) return;
    // A user scrubbing backward from the end is also a "jump back after
    // being near the end" — don't yank them to the next video.
    if (now - lastTrustedInputTime < 1000) return;

    advance(v, 'loop-restart-guard');
  };

  // ---- PiP tracking ---------------------------------------------------------
  const handlePipLeft = (v) => {
    pipActive = false;
    const now = Date.now();
    const coincidesWithAdvance = advancePending || now - lastAdvanceTime < 3000;
    if (!coincidesWithAdvance) {
      // Dropped PiP with no advance in flight = the user closed it
      // intentionally (the ✕). That's intent, not a navigation
      // side-effect — never fight it.
      pipArmedForAdvance = false;
      log('PiP closed by user — will not auto-restore');
    }
  };

  const onEnterPiP = (e) => {
    if (!(e.target instanceof HTMLVideoElement)) return;
    pipActive = true;
    log('entered PiP');
  };

  const onLeavePiP = (e) => {
    if (!(e.target instanceof HTMLVideoElement)) return;
    handlePipLeft(e.target);
  };

  const onPresentationModeChanged = (e) => {
    const v = e.target;
    if (!(v instanceof HTMLVideoElement)) return;
    if (v.webkitPresentationMode === 'picture-in-picture') {
      pipActive = true;
      log('entered PiP (webkitpresentationmodechanged)');
    } else if (pipActive) {
      handlePipLeft(v);
    }
  };

  // ---- Media state (force loop=false, track current video, fire advance) -
  const onActivePlaying = (v, videoOrSrcChanged) => {
    clearStallTimer();
    stallRetryCount = 0;

    if (advancePending) {
      log(`advance confirmed via ${advanceMechanism}`);
      advancePending = false;
    }

    // Auto-restore only when the PiP drop coincided with an actual
    // element/src change (i.e. navigation caused it, not a user close),
    // and only once per advance — timing-only heuristics misclassify a
    // user hitting the PiP ✕ right after an advance happens to land.
    if (pipArmedForAdvance && videoOrSrcChanged && !pipRestoreAttemptedForAdvance && !pipActive) {
      pipRestoreAttemptedForAdvance = true;
      restorePictureInPicture(v);
    }
  };

  const onVideoEnded = (e) => {
    const v = e.target;
    if (!(v instanceof HTMLVideoElement)) return;
    if (!enabled || !isOnShorts() || !isActiveShortsVideo(v)) return;
    advance(v, 'ended');
  };

  const onMediaState = (e) => {
    const v = e.target;
    if (!(v instanceof HTMLVideoElement)) return;

    if (e.type === 'durationchange' || e.type === 'loadedmetadata') {
      lastTimeByVideo.delete(v);
    }

    if (!enabled || !isOnShorts() || !isActiveShortsVideo(v)) return;

    const videoOrSrcChanged = v !== currentVideo || v.currentSrc !== currentVideoSrc;
    currentVideo = v;
    currentVideoSrc = v.currentSrc;
    // YouTube only sets `loop` when a video loads, so this needs to be
    // re-forced on every relevant event, not just once.
    v.loop = false;

    if (e.type === 'timeupdate') checkLoopRestartGuard(v);
    if (e.type === 'playing') onActivePlaying(v, videoOrSrcChanged);
  };

  const onVideoEmptied = (e) => {
    if (e.target instanceof HTMLVideoElement) lastTimeByVideo.delete(e.target);
  };

  const onTrustedInput = (e) => {
    if (e.isTrusted) lastTrustedInputTime = Date.now();
  };

  // ---- Toggle OFF must restore native behavior -----------------------------
  const applyEnabled = (newEnabled) => {
    const wasEnabled = enabled;
    enabled = newEnabled;
    if (wasEnabled && !enabled && currentVideo) {
      currentVideo.loop = true;
      log('disabled — restored native loop on current video');
    }
  };

  // ---- Shadow-DOM hedge: direct per-element listeners ----------------------
  const attachDirectListeners = (v) => {
    if (directListenerVideos.has(v)) return;
    directListenerVideos.add(v);
    // Media events are composed:false — if YouTube ever moves the player
    // into a shadow root, the document-level capture listeners below would
    // silently stop seeing them. Direct listeners on the element itself
    // survive that. (advance()'s 300ms dedupe guard absorbs the resulting
    // double-delivery for the common, non-shadow case.)
    v.addEventListener('ended', onVideoEnded);
    v.addEventListener('timeupdate', onMediaState);
    log('attached direct listeners to a <video> (shadow-DOM hedge)');
  };

  const attachDirectListenersToAllVideos = () => {
    document.querySelectorAll('video').forEach(attachDirectListeners);
  };

  // ---- Install capture listeners synchronously -----------------------------
  // Installed immediately, before the async storage.local.get below — never
  // gate this on that promise. `enabled` starts true optimistically; every
  // handler re-checks the live `enabled`/`isOnShorts()` state itself, so
  // flipping it later via storage.onChanged just changes handler behavior,
  // it never needs re-installing.
  document.addEventListener('loadedmetadata', onMediaState, true);
  document.addEventListener('durationchange', onMediaState, true);
  document.addEventListener('play', onMediaState, true);
  document.addEventListener('playing', onMediaState, true);
  document.addEventListener('timeupdate', onMediaState, true);
  document.addEventListener('emptied', onVideoEmptied, true);
  document.addEventListener('ended', onVideoEnded, true);
  document.addEventListener('pointerdown', onTrustedInput, true);
  document.addEventListener('keydown', onTrustedInput, true);
  document.addEventListener('enterpictureinpicture', onEnterPiP, true);
  document.addEventListener('leavepictureinpicture', onLeavePiP, true);
  document.addEventListener('webkitpresentationmodechanged', onPresentationModeChanged, true);

  // ---- Startup scan (load-bearing) -----------------------------------------
  // WebKit bug FB9157626: with "Preload Top Hit" enabled, document_start can
  // inject *late* — after a Shorts video is already playing and has already
  // fired the events above. Without this scan that video would never get
  // loop=false forced or get picked up as currentVideo.
  const scanForActiveVideo = () => {
    const v = document.querySelector(SELECTORS.activeVideo) || document.querySelector(SELECTORS.fallbackVideo);
    if (!(v instanceof HTMLVideoElement)) return;

    currentVideo = v;
    currentVideoSrc = v.currentSrc;
    attachDirectListeners(v);

    if (enabled && isOnShorts()) {
      v.loop = false;
      if (!v.paused) lastTimeByVideo.set(v, v.currentTime);
    }
    log('startup scan found an active Shorts video');
  };

  scanForActiveVideo(); // covers late injection (FB9157626)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scanForActiveVideo, { once: true });
  }

  // ---- SPA nav --------------------------------------------------------------
  // YouTube is a SPA; entering/leaving Shorts and scrolling between Shorts
  // never triggers a real page load, so document_start's content_script
  // match only gets us the *first* injection. yt-navigate-finish is
  // unofficial but in active 2026 use; the watchdog below is the fallback.
  document.addEventListener('yt-navigate-finish', () => {
    log('yt-navigate-finish — rescanning');
    scanForActiveVideo();
  });

  // ---- Settings reconcile -----------------------------------------------
  browser.storage.local
    .get({ enabled: true })
    .then((res) => {
      applyEnabled(res.enabled);
      log(`settings reconciled — enabled=${enabled}`);
    })
    .catch((err) => log('storage.local.get failed, keeping optimistic default', err));

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !('enabled' in changes)) return;
    applyEnabled(changes.enabled.newValue);
  });

  // ---- Watchdog -------------------------------------------------------------
  // Everything here is a cheap, idempotent repair — event-driven handling
  // above covers the critical path, so throttling of this timer in
  // hidden/backgrounded tabs is acceptable.
  setInterval(() => {
    if (!enabled || !isOnShorts()) return;

    attachDirectListenersToAllVideos();

    if (!currentVideo) return;

    currentVideo.loop = false; // re-assert in case something reset it

    // Only nudge while an advance is still unconfirmed — an unconditional
    // play() here would fight the user's own pause every 5 seconds.
    if (advancePending && currentVideo.paused && !currentVideo.ended && currentVideo.readyState >= 2) {
      currentVideo.play().catch(() => {});
    }

    if (currentVideo.ended && Date.now() - lastAdvanceTime > 5000) {
      const key = videoIdKey();
      const attempts = attemptCounts.get(key) || 0;
      if (attempts < 3) {
        log(`watchdog: ended-state retry (attempt ${attempts + 1}/3)`);
        advance(currentVideo, 'watchdog-ended-retry');
      } else {
        log('watchdog: giving up after 3 ended-state retries for this video');
      }
    }
  }, 5000);
})();
