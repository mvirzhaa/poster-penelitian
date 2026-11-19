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
