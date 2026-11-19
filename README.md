# Poster Penelitian

Aplikasi untuk **staf TU prodi**: isi formulir data penelitian (judul, peneliti, pembimbing, foto peneliti, foto produk/kegiatan, isi penelitian) lalu hasilkan poster dalam tiga bentuk:

| Format | Ukuran | Keluaran |
|---|---|---|
| **Poster A2** | 42 × 59,4 cm (potret) | PNG/JPG 100–300 dpi (bawaan 150 dpi = 2480×3508 px) dan **PDF** |
| **X-Banner** | 60 × 160 cm | PNG/JPG 50–150 dpi (bawaan 100 dpi = 2362×6299 px) dan **PDF**. 20 cm bagian bawah sengaja dikosongkan karena tertutup dudukan banner |
| **Bagikan** | 1080 × 1350 px (4:5) | PNG/JPG untuk WhatsApp, Instagram, dll. Ada halaman publik `/p/<kode>` dengan tombol bagikan |

Untuk dicetak, **PDF adalah pilihan terbaik** (teks tetap tajam). Berikan PDF/PNG ke percetakan.

## Prasyarat
- Node.js 20+
- PostgreSQL 13+
- Google Chrome / Chromium (Puppeteer mengunduhnya otomatis saat `npm install`; bila diblokir, pasang Chrome lalu isi `CHROME_PATH` di `.env`)

## Akun dan hak akses
Setiap staf TU masuk dengan akunnya sendiri dan **hanya melihat/mengubah/menghapus data prodinya**. Admin melihat semua prodi dan mengelola akun, prodi, kunci API, dan webhook (menu **Admin**).

Akun dummy (dibuat oleh `npm run seed`; kata sandi bawaan **wajib diganti**, aplikasi menampilkan pengingat sampai diganti):

| Nama pengguna | Peran | Prodi | Kata sandi awal |
|---|---|---|---|
| `admin` | Admin | semua | `admin2026` |
| `tu.informatika` | Staf TU | Teknik Informatika | `prodi2026` |
| `tu.sistem-informasi` | Staf TU | Sistem Informasi | `prodi2026` |
| `tu.manajemen` | Staf TU | Manajemen | `prodi2026` |
| `tu.akuntansi` | Staf TU | Akuntansi | `prodi2026` |

Akun/prodi baru dibuat admin lewat menu Admin. Login dibatasi 5 percobaan gagal per 10 menit; sesi berlaku 7 hari.

## Halaman
- **Data Penelitian** (`/`): daftar, pencarian, **edit**, **hapus** (dengan konfirmasi; foto ikut terhapus), buka poster.
- **Formulir** (`/form.html`): isian lengkap + pengecekan resolusi foto langsung di peramban.
- **Poster** (`/p/<kode>`): pratinjau tiap ukuran, unduh PNG/JPG/PDF, **unduh semua ukuran (ZIP)**, laporan kualitas cetak foto, tombol bagikan, dan kirim ke aplikasi lain.
- **Admin** (`/admin.html`): pengguna, prodi, kunci API, webhook & riwayat.

Semua poster otomatis memuat **logo Universitas Ibn Khaldun di pojok kanan atas**. Untuk mengganti, timpa berkas `public/assets/logo-universitas.png` (PNG transparan, ≥ 1000 px).

## Syarat resolusi foto (agar tidak pecah saat dicetak)
Standar cetak: **150 dpi** untuk poster A2 dan **100 dpi** untuk X-Banner (dilihat dari jarak 1–2 m).

| Foto | Minimal (ditolak jika kurang) | Disarankan |
|---|---|---|
| Peneliti | 800 × 800 px | 1200 × 1200 px atau lebih |
| Produk / kegiatan | sisi panjang 1600 px dan sisi pendek 800 px | **foto pertama ≥ 2400 px**, lainnya ≥ 1600 px |
| Logo (per penelitian, opsional) | 600 px sisi panjang | 1000 px atau lebih, PNG transparan |

Foto langsung dari kamera ponsel 8 MP ke atas sudah memenuhi. Jangan kirim lewat WhatsApp/Telegram (dikecilkan) atau tangkapan layar kecil. Ukuran 1 foto di poster bergantung pada jumlah foto, jadi setelah disimpan halaman poster menghitung **resolusi efektif tiap foto (dpi)** dan memberi peringatan (Baik ≥ 150/100 dpi, Layak ≥ 100/70 dpi, Rendah di bawahnya).

## API untuk aplikasi lain
Baca data, unduh poster, webhook bertanda tangan, dan kirim berkas: lihat **[API.md](API.md)**.

## Pemasangan
```bash
# 1. basis data
sudo -u postgres psql -c "CREATE USER poster WITH PASSWORD 'poster'" \
                      -c "CREATE DATABASE poster_penelitian OWNER poster"

# 2. aplikasi
npm install
cp .env.example .env      # sesuaikan DATABASE_URL, PUBLIC_BASE_URL
npm start                 # tabel dibuat otomatis saat pertama jalan
npm run seed              # buat prodi + akun dummy + 1 data contoh (/p/contoh)
```
Buka http://localhost:3000

