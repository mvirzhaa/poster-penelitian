const crypto = require('crypto');
const { pool } = require('./db');

const SESSION_DAYS = 7;
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const httpError = (status, message) => Object.assign(new Error(message), { status });

// ---------- Kata sandi (scrypt, tanpa dependensi tambahan) ----------
function hashSandi(pw) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(pw, salt, 64, (e, key) => e ? reject(e) : resolve(`scrypt$${salt.toString('hex')}$${key.toString('hex')}`));
  });
}
function cekSandi(pw, stored) {
  return new Promise(resolve => {
    const [algo, salt, hash] = String(stored).split('$');
    if (algo !== 'scrypt' || !salt || !hash) return resolve(false);
    crypto.scrypt(pw, Buffer.from(salt, 'hex'), 64, (e, key) => {
      if (e) return resolve(false);
      const b = Buffer.from(hash, 'hex');
      resolve(b.length === key.length && crypto.timingSafeEqual(b, key));
    });
  });
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const secureCookie = () => /^https:/i.test(process.env.PUBLIC_BASE_URL || '');
function setCookie(res, token, maxAgeSec) {
  res.append('Set-Cookie', `sid=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}${secureCookie() ? '; Secure' : ''}`);
}

async function buatSesi(res, penggunaId) {
  const token = crypto.randomBytes(32).toString('base64url');
  await pool.query(`INSERT INTO sesi (token,pengguna_id,kedaluwarsa) VALUES ($1,$2, now() + ($3 || ' days')::interval)`,
    [sha(token), penggunaId, String(SESSION_DAYS)]);
  setCookie(res, token, SESSION_DAYS * 86400);
}

// ---------- Middleware ----------
async function loadUser(req, res, next) {
  try {
    const token = parseCookies(req).sid;
    if (token) {
      const { rows } = await pool.query(`
        SELECT u.id, u.username, u.nama, u.peran, u.prodi_id, u.sandi_default, pr.nama AS prodi_nama, pr.kode AS prodi_kode
        FROM sesi s JOIN pengguna u ON u.id=s.pengguna_id LEFT JOIN prodi pr ON pr.id=u.prodi_id
        WHERE s.token=$1 AND s.kedaluwarsa > now() AND u.aktif`, [sha(token)]);
      req.user = rows[0] || null;
    }
  } catch (e) { return next(e); }
  next();
}
const requireLogin = (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Silakan login terlebih dahulu.' });
const requireAdmin = (req, res, next) => req.user?.peran === 'admin' ? next() : res.status(403).json({ error: 'Hanya admin yang boleh mengakses ini.' });
function getPrefix(req) {
  return (req.baseUrl || req.get('x-forwarded-prefix') || '').replace(/\/+$/, '')
    || (process.env.PUBLIC_BASE_URL ? (new URL(process.env.PUBLIC_BASE_URL).pathname.replace(/\/+$/, '')) : '')
    || (process.env.BASE_PATH || '').replace(/\/+$/, '');
}

function requirePage(req, res, next) {
  if (req.user) return next();
  const p = getPrefix(req);
  const target = (p && !req.originalUrl.startsWith(p)) ? (p + req.originalUrl) : req.originalUrl;
  res.redirect(p + '/login.html?next=' + encodeURIComponent(target));
}
function requireAdminPage(req, res, next) {
  const p = getPrefix(req);
  const target = (p && !req.originalUrl.startsWith(p)) ? (p + req.originalUrl) : req.originalUrl;
  if (!req.user) return res.redirect(p + '/login.html?next=' + encodeURIComponent(target));
  if (req.user.peran !== 'admin') return res.redirect(p + '/');
  next();
}

// Tolak permintaan ubah-data dari situs lain (pelindung CSRF tambahan di luar SameSite=Lax).
function sameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const o = req.headers.origin;
  if (o) {
    try { if (new URL(o).host !== req.get('host')) return res.status(403).json({ error: 'Asal permintaan tidak diizinkan.' }); }
    catch { return res.status(403).json({ error: 'Asal permintaan tidak valid.' }); }
  }
  next();
}

// ---------- Batas percobaan login ----------
const gagal = new Map();
function cekBatas(key) {
  const g = gagal.get(key);
  if (g && g.sampai > Date.now()) throw httpError(429, 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.');
}
function catatGagal(key) {
  const g = gagal.get(key) || { n: 0, sampai: 0 };
  g.n += 1;
  if (g.n >= 5) { g.sampai = Date.now() + 10 * 60 * 1000; g.n = 0; }
  gagal.set(key, g);
}

function routes(app, wrap) {
  app.post('/api/login', wrap(async (req, res) => {
    const username = String(req.body.username || '').trim().toLowerCase();
    const sandi = String(req.body.sandi || '');
    const key = `${req.ip}|${username}`;
    cekBatas(key);
    const { rows } = await pool.query('SELECT * FROM pengguna WHERE lower(username)=$1', [username]);
    const u = rows[0];
    const ok = u && u.aktif && await cekSandi(sandi, u.sandi);
    if (!ok) { catatGagal(key); throw httpError(401, 'Nama pengguna atau kata sandi salah.'); }
    gagal.delete(key);
    await buatSesi(res, u.id);
    res.json({ ok: true });
  }));

  app.post('/api/logout', wrap(async (req, res) => {
    const token = parseCookies(req).sid;
    if (token) await pool.query('DELETE FROM sesi WHERE token=$1', [sha(token)]);
    setCookie(res, '', 0);
    res.json({ ok: true });
  }));

  app.get('/api/me', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Belum login' });
    res.json(req.user);
  });

  app.post('/api/ganti-sandi', requireLogin, wrap(async (req, res) => {
    const { lama, baru } = req.body;
    if (!baru || String(baru).length < 8) throw httpError(400, 'Kata sandi baru minimal 8 karakter.');
    const { rows } = await pool.query('SELECT sandi FROM pengguna WHERE id=$1', [req.user.id]);
    if (!await cekSandi(String(lama || ''), rows[0].sandi)) throw httpError(400, 'Kata sandi lama salah.');
    await pool.query('UPDATE pengguna SET sandi=$1, sandi_default=FALSE WHERE id=$2', [await hashSandi(String(baru)), req.user.id]);
    // keluarkan sesi lain, pertahankan sesi ini
    const token = parseCookies(req).sid;
    await pool.query('DELETE FROM sesi WHERE pengguna_id=$1 AND token<>$2', [req.user.id, sha(token || '')]);
    res.json({ ok: true });
  }));
}

module.exports = { hashSandi, cekSandi, sha, loadUser, requireLogin, requireAdmin, requirePage, requireAdminPage, sameOrigin, routes, httpError, buatSesi, getPrefix, parseCookies, setCookie };
