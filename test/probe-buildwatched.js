(async function () {
  const reelIdsFrom = (obj) => { if (obj && Array.isArray(obj.entries)) { const ids=[]; for (const e of obj.entries){ const id=e&&e.command&&e.command.reelWatchEndpoint&&e.command.reelWatchEndpoint.videoId; if(id) ids.push(id);} return Array.from(new Set(ids)); } return []; };
  const digToken = (o,d)=>{ if(!o||typeof o!=='object'||d>8)return null; for(const k of Object.keys(o)){ if(k==='token'&&typeof o[k]==='string')return o[k]; if(o[k]&&typeof o[k]==='object'){const t=digToken(o[k],d+1); if(t)return t;}} return null; };
  const p=document.getElementById('shorts-player');
  const cur=(p&&p.getVideoData&&p.getVideoData().video_id)||(location.pathname.match(/\/shorts\/([^/?]+)/)||[])[1];
  const cfg=window.ytcfg; const apiKey=cfg.get('INNERTUBE_API_KEY'); const ctx=cfg.get('INNERTUBE_CONTEXT');
  const watched=new Set();
  try { const h=await fetch('https://www.youtube.com/feed/history',{credentials:'include'}); const html=await h.text(); for(const mm of html.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)) watched.add(mm[1]); } catch(e){}
  const fetchSeq=async(body)=>{const r=await fetch(`https://www.youtube.com/youtubei/v1/reel/reel_watch_sequence?key=${apiKey}&prettyPrint=false`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.assign({context:ctx},body)),credentials:'include'}); return r.json();};
  const ids=[]; let token=null;
  const seqBytes=[0x0a,0x0b].concat(Array.from(cur).map(c=>c.charCodeAt(0))).concat([0x2a,0x02,0x18,0x06,0x50,0x19,0x68,0x00]);
  const seqParams=btoa(String.fromCharCode.apply(null,seqBytes));
  const first=await fetchSeq({sequenceParams:seqParams}); for(const id of reelIdsFrom(first)) if(!ids.includes(id)&&!watched.has(id)) ids.push(id); token=digToken(first.continuationEndpoint,0);
  let g=0,dry=0; while(ids.length<50&&token&&g<16&&dry<2){g++;const b=ids.length;const m=await fetchSeq({continuation:token});for(const id of reelIdsFrom(m)) if(!ids.includes(id)&&!watched.has(id)) ids.push(id);token=digToken(m.continuationEndpoint,0);dry=ids.length>b?0:dry+1;}
  const ordered=Array.from(new Set([cur].concat(ids))).filter(id=>!watched.has(id)).slice(0,50);
  return { watchedCount: watched.size, built: ordered.length, overlapWithWatched: ordered.filter(id=>watched.has(id)).length, curWatched: watched.has(cur), sample: ordered.slice(0,6) };
})()
