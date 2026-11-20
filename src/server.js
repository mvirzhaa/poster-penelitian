require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const sharp = require('sharp');
const { ZipArchive } = require('archiver');
const { pool, migrate } = require('./db');
const { FORMATS, renderPoster, clearCache, closeBrowser, pixelSize, resolveDpi, nilaiKualitas } = require('./render');
const { posterHtml, THEMES, esc, ringkas } = require('./templates');
const A = require('./auth');
const webhooks = require('./webhooks');
const journey = require('./journey');
const apiv1 = require('./apiv1');
const sso = require('./sso');

const { httpError } = A;
const PORT = parseInt(process.env.PORT || '3000', 10);
const ROOT = path.join(__dirname, '..');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const PUBLIC_BASE = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
const BASE_PATH = (process.env.BASE_PATH || (PUBLIC_BASE ? new URL(PUBLIC_BASE).pathname.replace(/\/+$/, '') : '')).replace(/\/+$/, '');
const INTERNAL = `http://127.0.0.1:${PORT}`;
const baseOf = req => PUBLIC_BASE || `${req.protocol}://${req.get('host')}`;
const baseFallback = () => PUBLIC_BASE || INTERNAL;

const TEXT_FIELDS = ['judul', 'subjudul', 'institusi', 'unit', 'tahun', 'peneliti_nama', 'peneliti_info',
  'abstrak', 'anggaran', 'sumber_anggaran', 'ucapan', 'kontak', 'url_qr', 'tema'];
const { ELEMEN, bacaTampil, petaTampil } = require('./tampil');
const JSON_FIELDS = ['anggota_peneliti', 'output_penelitian', 'tampil'];   // disimpan sebagai JSONB
const FIELDS = [...TEXT_FIELDS, ...JSON_FIELDS];
const MAX_LEN = { judul: 300, subjudul: 300, abstrak: 2500, anggaran: 80, sumber_anggaran: 150, ucapan: 1000, kontak: 500, url_qr: 500 };
const MAX_ANGGOTA = 5;
const OUTPUT_PENELITIAN = ['Scopus Q1', 'Scopus Q2', 'Scopus Q3', 'Scopus Q4', 'Sinta 1', 'Sinta 2', 'Sinta 3', 'Sinta 4',
  'Seminar Internasional', 'Seminar Nasional', 'Paten Sederhana', 'HKI', 'Buku', 'Teknologi Purwarupa', 'Kebijakan', 'Karya Monumental'];
const MAX_FOTO = 8;

// Syarat minimal resolusi foto (piksel) agar tidak pecah saat dicetak. Dipakai juga oleh formulir (/api/syarat-foto).
const SYARAT_FOTO = {
  peneliti: { label: 'Foto peneliti', panjang: 800, pendek: 800, ideal: '1200 × 1200 px atau lebih' },
  kegiatan: { label: 'Foto produk/kegiatan', panjang: 1600, pendek: 800, ideal: 'foto pertama ≥ 2400 px sisi terpanjang, foto lain ≥ 1600 px (kamera ponsel 8 MP ke atas sudah cukup)' },
  logo: { label: 'Logo', panjang: 600, pendek: 100, ideal: '1000 px atau lebih (PNG transparan)' },
  standar_cetak: { a2: '150 dpi', xbanner: '100 dpi' },
};

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? true : process.env.TRUST_PROXY);
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(A.sameOrigin);
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
app.use(wrap(A.loadUser));

function sendHtml(res, filename, req) {
  const filePath = path.join(ROOT, 'public', filename);
  let html = fs.readFileSync(filePath, 'utf8');
  const prefix = (req ? (req.baseUrl || req.get('x-forwarded-prefix') || '') : '') || BASE_PATH;
  if (prefix) {
    const inject = `<base href="${prefix}/"><script>window.__BASE__='${prefix}';</script>`;
    if (!html.includes('window.__BASE__')) {
      html = html.replace('<head>', `<head>\n${inject}`);
    }
  }
  res.type('html').send(html);
}

const router = express.Router();

