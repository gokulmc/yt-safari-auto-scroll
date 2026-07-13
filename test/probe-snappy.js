// Advance, then poll-re-enter with NO exit and NO pre-delay. Measures how
// fast PiP re-enters, and records the PiP state right after the advance
// (inline = closed, so no exit needed; picture-in-picture = black, exit needed).
(async function () {
  const p = document.getElementById('movie_player');
  let v = p.querySelector('video');
  if (v.webkitPresentationMode !== 'picture-in-picture') { try { v.webkitSetPresentationMode('picture-in-picture'); } catch (e) {} await new Promise(r => setTimeout(r, 1500)); }
  const before = p.getVideoData().video_id;
  p.nextVideo();
  const t0 = Date.now();
  // sample the state a few times right after advance
  const samples = [];
  let took = false, tookMs = null;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 150));
    const vid = p.querySelector('video');
    if (!vid) continue;
    const mode = vid.webkitPresentationMode;
    if (i < 5) samples.push(Math.round((Date.now() - t0)) + ':' + mode);
    if (mode === 'picture-in-picture') {
      // could be "never dropped" (black) or "re-entered". If we've been
      // trying, treat first pip-after-a-drop as success.
      if (took === false && samples.some(s => s.indexOf('inline') > -1)) { took = true; tookMs = Date.now() - t0; break; }
    } else {
      try { vid.webkitSetPresentationMode('picture-in-picture'); } catch (e) {}
    }
  }
  await new Promise((r) => setTimeout(r, 600));
  const v2 = p.querySelector('video');
  return {
    before, after: p.getVideoData().video_id,
    droppedToInline: samples.some(s => s.indexOf('inline') > -1),
    firstSamples: samples,
    reenterMs: tookMs,
    stayedInPip: !!v2 && v2.webkitPresentationMode === 'picture-in-picture',
  };
})()
