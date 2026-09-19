const fs = require('fs');
let code = fs.readFileSync('e:/a2zapiserver/extension/background.js', 'utf8');

const pollScript = `
// --- Live Scrape Polling ---
let isLivePolling = false;
setInterval(async () => {
  if (isLivePolling) return;
  
  chrome.storage.local.get(['apiHost', 'apiKey'], async (res) => {
    if (!res.apiHost || !res.apiKey) return;
    isLivePolling = true;
    try {
      const host = res.apiHost.trim().replace(/\\/+$/, '');
      const baseWithApi = host.endsWith('/api') ? host : host + '/api';
      
      let response = await fetch(baseWithApi + '/catalog/extension/live-tasks', {
        headers: { 'X-API-Key': res.apiKey, 'Authorization': 'Bearer ' + res.apiKey }
      }).catch(e => null);
      
      if (!response || (!response.ok && !host.endsWith('/api'))) {
        response = await fetch(host + '/catalog/extension/live-tasks', {
          headers: { 'X-API-Key': res.apiKey, 'Authorization': 'Bearer ' + res.apiKey }
        }).catch(e => null);
      }
      
      if (response && response.ok) {
        const tasks = await response.json();
        for (const task of tasks) {
          console.log('[Background] Executing Live Scrape for:', task.url);
          try {
             const data = await executeLiveScrape(task.url);
             await fetch(baseWithApi + '/catalog/extension/live-tasks/' + task.id + '/result', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-API-Key': res.apiKey, 'Authorization': 'Bearer ' + res.apiKey },
                body: JSON.stringify({ success: true, data })
             }).catch(e => console.error('Failed to post result', e));
          } catch(e) {
             console.error('[Background] Live Scrape Failed:', e);
             await fetch(baseWithApi + '/catalog/extension/live-tasks/' + task.id + '/result', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-API-Key': res.apiKey, 'Authorization': 'Bearer ' + res.apiKey },
                body: JSON.stringify({ success: false, error: e.message })
             }).catch(err => null);
          }
        }
      }
    } catch (err) {
      // ignore
    }
    isLivePolling = false;
  });
}, 3000);
`;

if (!code.includes('isLivePolling = false;')) {
  code += '\n\n' + pollScript;
  fs.writeFileSync('e:/a2zapiserver/extension/background.js', code);
}
