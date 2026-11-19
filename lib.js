// Camada de dados compartilhada (jogador, staff, telão).
// Modo real: Supabase. Modo demo (?mock=1 ou sem credenciais): dados fictícios locais, só para visualizar.
window.FILA_CONFIG = window.FILA_CONFIG || {};
const FILA = (() => {
  const C = window.FILA_CONFIG;
  const params = new URLSearchParams(location.search);
  const MOCK = params.has('mock') || !C.SUPABASE_URL;
  let sb = null, offset = 0, tickets = [], cfg = { game_min: 20, extend_min: 10, gap_sec: 30 };
  const subs = new Set();
  const emit = () => subs.forEach(f => { try { f(); } catch (e) { console.error(e); } });
  const now = () => Date.now() + offset;
  const iso = ms => new Date(ms).toISOString();

  // ---------- dados de demonstração ----------
  function mockData() {
    const n = Date.now(), m = 60000, mk = (name, st, status, o = {}) => ({
      id: 'm' + Math.random().toString(36).slice(2, 8), name, station: st, status, fast: false, fast_at: null,
      jumped_from: null, extra_min: 0, queue_seq: Math.floor(Math.random() * 1e6), starts_at: null, ends_at: null, ...o });
    let q = 0;
    const play = (name, st, startedMin, extra = 0) => mk(name, st, 'playing', { starts_at: iso(n - startedMin * m), ends_at: iso(n + (20 + extra - startedMin) * m), extra_min: extra });
    const wait = (name, st, o = {}) => mk(name, st, 'waiting', { queue_seq: ++q, ...o });
    return [
      play('Marcos', 1, 14.6, 10), wait('Julia', 1), wait('Rafa', 1, { fast: true, fast_at: iso(n - 3 * m), jumped_from: 4 }), wait('Bianca', 1), wait('Thiago', 1), wait('Paulo', 1),
      play('Camila', 2, 16), wait('Lucas', 2), wait('Fernanda', 2), wait('Diego', 2),
      play('Renato', 3, 19.2), wait('Amanda', 3), wait('Gabriel', 3), wait('Leo', 3, { fast: true, fast_at: iso(n - 8 * m), jumped_from: 3 }), wait('Sofia', 3), wait('Vitor', 3), wait('Nina', 3),
      play('Priscila', 4, 4), wait('Caio', 4), wait('Daniel', 4),
    ];
  }

  async function init() {
    if (MOCK) { tickets = mockData(); setInterval(emit, 1000); return; }
    sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_KEY, { auth: { persistSession: false } });
    try {
      const t0 = Date.now(); const { data } = await sb.rpc('fila_now'); const t1 = Date.now();
      if (data) offset = new Date(data).getTime() - (t0 + t1) / 2;
      const c = await sb.from('fila_config').select('*').limit(1); if (c.data && c.data[0]) cfg = c.data[0];
    } catch (e) { console.warn('sync', e); }
    await refresh();
    let deb = null; const soft = () => { clearTimeout(deb); deb = setTimeout(refresh, 150); };
    sb.channel('fila').on('postgres_changes', { event: '*', schema: 'public', table: 'fila_tickets' }, soft).subscribe();
    setInterval(refresh, 8000);                       // rede de segurança se o realtime cair
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  }
  async function refresh() {
    if (MOCK) return;
    const { data, error } = await sb.from('fila_tickets').select('*').in('status', ['waiting', 'playing']);
    if (!error && data) { tickets = data; emit(); }
  }
  async function getTicket(id) {              // ticket próprio, mesmo já finalizado
    if (MOCK) return tickets.find(t => t.id === id) || null;
    const { data } = await sb.from('fila_tickets').select('*').eq('id', id).limit(1);
    return data && data[0] || null;
  }
  async function rpc(name, args) {
    if (MOCK) { alert('Modo demonstração: ação "' + name + '" não faz nada.'); return null; }
    const { data, error } = await sb.rpc(name, args || {});
    if (error) throw new Error(error.message);
    refresh(); return data;
  }

  // ---------- modelo de fila ----------
  const ms = x => (x ? new Date(x).getTime() : 0);
  const order = (a, b) => (b.fast - a.fast) || (ms(a.fast_at) - ms(b.fast_at)) || (Number(a.queue_seq) - Number(b.queue_seq));
  function station(s) {
    const P = tickets.find(t => t.station === s && t.status === 'playing') || null;
    const W = tickets.filter(t => t.station === s && t.status === 'waiting').sort(order);
    let t = P ? ms(P.ends_at) : now();
    const slots = W.map(w => { const start = t + cfg.gap_sec * 1000, end = start + cfg.game_min * 60000; t = end; return { t: w, start, end }; });
    return { s, P, W, slots, queueEnd: t, waitNew: Math.max(0, t - now()) };
  }
  function find(id) {                      // posição de um ticket
    const t = tickets.find(x => x.id === id); if (!t) return null;
    const st = station(t.station);
    if (t.status === 'playing') return { t, st, pos: 0, ahead: 0, startsAt: ms(t.starts_at) };
    const i = st.W.findIndex(w => w.id === id);
    return i < 0 ? null : { t, st, pos: i + 1, ahead: i + (st.P ? 1 : 0), startsAt: st.slots[i].start };
  }
  const tick = () => { if (!MOCK) sb.rpc('fila_tick').then(refresh); };   // idempotente

  // ---------- formatação ----------
  const pad = n => String(n).padStart(2, '0');
  const mmss = x => { x = Math.max(0, Math.ceil(x / 1000)); return pad(Math.floor(x / 60)) + ':' + pad(x % 60); };
  const clock = x => { const d = new Date(x); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  const mins = x => Math.max(0, Math.round(x / 60000));

  return { init, refresh, getTicket, rpc, station, find, tick, now, ms, mmss, clock, mins, sub: f => subs.add(f), get tickets() { return tickets; }, get cfg() { return cfg; }, MOCK };
})();

// ---------- alertas (som, vibração, aviso em tela cheia) ----------
const ALERT = (() => {
  let ac = null, wl = null;
  function unlock() {
    try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); } catch (e) {}
    keepAwake();
  }
  async function keepAwake() {
    try { if ('wakeLock' in navigator && !wl) { wl = await navigator.wakeLock.request('screen'); wl.addEventListener('release', () => { wl = null; }); } } catch (e) {}
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && ac) keepAwake(); });
  function beep(n = 3) {
    if (!ac) return;
    for (let i = 0; i < n; i++) {
      const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + i * 0.28;
      o.type = 'square'; o.frequency.value = i % 2 ? 880 : 1175; g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.connect(g).connect(ac.destination); o.start(t); o.stop(t + 0.25);
    }
  }
  function show(title, text, kind = 'info', n = 3) {
    beep(n);
    try { navigator.vibrate && navigator.vibrate([300, 120, 300, 120, 500]); } catch (e) {}
    let box = document.getElementById('alertbox');
    if (!box) { box = document.createElement('div'); box.id = 'alertbox'; document.body.appendChild(box); }
    box.className = 'alertbox ' + kind;
    box.innerHTML = '<div class="alertin"><div class="alerttitle"></div><div class="alerttext"></div><button class="btn">OK</button></div>';
    box.querySelector('.alerttitle').textContent = title; box.querySelector('.alerttext').textContent = text;
    box.querySelector('button').onclick = () => box.remove();
    document.title = '🔔 ' + title;
  }
  return { unlock, show, beep, get ready() { return !!ac && ac.state === 'running'; } };
})();
