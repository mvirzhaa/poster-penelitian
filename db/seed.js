// Mengisi satu data contoh (slug "contoh") lengkap dengan foto. Aman dijalankan berulang.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { pool, migrate } = require('../src/db');
const { hashSandi } = require('../src/auth');
const { hitungBiaya } = require('../src/biaya');
async function isiBiaya(id, jenis, biaya = []) {
  const h = await hitungBiaya({ jenis_penelitian: jenis, biaya });
  await pool.query('UPDATE penelitian SET jenis_penelitian=$1,biaya=$2,total_biaya=$3,anggaran=$4,sumber_anggaran=$5 WHERE id=$6',
    [h.jenis, JSON.stringify(h.biaya), h.total, h.anggaran, [...new Set(h.biaya.flatMap(b => b.sumber))].join(', '), id]);
}

// Akun dummy. Kata sandi awal: admin -> admin2026, staf TU -> prodi2026 (WAJIB diganti saat dipakai sungguhan).
const PRODI = [
  ['informatika', 'Teknik Informatika'],
  ['sistem-informasi', 'Sistem Informasi'],
  ['manajemen', 'Manajemen'],
  ['akuntansi', 'Akuntansi'],
];
const PENGGUNA = [
  ['admin', 'Administrator', 'admin', null, 'admin2026'],
  ['tu.informatika', 'Staf TU Teknik Informatika', 'tu', 'informatika', 'prodi2026'],
  ['tu.sistem-informasi', 'Staf TU Sistem Informasi', 'tu', 'sistem-informasi', 'prodi2026'],
  ['tu.manajemen', 'Staf TU Manajemen', 'tu', 'manajemen', 'prodi2026'],
  ['tu.akuntansi', 'Staf TU Akuntansi', 'tu', 'akuntansi', 'prodi2026'],
];

const UP = path.join(__dirname, '..', 'uploads');
const SRC = path.join(__dirname, '..', 'contoh');
fs.mkdirSync(UP, { recursive: true });

async function copyFoto(name, square) {
  const out = crypto.randomBytes(9).toString('hex') + '.jpg';
  let img = sharp(path.join(SRC, name)).rotate();
  if (square) img = img.resize(square, square, { fit: 'cover' });
  await img.jpeg({ quality: 88 }).toFile(path.join(UP, out));
  return out;
}

