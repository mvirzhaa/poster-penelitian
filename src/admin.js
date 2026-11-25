const crypto = require('crypto');
const express = require('express');
const { pool } = require('./db');
const { hashSandi, sha, requireLogin, requireAdmin, httpError } = require('./auth');
const wh = require('./webhooks');
const B = require('./biaya');

const randomPw = () => crypto.randomBytes(9).toString('base64url').replace(/[-_]/g, 'x').slice(0, 10);
const intOrNull = v => (v === '' || v == null ? null : parseInt(v, 10));

module.exports = function (app, wrap) {
  // Daftar prodi dipakai formulir (semua pengguna login)
  app.get('/api/prodi', requireLogin, wrap(async (req, res) => {
    const { rows } = await pool.query('SELECT id,kode,nama,fakultas FROM prodi ORDER BY fakultas,nama');
    res.json(rows);
  }));

  const r = express.Router();
  r.use(requireLogin, requireAdmin);

  // ----- Prodi -----
  r.post('/prodi', wrap(async (req, res) => {
    const kode = String(req.body.kode || '').trim().toLowerCase();
    const nama = String(req.body.nama || '').trim();
    if (!/^[a-z0-9-]{2,30}$/.test(kode)) throw httpError(400, 'Kode prodi: 2–30 karakter huruf kecil, angka, atau tanda hubung.');
    if (!nama) throw httpError(400, 'Nama prodi wajib diisi.');
    const fakultas = String(req.body.fakultas || '').trim().slice(0, 120);
    try {
      const { rows } = await pool.query('INSERT INTO prodi (kode,nama,fakultas) VALUES ($1,$2,$3) RETURNING *', [kode, nama, fakultas]);
      res.status(201).json(rows[0]);
    } catch (e) { throw e.code === '23505' ? httpError(400, 'Kode prodi sudah dipakai.') : e; }
  }));
  r.put('/prodi/:id', wrap(async (req, res) => {
    const nama = String(req.body.nama || '').trim();
    if (!nama) throw httpError(400, 'Nama prodi wajib diisi.');
    const fakultas = String(req.body.fakultas || '').trim().slice(0, 120);
    await pool.query('UPDATE prodi SET nama=$1, fakultas=$2 WHERE id=$3', [nama, fakultas, req.params.id]);
    res.json({ ok: true });
  }));
  r.delete('/prodi/:id', wrap(async (req, res) => {
    const c = await pool.query('SELECT (SELECT count(*) FROM penelitian WHERE prodi_id=$1)::int AS p, (SELECT count(*) FROM pengguna WHERE prodi_id=$1)::int AS u', [req.params.id]);
    if (c.rows[0].p || c.rows[0].u) throw httpError(400, 'Prodi masih dipakai oleh data penelitian atau pengguna.');
    await pool.query('DELETE FROM prodi WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  }));

  // ----- Pengguna -----
  r.get('/pengguna', wrap(async (req, res) => {
    const { rows } = await pool.query(`SELECT u.id,u.username,u.nama,u.peran,u.prodi_id,pr.nama AS prodi_nama,u.aktif,u.sandi_default,u.dibuat,
      (SELECT count(*)::int FROM penelitian p WHERE p.dibuat_oleh=u.id) AS jml_data
      FROM pengguna u LEFT JOIN prodi pr ON pr.id=u.prodi_id ORDER BY u.peran, pr.nama, u.username`);
    res.json(rows);
  }));
  r.post('/pengguna', wrap(async (req, res) => {
    const username = String(req.body.username || '').trim().toLowerCase();
    const nama = String(req.body.nama || '').trim();
    const peran = req.body.peran === 'admin' ? 'admin' : 'tu';
    const prodiId = intOrNull(req.body.prodi_id);
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw httpError(400, 'Nama pengguna: 3–40 karakter (huruf kecil, angka, titik, garis).');
    if (!nama) throw httpError(400, 'Nama lengkap wajib diisi.');
    if (peran === 'tu' && !prodiId) throw httpError(400, 'Akun staf TU harus dikaitkan dengan satu prodi.');
    const sandi = String(req.body.sandi || '').trim() || randomPw();
    if (sandi.length < 8) throw httpError(400, 'Kata sandi minimal 8 karakter.');
    try {
      const { rows } = await pool.query(
        'INSERT INTO pengguna (username,nama,sandi,peran,prodi_id,sandi_default) VALUES ($1,$2,$3,$4,$5,TRUE) RETURNING id',
        [username, nama, await hashSandi(sandi), peran, peran === 'admin' ? null : prodiId]);
      res.status(201).json({ id: rows[0].id, username, sandi_awal: sandi });
    } catch (e) { throw e.code === '23505' ? httpError(400, 'Nama pengguna sudah dipakai.') : e; }
  }));
  r.put('/pengguna/:id', wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const peran = req.body.peran === 'admin' ? 'admin' : 'tu';
    const aktif = req.body.aktif !== false && req.body.aktif !== 'false';
    if (id === req.user.id && (!aktif || peran !== 'admin')) throw httpError(400, 'Anda tidak dapat menonaktifkan atau menurunkan akun Anda sendiri.');
    const prodiId = intOrNull(req.body.prodi_id);
    if (peran === 'tu' && !prodiId) throw httpError(400, 'Akun staf TU harus dikaitkan dengan satu prodi.');
    await pool.query('UPDATE pengguna SET nama=$1, peran=$2, prodi_id=$3, aktif=$4 WHERE id=$5',
      [String(req.body.nama || '').trim() || 'Tanpa nama', peran, peran === 'admin' ? null : prodiId, aktif, id]);
    if (!aktif) await pool.query('DELETE FROM sesi WHERE pengguna_id=$1', [id]);
    res.json({ ok: true });
  }));
  r.post('/pengguna/:id/reset-sandi', wrap(async (req, res) => {
    const sandi = String(req.body.sandi || '').trim() || randomPw();
    if (sandi.length < 8) throw httpError(400, 'Kata sandi minimal 8 karakter.');
    await pool.query('UPDATE pengguna SET sandi=$1, sandi_default=TRUE WHERE id=$2', [await hashSandi(sandi), req.params.id]);
    await pool.query('DELETE FROM sesi WHERE pengguna_id=$1', [req.params.id]);
    res.json({ sandi_baru: sandi });
  }));
  r.delete('/pengguna/:id', wrap(async (req, res) => {
    if (parseInt(req.params.id, 10) === req.user.id) throw httpError(400, 'Anda tidak dapat menghapus akun sendiri.');
    await pool.query('DELETE FROM pengguna WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  }));

  // ----- Kunci API -----
  r.get('/kunci', wrap(async (req, res) => {
    const { rows } = await pool.query(`SELECT k.id,k.nama,k.prefiks,k.prodi_id,pr.nama AS prodi_nama,k.aktif,k.dibuat,k.terakhir_dipakai
      FROM kunci_api k LEFT JOIN prodi pr ON pr.id=k.prodi_id ORDER BY k.dibuat DESC`);
    res.json(rows);
  }));
  r.post('/kunci', wrap(async (req, res) => {
    const nama = String(req.body.nama || '').trim();
    if (!nama) throw httpError(400, 'Nama aplikasi/kunci wajib diisi.');
    const key = wh.newKey();
    await pool.query('INSERT INTO kunci_api (nama,prefiks,hash,prodi_id) VALUES ($1,$2,$3,$4)', [nama, key.slice(0, 9), sha(key), intOrNull(req.body.prodi_id)]);
    res.status(201).json({ kunci: key, catatan: 'Simpan sekarang; kunci lengkap tidak akan ditampilkan lagi.' });
  }));
  r.put('/kunci/:id', wrap(async (req, res) => {
    await pool.query('UPDATE kunci_api SET aktif=$1 WHERE id=$2', [req.body.aktif !== false && req.body.aktif !== 'false', req.params.id]);
    res.json({ ok: true });
  }));
  r.delete('/kunci/:id', wrap(async (req, res) => {
    await pool.query('DELETE FROM kunci_api WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  }));

  // ----- Webhook -----
  const cekUrl = u => {
    try { const x = new URL(u); if (!/^https?:$/.test(x.protocol)) throw 0; return x.toString(); }
    catch { throw httpError(400, 'URL tujuan harus diawali http:// atau https://'); }
  };
  r.get('/webhook', wrap(async (req, res) => {
    const { rows } = await pool.query(`SELECT w.*, pr.nama AS prodi_nama FROM webhook w LEFT JOIN prodi pr ON pr.id=w.prodi_id ORDER BY w.dibuat DESC`);
    res.json(rows);
  }));
  r.post('/webhook', wrap(async (req, res) => {
    const nama = String(req.body.nama || '').trim();
    if (!nama) throw httpError(400, 'Nama tujuan wajib diisi.');
    const { rows } = await pool.query('INSERT INTO webhook (nama,url,rahasia,prodi_id) VALUES ($1,$2,$3,$4) RETURNING *',
      [nama, cekUrl(req.body.url), String(req.body.rahasia || '').trim() || wh.newSecret(), intOrNull(req.body.prodi_id)]);
    res.status(201).json(rows[0]);
  }));
  r.put('/webhook/:id', wrap(async (req, res) => {
    await pool.query('UPDATE webhook SET nama=$1, url=$2, prodi_id=$3, aktif=$4 WHERE id=$5',
      [String(req.body.nama || '').trim(), cekUrl(req.body.url), intOrNull(req.body.prodi_id), req.body.aktif !== false && req.body.aktif !== 'false', req.params.id]);
    res.json({ ok: true });
  }));
  r.delete('/webhook/:id', wrap(async (req, res) => {
    await pool.query('DELETE FROM webhook WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  }));
  r.post('/webhook/:id/tes', wrap(async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM webhook WHERE id=$1', [req.params.id]);
    if (!rows[0]) throw httpError(404, 'Tujuan tidak ditemukan');
    res.json(await wh.kirimJson(rows[0], 'ping', { pesan: 'Uji koneksi dari Poster Penelitian' }));
  }));
  r.get('/webhook-log', wrap(async (req, res) => {
    const { rows } = await pool.query(`SELECT l.*, w.nama AS webhook_nama FROM webhook_log l LEFT JOIN webhook w ON w.id=l.webhook_id ORDER BY l.waktu DESC LIMIT 40`);
    res.json(rows);
  }));

  // ----- Komponen biaya per jenis penelitian -----
  const bacaKomponen = body => {
    const jenis = String(body.jenis || '');
    if (!B.JENIS_KEYS.includes(jenis)) throw httpError(400, 'Jenis penelitian tidak dikenal.');
    const nama = String(body.nama || '').trim().slice(0, 120);
    if (!nama) throw httpError(400, 'Nama komponen wajib diisi.');
    const nominal = B.angka(body.nominal);
    if (!Number.isFinite(nominal) || nominal < 0 || nominal > 1e12) throw httpError(400, 'Nominal harus berupa angka 0 atau lebih.');
    const mode = body.mode === 'bebas' ? 'bebas' : 'tetap';
    const sumber = B.SUMBER.filter(x => [].concat(body.sumber || []).includes(x));
    if (!sumber.length) throw httpError(400, 'Pilih minimal satu sumber dana.');
    return { jenis, nama, nominal, mode, sumber: JSON.stringify(sumber), aktif: body.aktif !== false && body.aktif !== 'false' };
  };
  r.get('/komponen-biaya', wrap(async (req, res) => {
    const { rows } = await pool.query('SELECT id,jenis,nama,nominal::float8 AS nominal,mode,sumber,urutan,aktif FROM komponen_biaya ORDER BY jenis,urutan,id');
    res.json({ jenis: B.JENIS, sumber_dana: B.SUMBER, komponen: rows });
  }));
  r.post('/komponen-biaya', wrap(async (req, res) => {
    const k = bacaKomponen(req.body);
    const { rows } = await pool.query(
      `INSERT INTO komponen_biaya (jenis,nama,nominal,mode,sumber,aktif,urutan)
       VALUES ($1,$2,$3,$4,$5,$6,(SELECT COALESCE(MAX(urutan),0)+1 FROM komponen_biaya WHERE jenis=$1)) RETURNING id`,
      [k.jenis, k.nama, k.nominal, k.mode, k.sumber, k.aktif]);
    res.status(201).json({ id: rows[0].id });
  }));
  r.put('/komponen-biaya/:id', wrap(async (req, res) => {
    const k = bacaKomponen(req.body);
    const { rowCount } = await pool.query('UPDATE komponen_biaya SET jenis=$1,nama=$2,nominal=$3,mode=$4,sumber=$5,aktif=$6 WHERE id=$7',
      [k.jenis, k.nama, k.nominal, k.mode, k.sumber, k.aktif, req.params.id]);
    if (!rowCount) throw httpError(404, 'Komponen tidak ditemukan.');
    res.json({ ok: true });
  }));
  r.post('/komponen-biaya/:id/geser', wrap(async (req, res) => {
    const arah = req.body.arah === 'atas' ? -1 : 1;
    const { rows } = await pool.query('SELECT id,jenis FROM komponen_biaya WHERE id=$1', [req.params.id]);
    if (!rows[0]) throw httpError(404, 'Komponen tidak ditemukan.');
    const daftar = (await pool.query('SELECT id FROM komponen_biaya WHERE jenis=$1 ORDER BY urutan,id', [rows[0].jenis])).rows.map(x => x.id);
    const i = daftar.indexOf(rows[0].id), j = i + arah;
    if (j >= 0 && j < daftar.length) { [daftar[i], daftar[j]] = [daftar[j], daftar[i]]; }
    for (let n = 0; n < daftar.length; n++) await pool.query('UPDATE komponen_biaya SET urutan=$1 WHERE id=$2', [n + 1, daftar[n]]);
    res.json({ ok: true });
  }));
  r.delete('/komponen-biaya/:id', wrap(async (req, res) => {
    await pool.query('DELETE FROM komponen_biaya WHERE id=$1', [req.params.id]);   // poster lama menyimpan salinan biayanya sendiri
    res.json({ ok: true });
  }));

  app.use('/api/admin', r);
};
