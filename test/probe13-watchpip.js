(async function () {
  const vids = Array.from(document.querySelectorAll('video'));
  const pipVid = vids.find((v) => v.webkitPresentationMode === 'picture-in-picture');
  if (!pipVid) return { err: 'no video in PiP right now — click the video into PiP first', count: vids.length };

  const p = document.getElementById('movie_player');
  const pv = p && p.querySelector('video');
  const beforeSrc = (pipVid.currentSrc || '').slice(0, 50);
  const beforeId = p.getVideoData().video_id;
  const pipIsPlayerVideo = pipVid === pv;

  const target = beforeId === '9bZkp7q19f0' ? 'M7lc1UVf-VE' : '9bZkp7q19f0';
  p.loadVideoById(target);
  await new Promise((r) => setTimeout(r, 3000));

  const pipVid2 = Array.from(document.querySelectorAll('video')).find((v) => v.webkitPresentationMode === 'picture-in-picture');
  return {
    beforeId, target,
    pipIsPlayerVideo,
    pipStillActive: !!pipVid2,
    playerIdAfter: p.getVideoData().video_id,
    pipSrcAfter: pipVid2 ? (pipVid2.currentSrc || '').slice(0, 50) : null,
    pipSrcChanged: pipVid2 ? (pipVid2.currentSrc || '').slice(0, 50) !== beforeSrc : null,
    // The verdict: PiP survived the swap AND now shows the new video.
    pipFollowed: !!pipVid2 && p.getVideoData().video_id === target && (pipVid2.currentSrc || '').slice(0, 50) !== beforeSrc,
  };
})()
