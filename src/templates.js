const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

const THEMES = {
  biru:   { nama: 'Biru',    p: '#1d4ed8', pd: '#0b2a6b', a: '#fbbf24', l: '#eef3ff' },
  hijau:  { nama: 'Hijau',   p: '#0f7a52', pd: '#073d2a', a: '#facc15', l: '#ecf8f2' },
  marun:  { nama: 'Marun',   p: '#a3213f', pd: '#55101f', a: '#fbbf24', l: '#fcf0f3' },
  ungu:   { nama: 'Ungu',    p: '#6d34b0', pd: '#34175c', a: '#fcd34d', l: '#f5effc' },
  teal:   { nama: 'Teal',    p: '#0e7c86', pd: '#073f45', a: '#fb923c', l: '#e9f7f8' },
  oranye: { nama: 'Oranye',  p: '#c2480c', pd: '#6b2406', a: '#38bdf8', l: '#fff3ea' },
  hitam:  { nama: 'Hitam',   p: '#27303f', pd: '#0f141c', a: '#f59e0b', l: '#f1f3f6' },
};

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Teks isian -> paragraf & poin. Baris berawalan "-", "*", "•", atau "1." menjadi poin.
function rich(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  let out = '', inList = false, para = [];
  const flush = () => { if (para.length) { out += `<p>${para.join('<br>')}</p>`; para = []; } };
  const close = () => { if (inList) { out += '</ul>'; inList = false; } };
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) { flush(); close(); continue; }
    const m = l.match(/^(?:[-•*]|\d+[.)])\s+(.*)$/);
    if (m) { flush(); if (!inList) { out += '<ul>'; inList = true; } out += `<li>${esc(m[1])}</li>`; }
    else { close(); para.push(esc(l)); }
  }
  flush(); close();
  return out;
}

function ringkas(text, max) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), max * 0.7)).replace(/[,;:.\-–\s]+$/, '') + '…';
}

const initials = n => String(n || '?').replace(/\b(dr|ir|prof|drs|hj|h)\.?\s/gi, '').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase();

function titleSize(len, sizes) {
  const [s1, s2, s3, s4] = sizes;
  return len <= 55 ? s1 : len <= 95 ? s2 : len <= 145 ? s3 : s4;
}

const FONT_CSS = [400, 500, 600, 700, 800].map(w =>
  `@font-face{font-family:'Inter';font-weight:${w};font-style:normal;src:url('/fonts/inter-latin-${w}-normal.woff2') format('woff2');}`
).join('');

