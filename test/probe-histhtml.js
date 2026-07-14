(async function () {
  const res = await fetch('https://www.youtube.com/feed/history', { credentials: 'include' });
  const html = await res.text();
  // ytInitialData embedded in the page HTML
  const m = html.match(/ytInitialData\s*=\s*(\{.+?\});<\/script>/s) || html.match(/ytInitialData"\]\s*=\s*(\{.+?\});/s);
  let ids = { watch: [], shorts: [] };
  let parsed = false;
  if (m) {
    try {
      const data = JSON.parse(m[1]);
      const t = JSON.stringify(data);
      ids.watch = Array.from(new Set(Array.from(t.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)).map(x=>x[1])));
      ids.shorts = Array.from(new Set(Array.from(t.matchAll(/\/shorts\/([A-Za-z0-9_-]{11})/g)).map(x=>x[1])));
      parsed = true;
    } catch (e) { ids.err = String(e); }
  }
  // also raw-scan the HTML directly
  const rawShorts = Array.from(new Set(Array.from(html.matchAll(/\/shorts\/([A-Za-z0-9_-]{11})/g)).map(x=>x[1])));
  const rawWatch = Array.from(new Set(Array.from(html.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)).map(x=>x[1])));
  return {
    status: res.status, htmlLen: html.length, foundInitialData: !!m, parsed,
    fromInitialData: { watch: ids.watch.length, shorts: ids.shorts.length },
    rawHtml: { videoIds: rawWatch.length, shortsIds: rawShorts.length, shortsSample: rawShorts.slice(0,8), watchSample: rawWatch.slice(0,8) },
  };
})()
