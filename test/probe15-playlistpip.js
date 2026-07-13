(async function () {
  const vids = Array.from(document.querySelectorAll('video'));
  const pipVid = vids.find((v) => v.webkitPresentationMode === 'picture-in-picture');
  if (!pipVid) return { err: 'no video in PiP — click into PiP first', count: vids.length };

  const p = document.getElementById('movie_player');
  const beforeId = p.getVideoData().video_id;
  const beforeSrc = (pipVid.currentSrc || '').slice(0, 45);
  const pipIsPlayerVideo = pipVid === p.querySelector('video');

  p.nextVideo(); // native playlist advance
  await new Promise((r) => setTimeout(r, 3500));

  const pipVid2 = Array.from(document.querySelectorAll('video')).find((v) => v.webkitPresentationMode === 'picture-in-picture');
  const afterId = p.getVideoData().video_id;
  return {
    beforeId, afterId, advanced: afterId !== beforeId,
    pipIsPlayerVideo,
    pipStillActive: !!pipVid2,
    pipSrcChanged: pipVid2 ? (pipVid2.currentSrc || '').slice(0, 45) !== beforeSrc : null,
    // THE VERDICT: PiP survived the native playlist advance AND shows the new Short.
    pipFollowed: !!pipVid2 && afterId !== beforeId,
    playerState: p.getPlayerState(),
  };
})()