// ---------- Berkas statis & halaman ----------
router.use('/assets', express.static(path.join(ROOT, 'public', 'assets')));
router.use('/fonts', express.static(path.join(ROOT, 'node_modules', '@fontsource', 'inter', 'files'), { maxAge: '30d' }));
router.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d', index: false }));
router.get('/favicon.ico', (req, res) => res.status(204).end());
router.get('/login.html', (req, res) => sendHtml(res, 'login.html', req));
router.get(['/', '/index.html'], A.requirePage, (req, res) => sendHtml(res, 'index.html', req));
router.get('/form.html', A.requirePage, (req, res) => sendHtml(res, 'form.html', req));
router.get('/sponsor.html', A.requirePage, (req, res) => sendHtml(res, 'sponsor.html', req));
router.get('/admin.html', A.requireAdminPage, (req, res) => sendHtml(res, 'admin.html', req));

A.routes(router, wrap);
sso.routes(router, wrap);
require('./admin')(router, wrap);
router.get('/api/syarat-foto', A.requireLogin, (req, res) => res.json(SYARAT_FOTO));
router.get('/api/tema', A.requireLogin, (req, res) => res.json(Object.entries(THEMES).map(([id, t]) => ({ id, ...t }))));

// ---------- Unggah foto ----------
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 12 } })
  .fields([{ name: 'foto_peneliti', maxCount: 1 }, { name: 'logo', maxCount: 1 }, { name: 'foto_kegiatan', maxCount: MAX_FOTO }]);

async function saveImage(file, jenis, { max = 3200, png = false, square = 0 } = {}) {
  const buf = file.buffer, syarat = SYARAT_FOTO[jenis];
  let meta;
  try { meta = await sharp(buf, { failOn: 'none' }).metadata(); }
  catch { throw httpError(400, 'Berkas bukan gambar yang valid (gunakan JPG, PNG, atau WebP).'); }
  if (!meta.width) throw httpError(400, 'Berkas bukan gambar yang valid (gunakan JPG, PNG, atau WebP).');
  let w = meta.width, h = meta.height;
  if (meta.orientation >= 5) [w, h] = [h, w];
  if (Math.max(w, h) < syarat.panjang || Math.min(w, h) < syarat.pendek) {
    throw httpError(400, `${syarat.label} "${file.originalname}" terlalu kecil (${w}×${h} px). Minimal sisi terpanjang ${syarat.panjang} px dan sisi terpendek ${syarat.pendek} px agar tidak pecah saat dicetak.`);
  }
  const name = crypto.randomBytes(9).toString('hex') + (png ? '.png' : '.jpg');
  let img = sharp(buf, { failOn: 'none' }).rotate();
  img = square
    ? img.resize(square, square, { fit: 'cover', position: sharp.strategy.attention })
    : img.resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true });
  img = png ? img.png() : img.flatten({ background: '#ffffff' }).jpeg({ quality: 90 });
  await img.toFile(path.join(UPLOAD_DIR, name));
  return name;
}
const rmUpload = name => { if (name) fs.rm(path.join(UPLOAD_DIR, path.basename(name)), { force: true }, () => {}); };
const arr = v => (v === undefined ? [] : [].concat(v));

