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

// ---------- migratie naar versie 2: indicatoren met categorieën ----------
// Een meting is { id, periode, waarden: { categorie: getal|null }, toelichting }.
// Zonder categorieën staat de waarde onder de lege sleutel ''.
function parseNum(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  let t = String(v ?? '').replace(/ca\.|ca\s|±|~|>|</gi, '').trim();
  const m = t.match(/-?\d[\d.,]*/); if (!m) return null;
  t = m[0];
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/\.\d{3}(\.|$)/.test(t)) t = t.replace(/\./g, '');
  const n = parseFloat(t); return isFinite(n) ? n : null;
}
function migrate(d) {
  if ((d.versie || 1) >= 2) return false;
  fs.writeFileSync(DATA_FILE + '.v1-backup', JSON.stringify(d, null, 1));
  const labels = i => (i.metingen || []).map(r => r.periode).join('|');
  const val = (i, p) => parseNum((i.metingen.find(r => r.periode === p) || {}).waarde);
  const base = i => ({ categorieen: [], optelbaar: false, doel: null, eenheid: i.eenheid || '', streefwaarde: i.streefwaarde || '' });
  const out = {};
  let maxNr = Math.max(0, ...Object.values(d.indicatoren).map(i => i.nr || 0));
  for (const i of Object.values(d.indicatoren)) {
    const v1 = labels(i);
    // Herkende beginreeksen netjes omzetten; al het andere generiek.
    if (i.id === 'BE-S1-I1' && (i.metingen || []).some(r => /Rethink\s[\d.]+,\sReuse/.test(r.toelichting || ''))) {
      const cats = ['Rethink', 'Reuse', 'Repair', 'Recycle'];
      out[i.id] = { ...i, ...base(i), streefwaarde: '', naam: 'Circulaire arbeidsplaatsen naar R-strategie', eenheid: 'arbeidsplaatsen', categorieen: cats, optelbaar: true,
        metingen: i.metingen.filter(r => /Rethink/.test(r.toelichting || '')).map(r => ({ id: r.id, periode: r.periode, toelichting: '',
          waarden: Object.fromEntries(cats.map(c => [c, parseNum(((r.toelichting || '').match(new RegExp(c + '\\s([\\d.]+)')) || [])[1])])) })) };
      const nid = 'BE-S1-I2';
      if (!d.indicatoren[nid]) out[nid] = { id: nid, subdoel: 'BE-S1', nr: ++maxNr, naam: 'Aandeel circulaire arbeidsplaatsen', status: i.status, bron: i.bron, ...base({}), eenheid: '%', streefwaarde: i.streefwaarde || '',
        toelichting: 'Aandeel van alle arbeidsplaatsen in Amersfoort bij vestigingen met een circulaire activiteit (KVK). Ter vergelijking: provincie Utrecht 2,8% in 2022.',
        metingen: i.metingen.map(r => ({ id: rid(), periode: r.periode, waarden: { '': parseNum(r.waarde) }, toelichting: '' })), bijgewerkt: '', door: '' };
      continue;
    }
    if (v1 === 'Apparaten|Kleding en textiel|Meubels') {
      out[i.id] = { ...i, ...base(i), eenheid: '%', categorieen: ['Apparaten', 'Kleding en textiel', 'Meubels'],
        metingen: [{ id: rid(), periode: '2025', toelichting: 'Amersfoorts panel 2025', waarden: { 'Apparaten': val(i, 'Apparaten'), 'Kleding en textiel': val(i, 'Kleding en textiel'), 'Meubels': val(i, 'Meubels') } }] };
      continue;
    }
    if (v1 === 'Baseline, primair|Baseline, totaal|Optimalisatie, primair|Biobased') {
      const bp = val(i, 'Baseline, primair'), bt = val(i, 'Baseline, totaal'), op = val(i, 'Optimalisatie, primair');
      out[i.id] = { ...i, ...base(i), eenheid: 'ton', categorieen: ['Primair', 'Secundair', 'Biobased'], optelbaar: true,
        metingen: [
          { id: rid(), periode: 'Baseline', toelichting: '', waarden: { Primair: bp, Secundair: bt != null && bp != null ? bt - bp : null, Biobased: 0 } },
          { id: rid(), periode: 'Optimalisatie', toelichting: '', waarden: { Primair: op, Secundair: null, Biobased: 0 } }],
        toelichting: (i.toelichting ? i.toelichting + ' ' : '') + 'Secundair bij optimalisatie nog niet afgelezen.' };
      continue;
    }
    if (v1 === 'Baseline|Optimalisatie|Doel: >50% reductie') {
      out[i.id] = { ...i, ...base(i), eenheid: 'ton CO₂', doel: val(i, 'Doel: >50% reductie'), streefwaarde: i.streefwaarde || 'meer dan 50% reductie t.o.v. baseline',
        metingen: ['Baseline', 'Optimalisatie'].map(p => ({ id: rid(), periode: p, waarden: { '': val(i, p) }, toelichting: '' })) };
      continue;
    }
    if (/^Nieuwbouwwoningen met ≥30% biobased, 2024\|Streefwaarde 2030, grondgebonden\|Streefwaarde 2030, gestapeld$/.test(v1)) {
      out[i.id] = { ...i, ...base(i), naam: 'Aandeel nieuwbouwwoningen met ≥30% biobased materiaal', eenheid: '%',
        streefwaarde: i.streefwaarde || 'in 2030: 50% biobased bij grondgebonden, 30% bij gestapelde bouw',
        metingen: [{ id: rid(), periode: '2024', waarden: { '': val(i, v1.split('|')[0]) }, toelichting: 'Gemeten naar totale massa exclusief fundering' }] };
      continue;
    }
    if (v1 === 'Per inwoner, 2023|Hergebruikt (Afvalspiegel 2022)') {
      out[i.id] = { ...i, ...base(i), naam: 'Grof huishoudelijk afval per inwoner', eenheid: 'kg',
        metingen: [{ id: rid(), periode: '2023', waarden: { '': val(i, 'Per inwoner, 2023') }, toelichting: '' }] };
      const nid = i.id + 'b';
      out[nid] = { id: nid, subdoel: i.subdoel, nr: ++maxNr, naam: 'Aandeel grof huishoudelijk afval dat wordt hergebruikt', status: i.status, bron: 'Afvalspiegel', ...base({}), eenheid: '%', toelichting: '',
        metingen: [{ id: rid(), periode: '2022', waarden: { '': val(i, 'Hergebruikt (Afvalspiegel 2022)') }, toelichting: '' }], bijgewerkt: '', door: '' };
      continue;
    }
    // Generiek
    const ws = (i.metingen || []).map(r => String(r.waarde || '')).filter(Boolean);
    const unit = i.eenheid || (ws.length && ws.every(w => /%/.test(w)) ? '%' : ws.length && ws.every(w => /\bton\b/.test(w)) ? 'ton' : ws.length && ws.every(w => /\bkg\b/.test(w)) ? 'kg' : '');
    out[i.id] = { ...i, ...base(i), eenheid: unit, metingen: (i.metingen || []).map(r => {
      const n = parseNum(r.waarde);
      const extra = n === null && r.waarde ? `Oorspronkelijke waarde: ${r.waarde}` : (/ca\./i.test(r.waarde || '') ? 'bij benadering' : '');
      return { id: r.id || rid(), periode: r.periode, waarden: { '': n }, toelichting: [r.toelichting, extra].filter(Boolean).join('. ') };
    }) };
  }
  for (const i of Object.values(out)) { delete i.rows; }
  d.indicatoren = out; d.versie = 2;
  return true;
}

