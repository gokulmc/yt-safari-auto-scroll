// Does a natural autoplay-next (no playlist) reuse the <video> element or
// create a fresh one? A fresh element = a new PiP-renderable surface, which
// would explain why the landscape autoplay case renders in PiP but in-place
// swaps go black.
(async function () {
  const p = document.getElementById('movie_player');
  const v = p.querySelector('video');
  const before = p.getVideoData().video_id;
  v.setAttribute('data-ytsas-mark', 'A'); // tag the current element
  const dur = v.duration;
  if (!dur || !isFinite(dur)) return { err: 'no duration', before };

  v.currentTime = Math.max(0, dur - 1.5);
  let after = before;
  const t0 = Date.now();
  while (Date.now() - t0 < 12000) {
    await new Promise((r) => setTimeout(r, 250));
    const now = p.getVideoData().video_id;
    if (now !== before) { after = now; break; }
  }
  await new Promise((r) => setTimeout(r, 1500));

  const v2 = document.getElementById('movie_player').querySelector('video');
  return {
    before, after, advanced: after !== before,
    sameElement: !!v2 && v2 === v,
    newElementHasOldMark: v2 ? v2.getAttribute('data-ytsas-mark') : null, // 'A' = same, null = new element
    hasList: location.href.indexOf('list=') > -1,
    url: location.href.slice(0, 55),
  };
})()
