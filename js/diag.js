(() => {
  const out = document.getElementById('out');
  const add = (ok, msg) => { const d = document.createElement('div'); d.className = 'r ' + (ok === true ? 'ok' : ok === false ? 'bad' : 'wr'); d.textContent = (ok === true ? '✔ ' : ok === false ? '✖ ' : '! ') + msg; out.appendChild(d); };
  const step = async (name, fn) => { try { const r = await fn(); add(r === undefined ? true : r.ok, name + (r && r.note ? ' — ' + r.note : '')); return r; } catch (e) { add(false, name + ' — ' + (e.message || JSON.stringify(e))); } };
  document.getElementById('run').onclick = async () => {
    out.innerHTML = ''; const pins = document.getElementById('pin').value.split(/[,\s;]+/).filter(Boolean); let pin = '';
    add(FILA.MOCK ? null : true, FILA.MOCK ? 'Modo demo (mock): não é o banco real' : 'Modo banco real');
    let cfg;
    await step('Conexão e hora do servidor', async () => { await FILA.init(); const t0 = Date.now(); await FILA.now(); return { ok: true, note: 'latência ' + (Date.now() - t0) + ' ms' }; });
    await step('Configuração', async () => { cfg = FILA.cfg; return { ok: cfg && cfg.game_min === 20, note: JSON.stringify(cfg) }; });
    await step('fast_every = 1 (alterna 1:1)', async () => ({ ok: cfg && cfg.fast_every === 1, note: 'valor atual ' + (cfg && cfg.fast_every) + (cfg && cfg.fast_every !== 1 ? ' → rode: update fila_config set fast_every = 1;' : '') }));
    await step('Telão: 5 estações', async () => { const b = await FILA.board(); return { ok: b.stations.length === 5, note: b.stations.length + ' estações' }; });
    let me;
    await step('Entrar na fila (jogador de teste)', async () => { me = await FILA.join('Teste Diag ' + Math.floor(Math.random() * 900 + 100)); return { ok: !me.error && !!me.ticket, note: me.error || '' }; });
    await step('Ver meu status', async () => { const r = await FILA.me(me.ticket.id); return { ok: !!(r && r.ticket), note: r && r.error }; });
    pin = pins[me.ticket.station - 1] || pins[0] || '';
    if (!pin) { add(null, 'PIN não informado: painel do staff não testado'); }
    else {
      let v; await step('Staff: login estação ' + (me.ticket.station), async () => { v = await FILA.staffView(me.ticket.station, pin); return { ok: v && v.ok, note: v && v.error }; });
      if (v && v.ok) {
        const mine = (v.station.waiting || []).find(t => /^Teste Diag/.test(t.name));
        await step('Staff: jogador de teste aparece no painel', async () => ({ ok: !!mine }));
        await step('Staff: marcar fast-pass', async () => { const r = await FILA.staffDo('fast', me.ticket.station, pin, { ticket: mine.id }); return { ok: r && r.ok, note: r && r.error }; });
        await step('Staff: remover teste', async () => { const r = await FILA.staffDo('remove', me.ticket.station, pin, { ticket: mine.id }); return { ok: r && r.ok, note: r && r.error }; });
        await step('Staff: sair (libera estação)', async () => { const r = await FILA.staffDo('logout', me.ticket.station, pin); return { ok: r && r.ok }; });
      }
    }
    add(null, 'Se algum "Teste Diag" sobrar numa fila, remova pelo painel do staff. Teste de 2 aparelhos: abra /staff.html em dois celulares na mesma estação; o segundo deve ver "ocupado".');
  };
})();