let data;
try { data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
catch (e) { data = seed(); }
if (migrate(data) || !fs.existsSync(DATA_FILE)) save();

function save() {
  if (!data) return;
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
const IND_FIELDS = ['naam', 'status', 'bron', 'eenheid', 'streefwaarde', 'toelichting'];
const str = (v, max = 20000) => String(v ?? '').slice(0, max);
const knownItems = new Set(model.lijnen.flatMap(l => [...l.sub.map(s => s.id), ...l.mt.map(m => m.id), ...l.mt.flatMap(m => m.act.map(a => a.id))]));
const knownSub = new Set(model.lijnen.flatMap(l => l.sub.map(s => s.id)));

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
// ---------- inloggen ----------
// Inlogpagina met sessiecookie (werkt in elke browser); basic auth blijft werken voor scripts (R, curl).
const SECRET_FILE = path.join(DATA_DIR, 'secret');
let SECRET;
try { SECRET = fs.readFileSync(SECRET_FILE, 'utf8').trim(); } catch (e) { SECRET = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(SECRET_FILE, SECRET, { mode: 0o600 }); }
const KEY = crypto.createHash('sha256').update(SECRET + ':' + APP_PASSWORD).digest(); // nieuw wachtwoord = iedereen opnieuw inloggen
const SESSION_DAYS = 30;
const sign = v => crypto.createHmac('sha256', KEY).update(v).digest('base64url');
const eq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
function cookies(req) { return Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(c => c[0]).map(([k, ...v]) => [k, v.join('=')])); }
function sessionOk(req) {
  const c = cookies(req).sessie || '';
  const [exp, sig] = c.split('.');
  return !!exp && !!sig && Number(exp) > Date.now() && eq(sig, sign(exp));
}
function basicOk(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return false;
  const [u, ...p] = Buffer.from(h.slice(6), 'base64').toString('utf8').split(':');
  return eq(u + ':' + p.join(':'), APP_USER + ':' + APP_PASSWORD);
}
function authorized(req) { return !APP_PASSWORD || sessionOk(req) || basicOk(req); }
const secure = req => (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
const clientIp = req => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
const fails = new Map(); // ip -> {n, t}
function loginPage(res, fout, code = 200) {
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'login.html'), 'utf8').replace('<!--FOUT-->', fout ? `<p class="fout" role="alert">${fout}</p>` : '');
  send(res, code, html, 'text/html; charset=utf-8');
}
async function readForm(req) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > 10000) break; chunks.push(c); }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

