// Monitoring Omgevingsprogramma Circulaire Stad
// Kleine webapp zonder externe afhankelijkheden (Node 18+).
// Opslag: data/data.json (actuele stand) en data/historie.jsonl (elke wijziging).
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Instellingen uit .env (naast server.js) laden, zodat ook pm2/systemd zonder extra tooling werkt
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch (e) { /* geen .env: prima */ }

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const APP_USER = process.env.APP_USER || 'circulair';
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const MODEL_FILE = process.env.MODEL_FILE || path.join(__dirname, 'model.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const HIST_FILE = path.join(DATA_DIR, 'historie.jsonl');

fs.mkdirSync(DATA_DIR, { recursive: true });
const model = JSON.parse(fs.readFileSync(MODEL_FILE, 'utf8'));

// ---------- opslag ----------
function seed() {
  // Eerste start: indicatoren en metingen overnemen uit model.json
  const indicatoren = {};
  let nr = 0;
  for (const l of model.lijnen) for (const s of l.sub) for (const i of (s.ind || [])) {
    const metingen = [];
    for (const r of (i.rows || [])) metingen.push({ id: rid(), periode: r[0], waarde: r[1], toelichting: '' });
    if (i.tab) {
      const h = i.tab.h;
      for (const r of i.tab.r) metingen.push({
        id: rid(), periode: r[0], waarde: r[r.length - 1],
        toelichting: h.slice(1, -1).map((k, n) => `${k} ${r[n + 1]}`).join(', ')
      });
    }
    indicatoren[i.id] = {
      id: i.id, subdoel: s.id, nr: ++nr, naam: i.t, status: i.st, bron: i.bron || '',
      eenheid: '', streefwaarde: '', toelichting: i.noot || '', metingen,
      bijgewerkt: '', door: ''
    };
  }
  return { versie: 1, notities: {}, indicatoren };
}
function rid() { return crypto.randomBytes(5).toString('hex'); }

let data;
try { data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
catch (e) { data = seed(); save(); }

function save() {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
  fs.renameSync(tmp, DATA_FILE);
}
function log(door, actie, item, waarde) {
  fs.appendFileSync(HIST_FILE, JSON.stringify({ t: new Date().toISOString(), door, actie, item, waarde }) + '\n');
}

// ---------- hulpfuncties ----------
const ID = /^[A-Za-z0-9-]{1,40}$/;
const NOTE_FIELDS = ['aannames', 'status', 'evaluatie', 'effect', 'toelichting'];
const IND_FIELDS = ['naam', 'status', 'bron', 'eenheid', 'streefwaarde', 'toelichting', 'subdoel'];
const MET_FIELDS = ['periode', 'waarde', 'toelichting'];
const str = (v, max = 20000) => String(v ?? '').slice(0, max);
const knownItems = new Set(model.lijnen.flatMap(l => [...l.sub.map(s => s.id), ...l.mt.map(m => m.id)]));

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'SAMEORIGIN'
  });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((ok, fail) => {
    let n = 0; const chunks = [];
    req.on('data', c => { n += c.length; if (n > 300000) { fail(new Error('te groot')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { ok(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { fail(e); } });
    req.on('error', fail);
  });
}
function authorized(req) {
  if (!APP_PASSWORD) return true;
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return false;
  const [u, ...p] = Buffer.from(h.slice(6), 'base64').toString('utf8').split(':');
  const a = Buffer.from(u + ':' + p.join(':')), b = Buffer.from(APP_USER + ':' + APP_PASSWORD);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

// ---------- routes ----------
async function handle(req, res) {
  if (!authorized(req)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Monitoring Circulaire Stad", charset="UTF-8"' });
    return res.end('Inloggen vereist');
  }
  const url = new URL(req.url, 'http://x');
  const p = url.pathname.split('/').filter(Boolean);

  if (p[0] !== 'api') {
    const file = path.normalize(path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'Niet gevonden', 'text/plain');
    return send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream');
  }

  const m = req.method;
  if (m === 'GET' && p[1] === 'model') return send(res, 200, model);
  if (m === 'GET' && p[1] === 'data') return send(res, 200, data);
  if (m === 'GET' && p[1] === 'historie') {
    const item = url.searchParams.get('item') || '';
    let lines = [];
    try { lines = fs.readFileSync(HIST_FILE, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch (e) {}
    if (item) lines = lines.filter(l => l.item === item || String(l.item).startsWith(item + '/'));
    return send(res, 200, lines.slice(-100).reverse());
  }

  if (!['PATCH', 'PUT', 'POST', 'DELETE'].includes(m)) return send(res, 405, { fout: 'Methode niet toegestaan' });
  let body = {};
  if (m !== 'DELETE') { try { body = await readBody(req); } catch (e) { return send(res, 400, { fout: 'Ongeldige invoer' }); } }
  const door = str(body.door, 80);
  const now = new Date().toISOString();

  // Notities bij maatregel of subdoel: PATCH /api/notities/:id
  if (p[1] === 'notities' && m === 'PATCH' && ID.test(p[2] || '') && knownItems.has(p[2])) {
    const n = data.notities[p[2]] || (data.notities[p[2]] = {});
    for (const k of NOTE_FIELDS) if (k in body) { n[k] = str(body[k]); log(door, 'notitie', p[2] + '/' + k, n[k]); }
    n.bijgewerkt = now; n.door = door; save();
    return send(res, 200, n);
  }

  if (p[1] === 'indicatoren') {
    const id = p[2] || '';
    if (!ID.test(id)) return send(res, 400, { fout: 'Ongeldig id' });
    // PUT /api/indicatoren/:id  (aanmaken of wijzigen)
    if (p.length === 3 && m === 'PUT') {
      const sub = str(body.subdoel ?? data.indicatoren[id]?.subdoel, 40);
      if (!knownItems.has(sub)) return send(res, 400, { fout: 'Onbekend subdoel' });
      const i = data.indicatoren[id] || (data.indicatoren[id] = { id, nr: Math.max(0, ...Object.values(data.indicatoren).map(x => x.nr || 0)) + 1, metingen: [] });
      for (const k of IND_FIELDS) if (k in body) i[k] = str(body[k], 4000);
      i.subdoel = sub; i.bijgewerkt = now; i.door = door; save();
      log(door, 'indicator', id, IND_FIELDS.reduce((o, k) => (o[k] = i[k], o), {}));
      return send(res, 200, i);
    }
    const i = data.indicatoren[id];
    if (!i) return send(res, 404, { fout: 'Indicator niet gevonden' });
    if (p.length === 3 && m === 'DELETE') {
      delete data.indicatoren[id]; save(); log(door || str(url.searchParams.get('door'), 80), 'indicator verwijderd', id, i);
      return send(res, 200, { ok: true });
    }
    // Metingen
    if (p[3] === 'metingen') {
      if (p.length === 4 && m === 'POST') {
        const r = { id: rid() }; for (const k of MET_FIELDS) r[k] = str(body[k], 2000);
        i.metingen.push(r); i.bijgewerkt = now; i.door = door; save(); log(door, 'meting toegevoegd', id + '/' + r.id, r);
        return send(res, 200, i);
      }
      const r = i.metingen.find(x => x.id === p[4]);
      if (!r) return send(res, 404, { fout: 'Meting niet gevonden' });
      if (m === 'PUT') {
        for (const k of MET_FIELDS) if (k in body) r[k] = str(body[k], 2000);
        i.bijgewerkt = now; i.door = door; save(); log(door, 'meting gewijzigd', id + '/' + r.id, r);
        return send(res, 200, i);
      }
      if (m === 'DELETE') {
        i.metingen = i.metingen.filter(x => x !== r); i.bijgewerkt = now; save();
        log(str(url.searchParams.get('door'), 80), 'meting verwijderd', id + '/' + r.id, r);
        return send(res, 200, i);
      }
    }
  }
  return send(res, 404, { fout: 'Niet gevonden' });
}

http.createServer((req, res) => handle(req, res).catch(e => { console.error(e); send(res, 500, { fout: 'Serverfout' }); }))
  .listen(PORT, HOST, () => console.log(`Monitoring Circulaire Stad draait op http://${HOST}:${PORT}${APP_PASSWORD ? ' (met wachtwoord)' : ' (ZONDER wachtwoord)'}`));
