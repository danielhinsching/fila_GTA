// Camada de dados. Dois modos com a MESMA interface:
//   real  → Supabase (somente funções fila_*; as tabelas são privadas)
//   demo  → ?mock=1 ou sem credenciais: simulador local com as mesmas regras, para testar as telas.
const FILA = (() => {
  const C = window.FILA_CONFIG || {};
  const Q = new URLSearchParams(location.search);
  const MOCK = Q.has('mock') || !C.SUPABASE_URL;
  let sb = null, offset = 0, cfg = { game_min: 20, extend_min: 10, gap_sec: 30, fast_every: 2 };
  const now = () => Date.now() + offset;
  const sync = r => { if (r && r.now) offset = Date.parse(r.now) - Date.now(); if (r && r.config) cfg = r.config; return r; };

  // ---------------------------------------------------------------- real
  async function rpc(fn, args) {
    const { data, error } = await sb.rpc(fn, args || {});
    if (error) throw new Error(error.message);
    return data;
  }
  const device = () => {
    try { let d = localStorage.getItem('fila_device'); if (!d) { d = crypto.randomUUID(); localStorage.setItem('fila_device', d); } return d; }
    catch (e) { return 'tmp-' + Math.random().toString(36).slice(2); }
  };

  const staffSid = () => {
    try { let d = localStorage.getItem('fila_staff_sid'); if (!d) { d = 's' + crypto.randomUUID(); localStorage.setItem('fila_staff_sid', d); } return d; }
    catch (e) { return 'tmp-staff-' + Math.random().toString(36).slice(2, 12); }
  };
  const mGate = (st, sid) => { const c = M.sess[st]; if (c && c.sid !== sid && Date.now() - c.seen < 40000) return false; M.sess[st] = { sid, seen: Date.now() }; return true; };

  // ---------------------------------------------------------------- demo (mesmas regras do SQL)
  const NST = 5, STS = [1, 2, 3, 4, 5];
  const M = { t: [], q: 0, run: {}, sess: {} };
  // Mesma regra do SQL: a cada cfg.fast_every normais começa 1 fast-pass; sem normais, os fast seguem em sequência.
  const mWaiting = s => {
    const w = M.t.filter(t => t.station === s && t.status === 'waiting');
    const N = w.filter(t => !t.fast).sort((a, b) => a.queue_seq - b.queue_seq), F = w.filter(t => t.fast).sort((a, b) => ms(a.fast_at) - ms(b.fast_at) || a.queue_seq - b.queue_seq);
    let run = M.run[s] || 0; const out = [];
    while (N.length || F.length) { if (F.length && (run >= (cfg.fast_every || 2) || !N.length)) { out.push(F.shift()); run = 0; } else { out.push(N.shift()); run++; } }
    return out;
  };
  const norm = x => String(x || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
  const mIso = x => new Date(x).toISOString();
  function mSeed() {
    const n = Date.now(), m = 60000;
    const mk = (name, st, status, o = {}) => ({ id: 'm' + Math.random().toString(36).slice(2, 9), name, station: st, status, fast: false, fast_at: null, jumped_from: null, extra_min: 0, queue_seq: ++M.q, starts_at: null, ends_at: null, device: null, ...o });
    const play = (name, st, startedMin, extra = 0) => mk(name, st, 'playing', { starts_at: mIso(n - startedMin * m), ends_at: mIso(n + (20 + extra - startedMin) * m), extra_min: extra });
    const wait = (name, st, o = {}) => mk(name, st, 'waiting', o);
    const fast = (name, st, from) => wait(name, st, { fast: true, fast_at: mIso(n - 3 * m), jumped_from: from });
    M.t = [
      play('Marcos', 1, 14.6, 10), wait('Julia', 1), fast('Rafa', 1, 4), wait('Bianca', 1), wait('Thiago', 1), wait('Paulo', 1),
      play('Camila', 2, 16), wait('Lucas', 2), wait('Fernanda', 2), wait('Diego', 2),
      play('Renato', 3, 19.2), wait('Amanda', 3), wait('Gabriel', 3), fast('Leo', 3, 3), wait('Sofia', 3), wait('Vitor', 3), wait('Nina', 3),
      play('Priscila', 4, 4), wait('Caio', 4), wait('Daniel', 4),
      play('Helena', 5, 9), wait('Otávio', 5)];
  }
  function mStart(s, at) {
    const w = mWaiting(s)[0];
    if (w) { M.run[s] = w.fast ? 0 : (M.run[s] || 0) + 1; w.status = 'playing'; w.starts_at = mIso(at); w.ends_at = mIso(at + cfg.game_min * 60000); }
  }
  function mTick() {
    const n = Date.now();
    for (let s = 1; s <= NST; s++) {
      const P = M.t.find(t => t.station === s && t.status === 'playing');
      if (P && ms(P.ends_at) <= n) { P.status = 'done'; mStart(s, Math.max(ms(P.ends_at) + cfg.gap_sec * 1000, n)); }
      else if (!P) mStart(s, n + cfg.gap_sec * 1000);
    }
  }
  function mStation(s, ids) {
    const n = Date.now(), P = M.t.find(t => t.station === s && t.status === 'playing');
    const W = mWaiting(s), base = P ? ms(P.ends_at) : n;
    const slot = i => base + ((i + 1) * cfg.gap_sec + i * cfg.game_min * 60) * 1000;
    const qend = slot(W.length);
    return { station: s,
      playing: P ? { ...(ids ? { id: P.id } : {}), name: P.name, fast: P.fast, extra_min: P.extra_min, starts_at: P.starts_at, ends_at: P.ends_at } : null,
      waiting: W.map((t, i) => ({ ...(ids ? { id: t.id } : {}), name: t.name, fast: t.fast, jumped_from: t.jumped_from, pos: i + 1, est_start: mIso(slot(i)) })),
      queue_end: mIso(qend), wait_new_s: Math.max(0, Math.ceil((qend - n) / 1000)) };
  }
  function mMe(id) {
    const t = M.t.find(x => x.id === id), base = { now: mIso(Date.now()), config: cfg };
    if (!t) return { ...base, ticket: null };
    const st = mStation(t.station, true), P = M.t.find(x => x.station === t.station && x.status === 'playing');
    const w = st.waiting.find(x => x.id === id);
    return { ...base, ticket: { id: t.id, name: t.name, station: t.station, status: t.status, fast: t.fast, jumped_from: t.jumped_from, extra_min: t.extra_min, starts_at: t.starts_at, ends_at: t.ends_at },
      pos: w ? w.pos : null, ahead: w ? w.pos - 1 + (P ? 1 : 0) : null, est_start: w ? w.est_start : null,
      current_starts_at: P ? P.starts_at : null, current_ends_at: P ? P.ends_at : null };
  }
  function mDo(a, s, p) {
    const t = p.ticket && M.t.find(x => x.id === p.ticket && x.station === s && ['waiting', 'playing'].includes(x.status));
    const P = M.t.find(x => x.station === s && x.status === 'playing');
    if (a === 'extend') { if (!P) return { ok: false, error: 'ninguem_jogando' }; P.ends_at = mIso(ms(P.ends_at) + cfg.extend_min * 60000); P.extra_min += cfg.extend_min; }
    else if (a === 'finish') { if (P) P.ends_at = mIso(Date.now()); mTick(); }
    else if (a === 'add') {
      const n = (p.name || '').trim().slice(0, 30); if (!n) return { ok: false, error: 'nome' };
      const w = M.t.filter(x => x.station === s && x.status === 'waiting').length + 1;
      M.t.push({ id: 'm' + Math.random().toString(36).slice(2, 9), name: n, station: s, status: 'waiting', fast: !!p.fast, fast_at: p.fast ? mIso(Date.now()) : null, jumped_from: p.fast ? w : null, extra_min: 0, queue_seq: ++M.q, starts_at: null, ends_at: null, device: null }); mTick();
    } else if (!t) return { ok: false, error: 'ticket' };
    else if (a === 'fast' && t.status === 'waiting' && !t.fast) {
      const rk = M.t.filter(x => x.station === s && x.status === 'waiting' && x.id !== t.id && (x.fast || x.queue_seq < t.queue_seq)).length + 1;
      t.fast = true; t.fast_at = mIso(Date.now()); t.jumped_from = rk;
    } else if (a === 'unfast') { t.fast = false; t.fast_at = null; t.jumped_from = null; }
    else if (a === 'absent') { const was = t.status; Object.assign(t, { status: 'waiting', fast: false, fast_at: null, jumped_from: null, starts_at: null, ends_at: null, extra_min: 0, queue_seq: ++M.q }); if (was === 'playing') mStart(s, Date.now() + 10000); }
    else if (a === 'remove') { const was = t.status; t.status = 'removed'; if (was === 'playing') mStart(s, Date.now() + 10000); }
    notifyDemo(); return { ok: true };
  }
  let demoCbs = [];
  const notifyDemo = () => demoCbs.forEach(f => f());

  // ---------------------------------------------------------------- interface pública
  async function init() {
    if (MOCK) {
      mSeed();
      if (Q.has('wasted')) { const r = M.t.find(t => t.name === (Q.get('as') || 'Renato')); if (r && r.status === 'playing') { r.starts_at = mIso(Date.now() - 20 * 60000 + 2000); r.ends_at = mIso(Date.now() + 2000); } }
      setInterval(mTick, 2000); return;
    }
    sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_KEY, { auth: { persistSession: false } });
    try { sync(await rpc('fila_me', { p_id: '00000000-0000-0000-0000-000000000000' })); } catch (e) { console.warn('sync', e); }   // sincroniza relógio e config
  }
  const api = {
    MOCK, now, init, demoFind: name => (M.t.find(t => t.name === name) || {}).id, get cfg() { return cfg; },
    async me(id) { return sync(MOCK ? mMe(id) : await rpc('fila_me', { p_id: id })); },
    async join(name) { if (MOCK) { if (M.t.some(t => ['waiting', 'playing'].includes(t.status) && norm(t.name) === norm(name))) return { error: 'nome_repetido' }; const d = device(); const sts = STS.map(s => mStation(s, false)); const best = sts.sort((a, b) => a.wait_new_s - b.wait_new_s)[0].station;
        const t = { id: 'm' + Math.random().toString(36).slice(2, 9), name: name.slice(0, 30), station: best, status: 'waiting', fast: false, fast_at: null, jumped_from: null, extra_min: 0, queue_seq: ++M.q, starts_at: null, ends_at: null, device: d }; M.t.push(t); mTick(); return mMe(t.id); }
      return sync(await rpc('fila_join', { p_name: name, p_device: device() })); },
    async board() { return sync(MOCK ? { now: mIso(Date.now()), config: cfg, stations: STS.map(s => mStation(s, false)) } : await rpc('fila_board')); },
    async staffView(station, pin) { return MOCK ? (!mGate(station, staffSid()) ? { ok: false, error: 'ocupado' } : (mTick(), { ok: true, now: mIso(Date.now()), config: cfg, station: mStation(station, true) })) : sync(await rpc('fila_staff_view', { p_station: station, p_pin: pin, p_session: staffSid() })); },
    async staffDo(action, station, pin, o = {}) { if (MOCK) { if (!mGate(station, staffSid())) return { ok: false, error: 'ocupado' }; if (action === 'logout') { delete M.sess[station]; return { ok: true }; } return mDo(action, station, o); } return rpc('fila_staff_do', { p_action: action, p_station: station, p_pin: pin, p_ticket: o.ticket || null, p_name: o.name || null, p_fast: !!o.fast, p_session: staffSid() }); },
    tick() { if (MOCK) mTick(); else rpc('fila_tick').catch(() => {}); },
    // Chama fn agora, a cada mudança (realtime por pulso) e como rede de segurança a cada fallbackMs.
    // Chama fn agora, a cada mudança (realtime por pulso, se realtime=true) e a cada fallbackMs.
    // Pulsos em rajada são agrupados: no máximo 1 consulta por segundo por tela.
    watch(fn, { jitter = 300, fallbackMs = 8000, realtime = true } = {}) {
      let t = null, lastRun = 0;
      const go = () => { lastRun = Date.now(); Promise.resolve(fn()).catch(() => {}); };
      const run = () => { if (t) return; const wait = Math.max(Math.random() * jitter, 1000 - (Date.now() - lastRun)); t = setTimeout(() => { t = null; go(); }, Math.max(0, wait)); };
      run(); setInterval(() => { if (!document.hidden) go(); }, fallbackMs + Math.random() * 1500);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) run(); });
      if (MOCK) demoCbs.push(run);
      else if (realtime) sb.channel('pulse-' + Math.random().toString(36).slice(2)).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'fila_pulse' }, run).subscribe();
    },
  };
  return api;
})();
