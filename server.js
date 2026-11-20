'use strict';
require('dotenv').config();
const express = require('express'), mysql = require('mysql2/promise'), path = require('path'), crypto = require('crypto');
const http = require('http'), https = require('https'), fs = require('fs');
const { WebSocketServer } = require('ws');
const sec = require('./lib/security'), makeDao = require('./lib/dao'), { applySave, HttpError } = require('./lib/rules');

const env = process.env;
const PORT = +(env.PORT || 3000), HOST = env.HOST || '127.0.0.2';
const TLS = env.TLS_KEY_FILE && env.TLS_CERT_FILE ? { key: fs.readFileSync(env.TLS_KEY_FILE), cert: fs.readFileSync(env.TLS_CERT_FILE) } : null;
const APP_URL = (env.APP_URL || `${TLS ? 'https' : 'http'}://localhost:${PORT}`).replace(/\/+$/, '');
const SECRET_DEFAULT = () => { let s = env.SESSION_SECRET; if (!s || s.length < 32) { s = crypto.randomBytes(48).toString('hex'); console.warn('Aviso: SESSION_SECRET no está definido (mínimo 32 caracteres). Se usa una clave temporal: las sesiones se cerrarán al reiniciar.'); } return s; };
let SECRET = SECRET_DEFAULT();
const tokens = sec.createTokens(SECRET), limiter = sec.createLimiter();
const RECAPTCHA_SITE = (env.RECAPTCHA_SITE_KEY || '').trim(), RECAPTCHA_SECRET = (env.RECAPTCHA_SECRET_KEY || '').trim();
const RECAPTCHA_ON = !!(RECAPTCHA_SITE && RECAPTCHA_SECRET);
if ((RECAPTCHA_SITE && !RECAPTCHA_SECRET) || (!RECAPTCHA_SITE && RECAPTCHA_SECRET)) {
  console.warn('Aviso: define tanto RECAPTCHA_SITE_KEY como RECAPTCHA_SECRET_KEY en .env para activar reCAPTCHA.');
}

const pool = mysql.createPool({
  host: env.DB_HOST || 'localhost', port: +(env.DB_PORT || 3306), user: env.DB_USER || 'root', password: env.DB_PASSWORD || '',
  database: env.DB_NAME || 'manos_que_hablan', charset: 'utf8mb4', waitForConnections: true, connectionLimit: 10,
  supportBigNumbers: true, bigNumberStrings: false
});
const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'camera=(self), microphone=(self)' });
  if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
  if (req.method === 'POST') {
    const o = req.get('origin');
    if (o) { try { if (new URL(o).host !== req.get('host')) return res.status(403).json({ error: 'Origen no permitido.' }); } catch { return res.sendStatus(403); } }
  }
  next();
});
const small = express.json({ limit: '20kb' }), big = express.json({ limit: '50mb' });
const bearer = req => { const h = req.get('authorization') || ''; return h.startsWith('Bearer ') ? h.slice(7) : null; };

async function authenticate(token) {
  const p = tokens.verify(token); if (!p) return null;
  const [r] = await pool.query('SELECT id,name,role,pw_changed FROM users WHERE id=?', [p.uid]);
  const u = r[0];
  if (!u || p.iat < Number(u.pw_changed)) return null; // la sesión deja de valer si se cambió la contraseña
  return { id: Number(u.id), name: u.name, role: u.role };
}
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);
const requireAuth = wrap(async (req, res, next) => {
  const u = await authenticate(bearer(req));
  if (!u) return res.status(401).json({ error: 'Tu sesión no es válida o venció. Inicia sesión de nuevo.' });
  req.user = u; next();
});
const sessionFor = u => ({ token: tokens.sign({ uid: Number(u.id) }), user: { id: Number(u.id), name: u.name, role: u.role } });
const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const checkPassword = p => typeof p === 'string' && p.length >= 8 && p.length <= 128;

