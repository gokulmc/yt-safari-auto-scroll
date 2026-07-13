// With a Short in PiP on the playlist page, seek to the end (NOT a
// navigation) and let the playlist auto-advance in place. Verdict: does
// PiP survive the native end-of-video advance?
(async function () {
  const p = document.getElementById('movie_player');
  const v = p.querySelector('video');
  const pipVid = Array.from(document.querySelectorAll('video')).find((x) => x.webkitPresentationMode === 'picture-in-picture');
  if (!pipVid) return { err: 'no video in PiP — click into PiP first' };

  const before = p.getVideoData().video_id;
  const beforeSrc = (pipVid.currentSrc || '').slice(0, 45);
  const pipIsPlayerVideo = pipVid === v;
  const dur = v.duration;
  if (!dur || !isFinite(dur)) return { err: 'no duration', before };

  v.currentTime = Math.max(0, dur - 2); // let it reach the end naturally

  let after = before;
  const t0 = Date.now();
  while (Date.now() - t0 < 9000) {
    await new Promise((r) => setTimeout(r, 200));
    const now = p.getVideoData().video_id;
    if (now !== before) { after = now; break; }
  }
  await new Promise((r) => setTimeout(r, 800));

  const pipVid2 = Array.from(document.querySelectorAll('video')).find((x) => x.webkitPresentationMode === 'picture-in-picture');
  return {
    before, after, advanced: after !== before,
    pipIsPlayerVideo,
    pipStillActive: !!pipVid2,
    pipSrcChanged: pipVid2 ? (pipVid2.currentSrc || '').slice(0, 45) !== beforeSrc : null,
    // THE VERDICT for background Shorts in PiP:
    pipFollowed: !!pipVid2 && after !== before,
    playerState: p.getPlayerState(),
    plLen: (p.getPlaylist() || []).length,
  };
})()