const BASE_CSS = `
${FONT_CSS}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:var(--W);height:var(--H);overflow:hidden;background:#fff}
body{font-family:'Inter',system-ui,sans-serif;color:#1c2330;-webkit-font-smoothing:antialiased}
.poster{--ts:1;position:relative;width:var(--W);height:var(--H);overflow:hidden;display:flex;flex-direction:column;background:#fff}
.poster>*{flex-shrink:0}
header{background:linear-gradient(135deg,var(--pd) 0%,var(--p) 100%);color:#fff;position:relative;overflow:hidden}
header::after{content:"";position:absolute;right:-140px;top:-140px;width:420px;height:420px;border-radius:50%;background:var(--a);opacity:.16}
header>*{position:relative;z-index:1}
header img.brand{float:right;height:var(--brand);width:auto;margin:0 0 14px 28px;filter:drop-shadow(0 4px 14px rgba(0,0,0,.4))}
.top{display:flex;align-items:center;gap:22px}
.top img.logo{height:var(--logo);width:auto;max-width:var(--logomax);object-fit:contain;background:#fff;border-radius:14px;padding:8px}
.inst{font-weight:700;letter-spacing:.06em;text-transform:uppercase;line-height:1.3}
.inst small{display:block;font-weight:500;opacity:.85;letter-spacing:.04em;text-transform:none}
.tahun{margin-left:auto;background:var(--a);color:#1a1a1a;font-weight:800;border-radius:999px;padding:.35em 1.1em}
h1{font-weight:800;line-height:1.12;letter-spacing:-.01em}
h2{font-weight:500;line-height:1.3;opacity:.92}
.avatar{flex:none;border-radius:50%;border:var(--ring) solid var(--a);overflow:hidden;background:var(--pd);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;box-shadow:0 8px 24px rgba(0,0,0,.28)}
.avatar img{width:100%;height:100%;object-fit:cover}
.who b{display:block;font-weight:800;line-height:1.2}
.who span{display:block;opacity:.88;line-height:1.35}
.lab{display:block;text-transform:uppercase;letter-spacing:.08em;font-weight:700;color:var(--a);margin-bottom:.25em}
.people{clear:both}
.ang b{display:block;font-weight:600;line-height:1.25}
.qrtop{flex:none;text-align:center}
.qrtop .qr{background:#fff;border-radius:14px;padding:10px}
.qrtop .qr svg{display:block;width:100%;height:100%}
.qrtop span{display:block;font-weight:600;opacity:.92;margin-top:6px}
main{padding:0}
.sec{break-inside:avoid;margin-bottom:var(--secgap)}
.sec h3{font-weight:800;color:var(--p);border-left:.28em solid var(--a);padding-left:.5em;line-height:1.1;margin-bottom:.45em;font-size:calc(var(--h3)*var(--ts))}
.sec p,.sec li{font-size:calc(var(--fs)*var(--ts));line-height:1.5;color:#27303f}
.sec p+p{margin-top:.5em}
.sec ul{padding-left:1.25em}
.sec li{margin-bottom:.25em}
.sec li::marker{color:var(--p)}
.sec.hl{background:var(--l);border-radius:18px;padding:.9em 1.1em}
.gal{flex:1 1 0;display:grid;gap:var(--galgap);grid-auto-rows:1fr;min-height:0}
.gal figure{position:relative;overflow:hidden;border-radius:16px;background:var(--l)}
.gal img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.gal figure.por img.bg{inset:-24px;width:calc(100% + 48px);height:calc(100% + 48px);object-fit:cover;filter:blur(20px) brightness(.8)}
.gal figure.por img.fg{object-fit:contain;padding:0 0 0 0}
.gal figcaption{position:absolute;left:0;right:0;bottom:0;padding:1.6em .8em .6em;font-size:var(--cap);font-weight:500;line-height:1.3;color:#fff;background:linear-gradient(transparent,rgba(0,0,0,.72))}
.gal.n1{grid-template-columns:1fr}
.gal.n2,.gal.n4{grid-template-columns:1fr 1fr}
footer{background:var(--pd);color:#e8edf7}
.spons{display:flex;align-items:center;gap:var(--spgap);flex-wrap:wrap}
.spons>span{font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:var(--spl);opacity:.85;margin-right:4px}
.spons img{height:var(--sp);width:auto;max-width:var(--spmax);object-fit:contain;background:#fff;border-radius:12px;padding:calc(var(--sp)*.14) calc(var(--sp)*.25);box-shadow:0 3px 12px rgba(0,0,0,.25)}
.spons-kiri_atas{margin-bottom:var(--spmb)}
footer h4{font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--a);margin-bottom:.35em}
footer p,footer li{line-height:1.45;opacity:.95}
footer ul{padding-left:1.1em}
.fgrid{display:flex;gap:var(--fgap)}
.fb{flex:1 1 0;min-width:0;display:flex;flex-direction:column;gap:var(--fbgap)}
.fb-out{flex:1.5 1 0}
.fb-full{flex:1.2 1 0}
.big{font-weight:800;color:#fff;line-height:1.15;font-size:var(--big)}
.chips{display:flex;flex-wrap:wrap;gap:var(--chipgap)}
.chip{border:2px solid var(--a);background:rgba(255,255,255,.1);color:#fff;border-radius:999px;font-weight:700;padding:.28em .85em;line-height:1.2;font-size:var(--chip)}
.fbar{display:flex;align-items:center;gap:30px}
.fk{flex:1 1 0;min-width:0}
.flogos{margin-left:auto;display:flex;align-items:center;gap:var(--lg);flex:none}
.flogos .apt{height:var(--apt);width:auto;flex:none;filter:drop-shadow(0 3px 10px rgba(0,0,0,.35))}
.flogos .spons{margin:0}
`;