/* ---------- autenticación ---------- */
app.get('/api/auth/config', (req, res) => res.json({ recaptchaSiteKey: RECAPTCHA_ON ? RECAPTCHA_SITE : null }));
const DUMMY = sec.hashPassword('contraseña-ficticia-para-igualar-tiempos');
app.post('/api/auth/register', small, wrap(async (req, res) => {
  if (limiter.tooMany('reg:' + req.ip, 20, 3600e3)) return res.status(429).json({ error: 'Demasiados intentos. Espera un momento.' });
  const { name, email, password, role } = req.body || {};
  const em = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!EMAIL.test(em) || em.length > 190) return res.status(400).json({ error: 'Escribe un correo válido.' });
  if (!checkPassword(password)) return res.status(400).json({ error: 'La contraseña debe tener entre 8 y 128 caracteres.' });
  if (!['sordo', 'oyente'].includes(role)) return res.status(400).json({ error: 'Elige un rol válido.' });
  const nm = (typeof name === 'string' && name.trim().slice(0, 120)) || 'Usuario', pass = await sec.hashPassword(password);
  for (let i = 0, id = Date.now(); i < 5; i++, id++) {
    try {
      await pool.query('INSERT INTO users(id,name,email,pass,role) VALUES(?,?,?,?,?)', [id, nm, em, pass, role]);
      return res.json(sessionFor({ id, name: nm, role }));
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY' && /email/i.test(e.message)) return res.status(409).json({ error: 'Ese correo ya existe.' });
      if (e.code !== 'ER_DUP_ENTRY') throw e;
    }
  }
  res.status(503).json({ error: 'No se pudo crear la cuenta. Inténtalo de nuevo.' });
}));

app.post('/api/auth/login', small, wrap(async (req, res) => {
  const { email, password, recaptchaToken } = req.body || {};
  const em = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (limiter.tooMany('ip:' + req.ip, 100, 900e3) || limiter.tooMany('em:' + em, 10, 900e3)) return res.status(429).json({ error: 'Demasiados intentos. Espera 15 minutos e inténtalo de nuevo.' });
  if (RECAPTCHA_ON && !(await sec.verifyRecaptcha(RECAPTCHA_SECRET, recaptchaToken, req.ip))) {
    return res.status(400).json({ error: 'Completa la verificación reCAPTCHA e inténtalo de nuevo.' });
  }
  const [r] = await pool.query('SELECT id,name,pass,role FROM users WHERE email=?', [em]);
  const u = r[0], ok = u ? await sec.verifyPassword(String(password || ''), u.pass) : (await sec.verifyPassword(String(password || ''), await DUMMY), false);
  if (!ok) return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
  limiter.clear('em:' + em);
  if (sec.isLegacyHash(u.pass)) await pool.query('UPDATE users SET pass=? WHERE id=?', [await sec.hashPassword(password), u.id]); // migra al formato seguro
  res.json(sessionFor(u));
}));

async function sendMail(to, subject, body) {
  if (!env.SMTP_HOST) return false;
  let nodemailer; try { nodemailer = require('nodemailer'); } catch { console.warn('Falta instalar nodemailer (npm install).'); return false; }
  const t = nodemailer.createTransport({ host: env.SMTP_HOST, port: +(env.SMTP_PORT || 587), secure: env.SMTP_SECURE === 'true', auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined });
  await t.sendMail({ from: env.SMTP_FROM || env.SMTP_USER, to, subject, text: body });
  return true;
}
app.post('/api/auth/forgot', small, wrap(async (req, res) => {
  const em = typeof (req.body || {}).email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const msg = env.SMTP_HOST
    ? 'Si el correo está registrado, enviaremos un enlace de un solo uso válido por 15 minutos. Revisa también la carpeta de spam.'
    : 'El envío de correo no está configurado en este servidor. Quien administra la instalación puede entregarte el enlace, que aparece en la terminal del servidor.';
  if (limiter.tooMany('fi:' + req.ip, 10, 3600e3) || limiter.tooMany('fe:' + em, 3, 3600e3)) return res.status(429).json({ error: 'Demasiadas solicitudes. Inténtalo más tarde.' });
  if (EMAIL.test(em)) {
    const [r] = await pool.query('SELECT id FROM users WHERE email=?', [em]);
    if (r[0]) {
      const token = crypto.randomBytes(32).toString('base64url');
      await pool.query('DELETE FROM password_resets WHERE user_id=?', [r[0].id]);
      await pool.query('INSERT INTO password_resets(user_id,token_hash,expires) VALUES(?,?,?)', [r[0].id, sec.sha256(token), Date.now() + 15 * 60e3]);
      const link = `${APP_URL}/#reset=${token}`;
      try {
        const sent = await sendMail(em, 'Restablecer tu contraseña · Manos que Hablan', `Recibimos una solicitud para cambiar tu contraseña.\n\nAbre este enlace (válido 15 minutos y de un solo uso):\n${link}\n\nSi no fuiste tú, ignora este mensaje.`);
        if (!sent) console.log(`\n[RECUPERACIÓN] Enlace para ${em} (válido 15 minutos, un solo uso):\n${link}\n`);
      } catch (e) { console.error('No se pudo enviar el correo de recuperación:', e.message); }
    }
  }
  res.json({ message: msg });
}));

