(async function () {
  const cfg = window.ytcfg; const apiKey = cfg.get('INNERTUBE_API_KEY'); const ctx = cfg.get('INNERTUBE_CONTEXT');
  const p = document.getElementById('shorts-player'); const cur = p.getVideoData().video_id;
  const reelIdsFrom=(o)=>o&&Array.isArray(o.entries)?Array.from(new Set(o.entries.map(e=>e.command&&e.command.reelWatchEndpoint&&e.command.reelWatchEndpoint.videoId).filter(Boolean))):[];
  const digToken=(o,d)=>{if(!o||typeof o!=='object'||d>8)return null;for(const k of Object.keys(o)){if(k==='token'&&typeof o[k]==='string')return o[k];if(o[k]&&typeof o[k]==='object'){const t=digToken(o[k],d+1);if(t)return t;}}return null;};
  const fetchSeq=async(b)=>{const r=await fetch(`https://www.youtube.com/youtubei/v1/reel/reel_watch_sequence?key=${apiKey}&prettyPrint=false`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.assign({context:ctx},b)),credentials:'include'});return r.json();};
  const watched=new Set(); try{const h=await fetch('https://www.youtube.com/feed/history',{credentials:'include'});const html=await h.text();for(const mm of html.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g))watched.add(mm[1]);}catch(e){}
  const seqBytes=[0x0a,0x0b].concat(Array.from(cur).map(c=>c.charCodeAt(0))).concat([0x2a,0x02,0x18,0x06,0x50,0x19,0x68,0x00]);
  const seqParams=btoa(String.fromCharCode.apply(null,seqBytes));
  let ids=[];let tok=null;const f=await fetchSeq({sequenceParams:seqParams});for(const id of reelIdsFrom(f))if(!ids.includes(id)&&!watched.has(id))ids.push(id);tok=digToken(f.continuationEndpoint,0);
  let g=0,dry=0;while(ids.length<70&&tok&&g<20&&dry<2){g++;const b=ids.length;const m=await fetchSeq({continuation:tok});for(const id of reelIdsFrom(m))if(!ids.includes(id)&&!watched.has(id))ids.push(id);tok=digToken(m.continuationEndpoint,0);dry=ids.length>b?0:dry+1;}
  const candidates=Array.from(new Set([cur].concat(ids))).filter(id=>!watched.has(id));
  const checkU=async(id)=>{try{const r=await fetch(`https://www.youtube.com/youtubei/v1/player?key=${apiKey}&prettyPrint=false`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({context:ctx,videoId:id}),credentials:'include'});const txt=await r.text();const mm=txt.match(/"isUnlisted":(true|false)/);return mm?mm[1]==='true':false;}catch(e){return false;}};
  const ordered=[];let dropped=0;const t0=Date.now();
  for(let i=0;i<candidates.length&&ordered.length<50;i+=8){const batch=candidates.slice(i,i+8);const flags=await Promise.all(batch.map(checkU));batch.forEach((id,k)=>{if(flags[k])dropped++;else if(ordered.length<50)ordered.push(id);});}
  // VERIFY: re-check each ordered id's true unlisted status
  const verify=[];for(let i=0;i<ordered.length;i+=10){verify.push(...await Promise.all(ordered.slice(i,i+10).map(checkU)));}
  return { built: ordered.length, dropped, buildMs: Date.now()-t0, unlistedRemainingInOutput: verify.filter(Boolean).length };
})()