const FORMAT_CSS = {
  a2: `
:root{--W:1260px;--H:1782px;--fs:25px;--h3:31px;--cap:19px;--secgap:26px;--galgap:16px;--logo:78px;--logomax:240px;--ring:6px;--brand:150px;--sp:54px;--spmax:190px;--spgap:12px;--spl:14px;--spmb:20px;--apt:118px;--big:30px;--chip:17px;--chipgap:9px;--fgap:44px;--fbgap:16px;--lg:26px}
header{padding:44px 64px 34px}
.top{margin-bottom:22px}.inst{font-size:21px}.inst small{font-size:19px}.tahun{font-size:22px}
h2{font-size:27px;margin-top:14px}
.people{display:flex;align-items:center;gap:32px;margin-top:26px}
.avatar{width:140px;height:140px;font-size:50px}
.who{flex:1 1 auto;min-width:0}
.who b{font-size:34px}.who span{font-size:21px}
.lab{font-size:15px}
.ang{flex:0 1 40%;padding-left:32px;border-left:3px solid rgba(255,255,255,.3)}
.ang .lst{display:flex;flex-direction:column;gap:6px}.ang b{font-size:23px;white-space:nowrap}
.qrtop .qr{width:150px;height:150px}.qrtop span{font-size:14px}
main{flex:1 1 auto;display:flex;flex-direction:column;padding:30px 64px 26px;min-height:0;gap:24px}
.abs{flex-shrink:0;margin-bottom:0}.abs .txt{column-count:1}
.gal{min-height:200px;max-height:620px;}.gal.tall{min-height:390px}
.gal.n3,.gal.n6{grid-template-columns:repeat(3,1fr)}
.gal.n5{grid-template-columns:repeat(6,1fr)}.gal.n5 figure{grid-column:span 2}.gal.n5 figure:nth-child(n+4){grid-column:span 3}
.gal.n7,.gal.n8{grid-template-columns:repeat(4,1fr)}
footer{padding:28px 64px 30px;display:flex;flex-direction:column;gap:22px}
footer h4{font-size:15px}footer p,footer li{font-size:calc(17px*var(--ts))}
`,
  xbanner: `
:root{--W:1200px;--H:3200px;--fs:32px;--h3:40px;--cap:26px;--secgap:30px;--galgap:20px;--logo:96px;--logomax:340px;--ring:9px;--brand:230px;--sp:92px;--spmax:320px;--spgap:20px;--spl:22px;--spmb:30px;--apt:210px;--big:46px;--chip:25px;--chipgap:14px;--fgap:44px;--fbgap:24px;--lg:40px}
header{padding:70px 72px 48px}
.top{margin-bottom:34px}.inst{font-size:30px}.inst small{font-size:26px}.tahun{font-size:32px}
h2{font-size:40px;margin-top:22px}
.people{display:grid;grid-template-columns:auto 1fr auto;grid-template-rows:auto auto;align-items:center;column-gap:36px;row-gap:22px;margin-top:38px}
.people .avatar{grid-column:1;grid-row:1/3}.people .who{grid-column:2;grid-row:1;align-self:end}.people .qrtop{grid-column:3;grid-row:1/3}
.people.noav{grid-template-columns:1fr auto}.people.noav .who,.people.noav .ang{grid-column:1}.people.noav .qrtop{grid-column:2}
.people.noqr{grid-template-columns:auto 1fr}.people.noqr.noav{grid-template-columns:1fr}
.people.nowho .ang{grid-row:1;border-top:0;padding-top:0}.people.nowho .avatar,.people.nowho .qrtop{grid-row:1}
.avatar{width:310px;height:310px;font-size:100px}
.who b{font-size:48px}.who span{font-size:29px;margin-top:4px}
.lab{font-size:21px}
.ang{grid-column:2;grid-row:2;align-self:start;padding-top:20px;border-top:3px solid rgba(255,255,255,.3);border-left:0;padding-left:0}
.ang .lst{display:flex;flex-direction:column;gap:8px}.ang b{font-size:32px}
.qrtop .qr{width:300px;height:300px}.qrtop span{font-size:24px}
main{flex:1 1 auto;display:flex;flex-direction:column;padding:44px 72px 0;min-height:0;gap:36px}
.abs{flex-shrink:0}
.gal{min-height:400px;max-height:1500px;}.gal.tall{min-height:700px}
.gal.n3,.gal.n5{grid-template-columns:1fr 1fr}.gal.n3 figure:first-child,.gal.n5 figure:first-child{grid-column:span 2}
.gal.n6,.gal.n7,.gal.n8{grid-template-columns:1fr 1fr}
footer{padding:40px 72px 215px;display:flex;flex-direction:column;gap:34px;margin-top:36px}
footer h4{font-size:22px}footer p,footer li{font-size:calc(26px*var(--ts))}
.fgrid{flex-wrap:wrap;row-gap:30px}.fb{flex:1 1 440px}.fb-ang{flex:0 0 430px}.fb-out{flex:1 1 480px}.fb-full{flex:1 1 100%}
`,
  share: `
:root{--W:1080px;--H:1350px;--fs:28px;--h3:30px;--cap:22px;--secgap:0px;--galgap:12px;--logo:64px;--logomax:200px;--ring:5px;--brand:128px;--sp:44px;--spmax:160px;--spgap:10px;--spl:12px;--spmb:14px;--apt:86px;--big:25px;--chip:15px;--chipgap:7px;--fgap:28px;--fbgap:8px;--lg:16px}
header{padding:40px 60px 30px}
.top{margin-bottom:20px}.inst{font-size:20px}.inst small{font-size:18px}.tahun{font-size:20px}
h2{font-size:24px;margin-top:10px}
.people{display:flex;align-items:center;gap:24px;margin-top:20px}
.avatar{width:116px;height:116px;font-size:40px;--ring:4px}
.who{flex:1 1 auto;min-width:0}.who b{font-size:30px}.who span{font-size:19px}
.lab{font-size:13px;margin-bottom:.1em}
.ang{flex:0 0 auto;padding-left:22px;border-left:3px solid rgba(255,255,255,.3)}.ang .lst{display:flex;flex-direction:column;gap:3px}.ang b{display:block;font-size:19px;font-weight:600;white-space:nowrap}
.qrtop .qr{width:112px;height:112px;padding:7px;border-radius:12px}.qrtop span{font-size:12px;margin-top:4px}
main{flex:1 1 auto;display:flex;flex-direction:column;padding:24px 60px 22px;min-height:0;gap:20px}
.gal{min-height:260px}
.gal.n3,.gal.n4,.gal.n5{grid-template-columns:1.5fr 1fr;grid-template-rows:1fr 1fr}.gal.n3 figure:first-child{grid-row:span 2}
.ring{font-size:calc(25px*var(--ts));line-height:1.45;color:#27303f;flex-shrink:0;border-left:8px solid var(--a);padding-left:22px}
.ring b{display:block;font-size:calc(14px*var(--ts));letter-spacing:.08em;text-transform:uppercase;color:var(--p);margin-bottom:.2em}
footer{padding:20px 60px 22px;display:flex;flex-direction:column;gap:14px}
footer h4{font-size:12px;margin-bottom:.2em}footer p{font-size:17px}
.fb-ang{flex:0 1 auto}.fb-ang>div+div{margin-top:6px}
`,
};

