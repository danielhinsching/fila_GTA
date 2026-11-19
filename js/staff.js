// Painel do staff: uma estação por celular/tablet, protegida por PIN.
(() => {
  const app = $('#app'), ERR = { bad: 'PIN incorreto', locked: 'Muitas tentativas. Aguarde 1 minuto.', ticket: 'Pessoa não encontrada (a fila mudou).', ninguem_jogando: 'Ninguém está jogando agora.', nome: 'Informe o nome.', estacao: 'Estação inválida.' };
  let S = null, PIN = '', authed = false, V = null, last = '', fired = {};
  try { S = +localStorage.getItem('fila_staff_st') || null; PIN = localStorage.getItem('fila_staff_pin') || ''; } catch (e) {}
  const qs = new URLSearchParams(location.search); if (qs.get('st')) { S = +qs.get('st'); PIN = qs.get('pin') || PIN; }

  function loginView(err) {
    last = '';
    app.innerHTML = `<div class="wrap" style="padding-top:30px"><p class="ttl">PAINEL DO STAFF</p><section class="box"><h3>QUAL ESTAÇÃO?</h3>
      <div class="row">${[1, 2, 3, 4, 5].map(n => `<button class="btn grow ${n === S ? 'y' : 'd'}" data-st="${n}">#${n}</button>`).join('')}</div>
      <h3 class="mt">PIN DA ESTAÇÃO</h3><input id="pin" type="tel" inputmode="numeric" autocomplete="off" maxlength="8" placeholder="PIN" value="${esc(PIN)}">
      <button id="in" class="btn y block mt">ENTRAR</button><div class="err" role="alert">${esc(err || '')}</div></section></div>`;
    $$('[data-st]').forEach(b => b.onclick = () => { S = +b.dataset.st; PIN = $('#pin').value; loginView(); });
    $('#in').onclick = login; $('#pin').onkeydown = e => { if (e.key === 'Enter') login(); };
  }
  async function login() {
    PIN = ($('#pin') ? $('#pin').value : PIN).trim();
    if (!S || !PIN) return loginView('Escolha a estação e digite o PIN');
    let r; try { r = await FILA.staffView(S, PIN); } catch (e) { return loginView('Sem conexão. Tente de novo.'); }
    if (!r.ok) return loginView(ERR[r.error] || 'Não foi possível entrar');
    try { localStorage.setItem('fila_staff_st', S); localStorage.setItem('fila_staff_pin', PIN); } catch (e) {}
    authed = true; V = r.station; ALERT.unlock(); last = ''; render();
  }
  function logout() { authed = false; PIN = ''; try { localStorage.removeItem('fila_staff_pin'); } catch (e) {} loginView(); }
  async function refresh() {
    if (!authed) return;
    const r = await FILA.staffView(S, PIN);
    if (!r.ok) { authed = false; return loginView(ERR[r.error]); }
    V = r.station; render();
  }
  async function act(action, o, okMsg) {
    try { const r = await FILA.staffDo(action, S, PIN, o); if (!r.ok) toast(ERR[r.error] || 'Não foi possível', 'bad'); else if (okMsg) toast(okMsg, 'gold'); }
    catch (e) { toast('Sem conexão. Tente de novo.', 'bad'); }
    refresh();
  }

  function render() {
    if (!authed || !V) return;
    const n = FILA.now(), P = V.playing, W = V.waiting;
    const over = P && ms(P.starts_at) <= n && ms(P.ends_at) <= n, started = P && ms(P.starts_at) <= n;
    const cur = P ? `<section class="box now ${over ? 'over' : ''}"><div class="bar"><h3>JOGANDO AGORA</h3>${P.extra_min ? `<span class="tag fast">+${P.extra_min} MIN</span>` : ''}</div>
        <div class="who ${P.fast ? 'gold' : ''}">${esc(P.name)}</div>
        ${over ? '<div class="c"><span class="wastedtag">WASTED</span></div>' : ''}
        ${started ? `<div class="timer" data-t="rem:${ms(P.ends_at)}">--:--</div><div class="pbar"><i data-t="bar:${ms(P.starts_at)}:${ms(P.ends_at)}"></i></div><p class="sub">${over ? 'tempo esgotado · o próximo entra em instantes' : 'tempo restante'}</p>`
                   : `<p class="sub">começa em</p><div class="timer warn" data-t="until:${ms(P.starts_at)}">--:--</div>`}
        <button class="btn g block mt" data-a="extend">+${FILA.cfg.extend_min} MIN</button>
        <div class="row mt"><button class="btn d s grow" data-a="finish">ENCERRAR AGORA</button><button class="btn d s grow" data-a="absent" data-id="${P.id}">AUSENTE → FIM</button></div></section>`
      : `<section class="box now c"><h3>ESTAÇÃO LIVRE</h3><p class="sub">Ninguém jogando. O próximo da fila começa sozinho.</p></section>`;
    const rows = W.map(w => `<div class="qrow"><div class="qpos">${w.pos}</div>
        <div class="qname ${w.fast ? 'gold' : ''}">${esc(w.name)}${w.fast && w.jumped_from ? `<div class="jump">⚡ estava em ${w.jumped_from}º · passou para a frente</div>` : ''}</div>
        <div class="qeta">${clock(ms(w.est_start))}<br>em <span data-t="eta:${ms(w.est_start)}">--</span> min</div>
        <div class="acts">${w.fast ? `<button class="btn s d" data-a="unfast" data-id="${w.id}">DESFAZER ⚡</button>` : `<button class="btn s g" data-a="fast" data-id="${w.id}">⚡ FAST-PASS</button>`}
          <button class="btn s d" data-a="absent" data-id="${w.id}">→ FIM</button><button class="btn s r" data-a="remove" data-id="${w.id}">✕</button></div></div>`).join('');
    const html = `<div class="bar" style="margin-bottom:6px"><h1 class="stitle">ESTAÇÃO #${S}</h1><button class="btn s d" data-a="out">SAIR</button></div>
      <div class="cols"><div>${cur}
        <section class="box addform"><h3>ADICIONAR PESSOA</h3><input id="addn" type="text" maxlength="30" placeholder="NOME" autocomplete="off">
          <div class="row"><label class="chk"><input id="addf" type="checkbox"> FAST-PASS</label><button class="btn y" data-a="add">ADICIONAR</button></div></section></div>
        <section class="box"><h3>FILA #${S} · ${W.length} AGUARDANDO</h3>${rows || '<p class="sub empty">Fila vazia.</p>'}</section></div>`;
    const typing = document.activeElement && document.activeElement.id === 'addn';
    if (html !== last && !typing) { const v = ($('#addn') || {}).value, c = ($('#addf') || {}).checked; app.innerHTML = html; if (v) $('#addn').value = v; if (c) $('#addf').checked = c; last = html; }
    tickTimers(n);
    if (P && started) {      // bipes de apoio ao staff
      const rem = ms(P.ends_at) - n, k = P.ends_at;
      if (rem <= 0) { if (!fired[k + 'z']) { fired[k + 'z'] = 1; ALERT.beep(4); } }
      else if (rem <= 60000) { if (!fired[k + '60']) { fired[k + '60'] = 1; ALERT.beep(3); } }
      else if (rem <= 300000 && !fired[k + '300']) { fired[k + '300'] = 1; ALERT.beep(2); }
    }
  }
  function tickTimers(n = FILA.now()) {
    $$('[data-t]').forEach(el => {
      const p = el.dataset.t.split(':'), k = p[0], v = +p[1], d = v - n;
      if (k === 'rem') { el.textContent = mmss(d); el.classList.toggle('crit', d <= 60000); el.classList.toggle('warn', d > 60000 && d <= 300000); }
      else if (k === 'until') el.textContent = mmss(d);
      else if (k === 'eta') el.textContent = mins(d);
      else if (k === 'bar') el.style.width = Math.max(0, Math.min(100, (n - v) / (+p[2] - v) * 100)) + '%';
    });
  }
  app.addEventListener('focusout', e => { if (e.target.id === 'addn') setTimeout(render, 100); });
  app.addEventListener('click', async e => {
    const b = e.target.closest('[data-a]'); if (!b) return; const a = b.dataset.a, id = b.dataset.id;
    if (a === 'out') return logout();
    if (a === 'extend') return act('extend', {}, `+${FILA.cfg.extend_min} min aplicado`);
    if (a === 'finish') { if (await confirmBox('Encerrar o jogo agora? O próximo começa em 30 segundos.')) act('finish', {}); return; }
    if (a === 'absent') { if (await confirmBox('Mandar esta pessoa para o FIM da fila (ausente)?')) act('absent', { ticket: id }, 'Enviado para o fim da fila'); return; }
    if (a === 'remove') { if (await confirmBox('Remover esta pessoa da fila?')) act('remove', { ticket: id }); return; }
    if (a === 'fast') return act('fast', { ticket: id }, '⚡ Fast-pass marcado');
    if (a === 'unfast') return act('unfast', { ticket: id }, 'Fast-pass desfeito');
    if (a === 'add') { const nm = $('#addn').value.trim(); if (!nm) return toast('Digite o nome', 'bad'); const f = $('#addf').checked; $('#addn').value = ''; $('#addf').checked = false; last = ''; act('add', { name: nm, fast: f }, 'Adicionado'); }
  });
  (async () => {
    await FILA.init();
    FILA.watch(refresh, { jitter: 200, fallbackMs: 5000 }); setInterval(() => authed && render(), 500); setInterval(() => authed && FILA.tick(), 3000);
    if (S && PIN) await login(); else loginView();
  })();
})();
