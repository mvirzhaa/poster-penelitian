const axios = require('axios');
const crypto = require('crypto');
const { pool } = require('./db');
const { buatSesi, getPrefix, parseCookies, hashSandi } = require('./auth');

const RAW_SSO_URL = (process.env.SSO_BASE_URL || process.env.EPORTAL_URL || 'https://eportal.uika-bogor.ac.id').replace(/\/+$/, '');
const SSO_API_URL = RAW_SSO_URL.endsWith('/api') ? RAW_SSO_URL : `${RAW_SSO_URL}/api`;
const EPORTAL_FRONTEND_URL = (process.env.EPORTAL_FRONTEND_URL || RAW_SSO_URL.replace(/\/api$/, '')).replace(/\/+$/, '');
const SSO_CLIENT_ID = process.env.SSO_CLIENT_ID || '';
const SSO_CLIENT_SECRET = process.env.SSO_CLIENT_SECRET || '';
const SSO_APP_MODULE_ID = process.env.SSO_APP_MODULE_ID || '';

/**
 * Mencari atau mendaftarkan prodi berdasarkan unit dari SSO.
 */
async function resolveProdiFromUnit(unitName, unitCode) {
  if (!unitName && !unitCode) return null;
  const nameStr = String(unitName || '').trim();
  const codeStr = String(unitCode || '').trim();

  try {
    const q = `
      SELECT id FROM prodi
      WHERE (nama IS NOT NULL AND lower(nama) = lower($1))
         OR (kode IS NOT NULL AND lower(kode) = lower($2))
         OR ($1 <> '' AND nama IS NOT NULL AND lower(nama) LIKE '%' || lower($1) || '%')
      ORDER BY (lower(nama) = lower($1)) DESC, (lower(kode) = lower($2)) DESC
      LIMIT 1
    `;
    const { rows } = await pool.query(q, [nameStr, codeStr]);
    if (rows.length > 0) return rows[0].id;

    // Otomatis buat prodi baru jika belum terdaftar
    const namaProdi = nameStr || codeStr;
    let kodeProdi = (codeStr || nameStr)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 30);
    if (!kodeProdi) kodeProdi = 'unit-' + Date.now().toString(36);

    const ins = await pool.query(
      `INSERT INTO prodi (kode, nama) VALUES ($1, $2)
       ON CONFLICT (kode) DO UPDATE SET nama = EXCLUDED.nama
       RETURNING id`,
      [kodeProdi, namaProdi]
    );
    return ins.rows[0]?.id || null;
  } catch (err) {
    console.error('[SSO] Gagal resolve prodi:', err.message);
    const fallback = await pool.query('SELECT id FROM prodi LIMIT 1');
    return fallback.rows[0]?.id || null;
  }
}

/**
 * Sinkronisasi data user dari SSO E-Portal ke tabel pengguna lokal.
 */
async function syncSsoUser(ssoUser, ssoAccess) {
  const ssoId = ssoUser?.sso_id ? String(ssoUser.sso_id) : null;
  if (!ssoId) throw new Error('Data SSO tidak memiliki sso_id valid.');

  const roleName = String(ssoAccess?.role_name || ssoUser.institutional_role || ssoUser.role || '').toLowerCase();
  const perms = Array.isArray(ssoAccess?.permissions) ? ssoAccess.permissions : [];
  const isAdmin = roleName === 'admin' || roleName === 'super-admin' || perms.includes('poster.admin') || perms.includes('*');
  const peran = isAdmin ? 'admin' : 'tu';

  const unitName = ssoAccess?.unit_name || ssoUser.unit_name || '';
  const unitCode = ssoAccess?.unit_code || ssoUser.unit_code || '';
  const prodiId = isAdmin ? null : await resolveProdiFromUnit(unitName, unitCode);

  const email = ssoUser.email ? String(ssoUser.email).trim().toLowerCase() : null;
  const nama = ssoUser.name || ssoUser.email || 'Pengguna E-Portal';
  const nidn = ssoUser.nidn ? String(ssoUser.nidn) : null;
  const npm = ssoUser.npm ? String(ssoUser.npm) : null;

  // 1. Cari berdasarkan sso_id
  let user = (await pool.query('SELECT * FROM pengguna WHERE sso_id = $1', [ssoId])).rows[0];

  // 2. Jika belum pernah login SSO, cari berdasarkan email atau username
  if (!user && email) {
    user = (await pool.query('SELECT * FROM pengguna WHERE lower(email) = $1 OR lower(username) = $1', [email])).rows[0];
  }

  if (user) {
    const finalPeran = user.peran === 'admin' ? 'admin' : peran;
    const finalProdiId = finalPeran === 'admin' ? null : (prodiId || user.prodi_id);
    const updateRes = await pool.query(
      `UPDATE pengguna
       SET sso_id = $1,
           nama = $2,
           peran = $3,
           prodi_id = $4,
           email = COALESCE($5, email),
           nidn = COALESCE($6, nidn),
           npm = COALESCE($7, npm),
           aktif = TRUE
       WHERE id = $8
       RETURNING *`,
      [ssoId, nama, finalPeran, finalProdiId, email, nidn, npm, user.id]
    );
    return updateRes.rows[0];
  }

  // 3. User baru
  let baseUsername = email || nidn || npm || ('sso_' + ssoId.slice(0, 8));
  let username = baseUsername;
  let counter = 1;
  while ((await pool.query('SELECT 1 FROM pengguna WHERE lower(username) = lower($1)', [username])).rowCount > 0) {
    username = `${baseUsername}_${counter++}`;
  }

  const dummyHash = await hashSandi(crypto.randomBytes(24).toString('hex'));
  const insertRes = await pool.query(
    `INSERT INTO pengguna (username, nama, sandi, peran, prodi_id, aktif, sandi_default, sso_id, email, nidn, npm)
     VALUES ($1, $2, $3, $4, $5, TRUE, FALSE, $6, $7, $8, $9)
     RETURNING *`,
    [username, nama, dummyHash, peran, prodiId, ssoId, email, nidn, npm]
  );
  return insertRes.rows[0];
}