const AUTOFIT = `
(async()=>{
  try{await document.fonts.ready}catch(e){}
  await Promise.all([...document.images].map(i=>i.complete?Promise.resolve():new Promise(r=>{i.onload=i.onerror=r})));
  const p=document.getElementById('poster');
  const over=()=>p.scrollHeight>p.clientHeight+1;
  let ts=1;
  while(over()&&ts>0.5){ts=Math.round((ts-0.03)*100)/100;p.style.setProperty('--ts',ts)}
  const ipp=window.__INPX||0,kual=[];
  if(ipp)document.querySelectorAll('img[data-q]').forEach(el=>{
    const nw=el.naturalWidth,nh=el.naturalHeight;if(!nw||!nh)return;
    const b=el.getBoundingClientRect(),fit=getComputedStyle(el).objectFit;
    const s=fit==='contain'?Math.min(b.width/nw,b.height/nh):Math.max(b.width/nw,b.height/nh);
    kual.push({tipe:el.dataset.q,nama:el.dataset.n,dpi:Math.round(1/(s*ipp))});
  });
  window.__kualitas=kual;window.__skala=ts;window.__overflow=over();window.__ready=true;
})();`;

async function qrSvg(url) {
  if (!url) return '';
  return QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
}

async function isPortrait(file) {
  try {
    const m = await sharp(path.join(UPLOAD_DIR, path.basename(file))).metadata();
    return m.height / m.width > 1.25;
  } catch { return false; }
}

// Foto tegak (mis. tangkapan layar ponsel) ditampilkan utuh di atas latar buram agar tidak terpotong.
async function gallery(fotos, max) {
  const list = fotos.slice(0, max);
  if (!list.length) return '';
  const figs = await Promise.all(list.map(async (f, i) => {
    const src = `/uploads/${esc(f.file)}`;
    const cap = f.keterangan ? `<figcaption>${esc(f.keterangan)}</figcaption>` : '';
    const q = `data-q="foto" data-n="${esc(f.keterangan ? `Foto ${i + 1}: ${f.keterangan}` : `Foto ${i + 1}`)}"`;
    return (await isPortrait(f.file))
      ? `<figure class="por"><img class="bg" src="${src}" alt=""><img class="fg" src="${src}" alt="" ${q}>${cap}</figure>`
      : `<figure><img src="${src}" alt="" ${q}>${cap}</figure>`;
  }));
  const tall = figs.some(h => h.startsWith('<figure class="por"'));
  return `<div class="gal n${list.length}${tall ? ' tall' : ''}">${figs.join('')}</div>`;
}

