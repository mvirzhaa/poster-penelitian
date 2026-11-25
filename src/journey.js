// Integrasi dengan aplikasi Journey (direktori dosen UIKA).
//  - Mencari dosen (calon pembimbing) lewat API Journey.
//  - Mengirim poster ukuran "share" + data penelitian ke Journey agar tampil di tab Produk dosen pembimbing.
// Aktif bila JOURNEY_API_URL dan JOURNEY_API_KEY diisi di .env.
const fs = require('fs');
const { pool } = require('./db');

const URL_API = (process.env.JOURNEY_API_URL || '').replace(/\/+$/, '');
const KUNCI = process.env.JOURNEY_API_KEY || '';
const aktif = () => !!(URL_API && KUNCI);
const hdr = () => ({ 'X-API-Key': KUNCI });

async function cariDosen(q, limit = 15) {
  if (!aktif()) return { aktif: false, data: [] };
  const u = `${URL_API}/integration/lecturers?q=${encodeURIComponent(q || '')}&limit=${limit}`;
  const r = await fetch(u, { headers: hdr(), signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`Journey menjawab ${r.status}`);
  const j = await r.json();
  return { aktif: true, data: j.data || [] };
}

const { bersihkanNama, anggotaPeneliti } = require('./nama');
const refs = r => [...new Set([r.peneliti_ref, ...anggotaPeneliti(r).map(a => a.ref)].filter(Boolean))];

async function simpanStatus(slug, status, pesan) {
  await pool.query('UPDATE penelitian SET journey_status=$2, journey_pesan=$3, journey_at=now() WHERE slug=$1', [slug, status, String(pesan || '').slice(0, 300)]).catch(() => {});
}

// Kirim (atau perbarui) poster ke Journey. Bila tidak ada pembimbing dari Journey, produk di Journey dihapus.
async function sinkron(r, renderRow, base) {
  if (!aktif()) return { ok: false, status: 'nonaktif', pesan: 'Integrasi Journey belum dikonfigurasi (JOURNEY_API_URL / JOURNEY_API_KEY).' };
  try {
    const dosen = refs(r);
    if (!dosen.length) {
      await hapus(r.slug, true);
      await simpanStatus(r.slug, 'tidak_terkait', 'Tidak ada anggota peneliti dari Journey (semua diketik manual).');
      return { ok: true, status: 'tidak_terkait', pesan: 'Tidak ada anggota peneliti dari Journey, tidak dikirim.' };
    }
    const out = await renderRow(r, 'share', 'png', null);
    const fd = new FormData();
    const set = (k, v) => fd.append(k, v == null ? '' : String(v));
    set('slug', r.slug); set('judul', r.judul); set('subjudul', ''); set('tahun', r.tahun);
    set('peneliti', bersihkanNama(r.peneliti_nama)); set('anggota', anggotaPeneliti(r).map(a => bersihkanNama(a.nama)).join(', '));
    set('ringkasan', r.abstrak);
    set('prodi', r.prodi_nama || '');
    set('halaman_url', `${base}/p/${r.slug}`);
    set('diperbarui', new Date(r.updated_at).toISOString());
    set('dosen', JSON.stringify(dosen));
    set('anggota_peneliti', JSON.stringify(anggotaPeneliti(r).map(a => bersihkanNama(a.nama))));
    fd.append('poster', new Blob([fs.readFileSync(out.file)], { type: 'image/png' }), `${r.slug}-share.png`);
    const res = await fetch(`${URL_API}/integration/products`, { method: 'POST', headers: hdr(), body: fd, signal: AbortSignal.timeout(60000) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || `Journey menjawab ${res.status}`);
    await simpanStatus(r.slug, 'terkirim', `Tampil di tab Produk untuk ${dosen.length} dosen.`);
    return { ok: true, status: 'terkirim', pesan: `Terkirim ke Journey (${dosen.length} dosen).`, dosen: j.dosen };
  } catch (e) {
    await simpanStatus(r.slug, 'gagal', e.message);
    return { ok: false, status: 'gagal', pesan: e.message };
  }
}

async function hapus(slug, diamkan = false) {
  if (!aktif()) return { ok: false };
  try {
    const res = await fetch(`${URL_API}/integration/products/${encodeURIComponent(slug)}`, { method: 'DELETE', headers: hdr(), signal: AbortSignal.timeout(15000) });
    return { ok: res.ok || res.status === 404 };
  } catch (e) { if (!diamkan) console.error('Journey hapus gagal:', e.message); return { ok: false }; }
}

module.exports = { aktif, cariDosen, sinkron, hapus };
