const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const CACHE_DIR = path.join(__dirname, '..', 'cache');
fs.mkdirSync(CACHE_DIR, { recursive: true });

// w,h = ukuran rancangan (px CSS). mm = ukuran cetak fisik. dpi = resolusi bawaan hasil gambar.
const FORMATS = {
  a2:      { label: 'Poster A2 (42 × 59,4 cm)', w: 1260, h: 1782, mm: [420, 594],  dpi: 150, minDpi: 40, maxDpi: 300 },
  xbanner: { label: 'X-Banner (60 × 160 cm)',   w: 1200, h: 3200, mm: [600, 1600], dpi: 100, minDpi: 30, maxDpi: 150 },
  share:   { label: 'Bagikan (1080 × 1350)',    w: 1080, h: 1350, mm: null,        dpi: null },
};

let browserPromise = null;
async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: true,
      executablePath: process.env.CHROME_PATH || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
    });
    browserPromise.then(b => b.on('disconnected', () => { browserPromise = null; }))
      .catch(() => { browserPromise = null; });
  }
  return browserPromise;
}
async function closeBrowser() {
  if (browserPromise) { try { (await browserPromise).close(); } catch {} browserPromise = null; }
}

// Render satu per satu agar memori tidak membengkak (X-banner resolusi tinggi cukup besar).
let chain = Promise.resolve();
function enqueue(fn) {
  const run = chain.then(() => fn());
  chain = run.catch(() => {});
  return run;
}

function resolveDpi(fmt, dpiParam) {
  const f = FORMATS[fmt];
  if (!f.mm) return null;
  let dpi = parseInt(dpiParam, 10);
  if (!Number.isFinite(dpi)) dpi = f.dpi;
  return Math.min(f.maxDpi, Math.max(f.minDpi, dpi));
}

function pixelSize(fmt, dpi) {
  const f = FORMATS[fmt];
  if (!f.mm) return { width: f.w, height: f.h, scale: 1 };
  const scale = (dpi * f.mm[0]) / 25.4 / f.w;
  return { width: Math.round(f.w * scale), height: Math.round(f.h * scale), scale };
}

async function renderOnce({ url, fmt, ext, dpi }) {
  const f = FORMATS[fmt];
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    const { scale } = pixelSize(fmt, dpi);
    await page.setViewport({ width: f.w, height: f.h, deviceScaleFactor: ext === 'pdf' ? 1 : scale });
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction('window.__ready === true', { timeout: 60000 });
    const info = await page.evaluate(() => ({ skala: window.__skala, overflow: window.__overflow, kualitas: window.__kualitas || [] }));
    let buffer;
    if (ext === 'pdf') {
      buffer = Buffer.from(await page.pdf({
        width: `${f.mm ? f.mm[0] : f.w * 0.2646}mm`,
        height: `${f.mm ? f.mm[1] : f.h * 0.2646}mm`,
        scale: f.mm ? (f.mm[0] / 25.4 * 96) / f.w : 1,
        printBackground: true,
        pageRanges: '1',
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
      }));
    } else {
      buffer = Buffer.from(await page.screenshot(
        ext === 'jpg' ? { type: 'jpeg', quality: 92 } : { type: 'png' }
      ));
    }
    return { buffer, info };
  } finally {
    await page.close().catch(() => {});
  }
}

// Mengembalikan { file, mime, info } dan memakai cache berdasarkan versi data (updated_at).
async function renderPoster({ slug, version, fmt, ext, dpiParam, baseUrl }) {
  if (!FORMATS[fmt]) throw Object.assign(new Error('Format tidak dikenal'), { status: 404 });
  if (!['png', 'jpg', 'pdf'].includes(ext)) throw Object.assign(new Error('Tipe berkas tidak dikenal'), { status: 404 });
  if (ext === 'pdf' && fmt === 'share') throw Object.assign(new Error('PDF hanya untuk A2 dan X-Banner'), { status: 400 });

  const dpi = resolveDpi(fmt, dpiParam);
  const key = `${slug}__${version}__${fmt}__${dpi || 'x'}__v2.${ext}`;
  const file = path.join(CACHE_DIR, key);
  const meta = file + '.json';
  const mime = ext === 'png' ? 'image/png' : ext === 'jpg' ? 'image/jpeg' : 'application/pdf';

  if (fs.existsSync(file) && fs.existsSync(meta)) {
    return { file, mime, info: JSON.parse(fs.readFileSync(meta, 'utf8')), dpi };
  }
  const result = await enqueue(async () => {
    if (fs.existsSync(file) && fs.existsSync(meta)) return null;
    return renderOnce({ url: `${baseUrl}/poster-html/${slug}/${fmt}`, fmt, ext, dpi });
  });
  if (result) {
    fs.writeFileSync(file, result.buffer);
    fs.writeFileSync(meta, JSON.stringify(result.info));
  }
  return { file, mime, info: JSON.parse(fs.readFileSync(meta, 'utf8')), dpi };
}

// Ambang resolusi efektif foto di atas kertas (dpi): poster dilihat dari ±1–2 m, banner dari ±2 m.
const AMBANG_DPI = { a2: { baik: 150, cukup: 100 }, xbanner: { baik: 100, cukup: 70 } };
function nilaiKualitas(fmt, list) {
  const t = AMBANG_DPI[fmt];
  if (!t || !Array.isArray(list)) return null;
  const items = list.map(k => ({ ...k, status: k.dpi >= t.baik ? 'baik' : k.dpi >= t.cukup ? 'cukup' : 'rendah' }));
  const status = items.some(i => i.status === 'rendah') ? 'rendah' : items.some(i => i.status === 'cukup') ? 'cukup' : 'baik';
  return { ambang: t, status, min_dpi: items.length ? Math.min(...items.map(i => i.dpi)) : null, items };
}

function clearCache(slug) {
  for (const n of fs.readdirSync(CACHE_DIR)) {
    if (n.startsWith(slug + '__')) fs.rmSync(path.join(CACHE_DIR, n), { force: true });
  }
}

module.exports = { nilaiKualitas, AMBANG_DPI, FORMATS, renderPoster, clearCache, closeBrowser, pixelSize, resolveDpi };
