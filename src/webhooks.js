const crypto = require('crypto');
const fs = require('fs');
const { pool } = require('./db');

const sign = (secret, data) => 'sha256=' + crypto.createHmac('sha256', secret).update(data).digest('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const newKey = () => 'pk_' + crypto.randomBytes(24).toString('base64url');
const newSecret = () => 'whsec_' + crypto.randomBytes(24).toString('base64url');

function posterUrls(base, slug) {
  const f = (fmt, exts) => Object.fromEntries(exts.map(e => [e, `${base}/img/${slug}/${fmt}.${e}`]));
  return {
    a2: f('a2', ['png', 'jpg', 'pdf']),
    xbanner: f('xbanner', ['png', 'jpg', 'pdf']),
    share: f('share', ['png', 'jpg']),
    semua_zip: `${base}/img/${slug}/semua.zip`,
  };
}

const { bersihkanNama, bersihkanDaftar } = require('./nama');

// Bentuk data penelitian yang dikirim ke aplikasi lain (tanpa data internal seperti id pengguna).
function ringkasData(r, base) {
  return {
    slug: r.slug,
    judul: r.judul,
    subjudul: r.subjudul,
    tahun: r.tahun,
    institusi: r.institusi,
    unit: r.unit,
    prodi: r.prodi_id ? { kode: r.prodi_kode, nama: r.prodi_nama } : null,
    peneliti: { nama: bersihkanNama(r.peneliti_nama), info: r.peneliti_info, anggota: bersihkanDaftar(r.anggota) },
    pembimbing: [r.pembimbing1, r.pembimbing2].filter(Boolean).map(bersihkanNama),
    pembimbing_detail: [[r.pembimbing1, r.pembimbing1_ref], [r.pembimbing2, r.pembimbing2_ref]].filter(([n]) => n)
      .map(([n, ref]) => ({ nama: bersihkanNama(n), journey_slug: ref || null })),
    ringkasan: r.ringkasan,
    foto_peneliti: r.foto_peneliti ? `${base}/uploads/${r.foto_peneliti}` : null,
    foto: (r.foto || []).map(f => ({ url: `${base}/uploads/${f.file}`, keterangan: f.keterangan })),
    sponsor: (r.sponsor || []).map(x => ({ nama: x.nama, logo: `${base}/uploads/${x.file}`, posisi: x.posisi })),
    dibuat: r.created_at,
    diperbarui: r.updated_at,
    halaman: `${base}/p/${r.slug}`,
    poster: posterUrls(base, r.slug),
  };
}

async function catat(whId, event, slug, status, ok, detail) {
  await pool.query('INSERT INTO webhook_log (webhook_id,event,slug,status,ok,detail) VALUES ($1,$2,$3,$4,$5,$6)',
    [whId, event, slug || null, status || null, ok, String(detail || '').slice(0, 300)]).catch(() => {});
}

// Jalankan permintaan dengan percobaan ulang untuk galat sementara (5xx/429/jaringan).
async function denganCobaUlang(wh, event, slug, buatRequest, maksimal = 3) {
  let status = null, detail = '';
  for (let i = 0; i < maksimal; i++) {
    try {
      const res = await buatRequest();
      status = res.status;
      if (res.ok) { await catat(wh.id, event, slug, status, true, 'OK'); return { ok: true, status }; }
      detail = `HTTP ${res.status}`;
      if (status < 500 && status !== 429) break;
    } catch (e) { detail = e.cause?.code || e.message; status = null; }
    if (i < maksimal - 1) await sleep(1000 * 2 ** i);
  }
  await catat(wh.id, event, slug, status, false, detail);
  return { ok: false, status, detail };
}

function kirimJson(wh, event, payload) {
  const body = JSON.stringify({ event, waktu: new Date().toISOString(), ...payload });
  return denganCobaUlang(wh, event, payload.penelitian?.slug, () => fetch(wh.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'PosterPenelitian/1.0',
      'X-Poster-Event': event,
      'X-Poster-Signature': sign(wh.rahasia, body),
    },
    body,
    signal: AbortSignal.timeout(10000),
  }));
}

// Kirim berkas poster (multipart/form-data, bidang "berkas") ke aplikasi tujuan.
function kirimBerkas(wh, row, fmt, ext, file, mime, base) {
  const buf = fs.readFileSync(file);
  const ts = String(Date.now());
  return denganCobaUlang(wh, 'poster.berkas', row.slug, () => {
    const fd = new FormData();
    fd.append('event', 'poster.berkas');
    fd.append('slug', row.slug);
    fd.append('judul', row.judul);
    fd.append('format', fmt);
    fd.append('tipe', ext);
    fd.append('metadata', JSON.stringify(ringkasData(row, base)));
    fd.append('berkas', new Blob([buf], { type: mime }), `poster-${fmt}-${row.slug}.${ext}`);
    return fetch(wh.url, {
      method: 'POST',
      headers: {
        'User-Agent': 'PosterPenelitian/1.0',
        'X-Poster-Event': 'poster.berkas',
        'X-Poster-Timestamp': ts,
        'X-Poster-Signature': sign(wh.rahasia, `${ts}.${row.slug}.${fmt}.${ext}`),
      },
      body: fd,
      signal: AbortSignal.timeout(60000),
    });
  }, 2);
}

// Beri tahu semua webhook aktif (milik prodi itu atau umum). Tidak menunggu hasil.
async function dispatch(event, row, base) {
  try {
    const { rows } = await pool.query('SELECT * FROM webhook WHERE aktif AND (prodi_id IS NULL OR prodi_id=$1)', [row.prodi_id]);
    for (const wh of rows) kirimJson(wh, event, { penelitian: ringkasData(row, base) }).catch(() => {});
  } catch (e) { console.error('Webhook dispatch gagal:', e.message); }
}

module.exports = { sign, newKey, newSecret, posterUrls, ringkasData, kirimJson, kirimBerkas, dispatch };
