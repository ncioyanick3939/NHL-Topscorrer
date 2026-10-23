/*
 * Surprise effects: confetti, coin shower, goal light, celebration card, counting numbers.
 * No libraries. Everything is skipped for people who asked their phone for less motion.
 */
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem('fx:' + k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('fx:' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};

export function vibrate(pattern = 30) {
  try { navigator.vibrate?.(pattern); } catch { /* not supported (iPhone) */ }
}

/** Particles from a point (default: upper middle). kind: 'confetti' or 'coins'. */
export function burst({ x = innerWidth / 2, y = innerHeight * 0.35, count = 90, kind = 'confetti', spread = 1 } = {}) {
  if (calm()) return;
  const c = document.createElement('canvas');
  c.className = 'fx-canvas';
  const dpr = Math.min(devicePixelRatio || 1, 2);
  c.width = innerWidth * dpr; c.height = innerHeight * dpr;
  document.body.append(c);
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  const colors = kind === 'coins' ? ['#ffd84a', '#ffc400', '#e0a800', '#fff1b0'] : ['#ffc400', '#ffd84a', '#ffffff', '#e5384f', '#3d7bff', '#3fd68a'];
  const parts = Array.from({ length: count }, () => {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.3 * spread;
    const v = 6 + Math.random() * 9;
    return { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4,
      w: kind === 'coins' ? 9 + Math.random() * 5 : 6 + Math.random() * 6, h: 4 + Math.random() * 6, c: colors[(Math.random() * colors.length) | 0] };
  });
  const t0 = performance.now();
  const frame = (t) => {
    const age = t - t0;
    g.clearRect(0, 0, innerWidth, innerHeight);
    g.globalAlpha = Math.max(0, 1 - Math.max(0, age - 1300) / 700);
    for (const p of parts) {
      p.vy += 0.32; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.fillStyle = p.c;
      if (kind === 'coins') { g.beginPath(); g.ellipse(0, 0, p.w / 2, (p.w / 2) * Math.abs(Math.cos(p.r * 2)) + 1, 0, 0, Math.PI * 2); g.fill(); }
      else g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      g.restore();
    }
    if (age < 2000) requestAnimationFrame(frame); else c.remove();
  };
  requestAnimationFrame(frame);
}

/** Red goal light pulsing around the screen edge. */
export function goalLight() {
  if (calm()) return;
  const el = document.createElement('div');
  el.className = 'fx-goal';
  document.body.append(el);
  setTimeout(() => el.remove(), 2400);
}

/** A big card in the middle: title, line below, optional emblem. Tap or wait to close. Several wait their turn. */
const queue = [];
let showing = false;
export function celebrate(opts = {}) {
  queue.push(opts);
  if (!showing) next();
}
function next() {
  const opts = queue.shift();
  showing = !!opts;
  if (opts) show(opts);
}
function show({ title, sub = '', kind = 'win', confetti = true }) {
  const el = document.createElement('div');
  el.className = `fx-cele ${kind}`;
  el.setAttribute('role', 'status');
  const icon = { win: '🏆', goal: '🚨', rank: '🥇', sold: '💰', egg: '🏒' }[kind] || '⭐';
  el.innerHTML = `<div class="fx-card"><div class="fx-icon">${icon}</div><b></b><span></span></div>`;
  el.querySelector('b').textContent = title;
  el.querySelector('span').textContent = sub;
  document.body.append(el);
  if (kind === 'goal') goalLight();
  if (confetti) setTimeout(() => burst({ count: kind === 'goal' ? 140 : 110 }), 120);
  vibrate(kind === 'goal' ? [60, 40, 60, 40, 120] : [40, 30, 80]);
  let done = false;
  const close = () => { if (done) return; done = true; el.classList.add('out'); setTimeout(() => { el.remove(); next(); }, 300); };
  el.addEventListener('click', close);
  setTimeout(close, 3200);
}

/* Numbers that count up to their new value. Remembers the last shown value per key, so a refresh does not replay. */
const shown = new Map();
export function countUp(root = document) {
  for (const el of root.querySelectorAll('[data-count]')) {
    const key = el.dataset.countKey || el.dataset.count;
    const to = Number(el.dataset.count);
    const from = shown.has(key) ? shown.get(key) : 0;
    shown.set(key, to);
    if (calm() || from === to || !Number.isFinite(to)) continue;
    const fmt = el.dataset.fmt === 'sign' ? (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toLocaleString('de-CH') : (n) => n.toLocaleString('de-CH');
    const t0 = performance.now(), dur = Math.min(1200, 400 + Math.abs(to - from) / 50);
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(Math.round(from + (to - from) * e));
      if (k < 1 && el.isConnected) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}

/**
 * Celebrate what happened since the last look: auctions won or lost, goals and assists of lineup players,
 * a better rank. The first look of a day only remembers the state, so nothing old pops up.
 * Returns texts for small toasts.
 */
export function news({ me, live, auctions }) {
  const toasts = [];
  if (auctions?.results) {
    const seen = new Set(store.get('results') ?? []);
    const first = store.get('results') == null;
    const keyOf = (r) => `${r.at}|${r.name}`;
    const fresh = auctions.results.filter((r) => !seen.has(keyOf(r)));
    store.set('results', auctions.results.map(keyOf));
    if (!first) {
      const won = fresh.filter((r) => r.won);
      if (won.length) celebrate({ title: 'Zuschlag!', sub: won.length === 1 ? `${won[0].name} gehört jetzt dir.` : `${won.map((r) => r.name).join(', ')} gehören jetzt dir.`, kind: 'win' });
      for (const r of fresh.filter((x) => !x.won)) toasts.push(`Überboten: ${r.name} ging an jemand anderen.`);
    }
  }
  if (live?.mine) {
    const day = live.openDay || 'x';
    const prev = store.get('live');
    const now = Object.fromEntries(live.mine.filter((r) => r.inLineup).map((r) => [r.id, [r.goals, r.assists]]));
    store.set('live', { day, now });
    if (prev && prev.day === day) {
      const scorers = live.mine.filter((r) => r.inLineup && r.goals > (prev.now[r.id]?.[0] ?? 0));
      if (scorers.length) celebrate({ title: 'TOR!', sub: scorers.map((r) => `${r.name} trifft`).join(' · '), kind: 'goal' });
      for (const r of live.mine.filter((x) => x.inLineup && x.assists > (prev.now[x.id]?.[1] ?? 0))) toasts.push(`Assist für ${r.name}!`);
    }
  }
  if (me?.rank) {
    const prev = store.get('rank');
    store.set('rank', me.rank);
    if (prev && me.rank < prev) celebrate({ title: `Platz ${me.rank}!`, sub: `Du bist in der Liga ${prev - me.rank === 1 ? 'einen Platz' : (prev - me.rank) + ' Plätze'} aufgestiegen.`, kind: 'rank' });
  }
  return toasts;
}

/* Easter egg: five quick taps on the NHL shield. */
let taps = [];
export function logoTap() {
  const now = Date.now();
  taps = [...taps.filter((t) => now - t < 1500), now];
  if (taps.length >= 5) {
    taps = [];
    goalLight();
    celebrate({ title: 'Goal Horn!', sub: 'Du hast den Geheimtipp gefunden. 🏒', kind: 'egg' });
  }
}
