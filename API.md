# API Poster Penelitian (untuk aplikasi lain)

Dasar: `https://<alamat-aplikasi>/api/v1` · Format data: JSON (UTF-8).

## 1. Autentikasi
Admin membuat **kunci API** di menu *Admin → Kunci API* (kunci lengkap hanya tampil sekali). Kirim di setiap permintaan:

```
Authorization: Bearer pk_xxxxxxxxxxxxxxxx
```
(atau header `X-API-Key`). Kunci dapat dibatasi ke **satu prodi**; kunci tersebut hanya melihat data prodinya. Kunci yang dinonaktifkan/dihapus langsung ditolak (`401`).

## 2. Membaca data

| Metode & alamat | Keterangan |
|---|---|
| `GET /api/v1/prodi` | Daftar prodi dalam lingkup kunci |
| `GET /api/v1/penelitian?q=&prodi=<kode>&sejak=<ISO>&page=1&limit=20` | Daftar penelitian (maks. 100/halaman). `sejak` = hanya yang diubah sejak waktu itu (cocok untuk sinkronisasi berkala) |
| `GET /api/v1/penelitian/{slug}` | Detail lengkap: identitas, peneliti utama, anggota peneliti, foto, isi (abstrak, anggaran, sumber anggaran, output penelitian), tautan poster |
| `GET /api/v1/penelitian/{slug}/poster/{format}.{tipe}?dpi=&unduh=1` | **Mengunduh berkas poster** |

`format`: `a2` (42×59,4 cm), `xbanner` (60×160 cm), `share` (1080×1350 px).
`tipe`: `png`, `jpg`, `pdf` (PDF hanya untuk `a2` dan `xbanner`; gunakan PDF untuk cetak).
`dpi` (opsional): A2 40–300 (bawaan 150), X-Banner 30–150 (bawaan 100).

Contoh:
```bash
curl -H "Authorization: Bearer $KUNCI" "https://poster.contoh.go.id/api/v1/penelitian?prodi=informatika&limit=5"

curl -H "Authorization: Bearer $KUNCI" -o poster-a2.pdf \
  "https://poster.contoh.go.id/api/v1/penelitian/AbC123xy/poster/a2.pdf"
```

Contoh item pada daftar:
```json
{
  "slug": "AbC123xy",
  "judul": "…", "tahun": "2026",
  "peneliti": "Fitrah Fajar",   // peneliti utama
  "anggota_peneliti": ["Ahmad Syafiq", "Dewi Lestari"],   // maks. 5, tanpa gelar
  "prodi": { "kode": "informatika", "nama": "Teknik Informatika" },
  "diperbarui": "2026-11-18T11:54:00.000Z",
  "halaman": "https://poster.contoh.go.id/p/AbC123xy",
  "poster": {
    "a2":      { "png": "…/img/AbC123xy/a2.png", "jpg": "…", "pdf": "…/img/AbC123xy/a2.pdf" },
    "xbanner": { "png": "…", "jpg": "…", "pdf": "…" },
    "share":   { "png": "…", "jpg": "…" },
    "semua_zip": "…/img/AbC123xy/semua.zip"
  }
}
```
Tautan di `poster` bersifat publik (siapa pun yang punya tautan dapat membuka), sehingga dapat dipasang langsung pada `<img>` atau diunduh tanpa kunci. Gambar dibuat sesuai data terbaru dan di-cache; saat data diubah, gambar baru otomatis dibuat.

## 3. Menerima pemberitahuan (webhook)
Admin mendaftarkan **URL penerima** di *Admin → Webhook & log*. Setiap penelitian **dibuat / diperbarui / dihapus**, aplikasi mengirim `POST` JSON ke URL tersebut:

```json
{
  "event": "penelitian.diperbarui",
  "waktu": "2026-11-18T11:54:00.000Z",
  "penelitian": { "slug": "…", "judul": "…", "prodi": {…}, "poster": { … }, "foto": [ … ] }
}
```
`event`: `penelitian.dibuat`, `penelitian.diperbarui`, `penelitian.dihapus`, `ping` (uji koneksi).

Header: `X-Poster-Event` dan `X-Poster-Signature: sha256=<HMAC-SHA256 isi permintaan, kunci = rahasia tujuan>`.
Balas status **2xx** bila berhasil. Bila gagal (5xx/429/jaringan), dicoba ulang hingga 3 kali (jeda 1 dan 2 detik); semua hasil dicatat di halaman admin.

Verifikasi tanda tangan (Node.js):
```js
const sig = 'sha256=' + require('crypto').createHmac('sha256', RAHASIA).update(rawBody).digest('hex');
if (!require('crypto').timingSafeEqual(Buffer.from(sig), Buffer.from(req.headers['x-poster-signature']))) return res.sendStatus(401);
```
Python:
```python
import hmac, hashlib
sig = 'sha256=' + hmac.new(RAHASIA.encode(), raw_body, hashlib.sha256).hexdigest()
ok = hmac.compare_digest(sig, request.headers['X-Poster-Signature'])
```
Gunakan **isi mentah** (raw body) sebelum di-parse.

