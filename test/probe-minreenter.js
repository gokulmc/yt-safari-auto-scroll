// Advance, then re-enter PiP after window.__T ms (no separate exit — the
// advance already drops PiP to inline). Find the smallest T that reliably
// re-enters, to minimize the between-Shorts flicker.
(async function () {
  const T = window.__T || 800;
  const p = document.getElementById('movie_player');
  const v = p.querySelector('video');
  if (v.webkitPresentationMode !== 'picture-in-picture') { try { v.webkitSetPresentationMode('picture-in-picture'); } catch (e) {} await new Promise(r => setTimeout(r, 1500)); }
  const before = p.getVideoData().video_id;
  p.nextVideo();
  await new Promise((r) => setTimeout(r, T));
  const pipMid = (p.querySelector('video') || {}).webkitPresentationMode;
  try { (p.querySelector('video')).webkitSetPresentationMode('picture-in-picture'); } catch (e) {}
  await new Promise((r) => setTimeout(r, 1400));
  const v2 = p.querySelector('video');
  return { T, before, after: p.getVideoData().video_id, pipMidAdvance: pipMid, stayedInPip: !!v2 && v2.webkitPresentationMode === 'picture-in-picture' };
})()