## Pengaturan (`.env`)
- `DATABASE_URL` – koneksi PostgreSQL.
- `PUBLIC_BASE_URL` – alamat publik aplikasi (mis. `https://poster.instansi.go.id`). Dipakai untuk **QR otomatis** ke halaman poster dan pratinjau saat tautan dibagikan di WhatsApp/medsos. Bila kosong, QR hanya muncul jika kolom “Tautan untuk kode QR” diisi di formulir.
- `TRUST_PROXY` – isi `true` bila berjalan di belakang nginx/proxy.
- Halaman bagikan `/p/<kode>` dan gambar poster tetap **publik** (siapa pun yang punya tautan) agar mudah dibagikan; data/formulir/admin wajib login.
- `CHROME_PATH` – lokasi Chrome/Chromium (opsional).

## Tips mengisi
- Baris yang diawali `- ` menjadi poin. Satu baris baru = pindah baris.
- Teks yang terlalu panjang diperkecil otomatis (sampai ±50%); halaman poster menampilkan peringatan bila terlalu kecil/meluap. Penghitung karakter di formulir adalah anjuran.
- Maksimal 8 foto kegiatan; foto pertama menjadi foto utama pada gambar “Bagikan”. Foto diperkecil dan dirotasi otomatis (EXIF) saat diunggah.
- Hasil render disimpan di `cache/` dan dibuat ulang otomatis saat data diubah.

## Struktur
```
db/schema.sql      tabel penelitian & foto_penelitian
src/server.js      Express: API, unggah foto, rute gambar, halaman bagikan
src/auth.js        login, sesi, kata sandi (scrypt), batas percobaan
src/admin.js       API admin: pengguna, prodi, kunci API, webhook
src/apiv1.js       API /api/v1 untuk aplikasi lain (kunci API)
src/webhooks.js    pengiriman webhook & berkas bertanda tangan HMAC
src/templates.js   tata letak poster (A2, X-Banner, Bagikan) + tema warna
src/render.js      Puppeteer: HTML -> PNG/JPG/PDF + cache
public/            login, daftar, formulir, admin
db/seed.js         prodi, akun dummy, data contoh
views/share.html   halaman bagikan publik
uploads/ cache/    foto unggahan & hasil render
```

## Endpoint gambar
`/img/<kode>/<a2|xbanner|share>.<png|jpg|pdf>?dpi=150&unduh=1`

## Logo di poster

- **Logo Universitas Ibn Khaldun Bogor** selalu tampil di pojok kanan atas pada semua ukuran (A2, X-banner, share). Berkasnya `public/assets/logo-universitas.png`; tidak bisa dimatikan dari form.
- **Logo sponsor** dikelola di menu **Logo Sponsor** (`/sponsor.html`):
  - Unggah logo (PNG/JPG, sisi terpanjang minimal 600 px, sisi terpendek minimal 100 px; PNG transparan disarankan).
  - Logo milik prodi hanya terlihat dan bisa diubah oleh prodi itu. Logo **umum** (dipakai semua prodi) hanya dikelola admin.
  - Di form penelitian, bagian **6. Logo sponsor**: centang sponsor lalu pilih posisi **Kiri atas** atau **Kanan bawah**. Posisi bisa diubah kapan saja lewat Edit. Maksimal 3 logo per posisi.
  - Mengganti atau menghapus logo di pustaka otomatis memperbarui poster yang memakainya.
  - Di X-banner, logo kanan bawah berada di atas zona aman 215 px.

## Integrasi dengan Journey (direktori dosen)

Aplikasi ini terhubung ke **Journey** lewat API (`JOURNEY_API_URL` + `JOURNEY_API_KEY` di `.env`):

- **Pembimbing dari database Journey.** Di form, ketik nama pembimbing lalu pilih dari daftar (pencarian ke Journey).
  Pembimbing dari **luar UIKA** cukup diketik manual (tidak terhubung ke Journey).
- **Poster tampil di Journey.** Setiap penelitian disimpan/diubah, poster ukuran **share** otomatis dikirim ke tab **Produk**
  Journey dan ke section **Produk Bimbingan** di profil tiap dosen pembimbing yang dipilih dari Journey. Dihapus di sini = hilang di Journey.
  Tombol manual: `POST /api/penelitian/:slug/sinkron-journey`. Status terakhir tersimpan di kolom `journey_status`.
- **Gelar dibuang otomatis** (Prof, Dr, Ir, H, S.Kom, M.Kom, S.T., Ph.D, dst.) dari nama peneliti, anggota tim, dan pembimbing
  pada **semua ukuran poster** serta di API/webhook. Nama yang seluruhnya huruf kapital diubah menjadi Huruf Awal Kapital.
  Aturannya ada di `src/nama.js`; uji: `node --test test/nama.test.js`.
- Tanpa konfigurasi Journey, semuanya tetap jalan; hanya pencarian dosen dan pengiriman ke Journey yang nonaktif.