app.post('/api/auth/reset', small, wrap(async (req, res) => {
  if (limiter.tooMany('rs:' + req.ip, 20, 3600e3)) return res.status(429).json({ error: 'Demasiados intentos. Inténtalo más tarde.' });
  const { token, password } = req.body || {};
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{30,80}$/.test(token)) return res.status(400).json({ error: 'El enlace no es válido.' });
  if (!checkPassword(password)) return res.status(400).json({ error: 'La contraseña debe tener entre 8 y 128 caracteres.' });
  const pass = await sec.hashPassword(password), c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [r] = await c.query('SELECT id,user_id FROM password_resets WHERE token_hash=? AND expires>? FOR UPDATE', [sec.sha256(token), Date.now()]);
    if (!r[0]) { await c.rollback(); return res.status(400).json({ error: 'El enlace venció o ya se usó. Solicita uno nuevo.' }); }
    await c.query('UPDATE users SET pass=?,pw_changed=? WHERE id=?', [pass, Date.now(), r[0].user_id]);
    await c.query('DELETE FROM password_resets WHERE user_id=?', [r[0].user_id]);
    await c.commit();
    closeSockets(Number(r[0].user_id));
    res.json({ ok: true });
  } catch (e) { await c.rollback(); throw e; } finally { c.release(); }
}));

app.get('/api/users/lookup', requireAuth, wrap(async (req, res) => {
  if (limiter.tooMany('lk:' + req.user.id, 30, 60e3)) return res.status(429).json({ error: 'Demasiadas búsquedas.' });
  const em = String(req.query.email || '').trim().toLowerCase();
  const [r] = await pool.query("SELECT id,name,role FROM users WHERE email=? AND role<>'admin'", [em]);
  if (!r[0]) return res.status(404).json({ error: 'No existe una cuenta con ese correo.' });
  res.json({ id: Number(r[0].id), name: r[0].name, role: r[0].role });
}));

/* ---------- lectura: cada persona recibe solo lo que le corresponde ---------- */
const clean = o => { Object.keys(o).forEach(k => (o[k] === null || o[k] === undefined) && delete o[k]); return o; };
const num = v => (/^\d+$/.test(String(v)) ? Number(v) : v);
const reactionsOf = (rs, id) => ({ like: rs.filter(y => y.target_id === id && y.type === 'like').map(y => y.user_id), love: rs.filter(y => y.target_id === id && y.type === 'love').map(y => y.user_id) });

