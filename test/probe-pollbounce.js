// exit + poll-re-enter until PiP takes; report ms until success (flicker time).
(async function () {
  const p = document.getElementById('movie_player');
  let v = p.querySelector('video');
  if (v.webkitPresentationMode !== 'picture-in-picture') { try { v.webkitSetPresentationMode('picture-in-picture'); } catch (e) {} await new Promise(r => setTimeout(r, 1500)); }
  const before = p.getVideoData().video_id;
  p.nextVideo();
  // let the advance settle a touch, then exit + poll re-enter
  await new Promise((r) => setTimeout(r, 300));
  try { p.querySelector('video').webkitSetPresentationMode('inline'); } catch (e) {}
  const t0 = Date.now();
  let took = false;
  for (let i = 0; i < 16; i++) {
    await new Promise((r) => setTimeout(r, 200));
    const vid = p.querySelector('video');
    if (!vid) continue;
    if (vid.webkitPresentationMode === 'picture-in-picture') { took = true; break; }
    try { vid.webkitSetPresentationMode('picture-in-picture'); } catch (e) {}
  }
  await new Promise((r) => setTimeout(r, 800));
  const v2 = p.querySelector('video');
  return {
    before, after: p.getVideoData().video_id,
    reenterMs: Date.now() - t0, tookDuringPoll: took,
    stayedInPip: !!v2 && v2.webkitPresentationMode === 'picture-in-picture',
  };
})()