/**
 * Validasi dan introspeksi token ke API SSO E-Portal UIKA.
 */
async function introspectToken(token, appModuleId) {
  const modId = appModuleId || SSO_APP_MODULE_ID;
  const url = `${SSO_API_URL}/sso/introspect${modId ? `?appModule_id=${encodeURIComponent(modId)}` : ''}`;
  const res = await axios.post(
    url,
    {},
    {
      headers: {
        'X-SSO-Client-ID': SSO_CLIENT_ID,
        'X-SSO-Client-Secret': SSO_CLIENT_SECRET,
        'Authorization': `Bearer ${token}`,
      },
      timeout: 10000,
    }
  );
  return res.data;
}

function routes(router, wrap) {
  // Callback endpoint yang dipanggil setelah user redirect dari E-Portal
  router.get('/sso/callback', wrap(async (req, res) => {
    const prefix = getPrefix(req);
    const { token, role_id, appModule_id, error } = req.query;

    if (error) {
      return res.redirect(`${prefix}/login.html?error=${encodeURIComponent('Login SSO dibatalkan: ' + error)}`);
    }

    const ssoToken = token || parseCookies(req).uika_sso_token;
    if (!ssoToken) {
      return res.redirect(`${prefix}/login.html?error=${encodeURIComponent('Token SSO tidak ditemukan.')}`);
    }

    if (!SSO_CLIENT_ID || !SSO_CLIENT_SECRET) {
      console.warn('[SSO] SSO_CLIENT_ID atau SSO_CLIENT_SECRET belum dikonfigurasi.');
      return res.redirect(`${prefix}/login.html?error=${encodeURIComponent('Kredensial SSO E-Portal belum dikonfigurasi di server.')}`);
    }

    try {
      const data = await introspectToken(ssoToken, appModule_id || SSO_APP_MODULE_ID);
      if (!data || !data.valid) {
        return res.redirect(`${prefix}/login.html?error=${encodeURIComponent(data?.message || 'Token SSO tidak valid atau sudah kedaluwarsa.')}`);
      }

      if (data.access && data.access.has_access === false) {
        return res.redirect(`${prefix}/login.html?error=${encodeURIComponent('Akun Anda tidak memiliki hak akses ke modul Poster Penelitian.')}`);
      }

      const user = await syncSsoUser(data.user, data.access);
      await buatSesi(res, user.id);

      return res.redirect(`${prefix}/`);
    } catch (err) {
      const errMsg = err.response?.data?.message || err.message || 'Gagal memverifikasi token ke E-Portal SSO.';
      console.error('[SSO Callback Error]', errMsg);
      return res.redirect(`${prefix}/login.html?error=${encodeURIComponent(errMsg)}`);
    }
  }));

  // Login shortcut: redirect ke portal atau login otomatis jika cookie SSO sudah ada
  router.get('/sso/login', wrap(async (req, res) => {
    const prefix = getPrefix(req);
    if (req.user) return res.redirect(`${prefix}/`);

    const ssoCookie = parseCookies(req).uika_sso_token;
    if (ssoCookie && SSO_CLIENT_ID && SSO_CLIENT_SECRET) {
      try {
        const data = await introspectToken(ssoCookie, SSO_APP_MODULE_ID);
        if (data && data.valid && (!data.access || data.access.has_access !== false)) {
          const user = await syncSsoUser(data.user, data.access);
          await buatSesi(res, user.id);
          return res.redirect(`${prefix}/`);
        }
      } catch (e) {
        // Abaikan galat cookie kadaluarsa dan lanjutkan redirect ke portal
      }
    }

    return res.redirect(EPORTAL_FRONTEND_URL);
  }));

  // Status integrasi SSO
  router.get('/api/sso/status', (req, res) => {
    res.json({
      enabled: Boolean(SSO_CLIENT_ID && SSO_CLIENT_SECRET),
      portal_url: EPORTAL_FRONTEND_URL,
      app_module_id: SSO_APP_MODULE_ID || null
    });
  });
}

module.exports = { routes, introspectToken, syncSsoUser, resolveProdiFromUnit };