// ---------- routes ----------
async function handle(req, res) {
  const path0 = req.url.split('?')[0];
  if (APP_PASSWORD && path0 === '/login' && req.method === 'POST') {
    const ip = clientIp(req), f = fails.get(ip);
    if (f && f.n >= 10 && Date.now() - f.t < 15 * 60e3) return loginPage(res, 'Te veel mislukte pogingen. Probeer het over een kwartier opnieuw.', 429);
    const form = await readForm(req);
    if (eq(form.get('wachtwoord') || '', APP_PASSWORD)) {
      fails.delete(ip);
      const exp = String(Date.now() + SESSION_DAYS * 864e5);
      res.writeHead(303, {
        'Location': '/',
        'Set-Cookie': `sessie=${exp}.${sign(exp)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure(req) ? '; Secure' : ''}`
      });
      return res.end();
    }
    fails.set(ip, { n: (f && Date.now() - f.t < 15 * 60e3 ? f.n : 0) + 1, t: Date.now() });
    await new Promise(r => setTimeout(r, 800));
    return loginPage(res, 'Dat wachtwoord klopt niet.', 401);
  }
  if (path0 === '/logout') {
    res.writeHead(303, { 'Location': '/', 'Set-Cookie': 'sessie=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' });
    return res.end();
  }
  if (!authorized(req)) {
    if (path0.startsWith('/api/')) return send(res, 401, { fout: 'Niet ingelogd' });
    return loginPage(res, '');
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

  // Indicatoren: PUT /api/indicatoren/:id (aanmaken of volledig vervangen, inclusief metingen), DELETE om te verwijderen
  if (p[1] === 'indicatoren' && p.length === 3) {
    const id = p[2];
    if (!ID.test(id)) return send(res, 400, { fout: 'Ongeldig id' });
    if (m === 'DELETE') {
      const i = data.indicatoren[id];
      if (!i) return send(res, 404, { fout: 'Indicator niet gevonden' });
      delete data.indicatoren[id]; save(); log(str(url.searchParams.get('door'), 80), 'indicator verwijderd', id, i);
      return send(res, 200, { ok: true });
    }
    if (m === 'PUT') {
      const old = data.indicatoren[id];
      const sub = str(body.subdoel ?? old?.subdoel, 40);
      if (!knownSub.has(sub)) return send(res, 400, { fout: 'Onbekend subdoel' });
      const cats = [...new Set((Array.isArray(body.categorieen) ? body.categorieen : []).map(c => str(c, 80).trim()).filter(Boolean))].slice(0, 12);
      const keys = cats.length ? cats : [''];
      const metingen = (Array.isArray(body.metingen) ? body.metingen : []).slice(0, 200).map(r => ({
        id: ID.test(r?.id || '') ? r.id : rid(),
        periode: str(r?.periode, 60).trim(),
        waarden: Object.fromEntries(keys.map(k => { const v = r?.waarden?.[k]; return [k, typeof v === 'number' && isFinite(v) ? v : null]; })),
        toelichting: str(r?.toelichting, 1000)
      })).filter(r => r.periode);
      const i = { id, subdoel: sub, nr: old?.nr || Math.max(0, ...Object.values(data.indicatoren).map(x => x.nr || 0)) + 1 };
      for (const k of IND_FIELDS) i[k] = str(body[k] ?? old?.[k], 4000);
      i.categorieen = cats; i.optelbaar = !!body.optelbaar && cats.length > 1;
      const KLEUREN = ['blauw', 'turquoise', 'groen', 'geel', 'oranje', 'rood', 'paars', 'grijs'];
      i.kleuren = Object.fromEntries(cats.map(c => [c, body.kleuren?.[c]]).filter(([, k]) => KLEUREN.includes(k)));
      i.doel = typeof body.doel === 'number' && isFinite(body.doel) ? body.doel : null;
      i.metingen = metingen; i.bijgewerkt = now; i.door = door;
      data.indicatoren[id] = i; save();
      log(door, old ? 'indicator gewijzigd' : 'indicator toegevoegd', id, { naam: i.naam, categorieen: cats, metingen: metingen.length });
      return send(res, 200, i);
    }
  }
  return send(res, 404, { fout: 'Niet gevonden' });
}

http.createServer((req, res) => handle(req, res).catch(e => { console.error(e); send(res, 500, { fout: 'Serverfout' }); }))
  .listen(PORT, HOST, () => console.log(`Monitoring Circulaire Stad draait op http://${HOST}:${PORT}${APP_PASSWORD ? ' (met wachtwoord)' : ' (ZONDER wachtwoord)'}`));
