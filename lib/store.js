// Хранилище: JSON-файл (по умолчанию) или Upstash Redis по REST (бесплатно, переживает «засыпание» Render).
// Включается переменными UPSTASH_REDIS_REST_URL и UPSTASH_REDIS_REST_TOKEN.
const fs = require('fs'), path = require('path');
const KEY = process.env.STORE_KEY || 'krysholet:db';

function fileBackend(file) {
  return {
    name: 'file ' + file,
    async load() { try { return fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } },
    async save(json) { const tmp = file + '.tmp'; fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(tmp, json); fs.renameSync(tmp, file); },
    saveSync(json) { const tmp = file + '.tmp'; fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(tmp, json); fs.renameSync(tmp, file); },
  };
}
function upstashBackend(url, token) {
  url = url.replace(/\/+$/, '');
  const call = async (opts) => {
    const r = await fetch(opts.url, { method: opts.method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: opts.body, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('upstash http ' + r.status);
    const j = await r.json(); if (j.error) throw new Error('upstash: ' + j.error); return j.result;
  };
  return {
    name: 'upstash ' + url.replace(/^https?:\/\//, ''),
    load: () => call({ url: url + '/get/' + encodeURIComponent(KEY), method: 'GET' }),
    save: (json) => call({ url: url, method: 'POST', body: JSON.stringify(['SET', KEY, json]) }),
  };
}

function open() {
  const u = process.env.UPSTASH_REDIS_REST_URL, t = process.env.UPSTASH_REDIS_REST_TOKEN;
  return u && t ? upstashBackend(u, t) : fileBackend(process.env.DATA_FILE || path.join(__dirname, '..', 'data.json'));
}

module.exports = { open, fileBackend, upstashBackend };
