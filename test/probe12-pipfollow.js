(async function () {
  const vids = Array.from(document.querySelectorAll('video'));
  const pipVid = vids.find((v) => v.webkitPresentationMode === 'picture-in-picture');
  if (!pipVid) return { err: 'no video is in PiP right now', count: vids.length };

  const p = document.getElementById('shorts-player');
  const pv = p && p.querySelector('video');
  const before = {
    pipIsShortsPlayerVideo: pipVid === pv,
    pipSrc: (pipVid.currentSrc || '').slice(0, 50),
    pipCurrentTime: Math.round(pipVid.currentTime),
    playerId: p && p.getVideoData ? p.getVideoData().video_id : null,
  };

  // Build queue + pick next, then loadVideoById on the shorts player.
  const uniq = (a) => Array.from(new Set(a));
  const rwsr = window.ytInitialReelWatchSequenceResponse;
  let queue = [];
  if (rwsr) queue = uniq(Array.from(JSON.stringify(rwsr).matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)).map((m) => m[1]));
  const cur = before.playerId;
  const idx = queue.indexOf(cur);
  const next = queue[idx + 1] || queue[0];
  p.loadVideoById(next);

  await new Promise((r) => setTimeout(r, 2500));

  const pipVid2 = Array.from(document.querySelectorAll('video')).find((v) => v.webkitPresentationMode === 'picture-in-picture');
  return {
    before,
    targetLoaded: next,
    pipStillActive: !!pipVid2,
    pipSrcChanged: pipVid2 ? (pipVid2.currentSrc || '').slice(0, 50) !== before.pipSrc : null,
    pipSrcAfter: pipVid2 ? (pipVid2.currentSrc || '').slice(0, 50) : null,
    playerIdAfter: p.getVideoData ? p.getVideoData().video_id : null,
    pipFollowed: pipVid2 ? p.getVideoData().video_id === next && (pipVid2.currentSrc || '') !== before.pipSrc : false,
  };
})()
