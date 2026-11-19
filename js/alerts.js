// Som, vibração, tela ligada e telas de aviso (incluindo o WASTED).
const ALERT = (() => {
  let ac = null, wl = null;
  const unlock = () => { try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); } catch (e) {} keepAwake(); };
  async function keepAwake() { try { if ('wakeLock' in navigator && !wl) { wl = await navigator.wakeLock.request('screen'); wl.addEventListener('release', () => { wl = null; }); } } catch (e) {} }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && ac) keepAwake(); });
  const vibrate = p => { try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} };

  function tone(freq, t0, dur, type = 'square', vol = 0.22, f2) {
    const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + t0;
    o.type = type; o.frequency.setValueAtTime(freq, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur + 0.05);
  }
  const beep = (n = 3) => { if (!ac) return; for (let i = 0; i < n; i++) tone(i % 2 ? 880 : 1175, i * 0.28, 0.22); };
  const thud = () => { if (!ac) return; tone(180, 0, 0.9, 'sawtooth', 0.28, 38); tone(90, 0.05, 1.1, 'sine', 0.35, 30); tone(520, 0.0, 0.5, 'triangle', 0.12, 120); };

  function overlay(cls, html) {
    let box = $('#overlay'); if (box) box.remove();
    box = document.createElement('div'); box.id = 'overlay'; box.className = cls; box.innerHTML = html; document.body.appendChild(box); return box;
  }
  function show(title, text, kind = 'info', n = 3) {
    beep(n); vibrate([300, 120, 300, 120, 500]);
    const b = overlay('alertbox ' + kind, '<div class="alertin"><div class="alerttitle"></div><div class="alerttext"></div><button class="btn y">ENTENDI</button></div>');
    $('.alerttitle', b).textContent = title; $('.alerttext', b).textContent = text; $('button', b).onclick = () => b.remove();
  }
  // Tela "WASTED" estilo GTA: cena em preto e branco, letreiro vermelho batendo, silêncio dramático.
  function wasted(sub, buttons) {
    thud(); vibrate([500, 150, 800]);
    document.documentElement.classList.add('is-wasted');
    const b = overlay('wasted', '<div class="w-vig"></div><div class="w-center"><div class="w-title">WASTED</div><div class="w-sub"></div><div class="w-actions"></div></div>');
    $('.w-sub', b).textContent = sub;
    const act = $('.w-actions', b);
    (buttons || []).forEach(x => { const el = document.createElement('button'); el.className = 'btn y'; el.textContent = x.label; el.onclick = () => { b.remove(); document.documentElement.classList.remove('is-wasted'); x.onClick && x.onClick(); }; act.appendChild(el); });
    return b;
  }
  const clearWasted = () => { const b = $('#overlay.wasted'); if (b) b.remove(); document.documentElement.classList.remove('is-wasted'); };
  return { unlock, show, beep, wasted, clearWasted, get ready() { return !!ac && ac.state === 'running'; } };
})();
