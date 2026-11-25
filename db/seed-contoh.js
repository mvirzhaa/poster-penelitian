// Menambah beberapa data penelitian contoh tambahan (lintas prodi) ke sistem. Aman dijalankan berulang (dilewati bila slug sudah ada).
// Jalankan SETELAH db/seed.js:  node db/seed-contoh.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { pool, migrate } = require('../src/db');

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
// Foto ilustrasi sederhana (pengganti foto produk) agar contoh tidak kosong.
async function fotoIlustrasi(warna1, warna2, teks) {
  const out = crypto.randomBytes(9).toString('hex') + '.jpg';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${warna1}"/><stop offset="1" stop-color="${warna2}"/></linearGradient></defs><rect width="1600" height="1000" fill="url(#g)"/><circle cx="1250" cy="250" r="260" fill="#fff" opacity=".08"/><circle cx="300" cy="820" r="320" fill="#fff" opacity=".06"/><text x="800" y="520" font-family="Arial,sans-serif" font-size="64" font-weight="700" fill="#fff" text-anchor="middle" opacity=".92">${teks}</text><text x="800" y="600" font-family="Arial,sans-serif" font-size="34" fill="#fff" text-anchor="middle" opacity=".7">Foto contoh – ganti dengan foto produk</text></svg>`;
  await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toFile(path.join(UP, out));
  return out;
}

const { hitungBiaya } = require('../src/biaya');
const DATA = [
  {
    slug: 'contoh-si', prodi: 'sistem-informasi', tema: 'biru', user: 'tu.sistem-informasi',
    judul: 'Sistem Informasi Monitoring Inventaris Laboratorium Berbasis Web dan QR Code',
    peneliti: 'Rina Amelia', tahun: '2026',
    anggota: [{ nama: 'Dr. Budi Santoso, S.Kom., M.T.', ref: '' }, { nama: 'Dewi Lestari, S.Kom., M.Kom.', ref: '' }],
    abstrak: 'Pencatatan inventaris laboratorium masih dilakukan dengan buku manual sehingga sering terjadi selisih data dan sulit melacak kondisi alat. Penelitian ini membangun sistem informasi berbasis web yang memakai kode QR pada setiap aset untuk pendataan, peminjaman, dan pelaporan kerusakan. Pengujian pada dua laboratorium komputer menunjukkan waktu pencatatan aset berkurang dari 5 menit menjadi 1 menit per item, dan selisih data inventaris turun hingga di bawah 2 persen.',
    jenis: 'skripsi',
    output: ['Sinta 3', 'Seminar Nasional', 'HKI'],
    foto: [['#1d4ed8', '#0b2a6b', 'Dasbor inventaris', 'Dasbor ringkasan inventaris'], ['#2563eb', '#1e3a8a', 'Pemindaian QR', 'Pemindaian kode QR aset'], ['#3b82f6', '#172554', 'Laporan kerusakan', 'Formulir laporan kerusakan alat']],
  },
  {
    slug: 'contoh-mn', prodi: 'manajemen', tema: 'marun', user: 'tu.manajemen',
    judul: 'Pengaruh Literasi Keuangan Digital terhadap Kinerja UMKM Kuliner di Kota Bogor',
    peneliti: 'Dr. Ahmad Syafiq, M.M.',
    tahun: '2026',
    anggota: [{ nama: 'Siti Aminah Nurhayati, S.E., M.M.', ref: '' }, { nama: 'Prof. Dr. Hendra Wijaya, M.Si.', ref: '' }, { nama: 'Rizky Pratama, S.M.', ref: '' }],
    abstrak: 'Pelaku UMKM kuliner semakin banyak memakai dompet digital, QRIS, dan pencatatan keuangan berbasis aplikasi, tetapi dampaknya terhadap kinerja usaha belum banyak dikaji. Penelitian kuantitatif ini melibatkan 150 pelaku UMKM kuliner di Kota Bogor dan dianalisis dengan regresi linear berganda. Hasilnya menunjukkan literasi keuangan digital berpengaruh positif dan signifikan terhadap kinerja usaha, terutama pada pencatatan keuangan dan akses pembiayaan.',
    jenis: 'dosen_mandiri', nominal: [9000000, 6000000, 1500000],
    output: ['Scopus Q4', 'Sinta 2', 'Seminar Internasional', 'Buku'],
    foto: [['#a3213f', '#55101f', 'Wawancara pelaku UMKM', 'Wawancara dan survei pelaku UMKM'], ['#be123c', '#4c0519', 'Pembayaran QRIS', 'Pembayaran digital QRIS di kedai']],
  },
  {
    slug: 'contoh-ak', prodi: 'akuntansi', tema: 'ungu', user: 'tu.akuntansi',
    judul: 'Penerapan Akuntansi Hijau pada Industri Kecil Pengolahan Pangan',
    peneliti: 'Dewi Lestari',
    tahun: '2026',
    anggota: [{ nama: 'Budi Santoso, S.E., Ak., M.Ak.', ref: '' }],
    abstrak: 'Industri kecil pengolahan pangan menghasilkan limbah yang biayanya jarang tercatat dalam laporan keuangan. Penelitian ini merancang format pencatatan biaya lingkungan sederhana berbasis akuntansi hijau dan mengujinya pada lima industri kecil. Penerapan format tersebut membantu pelaku usaha mengenali biaya pengelolaan limbah dan menemukan peluang efisiensi.',
    jenis: 'thesis',
    output: ['Sinta 4', 'Seminar Nasional', 'Kebijakan'],
    foto: [['#6d34b0', '#34175c', 'Pencatatan biaya limbah', 'Pencatatan biaya pengelolaan limbah']],
  },
];

(async () => {
  await migrate();
  let n = 0;
  for (const d of DATA) {
    if ((await pool.query('SELECT 1 FROM penelitian WHERE slug=$1', [d.slug])).rowCount) { console.log(`Lewati ${d.slug} (sudah ada)`); continue; }
    const pr = await pool.query('SELECT id FROM prodi WHERE kode=$1', [d.prodi]);
    const us = await pool.query('SELECT id FROM pengguna WHERE username=$1', [d.user]);
    if (!pr.rowCount || !us.rowCount) { console.log(`Lewati ${d.slug}: jalankan "node db/seed.js" dulu`); continue; }
    const komp = await require('../src/biaya').komponenJenis(d.jenis);
    const h = await hitungBiaya({ jenis_penelitian: d.jenis, biaya: komp.map((k, i) => ({ id: k.id, nominal: (d.nominal || [])[i] || 0, sumber: k.sumber.slice(0, 1) })) });
    const ins = await pool.query(`INSERT INTO penelitian
      (slug,judul,tahun,peneliti_nama,foto_peneliti,abstrak,jenis_penelitian,biaya,total_biaya,anggaran,sumber_anggaran,output_penelitian,anggota_peneliti,
       ucapan,kontak,prodi_id,dibuat_oleh,diubah_oleh,tema)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17,$18) RETURNING id`,
      [d.slug, d.judul, d.tahun, d.peneliti, await copyFoto('peneliti.jpg', 900), d.abstrak, h.jenis, JSON.stringify(h.biaya), h.total, h.anggaran,
       [...new Set(h.biaya.flatMap(b => b.sumber))].join(', '),
       JSON.stringify(d.output), JSON.stringify(d.anggota), 'Terima kasih kepada LPPM UIKA dan seluruh pihak yang membantu (contoh).',
       'peneliti@contoh.go.id\nWA 0812-0000-0000', pr.rows[0].id, us.rows[0].id, d.tema]);
    for (let i = 0; i < d.foto.length; i++) {
      const [c1, c2, teks, ket] = d.foto[i];
      await pool.query('INSERT INTO foto_penelitian (penelitian_id,file,keterangan,urutan) VALUES ($1,$2,$3,$4)', [ins.rows[0].id, await fotoIlustrasi(c1, c2, teks), ket, i]);
    }
    console.log(`Dibuat: /p/${d.slug}  (${d.prodi})`); n++;
  }
  console.log(`Selesai: ${n} data contoh tambahan.`);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
