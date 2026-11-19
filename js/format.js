// Utilidades pequenas e puras.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ms = x => (x ? new Date(x).getTime() : 0);
const pad = n => String(n).padStart(2, '0');
const mmss = x => { x = Math.max(0, Math.ceil(x / 1000)); return pad(Math.floor(x / 60)) + ':' + pad(x % 60); };
const clock = x => { const d = new Date(x); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const mins = x => Math.max(0, Math.round(x / 60000));
const toast = (msg, kind = '') => {
  const d = document.createElement('div'); d.className = 'toast ' + kind; d.textContent = msg; document.body.appendChild(d);
  setTimeout(() => d.classList.add('out'), 3200); setTimeout(() => d.remove(), 3700);
};
// Diálogo de confirmação próprio (melhor que confirm() no celular)
const confirmBox = msg => new Promise(res => {
  const b = document.createElement('div'); b.className = 'modal';
  b.innerHTML = '<div class="modal-in"><p></p><div class="row"><button class="btn d grow" data-v="0">CANCELAR</button><button class="btn y grow" data-v="1">CONFIRMAR</button></div></div>';
  $('p', b).textContent = msg; document.body.appendChild(b);
  b.onclick = e => { const v = e.target.closest('[data-v]'); if (v || e.target === b) { b.remove(); res(v && v.dataset.v === '1'); } };
});
