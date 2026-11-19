const slug = new URLSearchParams(location.search).get('slug');
const form = $('#f'), msg = $('#msg'), fotos = $('#fotos');
const MAX = 8;
let existing = [];

const SYARAT = { peneliti: { p: 800, s: 800, ideal: 1200 }, kegiatan: { p: 1600, s: 800, ideal: 1600, ideal1: 2400 }, logo: { p: 600, s: 100, ideal: 1000 } };

function setMsg(t, cls = '') { msg.textContent = t; msg.className = 'msg ' + cls; }

function ukuran(file) {
  return new Promise(res => {
    const u = URL.createObjectURL(file), im = new Image();
    im.onload = () => { res({ w: im.naturalWidth, h: im.naturalHeight }); URL.revokeObjectURL(u); };
    im.onerror = () => { res(null); URL.revokeObjectURL(u); };
    im.src = u;
  });
}

// Periksa resolusi di sisi peramban agar staf langsung tahu sebelum mengunggah.
async function cekFile(file, jenis, hintEl, pertama = false) {
  hintEl.className = 'hint';
  if (!file) { hintEl.textContent = ''; hintEl.dataset.ok = '1'; return true; }
  const d = await ukuran(file), s = SYARAT[jenis];
  if (!d) { hintEl.textContent = '✗ Berkas bukan gambar yang dapat dibaca (gunakan JPG/PNG/WebP).'; hintEl.classList.add('bad'); hintEl.dataset.ok = '0'; return false; }
  const panjang = Math.max(d.w, d.h), pendek = Math.min(d.w, d.h), info = `${d.w} × ${d.h} px`;
  if (panjang < s.p || pendek < s.s) {
    hintEl.textContent = `✗ ${info}: terlalu kecil dan akan tampak pecah saat dicetak. Minimal sisi panjang ${s.p} px dan sisi pendek ${s.s} px. Gunakan foto ukuran asli.`;
    hintEl.classList.add('bad'); hintEl.dataset.ok = '0'; return false;
  }
  const target = pertama && s.ideal1 ? s.ideal1 : s.ideal;
  if (jenis === 'peneliti' ? pendek < target : panjang < target) {
    hintEl.textContent = `⚠ ${info}: memenuhi syarat minimal, tetapi ${pertama && s.ideal1 ? 'foto utama sebaiknya ≥ ' + target + ' px' : 'lebih baik ≥ ' + target + ' px'} agar tajam.`;
    hintEl.classList.add('warn');
  } else { hintEl.textContent = `✓ ${info}: resolusi baik untuk cetak.`; hintEl.classList.add('ok'); }
  hintEl.dataset.ok = '1'; return true;
}

// Pratinjau + cek foto tunggal (peneliti, logo)
document.querySelectorAll('input[type=file][data-pv]').forEach(input => {
  input.addEventListener('change', () => {
    const box = document.getElementById(input.dataset.pv);
    const old = box.dataset.old || '';
    box.innerHTML = input.files[0] ? `<img class="${input.name === 'foto_peneliti' ? 'round' : ''}" src="${URL.createObjectURL(input.files[0])}">` : old;
    cekFile(input.files[0], input.dataset.jenis, document.querySelector(`[data-hint="${input.dataset.jenis}"]`));
  });
});

// Penghitung karakter (saran, bukan batas keras)
document.querySelectorAll('textarea[data-rec]').forEach(t => {
  const c = document.createElement('div'); c.className = 'cnt'; t.after(c);
  const upd = () => { const n = t.value.length, r = +t.dataset.rec; c.textContent = `${n} karakter · disarankan ≤ ${r}`; c.classList.toggle('over', n > r); };
  t.addEventListener('input', upd); upd(); t._upd = upd;
});

// Warna
api('/api/tema').then(list => {
  $('#themes').innerHTML = list.map((t, i) => `<label><input type="radio" name="tema" value="${t.id}" ${i === 0 ? 'checked' : ''}><span><i style="background:linear-gradient(135deg,${t.pd},${t.p})"></i>${t.nama}</span></label>`).join('');
  if (window.__tema) form.elements.tema.value = window.__tema;
});