function readFields(body) {
  const out = {};
  for (const k of TEXT_FIELDS) out[k] = String(body[k] ?? '').replace(/\r\n/g, '\n').trim();
  for (const [k, max] of Object.entries(MAX_LEN)) {
    if (out[k].length > max) throw httpError(400, `Isian "${k}" terlalu panjang (maks ${max} karakter).`);
  }
  // Anggota peneliti: JSON [{nama, ref}], maks 5; ref hanya untuk dosen yang dipilih dari Journey
  let ang = body.anggota_peneliti;
  if (typeof ang === 'string') { try { ang = JSON.parse(ang); } catch { throw httpError(400, 'Format anggota peneliti tidak valid.'); } }
  ang = (Array.isArray(ang) ? ang : []).map(x => ({ nama: String(x?.nama || '').trim().slice(0, 150), ref: String(x?.ref || '').trim() }))
    .filter(x => x.nama).map(x => ({ nama: x.nama, ref: /^[A-Za-z0-9_.-]{1,150}$/.test(x.ref) ? x.ref : '' }));
  if (ang.length > MAX_ANGGOTA) throw httpError(400, `Anggota peneliti maksimal ${MAX_ANGGOTA} orang.`);
  out.anggota_peneliti = JSON.stringify(ang);
  const outp = [].concat(body.output_penelitian === undefined ? [] : body.output_penelitian).map(String);
  out.output_penelitian = JSON.stringify(OUTPUT_PENELITIAN.filter(o => outp.includes(o))); // urutan baku, hanya nilai yang dikenal
  const tp = bacaTampil(body);
  out.tampil = tp ? JSON.stringify(tp) : undefined;   // undefined = tidak dikirim (insert -> bawaan, update -> tidak diubah)
  if (!out.judul) throw httpError(400, 'Judul penelitian wajib diisi.');
  if (!out.peneliti_nama) throw httpError(400, 'Nama peneliti wajib diisi.');
  if (!THEMES[out.tema]) out.tema = 'biru';
  if (out.url_qr && !/^https?:\/\//i.test(out.url_qr)) out.url_qr = 'https://' + out.url_qr;
  return out;
}

async function getFull(slug) {
  const { rows } = await pool.query(`SELECT p.*, pr.nama AS prodi_nama, pr.kode AS prodi_kode
    FROM penelitian p LEFT JOIN prodi pr ON pr.id=p.prodi_id WHERE p.slug=$1`, [slug]);
  if (!rows[0]) return null;
  const f = await pool.query('SELECT id,file,keterangan,urutan FROM foto_penelitian WHERE penelitian_id=$1 ORDER BY urutan,id', [rows[0].id]);
  const sp = await pool.query(`SELECT s.id, s.nama, s.file, ps.posisi FROM penelitian_sponsor ps JOIN sponsor s ON s.id=ps.sponsor_id
    WHERE ps.penelitian_id=$1 ORDER BY ps.posisi, ps.urutan, s.id`, [rows[0].id]);
  return { ...rows[0], foto: f.rows, sponsor: sp.rows };
}

// ---------- Logo sponsor ----------
const MAX_SPONSOR_POS = 3;
const sponsorTerlihat = (u, s) => u.peran === 'admin' || s.prodi_id == null || s.prodi_id === u.prodi_id;
const sponsorBoleh = (u, s) => u.peran === 'admin' || (s.prodi_id != null && s.prodi_id === u.prodi_id);

// Ganti tautan sponsor milik satu penelitian (di dalam transaksi). Hanya sponsor yang terlihat oleh pengguna.
async function simpanSponsor(client, penelitianId, body, user) {
  if (!body.sponsor_form) return;
  const ids = [...new Set(arr(body.sponsor_id).map(Number).filter(Boolean))];
  const { rows } = ids.length ? await client.query('SELECT id,prodi_id FROM sponsor WHERE id = ANY($1)', [ids]) : { rows: [] };
  const hitung = { kiri_atas: 0, kanan_bawah: 0 };
  await client.query('DELETE FROM penelitian_sponsor WHERE penelitian_id=$1', [penelitianId]);
  let urutan = 0;
  for (const id of ids) {
    const sp = rows.find(x => x.id === id);
    if (!sp || !sponsorTerlihat(user, sp)) continue;
    const posisi = body['sponsor_pos_' + id] === 'kiri_atas' ? 'kiri_atas' : 'kanan_bawah';
    if (++hitung[posisi] > MAX_SPONSOR_POS) throw httpError(400, `Maksimal ${MAX_SPONSOR_POS} logo sponsor per posisi.`);
    await client.query('INSERT INTO penelitian_sponsor (penelitian_id,sponsor_id,posisi,urutan) VALUES ($1,$2,$3,$4)', [penelitianId, id, posisi, urutan++]);
  }
}

// Setelah sponsor diubah, poster yang memakainya harus dibuat ulang.
async function segarkanPoster(sponsorId) {
  const { rows } = await pool.query(`UPDATE penelitian SET updated_at=now() WHERE id IN (SELECT penelitian_id FROM penelitian_sponsor WHERE sponsor_id=$1) RETURNING slug`, [sponsorId]);
  rows.forEach(r => clearCache(r.slug));
}

// ---------- Hak akses: staf TU hanya data prodinya; admin semua ----------
const canAccess = (u, r) => u.peran === 'admin' || (r.prodi_id != null && r.prodi_id === u.prodi_id);
async function getOwned(req) {
  const r = await getFull(req.params.slug);
  if (!r) throw httpError(404, 'Data tidak ditemukan');
  if (!canAccess(req.user, r)) throw httpError(403, 'Anda tidak berhak mengakses data prodi lain.');
  return r;
}
async function resolveProdi(req) {
  if (req.user.peran !== 'admin') {
    if (!req.user.prodi_id) throw httpError(403, 'Akun Anda belum dikaitkan dengan prodi. Hubungi admin.');
    return req.user.prodi_id;
  }
  const id = parseInt(req.body.prodi_id, 10);
  const { rowCount } = await pool.query('SELECT 1 FROM prodi WHERE id=$1', [id || 0]);
  if (!rowCount) throw httpError(400, 'Pilih prodi untuk data penelitian ini.');
  return id;
}

// ---------- API data penelitian ----------
router.use('/api/penelitian', A.requireLogin);

router.get('/api/penelitian', wrap(async (req, res) => {
  const admin = req.user.peran === 'admin';
  const prodi = admin ? (parseInt(req.query.prodi, 10) || null) : (req.user.prodi_id || -1);
  const q = String(req.query.q || '').trim();
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 12));
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const { rows } = await pool.query(`
    SELECT p.slug, p.judul, p.peneliti_nama, p.anggota_peneliti, p.tema, p.updated_at, p.foto_peneliti,
      pr.nama AS prodi_nama, u.nama AS diubah_oleh_nama,
      (SELECT file FROM foto_penelitian f WHERE f.penelitian_id=p.id ORDER BY urutan,id LIMIT 1) AS foto_utama,
      (SELECT count(*)::int FROM foto_penelitian f WHERE f.penelitian_id=p.id) AS jml_foto,
      count(*) OVER() AS total
    FROM penelitian p LEFT JOIN prodi pr ON pr.id=p.prodi_id LEFT JOIN pengguna u ON u.id=COALESCE(p.diubah_oleh,p.dibuat_oleh)
    WHERE ($1::int IS NULL OR p.prodi_id=$1)
      AND ($2='' OR p.judul ILIKE $3 OR p.peneliti_nama ILIKE $3 OR p.anggota_peneliti::text ILIKE $3)
    ORDER BY p.updated_at DESC LIMIT $4 OFFSET $5`, [prodi, q, `%${q}%`, limit, (page - 1) * limit]);
  res.json({ total: rows[0] ? Number(rows[0].total) : 0, halaman: page, per_halaman: limit, data: rows.map(({ total, ...x }) => x) });
}));

