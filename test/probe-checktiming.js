(async function () {
  const cfg = window.ytcfg;
  const apiKey = cfg.get('INNERTUBE_API_KEY');
  const ctx = cfg.get('INNERTUBE_CONTEXT');
  const p = document.getElementById('shorts-player');
  const cur = p.getVideoData().video_id;
  const seqBytes=[0x0a,0x0b].concat(Array.from(cur).map(c=>c.charCodeAt(0))).concat([0x2a,0x02,0x18,0x06,0x50,0x19,0x68,0x00]);
  const seqParams=btoa(String.fromCharCode.apply(null,seqBytes));
  // gather ~30 candidate ids
  const reelIdsFrom=(o)=>o&&Array.isArray(o.entries)?Array.from(new Set(o.entries.map(e=>e.command&&e.command.reelWatchEndpoint&&e.command.reelWatchEndpoint.videoId).filter(Boolean))):[];
  const digToken=(o,d)=>{if(!o||typeof o!=='object'||d>8)return null;for(const k of Object.keys(o)){if(k==='token'&&typeof o[k]==='string')return o[k];if(o[k]&&typeof o[k]==='object'){const t=digToken(o[k],d+1);if(t)return t;}}return null;};
  const fetchSeq=async(b)=>{const r=await fetch(`https://www.youtube.com/youtubei/v1/reel/reel_watch_sequence?key=${apiKey}&prettyPrint=false`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.assign({context:ctx},b)),credentials:'include'});return r.json();};
  let ids=[];let tok=null;const f=await fetchSeq({sequenceParams:seqParams});ids=reelIdsFrom(f);tok=digToken(f.continuationEndpoint,0);
  let g=0;while(ids.length<30&&tok&&g<5){g++;const m=await fetchSeq({continuation:tok});for(const id of reelIdsFrom(m))if(!ids.includes(id))ids.push(id);tok=digToken(m.continuationEndpoint,0);}
  ids=ids.slice(0,30);
  // check isUnlisted via player, concurrency-limited
  const t0=Date.now();
  const checkOne=async(id)=>{try{const r=await fetch(`https://www.youtube.com/youtubei/v1/player?key=${apiKey}&prettyPrint=false`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({context:ctx,videoId:id}),credentials:'include'});const txt=await r.text();const mm=txt.match(/"isUnlisted":(true|false)/);return {id,unlisted:mm?mm[1]==='true':null};}catch(e){return {id,unlisted:'err'};}};
  // parallel batches of 8
  const results=[];for(let i=0;i<ids.length;i+=8){const batch=ids.slice(i,i+8);results.push(...await Promise.all(batch.map(checkOne)));}
  const ms=Date.now()-t0;
  return { candidates:ids.length, ms, unlistedFound: results.filter(r=>r.unlisted===true).length, errors: results.filter(r=>r.unlisted==='err').length };
})()
