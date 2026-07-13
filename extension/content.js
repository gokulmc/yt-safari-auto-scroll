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

  // Diagnostic: counts rAF ticks over 500ms. In a hidden tab WebKit
  // suspends the rendering pipeline (rAF ≈ 0 ticks) — but a page with an
  // active PiP window may be exempt. This probe settles that empirically.
  const probeRenderingAlive = (label) => {
    let ticks = 0;
    const t0 = Date.now();
    const tick = () => {
      ticks += 1;
      if (Date.now() - t0 < 500) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    setTimeout(() => log(`probe[${label}]: hidden=${document.hidden} rafTicks/500ms=${ticks}`), 700);
  };

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
  let advanceFromPathname = null;

  let pipActive = false;
  let pipVideoElement = null;
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
    // A video that is literally in the PiP window is what the user is
    // watching, wherever YouTube has re-parented it — when a Short enters
    // PiP, YouTube swaps a placeholder into the reel renderer and can move
    // the real <video> out of it, which would fail both checks below and
    // make us ignore its `ended` entirely (no advance, ever, in PiP).
    if (isElementInPiP(v)) return true;
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
    if (stallRetryCount >= 3) {
      log('stall recovery: gave up after 3 retries');
      return;
    }
    const navigated = location.pathname !== advanceFromPathname;
    if (navigated) {
      // Navigation took — the only remaining stall is the NEW video
      // sitting paused. (Never play() before navigation: on an ended
      // video it restarts the OLD Short from zero and masquerades as a
      // successful advance.)
      const nv = currentVideo || v;
      if (nv.paused && !nv.ended) {
        stallRetryCount += 1;
        log(`stall recovery: post-navigation play() retry ${stallRetryCount}/3`);
        nv.play().catch(() => {});
        scheduleStallCheck(nv);
      }
    } else {
      // The advance didn't take (URL unchanged). Both the next button and
      // ArrowDown drive a scroll-snap animation, and hidden tabs have
      // rAF/IntersectionObserver frozen — the scroll only completes when
      // the window becomes visible again. Escalate to mechanisms that
      // bypass the rendering pipeline entirely.
      stallRetryCount += 1;
      if (stallRetryCount === 1) {
        log('stall recovery 1/3: ArrowDown');
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, bubbles: true })
        );
      } else if (stallRetryCount === 2) {
        // A real <a href="/shorts/..."> click goes through YouTube's SPA
        // router (plain event delegation, not rAF-gated) — this is how
        // regular-video autoplay manages to navigate in background tabs.
        const anchor = findNextShortsAnchor();
        if (anchor) {
          log('stall recovery 2/3: clicking next reel anchor', anchor.getAttribute('href'));
          anchor.click();
        } else {
          // No anchors in the Shorts DOM (confirmed live) — ask the
          // background worker to read the next reel's videoId from
          // YouTube's component data in the page's MAIN world and
          // click-navigate to it.
          browser.runtime
            .sendMessage({ type: 'advance-shorts' })
            .then((res) => log('stall recovery 2/3: main-world navigation →', JSON.stringify(res)))
            .catch((err) => log('stall recovery 2/3: main-world navigation failed', String(err)));
        }
      } else {
        const inPip = pipActive || (currentVideo && isElementInPiP(currentVideo));
        if (document.hidden && !inPip) {
          // Hidden tab with no PiP window to preserve: hand playback off
          // to the regular /watch page near the video's end — watch-page
          // autoplay-next is timer+fetch driven and keeps advancing in
          // background tabs, which Shorts' scroll-based advance never can
          // (WebKit suspends the rendering pipeline for hidden pages).
          const id = ((advanceFromPathname || '').match(/\/shorts\/([^/?]+)/) || [])[1];
          if (id) {
            const t = Math.max(0, Math.floor((v && v.duration) || 0) - 1);
            log(`stall recovery 3/3: handing off to watch-page autoplay (v=${id}, t=${t}s)`);
            location.href = `https://www.youtube.com/watch?v=${id}&t=${t}s`;
            return;
          }
        }
        log('stall recovery 3/3: arming visibilitychange retry');
        armVisibilityRetry();
      }
      scheduleStallCheck(v);
    }
  };

  const findNextShortsAnchor = () => {
    const active = document.querySelector('ytd-reel-video-renderer[is-active]');
    let sib = active ? active.nextElementSibling : null;
    while (sib) {
      const a = sib.querySelector ? sib.querySelector('a[href^="/shorts/"]') : null;
      if (a) return a;
      sib = sib.nextElementSibling;
    }
    for (const a of document.querySelectorAll('ytd-reel-video-renderer a[href^="/shorts/"]')) {
      if (a.getAttribute('href') !== location.pathname) return a;
    }
    return null;
  };

  const armVisibilityRetry = () => {
    document.addEventListener(
      'visibilitychange',
      () => {
        if (!document.hidden && enabled && isOnShorts() && currentVideo && location.pathname === advanceFromPathname) {
          advance(currentVideo, 'visibility-retry');
        }
      },
      { once: true }
    );
  };

  const scheduleStallCheck = (v) => {
    clearStallTimer();
    stallTimer = setTimeout(() => checkStall(v), 1500);
  };

  // ---- PiP restore --------------------------------------------------------
  const TOAST_ID = 'yt-auto-scroll-pip-restore-toast';

  const showRestoreToast = (v, text) => {
    const existing = document.getElementById(TOAST_ID);
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = TOAST_ID;
    toast.textContent = text || 'Click to restore Picture-in-Picture';
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

  // Big, centered, unmissable one-click PiP prompt. Used on a fresh watch
  // page where scripted PiP is gesture-gated — a small corner toast was
  // easy to miss, so this is deliberately front-and-center.
  const GESTURE_PROMPT_ID = 'yt-sas-gesture-prompt';
  const showGesturePrompt = (v) => {
    const existing = document.getElementById(GESTURE_PROMPT_ID);
    if (existing) existing.remove();

    const btn = document.createElement('button');
    btn.id = GESTURE_PROMPT_ID;
    btn.type = 'button';
    btn.textContent = '▶  Start background Shorts (Picture-in-Picture)';
    Object.assign(btn.style, {
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      zIndex: '2147483647',
      background: '#ff0033',
      color: '#fff',
      border: 'none',
      padding: '18px 28px',
      borderRadius: '12px',
      font: '600 16px/1.3 -apple-system, BlinkMacSystemFont, sans-serif',
      cursor: 'pointer',
      boxShadow: '0 6px 28px rgba(0,0,0,0.5)',
    });
    btn.addEventListener(
      'click',
      () => {
        btn.remove();
        if (typeof v.webkitSetPresentationMode === 'function') v.webkitSetPresentationMode('picture-in-picture');
        if (typeof v.requestPictureInPicture === 'function') v.requestPictureInPicture().catch(() => {});
      },
      { once: true }
    );
    document.body.appendChild(btn);
    log('shorts-continuation: showing one-click PiP prompt (scripted PiP is gesture-gated on a fresh page)');
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
    advanceFromPathname = location.pathname;
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
    if (document.hidden || isElementInPiP(v)) {
      probeRenderingAlive(`advance:${reason}${document.hidden ? ':hidden' : ''}${isElementInPiP(v) ? ':pip' : ''}`);
    }
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
    pipVideoElement = null;
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
    pipVideoElement = e.target;
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
      pipVideoElement = v;
      log('entered PiP (webkitpresentationmodechanged)');
    } else if (pipActive && v === pipVideoElement) {
      handlePipLeft(v);
    }
  };

  // ---- Media state (force loop=false, track current video, fire advance) -
  const onActivePlaying = (v, videoOrSrcChanged) => {
    clearStallTimer();
    stallRetryCount = 0;

    if (advancePending) {
      if (location.pathname !== advanceFromPathname) {
        log(`advance confirmed via ${advanceMechanism}`);
        advancePending = false;
      }
      // else: this 'playing' came from the OLD video (a nudge or YouTube's
      // loop restarting it) — the URL hasn't moved, so it is NOT an
      // advance confirmation.
    }

    // Auto-restore only when the PiP drop coincided with an actual
    // element/src change (i.e. navigation caused it, not a user close),
    // and only once per advance — timing-only heuristics misclassify a
    // user hitting the PiP ✕ right after an advance happens to land.
    if (pipArmedForAdvance && videoOrSrcChanged && !pipRestoreAttemptedForAdvance) {
      if (!pipActive) {
        pipRestoreAttemptedForAdvance = true;
        restorePictureInPicture(v);
      } else if (pipVideoElement && pipVideoElement !== v) {
        // PiP never "dropped" — it's still parked on the previous Short's
        // now-dead element. Hand the window over to the new video.
        pipRestoreAttemptedForAdvance = true;
        log('PiP handoff: moving PiP from the old video element to the new one');
        try {
          if (typeof pipVideoElement.webkitSetPresentationMode === 'function') {
            pipVideoElement.webkitSetPresentationMode('inline');
          } else if (document.pictureInPictureElement === pipVideoElement) {
            document.exitPictureInPicture().catch(() => {});
          }
        } catch (err) {
          /* old element may already be dead — fine */
        }
        restorePictureInPicture(v);
      } else if (pipVideoElement === v) {
        // Same element, new stream: WebKit's PiP window goes BLACK when the
        // media under an in-PiP element is swapped — the element still
        // reports picture-in-picture, but the window's video layer is
        // detached. Bounce the presentation mode to force a reattach.
        pipRestoreAttemptedForAdvance = true;
        log('PiP refresh: bouncing presentation mode to reattach the video layer');
        try {
          v.webkitSetPresentationMode('inline');
        } catch (err) {
          /* fall through to the re-enter below either way */
        }
        setTimeout(() => {
          try {
            v.webkitSetPresentationMode('picture-in-picture');
          } catch (err) {
            /* verified below */
          }
          setTimeout(() => {
            if (!isElementInPiP(v)) {
              log('PiP refresh: re-entry was rejected — showing restore toast');
              showRestoreToast(v);
            }
          }, 300);
        }, 120);
      }
    }
  };

  const onVideoEnded = (e) => {
    const v = e.target;
    if (!(v instanceof HTMLVideoElement)) return;
    if (!enabled || !isOnShorts()) return;
    if (!isActiveShortsVideo(v)) {
      // Diagnostic: an `ended` we chose to ignore is the prime suspect
      // whenever "it just stopped advancing" gets reported.
      log('ended ignored — video failed the active-video gate', {
        inPiP: isElementInPiP(v),
        isCurrent: v === currentVideo,
        duration: v.duration,
      });
      return;
    }
    advance(v, 'ended');
  };

  // Safari doesn't reliably deliver the PiP entry events to document-level
  // listeners (and PiP may predate script injection entirely), so state is
  // also synced from the live element on every media event — the events
  // above are just the fast path.
  const syncPipStateFromElement = (v) => {
    if (isElementInPiP(v)) {
      if (!pipActive || pipVideoElement !== v) {
        pipActive = true;
        pipVideoElement = v;
        log('PiP detected via live element state');
      }
    } else if (pipActive && v === pipVideoElement) {
      handlePipLeft(v);
      log('PiP exit detected via live element state');
    }
  };

  const onMediaState = (e) => {
    const v = e.target;
    if (!(v instanceof HTMLVideoElement)) return;

    if (e.type === 'durationchange' || e.type === 'loadedmetadata') {
      lastTimeByVideo.delete(v);
    }

    syncPipStateFromElement(v);

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

  // ---- Watch-mode PiP: Shorts → /watch handoff ------------------------------
  // A watch page swaps the next video's stream into the SAME <video>
  // element (timers+fetch — alive in hidden tabs), and PiP is bound to the
  // element, so YouTube's own autoplay advances forever, background and
  // PiP included. Shorts can never do this (compositor-scroll advance), so
  // this converts the current Short onto that machinery.
  const WATCH_MODE_FLAG = 'yt-sas-watch-mode-pip';
  const SHORTS_QUEUE_KEY = 'yt-sas-shorts-queue';

  browser.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== 'watch-mode-pip') return;
    const id = (location.pathname.match(/\/shorts\/([^/?]+)/) || [])[1];
    if (!id) {
      log('watch-mode: not on a /shorts/ page, ignoring');
      return;
    }
    const v = document.querySelector(SELECTORS.activeVideo) || document.querySelector(SELECTORS.fallbackVideo);
    const t = v && v.currentTime > 1 ? `&t=${Math.floor(v.currentTime)}s` : '';
    // Build a queue of upcoming SHORT ids so the watch page keeps playing
    // Shorts (via loadVideoById) rather than YouTube's landscape autoplay.
    browser.runtime
      .sendMessage({ type: 'get-next-shorts' })
      .then((res) => {
        const ids = (res && res.ids) || [];
        log(`watch-mode: got ${ids.length} upcoming Shorts`, JSON.stringify((res && res.diag) || {}));
        try {
          sessionStorage.setItem(WATCH_MODE_FLAG, '1');
          sessionStorage.setItem(SHORTS_QUEUE_KEY, JSON.stringify(ids));
        } catch (err) {
          /* storage may be blocked; navigation is still worth doing */
        }
        location.href = `https://www.youtube.com/watch?v=${id}${t}`;
      })
      .catch((err) => {
        log('watch-mode: queue fetch failed, going anyway', String(err));
        try {
          sessionStorage.setItem(WATCH_MODE_FLAG, '1');
        } catch (e) {
          /* ignore */
        }
        location.href = `https://www.youtube.com/watch?v=${id}${t}`;
      });
  });

  // On the watch page after a watch-mode handoff: pop into PiP, then keep
  // playing the queued Shorts by swapping each next id into the SAME player
  // element on `ended`. All three pieces — the media `ended` event, the
  // runtime message, and loadVideoById — stay alive in a hidden tab, and
  // reusing the element preserves the PiP window. This is the only path
  // that plays Shorts hands-free in the background.
  const startShortsContinuation = () => {
    let flagged = false;
    let queue = [];
    try {
      flagged = sessionStorage.getItem(WATCH_MODE_FLAG) === '1';
      queue = JSON.parse(sessionStorage.getItem(SHORTS_QUEUE_KEY) || '[]');
    } catch (err) {
      return;
    }
    if (!flagged || !location.pathname.startsWith('/watch')) return;
    try {
      sessionStorage.removeItem(WATCH_MODE_FLAG);
      sessionStorage.removeItem(SHORTS_QUEUE_KEY);
    } catch (err) {
      /* ignore */
    }
    log(`shorts-continuation: active with ${queue.length} queued Shorts`);

    let qIndex = 0;
    let advancing = false;
    const onWatchEnded = (e) => {
      if (!(e.target instanceof HTMLVideoElement) || advancing) return;
      if (!e.target.closest('#movie_player')) return;
      if (qIndex >= queue.length) {
        log('shorts-continuation: queue exhausted');
        return;
      }
      advancing = true;
      const nextId = queue[qIndex++];
      log(`shorts-continuation: loading next Short ${nextId} (${qIndex}/${queue.length})`);
      browser.runtime
        .sendMessage({ type: 'load-video-by-id', videoId: nextId })
        .then((r) => log('shorts-continuation: loadVideoById →', JSON.stringify(r)))
        .catch((err) => log('shorts-continuation: loadVideoById failed', String(err)))
        .finally(() => setTimeout(() => (advancing = false), 800));
    };
    document.addEventListener('ended', onWatchEnded, true);

    // Enter PiP once the player video is ready. Scripted PiP is gesture-
    // gated on a fresh document, so fall back to a prominent one-click
    // prompt.
    let attempts = 0;
    const enter = () => {
      const v = document.querySelector('#movie_player video') || document.querySelector('video.html5-main-video');
      if (!v || v.readyState < 2) {
        if ((attempts += 1) < 20) setTimeout(enter, 500);
        return;
      }
      if (typeof v.webkitSetPresentationMode === 'function') {
        try {
          v.webkitSetPresentationMode('picture-in-picture');
        } catch (err) {
          /* verified below */
        }
      }
      setTimeout(() => {
        if (isElementInPiP(v)) {
          log('shorts-continuation: PiP entered automatically');
        } else {
          showGesturePrompt(v);
        }
      }, 400);
    };
    enter();
  };
  startShortsContinuation();

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

    // Only nudge while an advance is still unconfirmed AND navigation has
    // actually happened — an unconditional play() would fight the user's
    // own pause, and a pre-navigation play() restarts the old ended Short.
    if (
      advancePending &&
      location.pathname !== advanceFromPathname &&
      currentVideo.paused &&
      !currentVideo.ended &&
      currentVideo.readyState >= 2
    ) {
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