router.get('/api/penelitian/:slug', wrap(async (req, res) => res.json(await getOwned(req))));

router.post('/api/penelitian', upload, wrap(async (req, res) => {
  const f = readFields(req.body);
  if (f.tampil === undefined) f.tampil = JSON.stringify(petaTampil({}));
  const prodiId = await resolveProdi(req);
  const files = req.files || {};
  const slug = crypto.randomBytes(6).toString('base64url');
  const saved = [];
  const client = await pool.connect();
  try {
    const fotoPeneliti = files.foto_peneliti?.[0] ? await saveImage(files.foto_peneliti[0], 'peneliti', { square: 1200 }) : null;
    if (fotoPeneliti) saved.push(fotoPeneliti);
    const logo = files.logo?.[0] ? await saveImage(files.logo[0], 'logo', { max: 1200, png: true }) : null;
    if (logo) saved.push(logo);
    const cols = [...FIELDS, 'slug', 'foto_peneliti', 'logo', 'prodi_id', 'dibuat_oleh', 'diubah_oleh'];
    const vals = [...FIELDS.map(k => f[k]), slug, fotoPeneliti, logo, prodiId, req.user.id, req.user.id];
    await client.query('BEGIN');
    const ins = await client.query(
      `INSERT INTO penelitian (${cols.join(',')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING id`, vals);
    const kets = arr(req.body.ket_baru);
    let i = 0;
    for (const file of (files.foto_kegiatan || []).slice(0, MAX_FOTO)) {
      const name = await saveImage(file, 'kegiatan');
      saved.push(name);
      await client.query('INSERT INTO foto_penelitian (penelitian_id,file,keterangan,urutan) VALUES ($1,$2,$3,$4)',
        [ins.rows[0].id, name, String(kets[i] || '').trim().slice(0, 200), i]);
      i++;
    }
    await simpanSponsor(client, ins.rows[0].id, req.body, req.user);
    await client.query('COMMIT');
    res.status(201).json({ slug });
    getFull(slug).then(r => { if (r) { webhooks.dispatch('penelitian.dibuat', r, baseOf(req)); journey.sinkron(r, renderRow, baseOf(req)); } });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    saved.forEach(rmUpload);
    throw e;
  } finally { client.release(); }
}));