function sponsorHtml(r, posisi) {
  const list = (r.sponsor || []).filter(x => x.posisi === posisi);
  if (!list.length) return '';
  const imgs = list.map(x => `<img src="/uploads/${esc(x.file)}" alt="${esc(x.nama)}" data-q="sponsor" data-n="${esc('Sponsor: ' + x.nama)}">`).join('');
  return `<div class="spons spons-${posisi}"><span>${posisi === 'kiri_atas' ? 'Didukung oleh' : 'Sponsor'}</span>${imgs}</div>`;
}

function avatar(r) {
  return `<div class="avatar">${r.foto_peneliti ? `<img src="/uploads/${esc(r.foto_peneliti)}" alt="" data-q="peneliti" data-n="Foto peneliti">` : esc(initials(r.peneliti_nama))}</div>`;
}

function topRow(r) {
  const inst = r.institusi || r.unit
    ? `<div class="inst">${esc(r.institusi)}${r.unit ? `<small>${esc(r.unit)}</small>` : ''}</div>` : '';
  const logo = r.logo ? `<img class="logo" src="/uploads/${esc(r.logo)}" alt="" data-q="logo" data-n="Logo">` : '';
  const tahun = r.tahun ? `<div class="tahun">${esc(r.tahun)}</div>` : '';
  return (logo || inst || tahun) ? `<div class="top">${logo}${inst}${tahun}</div>` : '';
}

const { bersihkanNama, anggotaPeneliti } = require('./nama');
const { petaTampil } = require('./tampil');

// Gelar selalu dibuang dari nama di semua ukuran poster.
const tanpaGelar = r => ({ ...r, peneliti_nama: bersihkanNama(r.peneliti_nama),
  anggota_peneliti: anggotaPeneliti(r).map(a => ({ ...a, nama: bersihkanNama(a.nama) })) });

// Identitas peneliti (di header): Peneliti Utama, Anggota Peneliti (maks 5), dan QR sejajar dengan peneliti.
function peopleHtml(r, qr, fmt, T) {
  const ang = anggotaPeneliti(r);
  const who = !T.peneliti_utama ? '' : `<div class="who"><small class="lab">Peneliti Utama</small><b>${esc(r.peneliti_nama)}</b>` +
`</div>`;
  const angHtml = ang.length && T.anggota
    ? `<div class="ang${ang.length > 3 ? ' many' : ''}"><small class="lab">Anggota Peneliti</small><div class="lst">${ang.map(a => `<b>${esc(a.nama)}</b>`).join('')}</div></div>` : '';
  const qrHtml = qr ? `<div class="qrtop"><div class="qr">${qr}</div><span>Pindai</span></div>` : '';
  // A2: avatar | peneliti | anggota | QR   X-banner: (avatar | peneliti | QR) lalu anggota di baris bawah
  const av = T.foto_peneliti ? avatar(r) : '';
  if (!av && !who && !angHtml && !qrHtml) return '';
  const cls = 'people' + (av ? '' : ' noav') + (qrHtml ? '' : ' noqr') + (who ? '' : ' nowho');
  return fmt === 'xbanner'
    ? `<div class="${cls}">${av}${who}${qrHtml}${angHtml}</div>`
    : `<div class="${cls}">${av}${who}${angHtml}${qrHtml}</div>`;
}

function abstrakHtml(r, fmt) {
  if (!(r.abstrak || '').trim()) return '';
  if (fmt === 'share') return `<div class="ring"><b>Abstrak</b>${esc(ringkas(r.abstrak, 380))}</div>`;
  return `<section class="sec abs"><h3>Abstrak</h3><div class="txt">${rich(r.abstrak)}</div></section>`;
}

