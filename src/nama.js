// Menghapus gelar akademik/profesi dari nama orang, supaya poster hanya menampilkan nama.
//   "Prof. Dr. Ir. H. Ahmad Syafiq, S.T., M.Kom., Ph.D"  ->  "Ahmad Syafiq"
//   "Fitrah Satrya Fajar Kusumah, S.Komp., M.Kom"       ->  "Fitrah Satrya Fajar Kusumah"
//   "Dewi Lestari S.Si M.Sc"                            ->  "Dewi Lestari"

// Gelar depan (dibandingkan tanpa titik, huruf kecil)
const DEPAN = new Set(['prof', 'professor', 'assoc', 'asst', 'dr', 'drs', 'dra', 'drg', 'dr(hc)', 'ir', 'h', 'hj', 'kh', 'k.h',
  'ust', 'ustadz', 'ustadzah', 'ustad', 'kyai', 'ky', 'nyai', 'gus', 'habib', 'tgh', 'pdt', 'rm', 'raden', 'ns', 'apt', 'dr.(hc)', 'dr.hc', 'dipl', 'ing']);
// Kata gelar depan yang hanya dianggap gelar bila berupa huruf kecil/titik khas ("dr." dokter, "ns." ners)
// supaya nama seperti "Ir" tidak rusak: aturan di bawah selalu menyisakan minimal satu kata nama.

// Gelar belakang bertitik: S.Kom, S.T., M.Kom., Ph.D, S.Pd.I, M.Pd.I, dst.
const BELAKANG_TITIK = /^(?:[A-Za-z]{1,6}\.){1,4}[A-Za-z]{0,6}\.?(?:\(.*\))?$/;
// Gelar belakang tanpa titik (hanya dikenali bila daftar ini cocok persis, huruf besar/kecil diabaikan)
const BELAKANG_POLOS = new Set(['st', 'mt', 'se', 'mm', 'sh', 'mh', 'skom', 'mkom', 'skomp', 'msi', 'ssi', 'spd', 'mpd', 'spsi', 'mpsi',
  'skm', 'mkm', 'sip', 'mip', 'sap', 'map', 'sag', 'mag', 'ssos', 'msos', 'shi', 'mhi', 'sthi', 'lc', 'ma', 'mba', 'msc', 'mse',
  'mcs', 'mit', 'mti', 'phd', 'ph.d', 'dba', 'cpa', 'cma', 'ca', 'ak', 'cfa', 'cissp', 'cisa', 'cism', 'pmp', 'scm', 'sfil', 'mfil',
  'sds', 'mds', 'sstat', 'mstat', 'sfarm', 'mfarm', 'apt', 'sked', 'mked', 'skep', 'mkep', 'sgz', 'mgz', 'sp', 'ssi', 'sti', 'mti',
  'sant', 'smb', 'mb', 'mpar', 'spar', 'mscom', 'mkes', 'skes', 'mkpd', 'spd.i', 'ssn', 'dipl', 'ing', 'ir', 'ipm', 'ipu', 'asean',
  'eng', 'ipp', 'mtr', 'str', 'amd', 'amk', 'amg', 'sh.mh', 'sp.pd', 'sp.a', 'sp.og']);

const lepasKurung = s => s.replace(/\s*\([^)]*\)\s*$/, '');

function bukanGelarBelakang(tok) {
  const t = tok.replace(/[,;]+$/, '');
  if (!t) return false;
  const polos = t.replace(/\./g, '').toLowerCase();
  if (t.includes('.')) return BELAKANG_TITIK.test(t);
  if (!BELAKANG_POLOS.has(polos)) return false;
  // tanpa titik: harus ditulis "ST", "MKom", "MSc" (>= 2 huruf besar) agar nama seperti "Ma" atau "Sp" aman
  return (t.match(/[A-Z]/g) || []).length >= 2 || t === 'Ak' || t === 'Lc';
}

function depanGelar(tok) {
  const t = tok.replace(/[,;]+$/, '');
  const polos = t.replace(/\./g, '').toLowerCase();
  if (!polos) return true; // sisa titik
  if (DEPAN.has(polos) || DEPAN.has(t.toLowerCase())) return true;
  // gabungan tanpa spasi: "Prof.Dr.Ir."
  if (t.includes('.')) {
    const parts = t.split('.').filter(Boolean).map(x => x.toLowerCase());
    return parts.length > 1 && parts.every(p => DEPAN.has(p));
  }
  return false;
}

function bersihkanNama(raw) {
  if (raw == null) return '';
  let s = String(raw).replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const asli = s;

  // 1) potong semua yang setelah koma bila potongan itu berisi gelar (format "Nama, S.T., M.Kom")
  const bagian = s.split(',').map(x => x.trim()).filter(Boolean);
  if (bagian.length > 1) {
    const [nama, ...sisa] = bagian;
    const semuaGelar = sisa.every(p => p.split(/\s+/).every(w => bukanGelarBelakang(w) || depanGelar(w) || /^(?:dan|&)$/i.test(w) || /^[A-Za-z]\.?$/.test(w)));
    s = semuaGelar ? nama : bagian.join(' ');
  }

  // 2) gelar depan
  let tok = lepasKurung(s).split(' ');
  while (tok.length > 1 && depanGelar(tok[0])) tok.shift();
  // pecah "Prof.Dr.Ir.Nama" yang menempel
  if (tok.length >= 1) {
    const m = tok[0].match(/^((?:(?:prof|dr|drs|dra|ir|h|hj|kh)\.)+)(.+)$/i);
    if (m && m[2]) tok[0] = m[2];
  }

  // 3) gelar belakang tanpa koma ("Dewi Lestari S.Si M.Sc"); selalu sisakan minimal satu kata
  while (tok.length > 1 && bukanGelarBelakang(tok[tok.length - 1])) tok.pop();
  // gelar yang tersisa di tengah akibat urutan aneh, mis. "Ahmad S.T. Syafiq" tidak disentuh (terlalu berisiko)

  let hasil = tok.join(' ').replace(/[\s,.;]+$/, '').trim();
  // Nama yang seluruhnya huruf kapital (data dosen sering begitu) -> Huruf Awal Kapital
  if (hasil && hasil === hasil.toUpperCase() && /[A-Z]/.test(hasil)) {
    hasil = hasil.toLowerCase().replace(/(^|[\s\-'’.])([a-z])/g, (m, a, b) => a + b.toUpperCase());
  }
  return hasil || asli;
}

// Daftar nama dipisah koma/titik koma ("Rina Amelia, Budi Santoso, S.Kom") -> hanya nama
function bersihkanDaftar(raw) {
  if (!raw) return '';
  const out = [];
  for (const p of String(raw).split(/\s*[;\n]\s*|\s*,\s*/)) {
    const t = p.trim();
    if (!t) continue;
    const kata = t.split(/\s+/);
    if (kata.every(w => bukanGelarBelakang(w) || depanGelar(w))) continue; // potongan murni gelar
    out.push(bersihkanNama(t));
  }
  return out.join(', ');
}

module.exports = { bersihkanNama, bersihkanDaftar };