router.put('/api/penelitian/:slug', upload, wrap(async (req, res) => {
  const cur = await getOwned(req);
  const f = readFields(req.body);
  if (f.tampil === undefined) f.tampil = JSON.stringify(petaTampil(cur.tampil));
  const prodiId = req.user.peran === 'admin' ? await resolveProdi(req) : cur.prodi_id;
  const files = req.files || {};
  const newFiles = [], oldToRemove = [];
  const client = await pool.connect();
  try {
    let fotoPeneliti = cur.foto_peneliti, logo = cur.logo;
    if (files.foto_peneliti?.[0]) {
      fotoPeneliti = await saveImage(files.foto_peneliti[0], 'peneliti', { square: 1200 });
      newFiles.push(fotoPeneliti); oldToRemove.push(cur.foto_peneliti);
    } else if (req.body.hapus_foto_peneliti) { fotoPeneliti = null; oldToRemove.push(cur.foto_peneliti); }
    if (files.logo?.[0]) {
      logo = await saveImage(files.logo[0], 'logo', { max: 1200, png: true });
      newFiles.push(logo); oldToRemove.push(cur.logo);
    } else if (req.body.hapus_logo) { logo = null; oldToRemove.push(cur.logo); }

    await client.query('BEGIN');
    const sets = [...FIELDS, 'foto_peneliti', 'logo', 'prodi_id', 'diubah_oleh'];
    await client.query(
      `UPDATE penelitian SET ${sets.map((k, i) => `${k}=$${i + 1}`).join(',')}, updated_at=now() WHERE id=$${sets.length + 1}`,
      [...FIELDS.map(k => f[k]), fotoPeneliti, logo, prodiId, req.user.id, cur.id]);

    const hapus = new Set(arr(req.body.hapus_foto).map(Number));
    for (const ft of cur.foto) {
      if (hapus.has(ft.id)) {
        await client.query('DELETE FROM foto_penelitian WHERE id=$1', [ft.id]);
        oldToRemove.push(ft.file);
      } else {
        await client.query('UPDATE foto_penelitian SET keterangan=$1 WHERE id=$2',
          [String(req.body['ket_' + ft.id] ?? ft.keterangan).trim().slice(0, 200), ft.id]);
      }
    }
    const sisa = cur.foto.filter(ft => !hapus.has(ft.id)).length;
    const kets = arr(req.body.ket_baru);
    let urutan = cur.foto.reduce((m, ft) => Math.max(m, ft.urutan), -1) + 1, i = 0;
    for (const file of (files.foto_kegiatan || [])) {
      if (sisa + i >= MAX_FOTO) break;
      const name = await saveImage(file, 'kegiatan');
      newFiles.push(name);
      await client.query('INSERT INTO foto_penelitian (penelitian_id,file,keterangan,urutan) VALUES ($1,$2,$3,$4)',
        [cur.id, name, String(kets[i] || '').trim().slice(0, 200), urutan++]);
      i++;
    }
    await simpanSponsor(client, cur.id, req.body, req.user);
    await client.query('COMMIT');
    oldToRemove.forEach(rmUpload);
    clearCache(cur.slug);
    res.json({ slug: cur.slug });
    getFull(cur.slug).then(r => { if (r) { webhooks.dispatch('penelitian.diperbarui', r, baseOf(req)); journey.sinkron(r, renderRow, baseOf(req)); } });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    newFiles.forEach(rmUpload);
    throw e;
  } finally { client.release(); }
}));