// Logo sponsor: pilih logo + posisi (dapat diedit kapan saja)
let sponsorTerpilih = {};
async function muatSponsor() {
  const list = await api('/api/sponsor');
  const box = $('#sponsorList');
  if (!list.length) { box.innerHTML = `<p class="hint">Belum ada logo sponsor. <a href="${u('/sponsor.html')}" target="_blank">Tambahkan di sini</a>, lalu muat ulang halaman ini.</p>`; return; }
  box.innerHTML = list.map(x => {
    const pilih = sponsorTerpilih[x.id];
    return `<label class="spon ${pilih ? 'on' : ''}" data-id="${x.id}">
      <input type="checkbox" name="sponsor_id" value="${x.id}" ${pilih ? 'checked' : ''}>
      <span class="lg"><img src="${u('/uploads/' + esc(x.file))}" alt=""></span>
      <span class="nm">${esc(x.nama)}<small>${esc(x.prodi_nama || 'Umum')}</small></span>
      <select name="sponsor_pos_${x.id}" ${pilih ? '' : 'disabled'}>
        <option value="kiri_atas" ${pilih === 'kiri_atas' ? 'selected' : ''}>Kiri atas</option>
        <option value="kanan_bawah" ${pilih !== 'kiri_atas' ? 'selected' : ''}>Kanan bawah</option>
      </select></label>`;
  }).join('');
  $$('.spon', box).forEach(l => {
    const cb = $('input[type=checkbox]', l), sel = $('select', l);
    cb.onchange = () => { sel.disabled = !cb.checked; l.classList.toggle('on', cb.checked); };
  });
}

// Baris foto kegiatan
const totalFotos = () => existing.filter(e => !e.hapus).length + fotos.querySelectorAll('.foto.baru').length;
function refreshAdd() { $('#addFoto').disabled = totalFotos() >= MAX; }
const adaFotoSebelum = row => existing.filter(e => !e.hapus).length + [...fotos.querySelectorAll('.foto.baru')].indexOf(row);
function addRow() {
  if (totalFotos() >= MAX) return;
  const d = document.createElement('div'); d.className = 'foto baru';
  d.innerHTML = `<img alt=""><div><input type="file" accept="image/*"><div class="hint"></div><input type="text" placeholder="Keterangan foto (opsional)" maxlength="200" style="margin-top:6px"></div><button type="button" class="btn danger sm">Hapus</button>`;
  const file = d.querySelector('input[type=file]'), img = d.querySelector('img'), hint = d.querySelector('.hint');
  file.onchange = () => { if (file.files[0]) img.src = URL.createObjectURL(file.files[0]); cekFile(file.files[0], 'kegiatan', hint, adaFotoSebelum(d) === 0); };
  d.querySelector('button').onclick = () => { d.remove(); refreshAdd(); };
  fotos.appendChild(d); refreshAdd();
}
$('#addFoto').onclick = addRow;

function addExisting(f) {
  const d = document.createElement('div'); d.className = 'foto';
  d.innerHTML = `<img src="${u('/uploads/' + esc(f.file))}" alt=""><div><input type="text" name="ket_${f.id}" value="${esc(f.keterangan)}" placeholder="Keterangan foto" maxlength="200"></div>
    <label style="margin:0;font-weight:400;font-size:13px"><input type="checkbox" name="hapus_foto" value="${f.id}"> hapus</label>`;
  const cb = d.querySelector('input[type=checkbox]');
  cb.onchange = () => { f.hapus = cb.checked; d.style.opacity = cb.checked ? .4 : 1; refreshAdd(); };
  fotos.appendChild(d);
}

async function init() {
  await initHeader('data', 'Poster Penelitian');
  if (ME.peran === 'admin') {
    $('#fsProdi').hidden = false;
    const pr = await api('/api/prodi');
    pr.forEach(x => $('#selProdi').insertAdjacentHTML('beforeend', `<option value="${x.id}">${esc(x.nama)}</option>`));
    $('#selProdi').required = true;
  }
  if (!slug) { addRow(); await muatSponsor(); return; }
  $('#ttl').textContent = 'Edit data penelitian';
  const r = await api('/api/penelitian/' + slug).catch(e => { setMsg(e.message, 'err'); return null; });
  if (!r) return;
  for (const el of form.elements) {
    if (el.name && el.type !== 'file' && el.type !== 'radio' && el.type !== 'checkbox' && r[el.name] !== undefined) el.value = r[el.name] ?? '';
  }
  window.__tema = r.tema; if (form.elements.tema?.length) form.elements.tema.value = r.tema;
  document.querySelectorAll('textarea[data-rec]').forEach(t => t._upd());
  const withDel = (id, file, round) => {
    const box = $('#' + id); if (!file) return;
    box.innerHTML = `<img class="${round ? 'round' : ''}" src="${u('/uploads/' + esc(file))}"><label><input type="checkbox" name="${round ? 'hapus_foto_peneliti' : 'hapus_logo'}" value="1"> hapus</label>`;
    box.dataset.old = box.innerHTML;
  };
  withDel('pvFoto', r.foto_peneliti, true); withDel('pvLogo', r.logo, false);
  sponsorTerpilih = Object.fromEntries((r.sponsor || []).map(x => [x.id, x.posisi]));
  await muatSponsor();
  existing = r.foto; r.foto.forEach(addExisting);
  if (!r.foto.length) addRow(); else refreshAdd();
}
init();

