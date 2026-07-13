(function () {
  const p = document.getElementById('shorts-player');
  if (!p) return JSON.stringify({ err: 'no shorts-player' });
  const safe = (fn) => { try { return fn(); } catch (e) { return '__err:' + e; } };
  const methods = ['getPlaylist','getPlaylistId','getPlaylistIndex','getCurrentVideoId','getVideoData','nextVideo','previousVideo','loadVideoById','cueVideoById','getPlayerState','playVideo'];
  const has = {};
  methods.forEach((m) => (has[m] = typeof p[m] === 'function'));
  return JSON.stringify({
    href: location.href,
    has,
    playlist: safe(() => p.getPlaylist()),
    playlistId: safe(() => p.getPlaylistId()),
    playlistIndex: safe(() => p.getPlaylistIndex()),
    currentVideoId: safe(() => p.getCurrentVideoId()),
    videoData: safe(() => { const d = p.getVideoData(); return d ? { video_id: d.video_id, title: d.title, isListed: d.isListed } : null; }),
    playerState: safe(() => p.getPlayerState()),
  });
})()