router.delete('/api/penelitian/:slug', wrap(async (req, res) => {
  const cur = await getOwned(req);
  await pool.query('DELETE FROM penelitian WHERE id=$1', [cur.id]);
  [cur.foto_peneliti, cur.logo, ...cur.foto.map(x => x.file)].forEach(rmUpload);
  clearCache(cur.slug);
  res.json({ ok: true });
  webhooks.dispatch('penelitian.dihapus', cur, baseOf(req));
  journey.hapus(cur.slug);
}));

// ---------- API pustaka logo sponsor ----------
const uploadLogo = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } }).single('logo');
router.use('/api/sponsor', A.requireLogin);

router.get('/api/sponsor', wrap(async (req, res) => {
  const { rows } = await pool.query(`SELECT s.id, s.nama, s.file, s.prodi_id, pr.nama AS prodi_nama,
      (SELECT count(*)::int FROM penelitian_sponsor ps WHERE ps.sponsor_id=s.id) AS dipakai
    FROM sponsor s LEFT JOIN prodi pr ON pr.id=s.prodi_id
    WHERE ($1::boolean OR s.prodi_id IS NULL OR s.prodi_id=$2) ORDER BY s.nama`, [req.user.peran === 'admin', req.user.prodi_id]);
  res.json(rows.map(x => ({ ...x, boleh_ubah: sponsorBoleh(req.user, x) })));
}));

router.post('/api/sponsor', uploadLogo, wrap(async (req, res) => {
  const nama = String(req.body.nama || '').trim().slice(0, 100);
  if (!nama) throw httpError(400, 'Nama sponsor wajib diisi.');
  if (!req.file) throw httpError(400, 'Pilih berkas logo sponsor.');
  let prodiId;
  if (req.user.peran === 'admin') {
    prodiId = req.body.umum ? null : (parseInt(req.body.prodi_id, 10) || null);
    if (!req.body.umum && !prodiId) throw httpError(400, 'Pilih prodi pemilik logo, atau centang "umum".');
  } else {
    if (!req.user.prodi_id) throw httpError(403, 'Akun Anda belum dikaitkan dengan prodi.');
    prodiId = req.user.prodi_id;
  }
  const file = await saveImage(req.file, 'logo', { max: 1600, png: true });
  const { rows } = await pool.query('INSERT INTO sponsor (nama,file,prodi_id,dibuat_oleh) VALUES ($1,$2,$3,$4) RETURNING id', [nama, file, prodiId, req.user.id]);
  res.status(201).json({ id: rows[0].id });
}));

async function getSponsorBoleh(req) {
  const { rows } = await pool.query('SELECT * FROM sponsor WHERE id=$1', [parseInt(req.params.id, 10) || 0]);
  if (!rows[0]) throw httpError(404, 'Sponsor tidak ditemukan');
  if (!sponsorBoleh(req.user, rows[0])) throw httpError(403, rows[0].prodi_id == null ? 'Logo umum hanya dapat diubah admin.' : 'Anda tidak berhak mengubah logo prodi lain.');
  return rows[0];
}

router.put('/api/sponsor/:id', uploadLogo, wrap(async (req, res) => {
  const sp = await getSponsorBoleh(req);
  const nama = String(req.body.nama || '').trim().slice(0, 100) || sp.nama;
  const file = req.file ? await saveImage(req.file, 'logo', { max: 1600, png: true }) : sp.file;
  await pool.query('UPDATE sponsor SET nama=$1, file=$2 WHERE id=$3', [nama, file, sp.id]);
  if (req.file) rmUpload(sp.file);
  await segarkanPoster(sp.id);
  res.json({ ok: true });
}));

router.delete('/api/sponsor/:id', wrap(async (req, res) => {
  const sp = await getSponsorBoleh(req);
  await segarkanPoster(sp.id);                       // sebelum tautan ikut terhapus
  await pool.query('DELETE FROM sponsor WHERE id=$1', [sp.id]);
  rmUpload(sp.file);
  res.json({ ok: true });
}));