(async () => {
  await migrate();
  for (const [kode, nama] of PRODI) await pool.query('INSERT INTO prodi (kode,nama) VALUES ($1,$2) ON CONFLICT (kode) DO NOTHING', [kode, nama]);
  for (const [username, nama, peran, kode, sandi] of PENGGUNA) {
    const prodi = kode ? (await pool.query('SELECT id FROM prodi WHERE kode=$1', [kode])).rows[0].id : null;
    const r = await pool.query(`INSERT INTO pengguna (username,nama,sandi,peran,prodi_id,sandi_default) VALUES ($1,$2,$3,$4,$5,TRUE)
      ON CONFLICT (username) DO NOTHING`, [username, nama, await hashSandi(sandi), peran, prodi]);
    if (r.rowCount) console.log(`Akun dibuat: ${username} / ${sandi}`);
  }
  const ada = await pool.query("SELECT 1 FROM penelitian WHERE slug='contoh'");
  if (ada.rowCount) { console.log('Data contoh sudah ada (/p/contoh).'); return pool.end(); }

  const peneliti = await copyFoto('peneliti.jpg', 900);
  const prodiInf = (await pool.query("SELECT id FROM prodi WHERE kode='informatika'")).rows[0].id;
  const tu = (await pool.query("SELECT id FROM pengguna WHERE username='tu.informatika'")).rows[0].id;
  const anggota = [
    // dosen Journey (lengkap dengan gelar; gelar dibuang otomatis di poster) + anggota dari luar yang diketik manual
    { nama: 'Fitrah Satrya Fajar Kusumah, S.Komp., M.Kom', ref: 'fitrah-satrya-gmail-com-2971' },
    { nama: 'Dr. Dewi Lestari, S.T., M.Kom.', ref: '' },
    { nama: 'Budi Santoso, S.Kom., M.T.', ref: '' },
    { nama: 'Prof. Dr. Ir. H. Ahmad Syafiq, M.Si.', ref: '' },
  ];
  const ins = await pool.query(`INSERT INTO penelitian
    (slug,judul,subjudul,institusi,unit,tahun,peneliti_nama,peneliti_info,foto_peneliti,
     abstrak,anggaran,sumber_anggaran,output_penelitian,anggota_peneliti,ucapan,kontak,prodi_id,dibuat_oleh,diubah_oleh,tema)
    VALUES ('contoh',$1,$2,'','','2026',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14,'teal') RETURNING id`, [
    'Pemanfaatan Drone Penyemprot untuk Efisiensi Pemupukan dan Pengendalian Hama Padi',
    '',
    'Fitrah Fajar', '', peneliti,
    'Penyemprotan pestisida dan pupuk cair secara manual pada lahan padi memakan waktu, boros larutan, dan berisiko bagi kesehatan petani. Penelitian ini menguji drone penyemprot yang dioperasikan dari pinggir lahan untuk menyemprot area secara merata dengan debit terkontrol. Uji lapangan dilakukan pada lahan padi seluas 5 hektare di tiga kelompok tani. Hasilnya, waktu penyemprotan per hektare turun dari sekitar 3 jam menjadi 20 menit, penggunaan larutan berkurang 30 persen, dan petani tidak lagi terpapar bahan kimia secara langsung. Teknologi ini layak diterapkan pada kelompok tani dengan pelatihan operator dan prosedur keselamatan terbang.',
    'Rp 14.500.000', 'Mandiri, Hibah Internal, Hibah External',
    JSON.stringify(['Scopus Q3', 'Sinta 2', 'Seminar Nasional', 'HKI', 'Teknologi Purwarupa']), JSON.stringify(anggota),
    'Terima kasih kepada LPPM UIKA dan seluruh pihak yang membantu (contoh).',
    'peneliti@contoh.go.id\nWA 0812-0000-0000',
    prodiInf, tu,
  ]);
  const fotos = [
    ['kegiatan1.jpg', 'Drone menyemprot larutan pada lahan'],
    ['kegiatan2.jpg', 'Operator mengendalikan drone di sawah'],
    ['kegiatan3.jpg', 'Semprotan merata pada tanaman'],
  ];
  for (let i = 0; i < fotos.length; i++) {
    await pool.query('INSERT INTO foto_penelitian (penelitian_id,file,keterangan,urutan) VALUES ($1,$2,$3,$4)',
      [ins.rows[0].id, await copyFoto(fotos[i][0]), fotos[i][1], i]);
  }
  // dua logo sponsor contoh (umum): satu kiri atas, satu kanan bawah
  const spon = [['sponsor-a.png', 'Mitra A (contoh)', 'kiri_atas'], ['sponsor-b.png', 'Mitra B (contoh)', 'kanan_bawah']];
  for (let i = 0; i < spon.length; i++) {
    const out = crypto.randomBytes(9).toString('hex') + '.png';
    await sharp(path.join(SRC, spon[i][0])).png().toFile(path.join(UP, out));
    const sp = await pool.query('INSERT INTO sponsor (nama,file,prodi_id,dibuat_oleh) VALUES ($1,$2,NULL,$3) RETURNING id', [spon[i][1], out, tu]);
    await pool.query('INSERT INTO penelitian_sponsor (penelitian_id,sponsor_id,posisi,urutan) VALUES ($1,$2,$3,$4)', [ins.rows[0].id, sp.rows[0].id, spon[i][2], i]);
  }
  await isiBiaya(ins.rows[0].id, 'skripsi');
  console.log('Data contoh dibuat: /p/contoh');
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
