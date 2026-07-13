(function () {
  const p = document.getElementById('shorts-player');
  const pv = p && p.querySelector('video');
  const vids = Array.from(document.querySelectorAll('video'));
  return JSON.stringify({
    playerCurrentId: p && p.getVideoData ? p.getVideoData().video_id : null,
    videoCount: vids.length,
    videos: vids.map((v, i) => ({
      i,
      pip: v.webkitPresentationMode || 'inline',
      paused: v.paused,
      isShortsPlayerVideo: v === pv,
      readyState: v.readyState,
      src: (v.currentSrc || '').slice(0, 45),
      inReel: !!v.closest('ytd-reel-video-renderer'),
      inShortsPlayer: !!v.closest('#shorts-player'),
      parentTag: v.parentElement ? v.parentElement.tagName + (v.parentElement.id ? '#' + v.parentElement.id : '') : null,
    })),
  });
})()