// Kirim berkas poster ke aplikasi lain (tujuan dikelola admin di halaman Admin).
router.get('/api/webhook-tujuan', A.requireLogin, wrap(async (req, res) => {
  const { rows } = await pool.query(`SELECT id,nama FROM webhook WHERE aktif AND ($1::int IS NULL OR prodi_id IS NULL OR prodi_id=$1) ORDER BY nama`,
    [req.user.peran === 'admin' ? null : req.user.prodi_id]);
  res.json(rows);
}));
router.post('/api/penelitian/:slug/kirim', wrap(async (req, res) => {
  const row = await getOwned(req);
  const hasil = await apiv1.kirimKe(row, req.body, req.user.peran === 'admin' ? null : req.user.prodi_id, baseOf(req), renderRow);
  res.status(hasil.ok ? 200 : 502).json(hasil);
}));

// Opsi isian untuk form (output penelitian, batas anggota)
router.get('/api/opsi', A.requireLogin, (req, res) => res.json({ output_penelitian: OUTPUT_PENELITIAN, maks_anggota: MAX_ANGGOTA, elemen: ELEMEN }));

// ---------- Integrasi Journey ----------
// Cari dosen di database Journey untuk kolom pembimbing (pembimbing luar UIKA tetap boleh diketik manual).
router.get('/api/dosen', A.requireLogin, wrap(async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 80);
    res.json(await journey.cariDosen(q));
  } catch (e) { res.json({ aktif: true, data: [], pesan: 'Journey tidak dapat dihubungi: ' + e.message }); }
}));
router.post('/api/penelitian/:slug/sinkron-journey', A.requireLogin, wrap(async (req, res) => {
  const row = await getOwned(req);
  const r = await getFull(row.slug);
  const hasil = await journey.sinkron(r, renderRow, baseOf(req));
  res.status(hasil.ok ? 200 : 502).json(hasil);
}));

// ---------- Poster (HTML internal -> gambar) ----------
const renderRow = (r, fmt, ext, dpi) => renderPoster({
  slug: r.slug, version: new Date(r.updated_at).getTime(), fmt, ext, dpiParam: dpi, baseUrl: INTERNAL,
});

router.get('/poster-html/:slug/:fmt', wrap(async (req, res) => {
  const r = await getFull(req.params.slug);
  const f = FORMATS[req.params.fmt];
  if (!r || !f) throw httpError(404, 'Tidak ditemukan');
  const inPerPx = f.mm ? f.mm[0] / 25.4 / f.w : 0;
  res.set('Cache-Control', 'no-store').type('html').send(await posterHtml(r, r.foto, req.params.fmt, { baseUrl: PUBLIC_BASE, inPerPx }));
}));

const slugify = s => String(s).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 50) || 'poster';

// Paket semua ukuran cetak dalam satu ZIP
router.get('/img/:slug/semua.zip', wrap(async (req, res) => {
  const r = await getFull(req.params.slug);
  if (!r) throw httpError(404, 'Data tidak ditemukan');
  const paket = [['a2', 'pdf'], ['a2', 'png'], ['xbanner', 'pdf'], ['xbanner', 'png'], ['share', 'png']];
  const hasil = [];
  for (const [fmt, ext] of paket) hasil.push({ fmt, ext, out: await renderRow(r, fmt, ext, null) });
  res.attachment(`poster-${slugify(r.judul)}.zip`);
  const zip = new ZipArchive({ zlib: { level: 3 } });
  zip.on('error', () => res.end());
  zip.pipe(res);
  for (const { fmt, ext, out } of hasil) zip.file(out.file, { name: `${fmt}/poster-${fmt}-${r.slug}.${ext}` });
  zip.append([
    `Poster: ${r.judul}`, '',
    'a2/       Poster A2 (42 x 59,4 cm). Cetak dari PDF; PNG = 150 dpi.',
    'xbanner/  X-Banner (60 x 160 cm). Cetak dari PDF; PNG = 100 dpi. 20 cm bagian bawah sengaja kosong (tertutup dudukan banner).',
    'share/    Gambar 1080 x 1350 px untuk WhatsApp/Instagram.', '',
  ].join('\r\n'), { name: 'BACA-SAYA.txt' });
  await zip.finalize();
}));