async function bootstrap(c, me) {
  const admin = me.role === 'admin', out = {};
  const [us] = await c.query('SELECT id,name,email,role FROM users ORDER BY id');
  out.users = us.map(u => (admin || Number(u.id) === me.id ? u : { id: u.id, name: u.name, role: u.role })); // sin contraseñas; el correo solo para ti y el administrador

  const [mine] = await c.query('SELECT chat_id FROM chat_members WHERE user_id=?', [me.id]);
  const mineIds = new Set(mine.map(x => Number(x.chat_id)));
  const [ch] = await c.query('SELECT id,title,owner,names FROM chats ORDER BY id');
  const vis = ch.filter(x => admin || mineIds.has(Number(x.id)));
  const [mb] = vis.length ? await c.query('SELECT chat_id,user_id FROM chat_members WHERE chat_id IN (?)', [vis.map(x => x.id)]) : [[]];
  const [ms] = mineIds.size ? await c.query('SELECT * FROM messages WHERE chat_id IN (?) ORDER BY t,id', [[...mineIds]]) : [[]];
  out.chats = vis.map(x => {
    const own = mineIds.has(Number(x.id));
    return {
      id: x.id, title: own ? x.title : 'Chat de otras personas', owner: x.owner, ...(own && x.names ? { names: JSON.parse(x.names) } : {}),
      members: mb.filter(m => m.chat_id === x.id).map(m => m.user_id),
      msgs: own ? ms.filter(m => m.chat_id === x.id).map(m => clean({
        id: m.id, uid: m.uid, from: m.from_role, sordo: m.sordo, oyente: m.oyente, orig: m.orig, src: m.src, t: m.t, type: m.type, dur: m.dur, audio: m.audio,
        deleted: m.deleted ? true : null, edited: m.edited ? true : null, fwd: m.fwd ? true : null, hiddenFor: m.hidden_for ? JSON.parse(m.hidden_for) : null
      })) : []
    };
  });

  const [p] = await c.query('SELECT * FROM posts ORDER BY id'), [cm] = await c.query('SELECT * FROM comments ORDER BY id');
  const [rs] = await c.query('SELECT kind,target_id,user_id,type FROM reactions');
  const rp = rs.filter(r => r.kind === 'p'), rc = rs.filter(r => r.kind === 'c');
  out.posts = p.map(x => clean({ id: x.id, uid: num(x.uid), name: x.name, role: x.role, text: x.text, pinned: x.pinned ? true : null, r: reactionsOf(rp, x.id) }));
  out.cmts = cm.map(x => ({ id: x.id, postId: x.post_id, parentId: x.parent_id, uid: num(x.uid), name: x.name, role: x.role, text: x.text, r: reactionsOf(rc, x.id) }));

  const [ct] = admin ? await c.query('SELECT * FROM contacts ORDER BY id') : await c.query('SELECT * FROM contacts WHERE uid=? ORDER BY id', [me.id]);
  const [md] = ct.length ? await c.query('SELECT contact_id,type,src,name FROM contact_media WHERE contact_id IN (?) ORDER BY id', [ct.map(x => x.id)]) : [[]];
  out.contacts = ct.map(x => ({ id: x.id, uid: x.uid, name: x.name, email: x.email, role: x.role, urole: x.urole, subject: x.subject, message: x.message, wantsLsc: !!x.wants_lsc,
    reply: x.has_reply ? { text: x.reply_text || '', media: md.filter(m => m.contact_id === x.id).map(m => clean({ type: m.type, src: m.src, name: m.name })), t: x.reply_t } : null }));

  const [pr] = admin ? await c.query('SELECT user_id,last,online FROM presence') : await c.query('SELECT user_id,last,online FROM presence WHERE user_id=?', [me.id]);
  out.presence = {}; pr.forEach(x => { out.presence[x.user_id] = { last: x.last, online: !!x.online }; });
  const [gl] = await c.query('SELECT id,es,lsc,cat FROM glossary WHERE user_id=? ORDER BY id', [me.id]);
  out.gl = { [me.id]: gl.map(clean) };
  return out;
}
const EMPTY = { users: [], chats: [], posts: [], cmts: [], contacts: [], presence: {}, gl: {} };
app.get('/api/bootstrap', wrap(async (req, res) => {
  const t = bearer(req); if (!t) return res.json(EMPTY);
  const me = await authenticate(t); if (!me) return res.status(401).json({ error: 'Sesión no válida o vencida.' });
  const c = await pool.getConnection();
  try { res.json(await bootstrap(c, me)); } finally { c.release(); }
}));

