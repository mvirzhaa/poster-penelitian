// Elemen isi poster yang dapat ditampilkan/disembunyikan. Judul dan logo UIKA selalu tampil.
// def = nilai bawaan. Hanya "Sumber anggaran" yang bawaannya tidak ditampilkan.
const ELEMEN = [
  { k: 'logo_instansi', label: 'Logo mitra/instansi (unggahan)', def: true },
  { k: 'instansi', label: 'Nama institusi & unit', def: true },
  { k: 'tahun', label: 'Tahun', def: true },
  { k: 'sponsor', label: 'Sponsor', def: true },
  { k: 'subjudul', label: 'Sub-judul', def: true },
  { k: 'foto_peneliti', label: 'Foto peneliti utama', def: true },
  { k: 'peneliti_utama', label: 'Peneliti utama', def: true },
  { k: 'anggota', label: 'Anggota peneliti', def: true },
  { k: 'qr', label: 'Kode QR', def: true },
  { k: 'abstrak', label: 'Abstrak', def: true },
  { k: 'foto_produk', label: 'Foto produk / kegiatan', def: true },
  { k: 'anggaran', label: 'Anggaran penelitian', def: true },
  { k: 'sumber_anggaran', label: 'Sumber anggaran', def: false },
  { k: 'output', label: 'Output penelitian', def: true },
  { k: 'ucapan', label: 'Ucapan terima kasih', def: true },
  { k: 'kontak', label: 'Kontak', def: true },
  { k: 'logo_apt', label: 'Logo APT Unggul', def: true },
];
const KEYS = ELEMEN.map(e => e.k);

// Gabungkan nilai tersimpan dengan bawaan -> {kunci: true/false} lengkap.
function petaTampil(val) {
  let v = val;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = {}; } }
  if (!v || typeof v !== 'object' || Array.isArray(v)) v = {};
  return Object.fromEntries(ELEMEN.map(e => [e.k, typeof v[e.k] === 'boolean' ? v[e.k] : e.def]));
}
// Dari isian form/API: array kunci yang dicentang, atau objek {kunci:boolean}. undefined bila tidak dikirim.
function bacaTampil(body) {
  if (body.tampil_ada === undefined && body.tampil === undefined) return undefined;
  let t = body.tampil;
  if (typeof t === 'string' && /^\s*[\[{]/.test(t)) { try { t = JSON.parse(t); } catch { t = []; } }
  if (t && typeof t === 'object' && !Array.isArray(t)) return petaTampil(t);
  const on = [].concat(t === undefined ? [] : t).map(String);
  return Object.fromEntries(KEYS.map(k => [k, on.includes(k)]));
}
module.exports = { ELEMEN, KEYS, petaTampil, bacaTampil };
