// Mengisi satu data contoh (slug "contoh") lengkap dengan foto. Aman dijalankan berulang.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { pool, migrate } = require('../src/db');
const { hashSandi } = require('../src/auth');

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
  const ins = await pool.query(`INSERT INTO penelitian
    (slug,judul,subjudul,institusi,unit,tahun,peneliti_nama,peneliti_info,anggota,pembimbing1,pembimbing2,foto_peneliti,
     ringkasan,latar_belakang,tujuan,metode,hasil,kesimpulan,pustaka,ucapan,kontak,prodi_id,dibuat_oleh,diubah_oleh,tema)
    VALUES ('contoh',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$22,'teal') RETURNING id`, [
    'Pemanfaatan Aplikasi Denah dan Render 3D untuk Visualisasi Tata Ruang Kantor',
    'Contoh data: ganti seluruh isian ini dengan data penelitian Anda',
    '', '', '2026',
    'Fitrah Fajar', 'Peneliti Pertama', 'Rina Amelia, Budi Santoso',
    // Pembimbing 1 = dosen Journey (lengkap dengan gelar, dibuang otomatis di poster); pembimbing 2 = diketik manual (dosen luar)
    'Fitrah Satrya Fajar Kusumah, S.Komp., M.Kom', 'Dr. Dewi Lestari, S.T., M.Kom.', peneliti,
    'Aplikasi denah ponsel memungkinkan rancangan tata ruang dibuat, divisualisasikan dalam 3D, dan dirender 4K sehingga proses diskusi perubahan ruang menjadi lebih cepat.',
    'Perencanaan tata ruang kantor masih banyak dilakukan dengan sketsa manual sehingga sulit dibayangkan oleh pengambil keputusan.\n\nAplikasi perancangan denah di ponsel menawarkan cara yang lebih cepat dan murah untuk membuat visualisasi sebelum pekerjaan fisik dimulai.',
    '- Membuat model denah dan perabot ruang kerja pada aplikasi\n- Menghasilkan visualisasi 3D dan gambar render\n- Menilai kemudahan dan kecepatan proses perancangan',
    'Eksperimen terapan pada 5 ruang kerja. Denah digambar di ponsel, perabot ditata pada tampilan 3D, lalu hasilnya dirender pada resolusi HD dan 4K. Waktu kerja dan kepuasan pengguna dicatat pada setiap ruang.',
    '- Waktu perancangan satu ruang rata-rata 25 menit\n- Render HD selesai kurang dari 2 menit\n- 9 dari 10 pengambil keputusan menilai visual 3D lebih mudah dipahami',
    'Aplikasi denah 3D di ponsel layak dipakai untuk perancangan awal tata ruang kantor. Langkah berikutnya: mengukur akurasi dimensi dan mengintegrasikan hasil dengan gambar kerja.',
    'Contoh rujukan 1. Penulis (2024). Judul. Penerbit.\nContoh rujukan 2. Penulis (2023). Judul. Jurnal.',
    'Ucapan terima kasih kepada seluruh pihak yang membantu (contoh).',
    'peneliti@contoh.go.id\nWA 0812-0000-0000',
    prodiInf, tu,
  ]);
  const fotos = [
    ['kegiatan1.jpg', 'Penataan perabot pada tampilan 3D'],
    ['kegiatan2.jpg', 'Daftar proyek denah'],
    ['kegiatan3.jpg', 'Pengaturan render 4K'],
  ];
  for (let i = 0; i < fotos.length; i++) {
    await pool.query('INSERT INTO foto_penelitian (penelitian_id,file,keterangan,urutan) VALUES ($1,$2,$3,$4)',
      [ins.rows[0].id, await copyFoto(fotos[i][0]), fotos[i][1], i]);
  }
  await pool.query('UPDATE penelitian SET pembimbing1_ref=$1 WHERE id=$2', ['fitrah-satrya-gmail-com-2971', ins.rows[0].id]);
  // dua logo sponsor contoh (umum): satu kiri atas, satu kanan bawah
  const spon = [['sponsor-a.png', 'Mitra A (contoh)', 'kiri_atas'], ['sponsor-b.png', 'Mitra B (contoh)', 'kanan_bawah']];
  for (let i = 0; i < spon.length; i++) {
    const out = crypto.randomBytes(9).toString('hex') + '.png';
    await sharp(path.join(SRC, spon[i][0])).png().toFile(path.join(UP, out));
    const sp = await pool.query('INSERT INTO sponsor (nama,file,prodi_id,dibuat_oleh) VALUES ($1,$2,NULL,$3) RETURNING id', [spon[i][1], out, tu]);
    await pool.query('INSERT INTO penelitian_sponsor (penelitian_id,sponsor_id,posisi,urutan) VALUES ($1,$2,$3,$4)', [ins.rows[0].id, sp.rows[0].id, spon[i][2], i]);
  }
  console.log('Data contoh dibuat: /p/contoh');
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
