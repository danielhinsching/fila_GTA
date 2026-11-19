// Telão: acompanha as 5 filas. Só mostra o necessário (nomes, tempos, posições).
(() => {
  const stage = $('#stage'), cols = $('#cols'); let B = null, last = '', lastP = {}, wasted = {};
  function fit() {
    const port = innerHeight > innerWidth * 1.1; stage.className = port ? 'port' : 'land';
    const w = port ? 1080 : 1920, h = port ? 1920 : 1080, k = Math.min(innerWidth / w, innerHeight / h);
    stage.style.transform = `scale(${k})`; stage.style.left = ((innerWidth - w * k) / 2) + 'px'; stage.style.top = ((innerHeight - h * k) / 2) + 'px';
  }
  addEventListener('resize', fit); fit();

  function render() {
    if (!B) return; const n = FILA.now();
    const html = B.stations.map(st => {
      const s = st.station, P = st.playing, W = st.waiting, started = P && ms(P.starts_at) <= n;
      // WASTED fica visível por ~12 s depois que o tempo da estação acaba
      const lp = lastP[s];
      if (lp && (!P || P.name !== lp.name) && lp.ends <= n + 1500) wasted[s] = { name: lp.name, until: lp.ends + 12000 };
      if (P && started && ms(P.ends_at) <= n) wasted[s] = { name: P.name, until: ms(P.ends_at) + 12000 };
      lastP[s] = P ? { name: P.name, ends: ms(P.ends_at) } : null;
      const wz = wasted[s] && n < wasted[s].until ? `<div class="cw"><b>WASTED</b><span>${esc(wasted[s].name)}</span></div>` : '';
      const playing = P ? (started
        ? `<div class="lbl">JOGANDO</div><div class="now ${P.fast ? 'gold' : ''}">${esc(P.name)}</div><div class="tm" data-t="rem:${ms(P.ends_at)}">--:--</div><div class="prog"><i data-t="bar:${ms(P.starts_at)}:${ms(P.ends_at)}" style="width:0"></i></div>`
        : `<div class="lbl calling">CHAMANDO</div><div class="now ${P.fast ? 'gold' : ''}">${esc(P.name)}</div><div class="tm warn" data-t="until:${ms(P.starts_at)}">--:--</div>`)
        : `<div class="lbl">ESTAÇÃO LIVRE</div><div class="now" style="color:#4dffb0">DISPONÍVEL</div>`;
      const nx = W[0];
      const nextB = nx ? `<div class="lbl">PRÓXIMO</div><div class="next ${nx.fast ? 'gold' : ''}">${esc(nx.name)}</div><div class="nexttm">em <span data-t="until:${ms(nx.est_start)}">--:--</span></div>` : `<div class="lbl">PRÓXIMO</div><div class="next" style="color:#ff8fd6">—</div>`;
      const lst = W.slice(1, 4).map(x => `<div class="li"><b>${x.pos}</b><span class="${x.fast ? 'gold' : ''}">${esc(x.name)}</span></div>`).join('');
      const more = W.length > 4 ? `<div class="more">+ ${W.length - 4} na fila</div>` : '';
      return `<div class="col">${wz}<h2>FILA #${s}<small>${W.length} aguardando</small></h2>${playing}${nextB}<div class="lbl seq">NA SEQUÊNCIA</div><div class="list">${lst}${more}</div>
        <div class="waitnew">ENTRAR AGORA: ~<span data-t="wait:${ms(st.queue_end)}">--</span> MIN</div></div>`;
    }).join('');
    if (html !== last) { cols.innerHTML = html; last = html; }
    tickTimers(n);
  }
  function tickTimers(n) {
    const d = new Date(); $('#clk').textContent = pad(d.getHours()) + ':' + pad(d.getMinutes());
    $$('[data-t]').forEach(el => {
      const p = el.dataset.t.split(':'), k = p[0], v = +p[1], r = v - n;
      if (k === 'rem') { el.textContent = mmss(r); el.classList.toggle('crit', r <= 60000); el.classList.toggle('warn', r > 60000 && r <= 300000); }
      else if (k === 'until') el.textContent = mmss(r);
      else if (k === 'wait') el.textContent = mins(r);
      else if (k === 'bar') el.style.width = Math.max(0, Math.min(100, (n - v) / (+p[2] - v) * 100)) + '%';
    });
  }
  (async () => {
    await FILA.init();
    FILA.watch(async () => { try { B = await FILA.board(); render(); } catch (e) { console.warn(e); if (!B) cols.innerHTML = '<div style="grid-column:1/-1;font-size:44px;text-align:center;padding-top:300px;color:#ff8fd6">CONECTANDO…<br><small style="font-size:28px">' + String(e.message || e).slice(0, 120) + '</small></div>'; } }, { jitter: 200, fallbackMs: 5000 });
    setInterval(render, 500); setInterval(FILA.tick, 3000);
  })();
})();