## 4. Mengirim berkas poster ke aplikasi lain
Selain tautan, berkas poster dapat **didorong** ke URL penerima yang sama:

* Dari halaman poster (staf): kotak *Kirim ke aplikasi lain*.
* Dari aplikasi lain lewat API:

```bash
curl -X POST -H "Authorization: Bearer $KUNCI" -H "Content-Type: application/json" \
  -d '{"webhook_id": 1, "format": "a2", "tipe": "pdf"}' \
  https://poster.contoh.go.id/api/v1/penelitian/AbC123xy/kirim
```
`GET /api/v1/webhook` menampilkan `id` tujuan yang boleh dipakai. Respons: `{"ok":true,"status":200,"tujuan":"…","format":"a2","tipe":"pdf"}` (`502` bila penerima gagal).

Penerima memperoleh `POST multipart/form-data` dengan bidang:
`event` (`poster.berkas`), `slug`, `judul`, `format`, `tipe`, `metadata` (JSON seperti §3), dan **`berkas`** (file).
Header: `X-Poster-Event`, `X-Poster-Timestamp`, dan `X-Poster-Signature: sha256=HMAC(rahasia, "<timestamp>.<slug>.<format>.<tipe>")`.
Tolak jika `timestamp` terlalu lama (mis. > 5 menit) untuk mencegah pemutaran ulang.

## 5. Kode galat
| Status | Arti |
|---|---|
| 400 | Parameter tidak valid (`{"error":"…"}`) |
| 401 | Kunci API tidak ada / salah / dinonaktifkan |
| 404 | Data tidak ada, atau di luar lingkup prodi kunci |
| 502 | Penerima webhook menolak/tidak dapat dihubungi (`/kirim`) |

## 6. Catatan
* Atur `PUBLIC_BASE_URL` di `.env` agar semua tautan dalam API/webhook memakai alamat publik yang benar.
* URL webhook boleh alamat internal (mis. `http://10.0.0.5/hook`) karena hanya admin yang dapat mendaftarkannya.

## Sponsor pada data penelitian

Detail penelitian (`GET /api/v1/penelitian/:slug`) dan payload webhook memuat:

```json
"sponsor": [
  { "nama": "Mitra A", "logo": "https://.../uploads/xxxx.png", "posisi": "kiri_atas" },
  { "nama": "Mitra B", "logo": "https://.../uploads/yyyy.png", "posisi": "kanan_bawah" }
]
```

`posisi` bernilai `kiri_atas` atau `kanan_bawah`. Logo UIKA di kanan atas selalu ada dan tidak termasuk daftar ini.


## Anggota peneliti & Journey

Setiap data penelitian membawa `peneliti` (peneliti utama) dan `anggota_peneliti` (maksimal 5 nama **tanpa gelar**). Pada payload webhook, anggota disertai tautan Journey:

```json
"peneliti_utama": { "nama": "Fitrah Fajar", "journey_slug": "fitrah-fajar-..." },
"anggota_peneliti": [
  { "nama": "Fitrah Satrya Fajar Kusumah", "journey_slug": "fitrah-satrya-gmail-com-2971" },
  { "nama": "Dewi Lestari", "journey_slug": null }
],
"abstrak": "…", "biaya": [{"nama":"SPP","nominal":2000000,"sumber":["Mandiri"]}], "anggaran": "Rp 14.500.000", "sumber_anggaran": "Mandiri, Hibah Internal",
"output_penelitian": ["Scopus Q1", "Sinta 2"]
```

Nilai `output_penelitian` yang valid: Scopus Q1–Q4, Sinta 1–4, Seminar Internasional, Seminar Nasional, Paten Sederhana, HKI, Buku, Teknologi Purwarupa, Kebijakan, Karya Monumental.

`journey_slug` berisi slug dosen di Journey bila dipilih dari database Journey, `null` bila diketik manual (dosen luar).

## Pengaturan tampil

Pada detail penelitian dan payload webhook ada `tampil`: objek `{kunci: true|false}` untuk tiap elemen poster (`abstrak`, `anggaran`, `sumber_anggaran`, `output`, `qr`, dst.). Elemen bernilai `false` tidak dicetak di poster. Bawaan: semua `true` kecuali `sumber_anggaran`.


### Jenis penelitian & biaya
Payload webhook dan detail memuat `jenis_penelitian` (`skripsi`, `thesis`, `desertasi`, `dosen_mandiri`, `join_research`), `total_biaya` (angka rupiah), dan pada detail `isi.biaya` (rincian komponen: `nama`, `nominal`, `sumber`). Poster hanya menampilkan total.
