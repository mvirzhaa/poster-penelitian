// Pembantu bersama untuk halaman admin/staf: panggilan API, header, ganti kata sandi.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTgl = d => new Date(d).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const BASE = window.__BASE__ 
  || document.querySelector('base')?.getAttribute('href')?.replace(/\/+$/, '') 
  || (location.pathname.startsWith('/poster') ? '/poster' : '');
const u = path => BASE + (path.startsWith('/') ? path : '/' + path);

async function api(url, opt = {}) {
  const fullUrl = (url.startsWith('http') || (BASE && url.startsWith(BASE + '/'))) ? url : u(url);
  const r = await fetch(fullUrl, opt);
  let j = null; try { j = await r.json(); } catch {}
  if (r.status === 401 && !url.includes('/api/login')) {
    location.href = 'https://eportal.uika-bogor.ac.id';
    throw new Error('Sesi berakhir');
  }
  if (!r.ok) throw new Error(j?.error || 'Terjadi kesalahan (' + r.status + ')');
  return j;
}
const jsonOpt = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

let ME = null;
async function initHeader(aktif, judul) {
  ME = await api('/api/me');
  const bar = $('#bar');
  bar.innerHTML = `<h1>${esc(judul || 'Poster Penelitian')}</h1>
    <nav><a href="${u('/')}" class="${aktif === 'data' ? 'on' : ''}">Data Penelitian</a><a href="${u('/sponsor.html')}" class="${aktif === 'sponsor' ? 'on' : ''}">Logo Sponsor</a>${ME.peran === 'admin' ? `<a href="${u('/admin.html')}" class="${aktif === 'admin' ? 'on' : ''}">Admin</a>` : ''}</nav>
    <span class="sp"></span>
    <div class="who"><b>${esc(ME.nama)}</b><small>${ME.peran === 'admin' ? 'Admin' : esc(ME.prodi_nama || 'Tanpa prodi')} · <a id="gs">Ganti sandi</a> · <a id="keluar">Keluar</a></small></div>`;
  $('#keluar').onclick = async () => {
    try { await fetch(u('/api/logout'), { method: 'POST' }); } catch {}
    location.href = 'https://eportal.uika-bogor.ac.id';
  };
  $('#gs').onclick = bukaGantiSandi;
  if (ME.sandi_default) {
    const a = document.createElement('div'); a.className = 'alert';
    a.innerHTML = 'Kata sandi Anda masih bawaan/sementara. <a id="gs2">Ganti sekarang</a> demi keamanan data.';
    bar.after(a); $('#gs2').onclick = bukaGantiSandi;
  }
  return ME;
}

function bukaGantiSandi() {
  const d = document.createElement('dialog');
  d.innerHTML = `<form method="dialog" id="fgs"><h3>Ganti kata sandi</h3>
    <label>Kata sandi lama<input type="password" name="lama" required autocomplete="current-password"></label>
    <label>Kata sandi baru <span class="h">(minimal 8 karakter)</span><input type="password" name="baru" required minlength="8" autocomplete="new-password"></label>
    <p class="msg" id="gsm" style="margin:10px 0 0;font-size:13px"></p>
    <div class="row"><button type="button" class="btn" id="gsb">Batal</button><button class="btn pri" type="submit">Simpan</button></div></form>`;
  document.body.appendChild(d); d.showModal();
  $('#gsb', d).onclick = () => { d.close(); d.remove(); };
  $('#fgs', d).onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    try {
      await api('/api/ganti-sandi', jsonOpt('POST', { lama: f.lama.value, baru: f.baru.value }));
      alert('Kata sandi berhasil diganti.');
      d.close(); d.remove();
      $('.alert')?.remove();
    } catch (err) {
      $('#gsm', d).textContent = err.message; $('#gsm', d).className = 'msg err';
    }
  };
}
