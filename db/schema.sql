CREATE TABLE IF NOT EXISTS penelitian (
  id              SERIAL PRIMARY KEY,
  slug            TEXT UNIQUE NOT NULL,
  judul           TEXT NOT NULL,
  subjudul        TEXT NOT NULL DEFAULT '',
  institusi       TEXT NOT NULL DEFAULT '',
  unit            TEXT NOT NULL DEFAULT '',
  tahun           TEXT NOT NULL DEFAULT '',
  peneliti_nama   TEXT NOT NULL,
  peneliti_info   TEXT NOT NULL DEFAULT '',
  anggota         TEXT NOT NULL DEFAULT '',
  pembimbing1     TEXT NOT NULL DEFAULT '',
  pembimbing2     TEXT NOT NULL DEFAULT '',
  foto_peneliti   TEXT,
  logo            TEXT,
  ringkasan       TEXT NOT NULL DEFAULT '',
  latar_belakang  TEXT NOT NULL DEFAULT '',
  tujuan          TEXT NOT NULL DEFAULT '',
  metode          TEXT NOT NULL DEFAULT '',
  hasil           TEXT NOT NULL DEFAULT '',
  kesimpulan      TEXT NOT NULL DEFAULT '',
  pustaka         TEXT NOT NULL DEFAULT '',
  ucapan          TEXT NOT NULL DEFAULT '',
  kontak          TEXT NOT NULL DEFAULT '',
  url_qr          TEXT NOT NULL DEFAULT '',
  tema            TEXT NOT NULL DEFAULT 'biru',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS foto_penelitian (
  id             SERIAL PRIMARY KEY,
  penelitian_id  INT NOT NULL REFERENCES penelitian(id) ON DELETE CASCADE,
  file           TEXT NOT NULL,
  keterangan     TEXT NOT NULL DEFAULT '',
  urutan         INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_foto_penelitian ON foto_penelitian(penelitian_id, urutan);

-- ===== Akun, prodi, dan akses =====
CREATE TABLE IF NOT EXISTS prodi (
  id    SERIAL PRIMARY KEY,
  kode  TEXT UNIQUE NOT NULL,
  nama  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pengguna (
  id             SERIAL PRIMARY KEY,
  username       TEXT UNIQUE NOT NULL,
  nama           TEXT NOT NULL,
  sandi          TEXT NOT NULL,
  peran          TEXT NOT NULL DEFAULT 'tu' CHECK (peran IN ('admin','tu')),
  prodi_id       INT REFERENCES prodi(id) ON DELETE SET NULL,
  aktif          BOOLEAN NOT NULL DEFAULT TRUE,
  sandi_default  BOOLEAN NOT NULL DEFAULT FALSE,
  dibuat         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sesi (
  token        TEXT PRIMARY KEY,
  pengguna_id  INT NOT NULL REFERENCES pengguna(id) ON DELETE CASCADE,
  kedaluwarsa  TIMESTAMPTZ NOT NULL
);

-- SSO & Integrasi Akun E-Portal
ALTER TABLE pengguna ADD COLUMN IF NOT EXISTS sso_id TEXT;
ALTER TABLE pengguna ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE pengguna ADD COLUMN IF NOT EXISTS nidn TEXT;
ALTER TABLE pengguna ADD COLUMN IF NOT EXISTS npm TEXT;
ALTER TABLE pengguna ALTER COLUMN sandi DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pengguna_sso_id ON pengguna(sso_id) WHERE sso_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pengguna_email ON pengguna(lower(email)) WHERE email IS NOT NULL;

ALTER TABLE penelitian ADD COLUMN IF NOT EXISTS prodi_id    INT REFERENCES prodi(id) ON DELETE SET NULL;
ALTER TABLE penelitian ADD COLUMN IF NOT EXISTS dibuat_oleh INT REFERENCES pengguna(id) ON DELETE SET NULL;
ALTER TABLE penelitian ADD COLUMN IF NOT EXISTS diubah_oleh INT REFERENCES pengguna(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_penelitian_prodi ON penelitian(prodi_id, updated_at DESC);

-- ===== Integrasi aplikasi lain =====
CREATE TABLE IF NOT EXISTS kunci_api (
  id                 SERIAL PRIMARY KEY,
  nama               TEXT NOT NULL,
  prefiks            TEXT NOT NULL,
  hash               TEXT UNIQUE NOT NULL,
  prodi_id           INT REFERENCES prodi(id) ON DELETE CASCADE,
  aktif              BOOLEAN NOT NULL DEFAULT TRUE,
  dibuat             TIMESTAMPTZ NOT NULL DEFAULT now(),
  terakhir_dipakai   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS webhook (
  id        SERIAL PRIMARY KEY,
  nama      TEXT NOT NULL,
  url       TEXT NOT NULL,
  rahasia   TEXT NOT NULL,
  prodi_id  INT REFERENCES prodi(id) ON DELETE CASCADE,
  aktif     BOOLEAN NOT NULL DEFAULT TRUE,
  dibuat    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS webhook_log (
  id          SERIAL PRIMARY KEY,
  webhook_id  INT REFERENCES webhook(id) ON DELETE CASCADE,
  event       TEXT NOT NULL,
  slug        TEXT,
  status      INT,
  ok          BOOLEAN NOT NULL DEFAULT FALSE,
  detail      TEXT,
  waktu       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_webhook_log ON webhook_log(waktu DESC);

-- ===== Logo sponsor =====
CREATE TABLE IF NOT EXISTS sponsor (
  id        SERIAL PRIMARY KEY,
  nama      TEXT NOT NULL,
  file      TEXT NOT NULL,
  prodi_id  INT REFERENCES prodi(id) ON DELETE CASCADE,   -- NULL = umum (semua prodi)
  dibuat_oleh INT REFERENCES pengguna(id) ON DELETE SET NULL,
  dibuat    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS penelitian_sponsor (
  penelitian_id  INT NOT NULL REFERENCES penelitian(id) ON DELETE CASCADE,
  sponsor_id     INT NOT NULL REFERENCES sponsor(id) ON DELETE CASCADE,
  posisi         TEXT NOT NULL CHECK (posisi IN ('kiri_atas','kanan_bawah')),
  urutan         INT NOT NULL DEFAULT 0,
  PRIMARY KEY (penelitian_id, sponsor_id)
);

-- Integrasi Journey: pembimbing dapat dipilih dari database dosen Journey (slug) atau diketik manual (kosong)
ALTER TABLE penelitian ADD COLUMN IF NOT EXISTS pembimbing1_ref TEXT NOT NULL DEFAULT '';
ALTER TABLE penelitian ADD COLUMN IF NOT EXISTS pembimbing2_ref TEXT NOT NULL DEFAULT '';
ALTER TABLE penelitian ADD COLUMN IF NOT EXISTS journey_status  TEXT NOT NULL DEFAULT '';
ALTER TABLE penelitian ADD COLUMN IF NOT EXISTS journey_pesan   TEXT NOT NULL DEFAULT '';
ALTER TABLE penelitian ADD COLUMN IF NOT EXISTS journey_at      TIMESTAMPTZ;

-- ===== Revisi isian: Peneliti Utama + Anggota Peneliti (maks 5), abstrak, anggaran, output =====
ALTER TABLE penelitian ADD COLUMN IF NOT EXISTS anggota_peneliti  JSONB NOT NULL DEFAULT '[]';   -- [{nama, ref}] ref = slug dosen Journey atau ''
ALTER TABLE penelitian ADD COLUMN IF NOT EXISTS abstrak           TEXT  NOT NULL DEFAULT '';
ALTER TABLE penelitian ADD COLUMN IF NOT EXISTS anggaran          TEXT  NOT NULL DEFAULT '';
ALTER TABLE penelitian ADD COLUMN IF NOT EXISTS sumber_anggaran   TEXT  NOT NULL DEFAULT '';
ALTER TABLE penelitian ADD COLUMN IF NOT EXISTS output_penelitian JSONB NOT NULL DEFAULT '[]';   -- ["Scopus Q1","Sinta 2",...]

-- Data lama: pembimbing 1/2 menjadi anggota peneliti; ringkasan menjadi abstrak (hanya bila kolom baru masih kosong)
UPDATE penelitian SET anggota_peneliti = (
  SELECT COALESCE(jsonb_agg(jsonb_build_object('nama', v.n, 'ref', v.r) ORDER BY v.o), '[]'::jsonb)
  FROM (VALUES (1, pembimbing1, pembimbing1_ref), (2, pembimbing2, pembimbing2_ref)) AS v(o, n, r) WHERE v.n <> '')
WHERE anggota_peneliti = '[]'::jsonb AND (pembimbing1 <> '' OR pembimbing2 <> '');
UPDATE penelitian SET abstrak = COALESCE(NULLIF(ringkasan, ''), NULLIF(latar_belakang, ''), '')
WHERE abstrak = '' AND (ringkasan <> '' OR latar_belakang <> '');

-- Pengaturan elemen poster yang ditampilkan/disembunyikan: {"abstrak":true,"sumber_anggaran":false,...}. Kunci yang belum ada memakai nilai bawaan (lihat src/tampil.js).
ALTER TABLE penelitian ADD COLUMN IF NOT EXISTS tampil JSONB NOT NULL DEFAULT '{}';

-- Peneliti utama dapat berasal dari dosen Journey (slug Journey); kosong = diketik manual.
ALTER TABLE penelitian ADD COLUMN IF NOT EXISTS peneliti_ref TEXT NOT NULL DEFAULT '';

-- Perbaikan: data yang tersimpan dengan SEMUA elemen "tidak tampil" (akibat form lama/cache browser) dikembalikan ke bawaan.
UPDATE penelitian SET tampil = '{}', updated_at = now()
 WHERE tampil <> '{}'::jsonb AND NOT EXISTS (SELECT 1 FROM jsonb_each(tampil) e WHERE e.value = 'true'::jsonb);

-- ===== Jenis penelitian & komponen biaya (diatur admin) =====
-- mode 'tetap' = nominal mengikuti angka yang ditetapkan admin; 'bebas' = nominal diisi pengguna (nominal di sini hanya saran/isian awal).
CREATE TABLE IF NOT EXISTS komponen_biaya (
  id       SERIAL PRIMARY KEY,
  jenis    TEXT NOT NULL CHECK (jenis IN ('skripsi','thesis','desertasi','dosen_mandiri','join_research')),
  nama     TEXT NOT NULL,
  nominal  BIGINT NOT NULL DEFAULT 0 CHECK (nominal >= 0),
  mode     TEXT NOT NULL DEFAULT 'tetap' CHECK (mode IN ('tetap','bebas')),
  sumber   JSONB NOT NULL DEFAULT '[]',     -- pilihan sumber dana: Mandiri / Hibah Internal / Hibah External
  urutan   INT NOT NULL DEFAULT 0,
  aktif    BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS idx_komponen_biaya ON komponen_biaya(jenis, urutan);

ALTER TABLE penelitian ADD COLUMN IF NOT EXISTS jenis_penelitian TEXT   NOT NULL DEFAULT '';
ALTER TABLE penelitian ADD COLUMN IF NOT EXISTS biaya            JSONB  NOT NULL DEFAULT '[]';   -- [{nama, nominal, sumber:[...]}] (salinan saat disimpan)
ALTER TABLE penelitian ADD COLUMN IF NOT EXISTS total_biaya      BIGINT NOT NULL DEFAULT 0;

-- Isian awal komponen (hanya bila tabel masih kosong)
INSERT INTO komponen_biaya (jenis,nama,nominal,mode,sumber,urutan)
SELECT j.jenis, k.nama, CASE WHEN k.nama='Biaya Intangible Bimbingan' THEN j.intang ELSE k.nominal END, 'tetap', k.sumber::jsonb, k.urutan
FROM (VALUES ('skripsi',1500000),('thesis',5000000),('desertasi',10000000)) AS j(jenis,intang)
CROSS JOIN (VALUES
  ('SPP',2000000,'["Mandiri"]',1),
  ('SKS',3500000,'["Mandiri"]',2),
  ('Biaya Kolokium/Seminar',300000,'["Mandiri"]',3),
  ('Biaya Sidang',1500000,'["Mandiri"]',4),
  ('Biaya Publikasi',700000,'["Mandiri","Hibah Internal"]',5),
  ('Operasional Penelitian',5000000,'["Mandiri","Hibah External"]',6),
  ('Biaya Intangible Bimbingan',0,'["Hibah Internal"]',7)
) AS k(nama,nominal,sumber,urutan)
WHERE NOT EXISTS (SELECT 1 FROM komponen_biaya);
INSERT INTO komponen_biaya (jenis,nama,nominal,mode,sumber,urutan)
SELECT j.jenis, k.nama, k.nominal, 'bebas', k.sumber::jsonb, k.urutan
FROM (VALUES ('dosen_mandiri'),('join_research')) AS j(jenis)
CROSS JOIN (VALUES
  ('Biaya Publikasi',8000000,'["Hibah External"]',1),
  ('Operasional Penelitian',5000000,'["Mandiri","Hibah External"]',2),
  ('Biaya Intangible Penelitian',1500000,'["Hibah Internal"]',3)
) AS k(nama,nominal,sumber,urutan)
WHERE NOT EXISTS (SELECT 1 FROM komponen_biaya WHERE jenis IN ('dosen_mandiri','join_research'));

-- ===== Fakultas pada prodi + daftar prodi UIKA =====
ALTER TABLE prodi ADD COLUMN IF NOT EXISTS fakultas TEXT NOT NULL DEFAULT '';
UPDATE prodi SET nama='Informatika' WHERE kode='informatika' AND nama='Teknik Informatika';
INSERT INTO prodi (kode,nama,fakultas) VALUES
  ('pendidikan-bahasa-inggris','Pendidikan Bahasa Inggris','Fakultas Keguruan dan Ilmu Pendidikan (FKIP)'),
  ('pendidikan-masyarakat','Pendidikan Masyarakat (Luar Sekolah)','Fakultas Keguruan dan Ilmu Pendidikan (FKIP)'),
  ('teknologi-pendidikan','Teknologi Pendidikan','Fakultas Keguruan dan Ilmu Pendidikan (FKIP)'),
  ('pendidikan-vokasional-fashion','Pendidikan Vokasional Desain Fashion','Fakultas Keguruan dan Ilmu Pendidikan (FKIP)'),
  ('matematika','Matematika','Fakultas Keguruan dan Ilmu Pendidikan (FKIP)'),
  ('ppg','Program Profesi Guru (PPG)','Fakultas Keguruan dan Ilmu Pendidikan (FKIP)'),
  ('ilmu-hukum','Ilmu Hukum','Fakultas Hukum'),
  ('manajemen','Manajemen','Fakultas Ekonomi dan Bisnis (FEB)'),
  ('akuntansi','Akuntansi','Fakultas Ekonomi dan Bisnis (FEB)'),
  ('bisnis-digital','Bisnis Digital','Fakultas Ekonomi dan Bisnis (FEB)'),
  ('perdagangan-internasional','Perdagangan Internasional','Fakultas Ekonomi dan Bisnis (FEB)'),
  ('perbankan-keuangan-digital','Perbankan dan Keuangan Digital','Fakultas Ekonomi dan Bisnis (FEB)'),
  ('pai','Pendidikan Agama Islam (PAI)','Fakultas Agama Islam (FAI)'),
  ('hukum-keluarga-islam','Hukum Keluarga Islam','Fakultas Agama Islam (FAI)'),
  ('kpi','Komunikasi dan Penyiaran Islam (KPI)','Fakultas Agama Islam (FAI)'),
  ('ekonomi-syariah','Ekonomi Syariah','Fakultas Agama Islam (FAI)'),
  ('pgmi','Pendidikan Guru Madrasah Ibtidaiyah (PGMI)','Fakultas Agama Islam (FAI)'),
  ('bkpi','Bimbingan dan Konseling Pendidikan Islam (BKPI)','Fakultas Agama Islam (FAI)'),
  ('manajemen-haji-umrah','Manajemen Haji dan Umrah','Fakultas Agama Islam (FAI)'),
  ('ilmu-quran-tafsir','Ilmu Al-Qur''an dan Tafsir','Fakultas Agama Islam (FAI)'),
  ('teknik-sipil','Teknik Sipil','Fakultas Teknik dan Sains (FTS)'),
  ('teknik-mesin','Teknik Mesin','Fakultas Teknik dan Sains (FTS)'),
  ('teknik-elektro','Teknik Elektro','Fakultas Teknik dan Sains (FTS)'),
  ('informatika','Informatika','Fakultas Teknik dan Sains (FTS)'),
  ('sistem-informasi','Sistem Informasi','Fakultas Teknik dan Sains (FTS)'),
  ('rekayasa-pertanian-biosistem','Rekayasa Pertanian dan Biosistem','Fakultas Teknik dan Sains (FTS)'),
  ('ilmu-lingkungan','Ilmu Lingkungan','Fakultas Teknik dan Sains (FTS)'),
  ('kesehatan-masyarakat','Kesehatan Masyarakat','Fakultas Ilmu Kesehatan (FIK)'),
  ('gizi','Gizi','Fakultas Ilmu Kesehatan (FIK)')
ON CONFLICT (kode) DO UPDATE SET fakultas = CASE WHEN prodi.fakultas='' THEN EXCLUDED.fakultas ELSE prodi.fakultas END;

-- Gabungkan duplikat prodi 'Teknik Informatika' (mis. dibuat otomatis oleh SSO dari E-Portal) ke prodi 'informatika'
DO $$
DECLARE
  target_id INT;
  dup RECORD;
BEGIN
  SELECT id INTO target_id FROM prodi WHERE kode = 'informatika' LIMIT 1;
  IF target_id IS NOT NULL THEN
    FOR dup IN
      SELECT id FROM prodi
      WHERE id <> target_id
        AND (lower(kode) IN ('ft-ti', 'ft_ti', 'teknik-informatika') OR lower(nama) = 'teknik informatika')
    LOOP
      UPDATE pengguna SET prodi_id = target_id WHERE prodi_id = dup.id;
      UPDATE penelitian SET prodi_id = target_id WHERE prodi_id = dup.id;
      UPDATE sponsor SET prodi_id = target_id WHERE prodi_id = dup.id;
      UPDATE kunci_api SET prodi_id = target_id WHERE prodi_id = dup.id;
      UPDATE webhook SET prodi_id = target_id WHERE prodi_id = dup.id;
      DELETE FROM prodi WHERE id = dup.id;
    END LOOP;
  END IF;
END $$;
