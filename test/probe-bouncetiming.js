// Advance the playlist, then bounce PiP with a given gap, and report whether
// PiP stayed active (not closed). Gap comes from window.__bounceGap (ms).
(async function () {
  const gap = window.__bounceGap || 250;
  const preWait = window.__preWait || 500;
  const p = document.getElementById('movie_player');
  const v = p.querySelector('video');
  const before = p.getVideoData().video_id;
  const pipBefore = v.webkitPresentationMode;
  if (pipBefore !== 'picture-in-picture') return { err: 'not in PiP at start' };

  p.nextVideo(); // advance
  await new Promise((r) => setTimeout(r, preWait));
  const afterAdvance = p.getVideoData().video_id;
  const pipAfterAdvance = v.webkitPresentationMode;

  // bounce
  try { v.webkitSetPresentationMode('inline'); } catch (e) {}
  await new Promise((r) => setTimeout(r, gap));
  try { v.webkitSetPresentationMode('picture-in-picture'); } catch (e) {}
  await new Promise((r) => setTimeout(r, 1200));

  const v2 = document.querySelector('#movie_player video');
  return {
    gap, preWait,
    before, afterAdvance, advanced: afterAdvance !== before,
    pipAfterAdvance,
    pipAfterBounce: v2 ? v2.webkitPresentationMode : 'no-video',
    stayedInPip: !!v2 && v2.webkitPresentationMode === 'picture-in-picture',
    curTime: v2 ? Math.round(v2.currentTime * 10) / 10 : null,
  };
})()
