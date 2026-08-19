/**
 * Kynx Family Panel – Grand RP DE03 (Flat-Ordner Version)
 * Alle Dateien liegen im gleichen Ordner.
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const querystring = require('querystring');

const ROOT = __dirname;
const CONFIG_PATH = path.join(ROOT, 'config.json');
const DATA_DIR = path.join(ROOT, 'data');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const TESTS_FILE = path.join(DATA_DIR, 'tests.json');
const MEMBERS_FILE = path.join(DATA_DIR, 'members.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function loadConfig() { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
function loadJson(file, fallback) {
  try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) {}
  return fallback;
}
function saveJson(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8'); }

let sessions = loadJson(SESSIONS_FILE, {});
let tests = loadJson(TESTS_FILE, []);
let members = loadJson(MEMBERS_FILE, []);

function persistSessions() { saveJson(SESSIONS_FILE, sessions); }
function persistTests() { saveJson(TESTS_FILE, tests); }
function persistMembers() { saveJson(MEMBERS_FILE, members); }

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach(p => {
    const [k, ...v] = p.trim().split('=');
    if (k) out[k] = decodeURIComponent(v.join('='));
  });
  return out;
}

function httpsRequest(method, urlStr, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const opts = { hostname: u.hostname, path: u.pathname + u.search, method, headers: { ...headers } };
    if (body) opts.headers['Content-Length'] = Buffer.byteLength(body);
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        let parsed = data;
        try { parsed = JSON.parse(data); } catch (_) {}
        resolve({ status: res.statusCode, data: parsed });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function getSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  const sid = cookies.sid;
  if (!sid || !sessions[sid]) return null;
  if (sessions[sid].expires < Date.now()) { delete sessions[sid]; persistSessions(); return null; }
  return sessions[sid];
}

function createSession(user) {
  const sid = crypto.randomBytes(24).toString('hex');
  sessions[sid] = { user, expires: Date.now() + 7 * 24 * 60 * 60 * 1000 };
  persistSessions();
  return sid;
}

function destroySession(sid) {
  if (sid && sessions[sid]) { delete sessions[sid]; persistSessions(); }
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function redirect(res, location, extra = {}) {
  res.writeHead(302, { Location: location, ...extra });
  res.end();
}

function serveStatic(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json'
  };
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404); res.end('Not Found'); return;
  }
  res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
  res.end(fs.readFileSync(filePath));
}

function isConfigReady(config) {
  const d = config.discord;
  return d.clientId && !String(d.clientId).startsWith('DEINE') &&
    d.clientSecret && !String(d.clientSecret).startsWith('DEIN') &&
    d.guildId && !String(d.guildId).startsWith('DEINE');
}

async function exchangeCode(code, config) {
  const body = querystring.stringify({
    client_id: config.discord.clientId,
    client_secret: config.discord.clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.discord.redirectUri
  });
  const res = await httpsRequest('POST', 'https://discord.com/api/oauth2/token', {
    'Content-Type': 'application/x-www-form-urlencoded'
  }, body);
  if (res.status !== 200) throw new Error('Token exchange failed');
  return res.data;
}

async function fetchUser(accessToken) {
  const res = await httpsRequest('GET', 'https://discord.com/api/users/@me', {
    Authorization: 'Bearer ' + accessToken
  });
  if (res.status !== 200) throw new Error('User fetch failed');
  return res.data;
}

async function fetchUserGuilds(accessToken) {
  const res = await httpsRequest('GET', 'https://discord.com/api/users/@me/guilds', {
    Authorization: 'Bearer ' + accessToken
  });
  if (res.status !== 200) throw new Error('Guilds fetch failed');
  return res.data;
}

async function fetchMemberRoles(config, userId) {
  if (!config.discord.botToken || String(config.discord.botToken).startsWith('DEIN')) return null;
  const res = await httpsRequest('GET',
    `https://discord.com/api/guilds/${config.discord.guildId}/members/${userId}`,
    { Authorization: 'Bot ' + config.discord.botToken });
  if (res.status !== 200) return null;
  return res.data.roles || [];
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  try { return JSON.parse(body); } catch (_) { return null; }
}

const server = http.createServer(async (req, res) => {
  const config = loadConfig();
  const url = new URL(req.url, `http://localhost:${config.server.port}`);
  const pathname = url.pathname;

  try {
    if (pathname === '/auth/login') {
      if (!isConfigReady(config)) {
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end('<html><body style="font-family:sans-serif;background:#0d0f14;color:#fff;padding:40px"><h1>Discord nicht konfiguriert</h1><p>Trage clientId, clientSecret, guildId, requiredRoleId, botToken in config.json ein.</p><a href="/" style="color:#e8b84a">Zurück</a></body></html>');
      }
      const state = crypto.randomBytes(16).toString('hex');
      sessions['_oauth_' + state] = { expires: Date.now() + 600000 };
      persistSessions();
      const params = new URLSearchParams({
        client_id: config.discord.clientId,
        redirect_uri: config.discord.redirectUri,
        response_type: 'code',
        scope: (config.discord.scopes || ['identify', 'guilds']).join(' '),
        state,
        prompt: 'consent'
      });
      return redirect(res, 'https://discord.com/api/oauth2/authorize?' + params.toString());
    }

    if (pathname === '/auth/callback') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const err = url.searchParams.get('error');
      if (err) return redirect(res, '/?error=' + encodeURIComponent(err));
      if (!code || !state || !sessions['_oauth_' + state]) return redirect(res, '/?error=invalid_state');
      delete sessions['_oauth_' + state];
      try {
        const tokenData = await exchangeCode(code, config);
        const user = await fetchUser(tokenData.access_token);
        const guilds = await fetchUserGuilds(tokenData.access_token);
        if (!guilds.some(g => g.id === config.discord.guildId)) return redirect(res, '/?error=not_in_server');
        let hasRole = true;
        let roles = [];
        if (config.discord.requiredRoleId && !String(config.discord.requiredRoleId).startsWith('DEINE')) {
          roles = await fetchMemberRoles(config, user.id);
          if (roles === null) {
            hasRole = true;
            console.warn('[WARN] Bot-Token fehlt – Rollen-Check übersprungen');
          } else {
            hasRole = roles.includes(config.discord.requiredRoleId);
          }
        }
        if (!hasRole) return redirect(res, '/?error=missing_role');
        const avatarUrl = user.avatar
          ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
          : 'https://cdn.discordapp.com/embed/avatars/0.png';
        const sid = createSession({
          id: user.id,
          username: user.username,
          globalName: user.global_name || user.username,
          discriminator: user.discriminator || '0',
          avatar: avatarUrl,
          roles
        });
        return redirect(res, '/dashboard.html', {
          'Set-Cookie': `sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 3600}`
        });
      } catch (e) {
        console.error('OAuth error:', e.message);
        return redirect(res, '/?error=oauth_failed');
      }
    }

    if (pathname === '/auth/logout') {
      destroySession(parseCookies(req.headers.cookie).sid);
      return redirect(res, '/', { 'Set-Cookie': 'sid=; Path=/; HttpOnly; Max-Age=0' });
    }

    if (pathname === '/api/me') {
      const session = getSession(req);
      if (!session) return sendJson(res, 401, { error: 'not_authenticated' });
      return sendJson(res, 200, { user: session.user, family: config.family });
    }

    if (pathname === '/api/config') {
      return sendJson(res, 200, {
        family: config.family,
        sanktionen: config.sanktionen,
        raenge: config.raenge || [],
        statusOptionen: config.statusOptionen || [],
        einstellungstest: {
          minBestehen: config.einstellungstest.minBestehen,
          fragen: config.einstellungstest.fragen
        },
        discordConfigured: isConfigReady(config)
      });
    }

    if (pathname === '/api/members' && req.method === 'GET') {
      const session = getSession(req);
      if (!session) return sendJson(res, 401, { error: 'not_authenticated' });
      return sendJson(res, 200, { members });
    }

    if (pathname === '/api/members' && req.method === 'POST') {
      const session = getSession(req);
      if (!session) return sendJson(res, 401, { error: 'not_authenticated' });
      const p = await readBody(req);
      if (!p || !p.vorname || !p.nachname) return sendJson(res, 400, { error: 'vorname_nachname_required' });
      const member = {
        id: crypto.randomBytes(8).toString('hex'),
        vorname: p.vorname.trim(),
        nachname: p.nachname.trim(),
        telefon: p.telefon || '',
        discordId: p.discordId || '',
        discordName: p.discordName || '',
        rang: p.rang || 'Prospect',
        status: p.status || 'Probezeit',
        notizen: p.notizen || '',
        eingestelltAm: p.eingestelltAm || new Date().toISOString().slice(0, 10),
        eingestelltVon: session.user.username,
        sanktionen: [],
        createdAt: new Date().toISOString()
      };
      members.unshift(member);
      persistMembers();
      return sendJson(res, 201, { member });
    }

    if (pathname.startsWith('/api/members/') && req.method === 'PUT') {
      const session = getSession(req);
      if (!session) return sendJson(res, 401, { error: 'not_authenticated' });
      const id = pathname.split('/')[3];
      const p = await readBody(req);
      const idx = members.findIndex(m => m.id === id);
      if (idx < 0) return sendJson(res, 404, { error: 'not_found' });
      const m = members[idx];
      ['vorname', 'nachname', 'telefon', 'discordId', 'discordName', 'rang', 'status', 'notizen', 'eingestelltAm'].forEach(k => {
        if (p[k] !== undefined) m[k] = p[k];
      });
      m.updatedAt = new Date().toISOString();
      m.updatedBy = session.user.username;
      persistMembers();
      return sendJson(res, 200, { member: m });
    }

    if (pathname.startsWith('/api/members/') && pathname.endsWith('/sanktion') && req.method === 'POST') {
      const session = getSession(req);
      if (!session) return sendJson(res, 401, { error: 'not_authenticated' });
      const id = pathname.split('/')[3];
      const p = await readBody(req);
      const m = members.find(x => x.id === id);
      if (!m) return sendJson(res, 404, { error: 'not_found' });
      if (!m.sanktionen) m.sanktionen = [];
      m.sanktionen.push({
        id: crypto.randomBytes(4).toString('hex'),
        verstoß: p.verstoß || 'Unbekannt',
        strafe: p.strafe || '',
        grund: p.grund || '',
        datum: p.datum || new Date().toISOString().slice(0, 10),
        von: session.user.username
      });
      persistMembers();
      return sendJson(res, 201, { member: m });
    }

    if (pathname.match(/^\/api\/members\/[^/]+\/sanktion\/[^/]+$/) && req.method === 'DELETE') {
      const session = getSession(req);
      if (!session) return sendJson(res, 401, { error: 'not_authenticated' });
      const parts = pathname.split('/');
      const mid = parts[3], sid = parts[5];
      const m = members.find(x => x.id === mid);
      if (!m) return sendJson(res, 404, { error: 'not_found' });
      m.sanktionen = (m.sanktionen || []).filter(s => s.id !== sid);
      persistMembers();
      return sendJson(res, 200, { member: m });
    }

    if (pathname.startsWith('/api/members/') && req.method === 'DELETE') {
      const session = getSession(req);
      if (!session) return sendJson(res, 401, { error: 'not_authenticated' });
      const id = pathname.split('/')[3];
      members = members.filter(m => m.id !== id);
      persistMembers();
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === '/api/tests' && req.method === 'GET') {
      const session = getSession(req);
      if (!session) return sendJson(res, 401, { error: 'not_authenticated' });
      return sendJson(res, 200, { tests });
    }

    if (pathname === '/api/tests' && req.method === 'POST') {
      const session = getSession(req);
      if (!session) return sendJson(res, 401, { error: 'not_authenticated' });
      const payload = await readBody(req);
      const fragen = config.einstellungstest.fragen;
      const ans = (payload && payload.answers) || {};
      let richtig = 0;
      const details = fragen.map(f => {
        const ok = ans[String(f.id)] === true;
        if (ok) richtig++;
        return { id: f.id, frage: f.frage, richtig: ok, bewertet: ans[String(f.id)] !== undefined && ans[String(f.id)] !== null };
      });
      const prozent = fragen.length ? Math.round((richtig / fragen.length) * 100) : 0;
      const test = {
        id: crypto.randomBytes(8).toString('hex'),
        label: (payload && payload.label) || ('Test ' + new Date().toLocaleString('de-DE')),
        geprueftVon: session.user.username,
        geprueftVonId: session.user.id,
        datum: new Date().toISOString(),
        details, richtig, gesamt: fragen.length, prozent,
        bestanden: prozent >= config.einstellungstest.minBestehen,
        minBestehen: config.einstellungstest.minBestehen
      };
      tests.unshift(test);
      if (tests.length > 200) tests = tests.slice(0, 200);
      persistTests();
      return sendJson(res, 201, { test });
    }

    if (pathname.startsWith('/api/tests/') && req.method === 'DELETE') {
      const session = getSession(req);
      if (!session) return sendJson(res, 401, { error: 'not_authenticated' });
      const id = pathname.split('/').pop();
      tests = tests.filter(t => t.id !== id);
      persistTests();
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === '/dashboard.html' || pathname === '/dashboard') {
      if (!getSession(req)) return redirect(res, '/?error=login_required');
      return serveStatic(res, path.join(ROOT, 'dashboard.html'));
    }

    // Static: same folder
    let name = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
    name = path.basename(name); // no path traversal
    const allowed = ['index.html', 'dashboard.html', 'style.css', 'dashboard.js', 'config.json', 'README.md'];
    if (!allowed.includes(name) && !name.endsWith('.css') && !name.endsWith('.js')) {
      res.writeHead(404); return res.end('Not Found');
    }
    return serveStatic(res, path.join(ROOT, name));
  } catch (e) {
    console.error(e);
    sendJson(res, 500, { error: 'server_error', message: e.message });
  }
});

const PORT = loadConfig().server.port || 3000;
server.listen(PORT, () => {
  console.log(`\n  Kynx Panel → http://localhost:${PORT}\n`);
  if (!isConfigReady(loadConfig())) console.log('  ⚠ Discord in config.json noch nicht gesetzt\n');
});
