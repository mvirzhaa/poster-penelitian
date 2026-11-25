// Jenis penelitian & komponen biaya. Daftar komponen disimpan di tabel komponen_biaya (diatur admin).
const { pool } = require('./db');
const { httpError } = require('./auth');

const JENIS = [
  { k: 'skripsi', label: 'Skripsi' },
  { k: 'thesis', label: 'Thesis' },
  { k: 'desertasi', label: 'Desertasi' },
  { k: 'dosen_mandiri', label: 'Penelitian Dosen Mandiri' },
  { k: 'join_research', label: 'Join Research' },
];
const JENIS_KEYS = JENIS.map(j => j.k);
const SUMBER = ['Mandiri', 'Hibah Internal', 'Hibah External'];
const MAX_NOMINAL = 1e12;

// "5.000.000", "Rp 5000000", 5000000 -> 5000000; negatif/tidak valid -> NaN
const angka = v => { const t = String(v ?? '').trim(); if (t === '') return 0; if (/^-/.test(t)) return NaN; const d = t.replace(/[\s.,]|^Rp/gi, ''); return /^\d+$/.test(d) ? parseInt(d, 10) : NaN; };
const rupiah = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');

async function komponenJenis(jenis, { semua = false } = {}) {
  const { rows } = await pool.query(
    `SELECT id,jenis,nama,nominal::float8 AS nominal,mode,sumber,urutan,aktif FROM komponen_biaya
     WHERE jenis=$1 ${semua ? '' : 'AND aktif'} ORDER BY urutan,id`, [jenis]);
  return rows;
}

// Dari isian pengguna -> {jenis, biaya:[{nama,nominal,sumber}], total, anggaran}. Nominal 'tetap' selalu mengikuti angka admin.
async function hitungBiaya(body, { wajibJenis = false } = {}) {
  const jenis = String(body.jenis_penelitian || '').trim();
  if (!jenis) { if (wajibJenis) throw httpError(400, 'Pilih jenis penelitian.'); return null; }
  if (!JENIS_KEYS.includes(jenis)) throw httpError(400, 'Jenis penelitian tidak dikenal.');
  let kiriman = body.biaya;
  if (typeof kiriman === 'string') { try { kiriman = JSON.parse(kiriman); } catch { throw httpError(400, 'Format biaya tidak valid.'); } }
  kiriman = Array.isArray(kiriman) ? kiriman : [];
  const komp = await komponenJenis(jenis);
  const biaya = [];
  for (const k of komp) {
    const x = kiriman.find(v => Number(v?.id) === k.id) || {};
    let nominal = k.nominal;
    if (k.mode === 'bebas') {
      nominal = angka(x.nominal);
      if (!Number.isFinite(nominal) || nominal < 0 || nominal > MAX_NOMINAL) throw httpError(400, `Nominal "${k.nama}" tidak valid.`);
    }
    const sumber = (Array.isArray(x.sumber) ? x.sumber : []).map(String).filter(s => SUMBER.includes(s));
    if (k.mode === 'bebas' && nominal === 0) continue;   // komponen bebas yang tidak diisi tidak dihitung
    biaya.push({ nama: k.nama, nominal, sumber: sumber.length ? sumber : (x.sumber === undefined ? k.sumber : []) });
  }
  const total = biaya.reduce((a, b) => a + b.nominal, 0);
  return { jenis, biaya, total, anggaran: total ? rupiah(total) : '' };
}

module.exports = { angka, JENIS, JENIS_KEYS, SUMBER, rupiah, komponenJenis, hitungBiaya };