/* ---------- escritura: cada operación se autoriza en el servidor ---------- */
app.post('/api/save/:name', requireAuth, big, wrap(async (req, res) => {
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    await applySave(req.params.name, makeDao(c), req.user, req.body || {});
    await c.commit(); res.json({ ok: true });
  } catch (e) { await c.rollback(); throw e; } finally { c.release(); }
}));

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'El archivo es demasiado grande.' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Solicitud no válida.' });
  console.error(req.method, req.path, err.message);
  res.status(500).json({ error: 'No se pudo completar la operación. Revisa el registro del servidor.' });
});

/* ---------- señalización de videollamadas (WebSocket) ---------- */
const sockets = new Map(); // id de usuario -> conexiones
function closeSockets(uid) { (sockets.get(uid) || new Set()).forEach(s => s.close(4001, 'sesión cerrada')); }
const pairCache = new Map();
async function sharesChat(a, b) {
  const k = a < b ? `${a}:${b}` : `${b}:${a}`, hit = pairCache.get(k);
  if (hit && Date.now() - hit.t < 30e3) return hit.ok;
  const [r] = await pool.query('SELECT 1 FROM chat_members x JOIN chat_members y ON x.chat_id=y.chat_id WHERE x.user_id=? AND y.user_id=? LIMIT 1', [a, b]);
  pairCache.set(k, { ok: !!r[0], t: Date.now() }); return !!r[0];
}
const SIGNALS = new Set(['invite', 'accept', 'decline', 'busy', 'offer', 'answer', 'ice', 'end']);
function startSignaling(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const o = req.headers.origin;
    let okOrigin = true; if (o) { try { okOrigin = new URL(o).host === req.headers.host; } catch { okOrigin = false; } }
    if (!req.url.startsWith('/ws') || !okOrigin) return socket.destroy();
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  });
  wss.on('connection', ws => {
    ws.alive = true; ws.user = null; ws.sent = [];
    const timer = setTimeout(() => { if (!ws.user) ws.close(4001, 'auth'); }, 5000);
    ws.on('pong', () => { ws.alive = true; });
    ws.on('message', async raw => {
      try {
        const m = JSON.parse(raw);
        if (!ws.user) {
          if (m.type !== 'auth') return ws.close(4001, 'auth');
          const u = await authenticate(m.token); if (!u) return ws.close(4001, 'auth');
          ws.user = u; clearTimeout(timer);
          (sockets.get(u.id) || sockets.set(u.id, new Set()).get(u.id)).add(ws);
          return ws.send(JSON.stringify({ type: 'ready' }));
        }
        const now = Date.now(); ws.sent = ws.sent.filter(t => now - t < 10e3); ws.sent.push(now);
        if (ws.sent.length > 300) return ws.close(4008, 'demasiados mensajes');
        const to = Number(m.to);
        if (!SIGNALS.has(m.type) || !Number.isSafeInteger(to) || to === ws.user.id || !(await sharesChat(ws.user.id, to))) return;
        const out = { type: m.type, to, from: ws.user.id };
        if (m.type === 'invite') { out.name = ws.user.name; out.chat = Number.isSafeInteger(m.chat) ? m.chat : null; }
        if (m.sdp && typeof m.sdp.sdp === 'string' && ['offer', 'answer'].includes(m.sdp.type)) out.sdp = { type: m.sdp.type, sdp: m.sdp.sdp };
        if (m.cand && typeof m.cand === 'object') out.cand = m.cand;
        (sockets.get(to) || []).forEach(s => s.readyState === 1 && s.send(JSON.stringify(out)));
      } catch { /* mensaje inválido: se ignora */ }
    });
    ws.on('close', () => { clearTimeout(timer); if (ws.user) { const s = sockets.get(ws.user.id); if (s) { s.delete(ws); if (!s.size) sockets.delete(ws.user.id); } } });
  });
  setInterval(() => wss.clients.forEach(ws => { if (!ws.alive) return ws.terminate(); ws.alive = false; ws.ping(); }), 30e3).unref();
}

