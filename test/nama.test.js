// Jalankan: node --test test/nama.test.js
const test = require('node:test');
const assert = require('node:assert');
const { bersihkanNama: b, bersihkanDaftar: d } = require('../src/nama');

const kasus = [
  ['Prof. Dr. Ir. H. Ahmad Syafiq, S.T., M.Kom., Ph.D', 'Ahmad Syafiq'],
  ['Fitrah Satrya Fajar Kusumah, S.Komp., M.Kom', 'Fitrah Satrya Fajar Kusumah'],
  ['Dr. Dewi Lestari, S.T., M.Kom.', 'Dewi Lestari'],
  ['Dewi Lestari S.Si M.Sc', 'Dewi Lestari'],
  ['Drs. H. Budi Santoso, M.M.', 'Budi Santoso'],
  ['Dra. Hj. Siti Aminah, M.Pd.I', 'Siti Aminah'],
  ['Ir. Rina Amelia ST MT', 'Rina Amelia'],
  ['Prof.Dr.Ir. Joko Widodo', 'Joko Widodo'],
  ['dr. Andi Pratama, Sp.PD', 'Andi Pratama'],
  ['Muhammad Yusuf, Lc., M.A.', 'Muhammad Yusuf'],
  ['Wei Ma', 'Wei Ma'],
  ['Ahmad Syafiq', 'Ahmad Syafiq'],
  // data nyata dari database Journey (huruf kapital semua)
  ['JEJEN JAENUDIN, S.KOM., M.KOM.', 'Jejen Jaenudin'],
  ['HARUN FAIZAL, S.E., M.AK. CAP., CWC.', 'Harun Faizal'],
  ['HJ. NURUL CHAYATI, IR., MT.', 'Nurul Chayati'],
  ['DR. NURAENI, DRA., M.ED.', 'Nuraeni'],
  ['PROF.DR. H. E. MUJAHIDIN, M.SI.', 'E. Mujahidin'],
  ['DIPL. ING. JOKI IRAWAN, S.T.', 'Joki Irawan'],
  ['SARAH CHAIRUL ANNISA, S.PD., M,T.', 'Sarah Chairul Annisa'],
  ['SAFARUDDIN HIDAYAT AL IKHSAN, S.KOM., M.KOM.', 'Safaruddin Hidayat Al Ikhsan'],
];
for (const [masuk, keluar] of kasus) test(masuk, () => assert.strictEqual(b(masuk), keluar));
test('nama kosong', () => assert.strictEqual(b(''), ''));
test('daftar anggota', () => assert.strictEqual(d('Rina Amelia, S.Kom, Budi Santoso, M.T.; Dr. Citra Dewi, M.Si'), 'Rina Amelia, Budi Santoso, Citra Dewi'));
