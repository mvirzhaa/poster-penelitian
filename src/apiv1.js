const express = require('express');
const { pool } = require('./db');
const { sha, httpError } = require('./auth');
const { bersihkanNama, anggotaPeneliti } = require('./nama');
const wh = require('./webhooks');

// API untuk aplikasi lain. Autentikasi: "Authorization: Bearer pk_..." atau header "X-API-Key".
module.exports = function (app, wrap, { getFull, renderRow, baseOf }) {
  const r = express.Router();

  r.use(wrap(async (req, res, next) => {
    const h = req.headers.authorization || '';
    const key = (h.startsWith('Bearer ') ? h.slice(7) : req.headers['x-api-key'] || '').trim();
    if (!key) throw httpError(401, 'Kunci API diperlukan (header Authorization: Bearer <kunci>).');
    const { rows } = await pool.query('SELECT id,nama,prodi_id FROM kunci_api WHERE hash=$1 AND aktif', [sha(key)]);
    if (!rows[0]) throw httpError(401, 'Kunci API tidak valid atau dinonaktifkan.');
    req.apiKey = rows[0];
    pool.query('UPDATE kunci_api SET terakhir_dipakai=now() WHERE id=$1', [rows[0].id]).catch(() => {});
    next();
  }));

  const dalamLingkup = (req, row) => !req.apiKey.prodi_id || req.apiKey.prodi_id === row.prodi_id;
  async function ambil(req) {
    const row = await getFull(req.params.slug);
    if (!row || !dalamLingkup(req, row)) throw httpError(404, 'Data tidak ditemukan');
    return row;
  }

  r.get('/', (req, res) => res.json({
    nama: 'Poster Penelitian API', versi: 1,
    endpoint: [
      'GET  /api/v1/prodi',
      'GET  /api/v1/penelitian?q=&prodi=<kode>&sejak=<ISO>&page=1&limit=20',
      'GET  /api/v1/penelitian/{slug}',
      'GET  /api/v1/penelitian/{slug}/poster/{a2|xbanner|share}.{png|jpg|pdf}?dpi=',
      'GET  /api/v1/webhook',
      'POST /api/v1/penelitian/{slug}/kirim   {webhook_id, format, tipe, dpi}',
    ],
  }));

  r.get('/prodi', wrap(async (req, res) => {
    const { rows } = await pool.query('SELECT kode,nama FROM prodi WHERE ($1::int IS NULL OR id=$1) ORDER BY nama', [req.apiKey.prodi_id]);
    res.json(rows);
  }));

  r.get('/penelitian', wrap(async (req, res) => {
    const base = baseOf(req);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const q = String(req.query.q || '').trim();
    const sejak = req.query.sejak ? new Date(String(req.query.sejak)) : null;
    if (sejak && isNaN(sejak)) throw httpError(400, 'Parameter "sejak" harus berupa tanggal ISO, mis. 2026-11-01T00:00:00Z');
    const { rows } = await pool.query(`
      SELECT p.slug, p.judul, p.subjudul, p.tahun, p.peneliti_nama, p.anggota_peneliti, p.updated_at, pr.kode AS prodi_kode, pr.nama AS prodi_nama,
             count(*) OVER() AS total
      FROM penelitian p LEFT JOIN prodi pr ON pr.id=p.prodi_id
      WHERE ($1::int IS NULL OR p.prodi_id=$1)
        AND ($2='' OR pr.kode=$2)
        AND ($3='' OR p.judul ILIKE $4 OR p.peneliti_nama ILIKE $4 OR p.anggota_peneliti::text ILIKE $4)
        AND ($5::timestamptz IS NULL OR p.updated_at >= $5)
      ORDER BY p.updated_at DESC LIMIT $6 OFFSET $7`,
      [req.apiKey.prodi_id, String(req.query.prodi || '').toLowerCase(), q, `%${q}%`, sejak, limit, (page - 1) * limit]);
    res.json({
      total: rows[0] ? Number(rows[0].total) : 0, halaman: page, per_halaman: limit,
      data: rows.map(({ total, ...x }) => ({
        slug: x.slug, judul: x.judul, subjudul: x.subjudul, tahun: x.tahun, peneliti: x.peneliti_nama,
        anggota_peneliti: anggotaPeneliti(x).map(a => bersihkanNama(a.nama)),
        prodi: x.prodi_kode ? { kode: x.prodi_kode, nama: x.prodi_nama } : null,
        diperbarui: x.updated_at, halaman: `${base}/p/${x.slug}`, poster: wh.posterUrls(base, x.slug),
      })),
    });
  }));

  r.get('/penelitian/:slug', wrap(async (req, res) => {
    const row = await ambil(req);
    res.json({
      ...wh.ringkasData(row, baseOf(req)),
      isi: {
        abstrak: row.abstrak, anggaran: row.anggaran, sumber_anggaran: row.sumber_anggaran,
        output_penelitian: row.output_penelitian, ucapan: row.ucapan, kontak: row.kontak,
      },
    });
  }));

  r.get('/penelitian/:slug/poster/:file', wrap(async (req, res) => {
    const m = /^(\w+)\.(png|jpg|pdf)$/.exec(req.params.file);
    if (!m) throw httpError(404, 'Gunakan format {a2|xbanner|share}.{png|jpg|pdf}');
    const row = await ambil(req);
    const out = await renderRow(row, m[1], m[2], req.query.dpi);
    if (req.query.unduh) res.attachment(`poster-${m[1]}-${row.slug}.${m[2]}`);
    res.type(out.mime).sendFile(out.file);
  }));

  r.get('/webhook', wrap(async (req, res) => {
    const { rows } = await pool.query('SELECT id,nama FROM webhook WHERE aktif AND ($1::int IS NULL OR prodi_id IS NULL OR prodi_id=$1) ORDER BY nama', [req.apiKey.prodi_id]);
    res.json(rows);
  }));

  r.post('/penelitian/:slug/kirim', wrap(async (req, res) => {
    const row = await ambil(req);
    const hasil = await kirimKe(row, req.body, req.apiKey.prodi_id, baseOf(req), renderRow);
    res.status(hasil.ok ? 200 : 502).json(hasil);
  }));

  app.use('/api/v1', r);
};

// Dipakai bersama oleh rute sesi (halaman) dan rute kunci API.
async function kirimKe(row, body, batasProdi, base, renderRow) {
  const fmt = String(body.format || ''), ext = String(body.tipe || 'pdf');
  const { rows } = await pool.query('SELECT * FROM webhook WHERE id=$1 AND aktif', [parseInt(body.webhook_id, 10) || 0]);
  const hook = rows[0];
  if (!hook || (hook.prodi_id && hook.prodi_id !== row.prodi_id) || (batasProdi && hook.prodi_id && hook.prodi_id !== batasProdi)) {
    throw httpError(404, 'Tujuan (webhook) tidak ditemukan atau tidak boleh dipakai untuk data ini.');
  }
  const out = await renderRow(row, fmt, ext, body.dpi);
  const r = await wh.kirimBerkas(hook, row, fmt, ext, out.file, out.mime, base);
  return { ...r, tujuan: hook.nama, format: fmt, tipe: ext };
}
module.exports.kirimKe = kirimKe;