// Penutup: anggaran, sumber anggaran, output penelitian, ucapan, kontak, lalu logo APT Unggul sejajar dengan sponsor kanan bawah.
function penutupHtml(r, fmt) {
  const out = Array.isArray(r.output_penelitian) ? r.output_penelitian : [];
  const blocks = [];
  const ang = [];
  if ((r.anggaran || '').trim()) ang.push(`<div><h4>Anggaran Penelitian</h4><div class="big">${esc(r.anggaran)}</div></div>`);
  if ((r.sumber_anggaran || '').trim()) ang.push(`<div><h4>Sumber Anggaran</h4><p>${esc(r.sumber_anggaran)}</p></div>`);
  if (ang.length) blocks.push(`<div class="fb fb-ang">${ang.join('')}</div>`);
  if (out.length) blocks.push(`<div class="fb fb-out"><h4>Output Penelitian</h4><div class="chips">${out.map(o => `<span class="chip">${esc(o)}</span>`).join('')}</div></div>`);
  if (fmt !== 'share' && (r.ucapan || '').trim()) blocks.push(`<div class="fb fb-full"><h4>Ucapan Terima Kasih</h4>${rich(r.ucapan)}</div>`);
  const kontak = (r.kontak || '').trim() ? `<div class="fk"><h4>Kontak</h4>${rich(r.kontak)}</div>` : '<div class="fk"></div>';
  const logos = `<div class="flogos">${r._t.logo_apt ? '<img class="apt" src="/assets/logo-apt-unggul.png" alt="Peringkat Akreditasi APT Unggul BAN-PT">' : ''}${sponsorHtml(r, 'kanan_bawah')}</div>`;
  return `<footer>${blocks.length ? `<div class="fgrid">${blocks.join('')}</div>` : ''}<div class="fbar">${kontak}${logos}</div></footer>`;
}

async function posterHtml(r0, fotos, fmt, { baseUrl, inPerPx = 0 } = {}) {
  const T = petaTampil(r0.tampil);
  const r = tanpaGelar(r0);
  r._t = T;
  // Elemen yang dimatikan dikosongkan sehingga judul bagiannya (mis. "Sumber Anggaran") ikut hilang.
  if (!T.logo_instansi) r.logo = null;
  if (!T.instansi) { r.institusi = ''; r.unit = ''; }
  if (!T.tahun) r.tahun = '';
  if (!T.subjudul) r.subjudul = '';
  if (!T.sponsor) r.sponsor = [];
  if (!T.abstrak) r.abstrak = '';
  if (!T.anggaran) r.anggaran = '';
  if (!T.sumber_anggaran) r.sumber_anggaran = '';
  if (!T.output) r.output_penelitian = [];
  if (!T.ucapan) r.ucapan = '';
  if (!T.kontak) r.kontak = '';
  if (!T.foto_produk) fotos = [];
  const t = THEMES[r.tema] || THEMES.biru;
  const target = r.url_qr || (baseUrl ? `${baseUrl}/p/${r.slug}` : '');
  const qr = T.qr ? await qrSvg(target) : '';
  const themeVars = `:root{--p:${t.p};--pd:${t.pd};--a:${t.a};--l:${t.l}}`;
  const sizes = { a2: [66, 58, 50, 42], xbanner: [78, 68, 60, 52], share: [58, 50, 43, 37] }[fmt];
  const fsz = titleSize(r.judul.length, sizes);
  const maxFoto = { a2: 8, xbanner: 6, share: 3 }[fmt];

  // Urutan isi: identitas peneliti -> abstrak -> foto produk -> penutup
  const body = `
<header><img class="brand" src="/assets/logo-universitas.png" alt="Universitas Ibn Khaldun Bogor">${sponsorHtml(r, 'kiri_atas')}${topRow(r)}
  <h1 style="font-size:${fsz}px">${esc(r.judul)}</h1>${r.subjudul ? `<h2>${esc(r.subjudul)}</h2>` : ''}
  ${peopleHtml(r, qr, fmt, T)}
</header>
<main>${abstrakHtml(r, fmt)}${T.foto_produk ? (await gallery(fotos, maxFoto) || '<div class="gal n1" style="background:var(--l);border-radius:16px"></div>') : ''}</main>
${penutupHtml(r, fmt)}`;

  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>${esc(r.judul)}</title>
<style>${themeVars}${BASE_CSS}${FORMAT_CSS[fmt]}</style></head>
<body><div class="poster" id="poster">${body}</div><script>window.__INPX=${Number(inPerPx) || 0};${AUTOFIT}</script></body></html>`;
}

module.exports = { posterHtml, THEMES, esc, ringkas };