form.addEventListener('submit', async e => {
  e.preventDefault();
  if ($$('.hint[data-ok="0"]').length) { setMsg('Ada foto yang resolusinya terlalu kecil. Ganti dengan foto ukuran asli (lihat pesan merah).', 'err'); return; }
  const fd = new FormData(form);
  fotos.querySelectorAll('.foto.baru').forEach(row => {
    const f = row.querySelector('input[type=file]').files[0];
    if (f) { fd.append('foto_kegiatan', f); fd.append('ket_baru', row.querySelector('input[type=text]').value); }
  });
  const btn = $('#save'); btn.disabled = true; setMsg('Menyimpan… (mengunggah foto bisa beberapa detik)');
  try {
    const j = await api(slug ? '/api/penelitian/' + slug : '/api/penelitian', { method: slug ? 'PUT' : 'POST', body: fd });
    location.href = u('/p/' + j.slug);
  } catch (err) { setMsg(err.message, 'err'); btn.disabled = false; }
});


// ---------- Pembimbing: cari di Journey atau ketik manual ----------
const dlDosen = $('#dlDosen');
let hasilDosen = [];           // hasil pencarian terakhir
let journeyAktif = true;

function hintPemb(no) {
  const inp = form.elements['pembimbing' + no], ref = form.elements['pembimbing' + no + '_ref'], h = $('#hintPemb' + no);
  if (!inp.value.trim()) { ref.value = ''; h.textContent = ''; h.removeAttribute('data-ok'); return; }
  if (ref.value && inp.dataset.pilih === undefined) inp.dataset.pilih = inp.value.trim(); // tautan tersimpan saat edit
  const cocok = hasilDosen.find(d => d.nama === inp.value.trim());
  if (cocok) ref.value = cocok.slug;
  else if (ref.value && inp.dataset.pilih !== inp.value.trim()) ref.value = ''; // teks diubah manual -> lepas dari Journey
  if (ref.value) { h.textContent = `✓ Pembimbing ${no}: terhubung ke dosen Journey — produk ini tampil di profil dosen tersebut.`; h.style.color = '#15803d'; }
  else { h.textContent = `Pembimbing ${no}: diketik manual (tidak terhubung ke Journey).`; h.style.color = ''; }
  if (ref.value) inp.dataset.pilih = inp.value.trim();
}

let tmrDosen;
document.querySelectorAll('input[data-pemb]').forEach(inp => {
  inp.addEventListener('input', () => {
    clearTimeout(tmrDosen);
    hintPemb(inp.dataset.pemb);
    const q = inp.value.trim();
    if (q.length < 2 || !journeyAktif) return;
    tmrDosen = setTimeout(async () => {
      try {
        const r = await api('/api/dosen?q=' + encodeURIComponent(q));
        if (r.aktif === false) { journeyAktif = false; return; }
        hasilDosen = r.data || [];
        dlDosen.innerHTML = hasilDosen.map(d => `<option value="${esc(d.nama)}">${esc([d.jabatan, d.prodi].filter(Boolean).join(' · '))}</option>`).join('');
        hintPemb(inp.dataset.pemb);
      } catch { /* diabaikan: tetap bisa diketik manual */ }
    }, 250);
  });
  inp.addEventListener('change', () => hintPemb(inp.dataset.pemb));
});
// saat mengedit: tampilkan status tautan yang tersimpan
setTimeout(() => { hintPemb(1); hintPemb(2); }, 800);