/* ---------- migración e inicio ---------- */
async function initialize() {
  const c = await pool.getConnection();
  try {
    const tryQ = async (sql, ok = []) => { try { await c.query(sql); } catch (e) { if (!ok.includes(e.code)) throw e; } };
    await tryQ('ALTER TABLE chats ADD COLUMN names TEXT NULL', ['ER_DUP_FIELDNAME']);
    await tryQ('ALTER TABLE users MODIFY pass VARCHAR(255) NOT NULL');
    await tryQ('ALTER TABLE users ADD COLUMN pw_changed BIGINT NOT NULL DEFAULT 0', ['ER_DUP_FIELDNAME']);
    await c.query(`CREATE TABLE IF NOT EXISTS password_resets (
      id INT AUTO_INCREMENT PRIMARY KEY, user_id BIGINT NOT NULL, token_hash CHAR(64) NOT NULL, expires BIGINT NOT NULL,
      UNIQUE KEY uq_token (token_hash), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB`);

    const [adm] = await c.query("SELECT id,pass FROM users WHERE role='admin' LIMIT 1");
    const email = (env.ADMIN_EMAIL || '').trim().toLowerCase(), pw = env.ADMIN_PASSWORD || '';
    if (pw && pw.length < 12) throw new Error('ADMIN_PASSWORD debe tener mínimo 12 caracteres');
    const defaultPw = sec.sha256('Admin#2026'); // contraseña pública de la versión demo anterior
    if (!adm[0]) {
      if (!email || !pw) throw new Error('No existe administrador: define ADMIN_EMAIL y ADMIN_PASSWORD (mínimo 12 caracteres) en .env');
      const [one] = await c.query('SELECT id FROM users WHERE id=1');
      await c.query("INSERT INTO users(id,name,email,pass,role) VALUES(?,'Administrador',?,?,'admin')", [one[0] ? Date.now() : 1, email, await sec.hashPassword(pw)]);
    } else if (adm[0].pass === defaultPw) {
      if (!email || !pw) throw new Error('El administrador usa la contraseña pública de la versión demo. Define ADMIN_EMAIL y ADMIN_PASSWORD en .env para reemplazarla.');
      await c.query('UPDATE users SET email=?,pass=?,pw_changed=? WHERE id=?', [email, await sec.hashPassword(pw), Date.now(), adm[0].id]);
    }
    await c.query("INSERT IGNORE INTO posts(id,uid,name,role,text,pinned) VALUES(1,'ejemplo','Karol','sordo','¡Hola, comunidad! Soy Karol. Me encanta poder escribir en mi estructura y que las demás personas me entiendan 💜',1)");
    await c.query("INSERT IGNORE INTO comments(id,post_id,parent_id,uid,name,role,text) VALUES(2,1,NULL,'ejemplo','Equipo Manos que Hablan','oyente','¡Bienvenida, Karol! Aquí todas las formas de comunicar valen 🤟')");
    await c.query('SET FOREIGN_KEY_CHECKS=0');
    for (const t of ['users', 'chats', 'messages', 'posts', 'comments', 'glossary', 'contacts'])
      try { await c.query(`ALTER TABLE \`${t}\` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); } catch (e) { console.warn('utf8mb4', t, e.message); }
    await c.query('SET FOREIGN_KEY_CHECKS=1');
  } finally { c.release(); }
}

app.use(express.static(path.join(__dirname, 'public')));
initialize().then(() => {
  const server = TLS ? https.createServer(TLS, app) : http.createServer(app);
  startSignaling(server);
  server.listen(PORT, HOST, () => console.log(`Manos que Hablan en ${APP_URL} (escuchando en ${HOST}:${PORT}${TLS ? ', HTTPS' : ''})`));
}).catch(async e => { console.error('No se pudo iniciar:', e.message); await pool.end(); process.exitCode = 1; });