// /img/<slug>/<format>.<png|jpg|pdf>?dpi=..&unduh=1
router.get('/img/:slug/:file', wrap(async (req, res) => {
  const m = /^(\w+)\.(png|jpg|pdf)$/.exec(req.params.file);
  if (!m) throw httpError(404, 'Tidak ditemukan');
  const r = await getFull(req.params.slug);
  if (!r) throw httpError(404, 'Data tidak ditemukan');
  const [, fmt, ext] = m;
  const out = await renderRow(r, fmt, ext, req.query.dpi);
  const kual = nilaiKualitas(fmt, out.info.kualitas);
  res.set({
    'X-Teks-Skala': String(out.info.skala ?? 1),
    'X-Teks-Meluap': out.info.overflow ? '1' : '0',
    ...(kual ? { 'X-Kualitas': encodeURIComponent(JSON.stringify(kual)) } : {}),
    'Access-Control-Expose-Headers': 'X-Teks-Skala, X-Teks-Meluap, X-Kualitas',
    'Cache-Control': 'no-cache',
  });
  if (req.query.unduh) res.attachment(`poster-${fmt}-${slugify(r.judul)}.${ext}`);
  res.type(out.mime).sendFile(out.file);
}));

// ---------- Halaman bagikan (publik) ----------
router.get('/p/:slug', wrap(async (req, res) => {
  const r = await getFull(req.params.slug);
  if (!r) return res.status(404).send('Poster tidak ditemukan');
  const base = baseOf(req);
  const prefix = (req ? (req.baseUrl || req.get('x-forwarded-prefix') || '') : '') || BASE_PATH;
  const ver = new Date(r.updated_at).getTime();
  const formats = Object.fromEntries(Object.entries(FORMATS).map(([k, v]) => {
    const dpi = resolveDpi(k, null);
    return [k, { label: v.label, mm: v.mm, dpi, px: pixelSize(k, dpi), w: v.w, h: v.h, pdf: k !== 'share' }];
  }));
  const html = fs.readFileSync(path.join(ROOT, 'views', 'share.html'), 'utf8')
    .replaceAll('{{JUDUL}}', esc(r.judul))
    .replaceAll('{{DESKRIPSI}}', esc(ringkas(r.abstrak || `${r.peneliti_nama}`, 200)))
    .replaceAll('{{PENELITI}}', esc(r.peneliti_nama))
    .replaceAll('{{SLUG}}', esc(r.slug))
    .replaceAll('{{VER}}', String(ver))
    .replaceAll('{{OG_IMAGE}}', esc(`${base}/img/${r.slug}/share.jpg?v=${ver}`))
    .replaceAll('{{URL}}', esc(`${base}/p/${r.slug}`))
    .replaceAll('{{BASE_PATH}}', esc(prefix))
    .replace('{{FORMATS}}', JSON.stringify(formats).replace(/</g, '\\u003c'));
  res.type('html').send(html);
}));

// ---------- API untuk aplikasi lain (kunci API) ----------
apiv1(router, wrap, { getFull, renderRow, baseOf });

app.use(router);
if (BASE_PATH) {
  app.use(BASE_PATH, router);
}

// ---------- Galat ----------
app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan' }));
if (BASE_PATH) {
  app.use(BASE_PATH + '/api', (req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan' }));
}
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) err = httpError(400, err.code === 'LIMIT_FILE_SIZE' ? 'Ukuran foto maksimal 25 MB per berkas.' : 'Unggahan tidak valid: ' + err.message);
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Terjadi kesalahan di server: ' + err.message : err.message });
});

migrate().then(() => {
  const server = app.listen(PORT, () => console.log(`Poster Penelitian berjalan di http://localhost:${PORT}`));
  const stop = async () => { server.close(); await closeBrowser(); await pool.end(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}).catch(e => { console.error('Gagal terhubung/migrasi basis data:', e.message); process.exit(1); });
