(async function () {
  const cfg = window.ytcfg;
  if (!cfg || !cfg.get) return { err:'no ytcfg', url: location.href.slice(0,40) };
  const apiKey = cfg.get('INNERTUBE_API_KEY');
  const ctx = cfg.get('INNERTUBE_CONTEXT');
  const p = document.getElementById('shorts-player');
  const cur = (p&&p.getVideoData&&p.getVideoData().video_id)||(location.pathname.match(/\/shorts\/([^/?]+)/)||[])[1];
  if(!cur) return {err:'no cur'};
  const seqBytes=[0x0a,0x0b].concat(Array.from(cur).map(c=>c.charCodeAt(0))).concat([0x2a,0x02,0x18,0x06,0x50,0x19,0x68,0x00]);
  const seqParams=btoa(String.fromCharCode.apply(null,seqBytes));
  const r=await fetch(`https://www.youtube.com/youtubei/v1/reel/reel_watch_sequence?key=${apiKey}&prettyPrint=false`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({context:ctx,sequenceParams:seqParams}),credentials:'include'});
  const j=await r.json();
  const isUnlistedEntry=(e)=>{const s=JSON.stringify(e);if(/"isUnlisted"\s*:\s*true/i.test(s))return true;return /unlisted/i.test(s.replace(/"isUnlisted"\s*:\s*false/gi,''));};
  const entries=(j.entries||[]).slice(0,10);
  const rows=[];
  for(const e of entries){
    const id=e.command&&e.command.reelWatchEndpoint&&e.command.reelWatchEndpoint.videoId;
    if(!id) continue;
    // ground truth via player endpoint microformat
    let truth=null;
    try{
      const pr=await fetch(`https://www.youtube.com/youtubei/v1/player?key=${apiKey}&prettyPrint=false`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({context:ctx,videoId:id}),credentials:'include'});
      const pj=await pr.json();
      const mf=pj.microformat&&pj.microformat.playerMicroformatRenderer;
      truth = mf ? !!mf.isUnlisted : null;
    }catch(err){truth='err';}
    rows.push({id, filterSaysUnlisted:isUnlistedEntry(e), trueUnlisted:truth});
  }
  return { rows, missed: rows.filter(x=>x.trueUnlisted===true && !x.filterSaysUnlisted).length };
})()
