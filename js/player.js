// Tela do jogador: entra na fila, acompanha posição/tempo e recebe alertas.
(() => {
  const KEY = 'fila_ticket_v2', app = $('#app'), logo = $('#logo'), C = 2 * Math.PI * 116;
  let myId = null, R = null, fin = false, soundOn = false, fired = {}, prev = {}, missing = 0, lastKey = '', offline = false;
  try { myId = localStorage.getItem(KEY); fired = JSON.parse(localStorage.getItem('fila_fired') || '{}'); } catch (e) {}
  const once = k => { if (fired[k]) return false; fired[k] = 1; try { localStorage.setItem('fila_fired', JSON.stringify(fired)); } catch (e) {} return true; };
  const forget = () => { myId = null; R = null; prev = {}; lastKey = ''; try { localStorage.removeItem(KEY); } catch (e) {} };

  // ------------------------------------------------------------ telas
  function joinView() {
    logo.classList.remove('sm'); lastKey = '';
    app.innerHTML = `<section class="box hero"><h3>ENTRE NA FILA DO GTA VI</h3>
      <input id="nm" type="text" maxlength="30" placeholder="SEU NOME" autocomplete="given-name" autocapitalize="words" enterkeyhint="go">
      <button id="go" class="btn y block mt">ENTRAR NA FILA</button><div class="err" id="err" role="alert"></div>
      <div class="rules"><div><b>1</b>Você entra em uma das 4 filas, escolhida pelo sistema.</div>
        <div><b>2</b>Cada jogador tem ${FILA.cfg.game_min} minutos no console.</div>
        <div><b>3</b>Deixe esta tela aberta: avisamos quando for a sua vez.</div></div></section>`;
    const go = async () => {
      const name = $('#nm').value.trim(); if (!name) { $('#err').textContent = 'Digite seu nome'; return; }
      ALERT.unlock(); soundOn = true; $('#go').disabled = true; $('#err').textContent = '';
      try { R = await FILA.join(name); if (R.error === 'nome_repetido') { $('#err').textContent = 'Já tem alguém com esse nome na fila. Se for você, abra pelo mesmo navegador; se for outra pessoa, use nome e sobrenome.'; $('#go').disabled = false; return; } if (!R.ticket) throw 0; myId = R.ticket.id; try { localStorage.setItem(KEY, myId); } catch (e) {} fin = false; missing = 0; render(); }
      catch (e) { $('#err').textContent = 'Não foi possível entrar. Verifique a internet e tente de novo.'; $('#go').disabled = false; }
    };
    $('#go').onclick = go; $('#nm').onkeydown = e => { if (e.key === 'Enter') go(); };
  }
  const soundChip = () => (soundOn && ALERT.ready)
    ? `<div class="chip"><i class="ok"></i>Alertas ativos · mantenha esta tela aberta</div>`
    : `<button id="snd" class="btn g block mt">🔔 TOQUE PARA ATIVAR OS ALERTAS</button>`;
  const offChip = () => offline ? `<div class="chip"><i class="off"></i>Sem conexão · tentando reconectar…</div>` : '';

  const head = t => `<h2 class="who ${t.fast ? 'gold' : ''}">${esc(t.name)}</h2><div class="badges">${t.fast ? '<span class="tag fast">⚡ FAST-PASS</span>' : ''}</div>`;

  const VIEWS = {
    wait: (t, r) => `${head(t)}
      <div class="sign"><small>FILA</small><b>#${t.station}</b></div>
      <section class="box card ${r.pos === 1 ? 'near' : ''}"><h3 class="c">SUA POSIÇÃO</h3><div class="bignum">${r.pos}º</div>
        <p class="sub">${r.ahead === 0 ? 'Você é o próximo!' : r.ahead === 1 ? 'Falta 1 pessoa na sua frente' : `Faltam ${r.ahead} pessoas na sua frente`}</p>
        ${r.pos === 1 ? '<p class="nearmsg">FIQUE POR PERTO!</p>' : ''}</section>
      <section class="box card"><h3 class="c">PREVISÃO PARA JOGAR</h3><div class="timer etabig" data-t="eta:${ms(r.est_start)}">--</div>
        <p class="sub mt">por volta das ${clock(ms(r.est_start))}</p></section>${soundChip()}${offChip()}`,
    call: (t) => `${head(t)}<section class="box go card" style="border-color:var(--yel)"><h3 class="c">É A SUA VEZ!</h3><p class="sub">Vá agora para a</p>
      <div class="gobig ttl">ESTAÇÃO #${t.station}</div><p class="sub mt">Seu jogo começa em</p><div class="timer warn" style="font-size:72px;margin-top:6px" data-t="until:${ms(t.starts_at)}">--:--</div></section>${soundChip()}`,
    play: (t) => `${head(t)}<section class="box card"><h3 class="c">VOCÊ ESTÁ JOGANDO · ESTAÇÃO #${t.station}</h3>
      <div class="ringwrap"><svg viewBox="0 0 260 260"><circle class="ring-bg" cx="130" cy="130" r="116"/><circle class="ring-fg" cx="130" cy="130" r="116" stroke-dasharray="${C}" stroke-dashoffset="0" data-ring="${ms(t.starts_at)}:${ms(t.ends_at)}"/></svg>
        <div class="ringtxt"><div class="timer" data-t="rem:${ms(t.ends_at)}">--:--</div><small>tempo restante${t.extra_min ? ` · inclui +${t.extra_min} min` : ''}</small></div></div>
      <p class="sub small">Quer mais ${FILA.cfg.extend_min} minutos? Fale com o staff da sua estação.</p></section>${soundChip()}${offChip()}`,
    done: (t) => `${head(t)}<section class="box card c"><h3>OBRIGADO POR JOGAR!</h3><p class="sub" style="font-size:22px;margin:8px 0 14px">${t.status === 'removed' ? 'Seu ticket foi removido pelo staff.' : 'Seu tempo acabou. Esperamos que tenha sido épico!'}</p>
      <button id="again" class="btn y block">ENTRAR NA FILA DE NOVO</button></section>`,
  };

  function viewOf(t, n) {
    if (t.status === 'playing') return n < ms(t.starts_at) ? 'call' : (n >= ms(t.ends_at) ? 'done' : 'play');
    return t.status === 'waiting' ? 'wait' : 'done';
  }

  function render() {
    if (!myId || fin) return;
    if (!R) return;
    if (!R.ticket) { if (++missing >= 2) { forget(); joinView(); } return; }
    missing = 0; const t = R.ticket, n = FILA.now(), view = viewOf(t, n);
    logo.classList.add('sm');
    const key = [view, t.id, t.station, t.name, t.fast, t.extra_min, t.status, t.ends_at, t.starts_at, R.pos, R.ahead, R.est_start, soundOn && ALERT.ready, offline].join('|');
    if (key !== lastKey) {
      app.innerHTML = VIEWS[view](t, R); lastKey = key;
      const s = $('#snd'); if (s) s.onpointerdown = () => { ALERT.unlock(); soundOn = true; ALERT.beep(1); setTimeout(() => { lastKey = ''; render(); }, 60); };
      const a = $('#again'); if (a) a.onclick = () => { forget(); joinView(); };
    }
    tickTimers(n); alerts(t, view, n);
  }
  function tickTimers(n = FILA.now()) {
    $$('[data-t]').forEach(el => {
      const i = el.dataset.t.indexOf(':'), k = el.dataset.t.slice(0, i), v = +el.dataset.t.slice(i + 1), d = v - n;
      if (k === 'rem') { el.textContent = mmss(d); el.classList.toggle('crit', d <= 60000); el.classList.toggle('warn', d > 60000 && d <= 300000); }
      else if (k === 'until') el.textContent = mmss(d);
      else if (k === 'eta') { el.textContent = d >= 600000 ? '~' + Math.round(d / 60000) + ' min' : mmss(d); el.classList.toggle('warn', d <= 300000); }
    });
    $$('[data-ring]').forEach(el => {
      const [s, e] = el.dataset.ring.split(':').map(Number), frac = Math.max(0, Math.min(1, (e - n) / (e - s))), d = e - n;
      el.setAttribute('stroke-dashoffset', (C * (1 - frac)).toFixed(1)); el.classList.toggle('crit', d <= 60000); el.classList.toggle('warn', d > 60000 && d <= 300000);
    });
  }

  // ------------------------------------------------------------ alertas
  function alerts(t, view, n) {
    const id = t.id, p = prev;
    if (p.view === 'wait' && (view === 'call' || view === 'play') && once(id + ':turn')) ALERT.show('É A SUA VEZ!', 'Vá agora para a ESTAÇÃO #' + t.station + '. Seu jogo começa em instantes.', 'go', 5);
    if (view === 'wait') {
      if (p.view === 'wait' && p.pos) {
        if (R.pos > p.pos) toast(`Sua posição mudou: ${p.pos}º → ${R.pos}º`, 'gold');
        else if (R.pos < p.pos && R.pos > 1) toast(`Você avançou: ${p.pos}º → ${R.pos}º`);
        if (!p.fast && t.fast) toast('⚡ Fast-pass ativado! Você passou para a frente da fila.', 'gold');
      }
      if (R.pos === 1 && p.pos > 1 && once(id + ':next:' + t.id + R.pos + ':' + (p.pos))) ALERT.show('VOCÊ É O PRÓXIMO!', 'Fique por perto da estação #' + t.station + '.', 'warn', 3);
      if (R.pos === 1 && R.current_ends_at && ms(R.current_starts_at) <= n) {
        const rem = ms(R.current_ends_at) - n, k = R.current_ends_at;
        if (rem <= 60000) { if (once(id + ':n60:' + k)) { fired[id + ':n300:' + k] = 1; ALERT.show('FALTA 1 MINUTO!', 'Vá para a estação #' + t.station + ': o jogador atual termina em 1 minuto.', 'go', 4); } }
        else if (rem <= 300000 && once(id + ':n300:' + k)) ALERT.show('FALTAM 5 MINUTOS', 'Você joga em seguida na estação #' + t.station + '. Vá chegando!', 'warn', 3);
      }
    } else if (t.status === 'playing' && ms(t.starts_at) <= n) {
      const rem = ms(t.ends_at) - n, k = t.ends_at;
      if (rem <= 0) { if (once(id + ':wasted')) ALERT.wasted('Seu tempo acabou. Valeu por jogar!', [{ label: 'Entrar na fila de novo', onClick: () => { forget(); joinView(); } }, { label: 'Fechar', onClick: () => {} }]); }
      else if (rem <= 60000) { if (once(id + ':p60:' + k)) { fired[id + ':p300:' + k] = 1; ALERT.show('FALTA 1 MINUTO!', `Seu tempo está acabando. Se quiser mais ${FILA.cfg.extend_min} min, chame o staff agora.`, 'go', 4); } }
      else if (rem <= 300000 && once(id + ':p300:' + k)) ALERT.show('FALTAM 5 MINUTOS', 'Aproveite o tempo que resta!', 'warn', 3);
    }
    prev = { view, pos: R.pos, fast: t.fast };
  }

  // ------------------------------------------------------------ início
  (async () => {
    await FILA.init();
    const as = new URLSearchParams(location.search).get('as');       // demo: ?mock=1&as=Julia
    if (FILA.MOCK && as && !myId) myId = FILA.demoFind(as);
    FILA.watch(async () => { if (!myId) return; try { R = await FILA.me(myId); offline = false; } catch (e) { offline = true; } render(); }, { jitter: 1500, fallbackMs: 6000 });
    if (myId) { /* aguarda a primeira resposta */ } else joinView();
    setInterval(render, 250);
    // se nenhuma tela de staff/telão estiver aberta, o relógio da fila ainda precisa avançar
    setInterval(() => { if (!R || !R.ticket) return; const n = FILA.now(), t = R.ticket;
      const late = (t.status === 'playing' && n - ms(t.ends_at) > 8000) || (t.status === 'waiting' && R.current_ends_at && n - ms(R.current_ends_at) > 8000);
      if (late) setTimeout(FILA.tick, Math.random() * 4000); }, 5000);
  })();
})();
