const $app = document.getElementById('app');
const $nav = document.getElementById('nav');

const TEAM_COLORS = {
  ANA: ['#f47a38', '#fff'], BOS: ['#fcb514', '#16223a'], BUF: ['#003087', '#fff'], CGY: ['#d2001c', '#fff'], CAR: ['#cc0000', '#fff'],
  CHI: ['#cf0a2c', '#fff'], COL: ['#8a2e4d', '#fff'], CBJ: ['#002654', '#fff'], DAL: ['#006847', '#fff'], DET: ['#ce1126', '#fff'],
  EDM: ['#ff4c00', '#fff'], FLA: ['#c8102e', '#fff'], LAK: ['#a2aaad', '#16223a'], MIN: ['#154734', '#fff'], MTL: ['#af1e2d', '#fff'],
  NSH: ['#ffb81c', '#16223a'], NJD: ['#ce1126', '#fff'], NYI: ['#00539b', '#fff'], NYR: ['#2f6bd6', '#fff'], OTT: ['#c8102e', '#fff'],
  PHI: ['#f74902', '#fff'], PIT: ['#fcb514', '#16223a'], SEA: ['#68a2b9', '#16223a'], SJS: ['#006d75', '#fff'], STL: ['#002f87', '#fff'],
  TBL: ['#1f55c0', '#fff'], TOR: ['#1f4aa8', '#fff'], UTA: ['#6cace4', '#16223a'], VAN: ['#00205b', '#fff'], VGK: ['#b4975a', '#16223a'],
  WSH: ['#c8102e', '#fff'], WPG: ['#2a4a86', '#fff'],
};
const POS = { F: 'Stürmer', D: 'Verteidiger', G: 'Torhüter' };

const S = { tab: 'board', me: null, pos: '', sort: 'expiry', q: '', timer: null };

/* ---------- helpers ---------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Math.round(n).toLocaleString('de-CH');
const pct = (p) => (p.prev ? ((p.price - p.prev) / p.prev) * 100 : 0);
const cls = (p) => (p.price > p.prev ? 'up' : p.price < p.prev ? 'down' : 'flat');
const arrow = (c) => (c === 'up' ? '▲' : c === 'down' ? '▼' : '–');
const pill = (p) => { const c = cls(p); return `<span class="pill ${c}">${arrow(c)} ${Math.abs(pct(p)).toFixed(1)}%</span>`; };
const logo = (t) => `<img src="https://assets.nhle.com/logos/nhl/svg/${esc(t)}_light.svg" alt="" loading="lazy">`;

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.body ? 'POST' : 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !opts.quiet) { showAuth(); throw new Error('login'); }
  if (!res.ok) throw new Error(data.error || 'Fehler');
  return data;
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.append(el);
  setTimeout(() => el.remove(), 2600);
}

document.addEventListener('error', (e) => {
  if (e.target.tagName === 'IMG') e.target.remove(); // missing photo or logo: fall back to initials or nothing
}, true);

function avatar(p, large) {
  const c = TEAM_COLORS[p.team] || ['#2c3e63', '#fff'];
  const ini = ((p.first || '').charAt(0) + (p.last || '').charAt(0)).toUpperCase();
  const img = p.headshot ? `<img class="ph" src="${esc(p.headshot)}" alt="" loading="lazy">` : '';
  return `<div class="av${large ? ' lg' : ''}" style="background:${c[0]};color:${c[1]}">${esc(ini)}${img}<i>${esc(p.pos)}</i></div>`;
}

function spark(h) {
  if (!h || h.length < 2) return '<svg class="spark" aria-hidden="true"></svg>';
  const mn = Math.min(...h), mx = Math.max(...h), r = mx - mn || 1, w = 104, ht = 34;
  const pts = h.map((v, i) => `${(i / (h.length - 1) * w).toFixed(1)},${(ht - 4 - ((v - mn) / r) * (ht - 8)).toFixed(1)}`).join(' ');
  const c = h[h.length - 1] >= h[0] ? 'var(--up)' : 'var(--down)';
  const [lx, ly] = pts.split(' ').pop().split(',');
  return `<svg class="spark" viewBox="0 0 104 34" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${lx}" cy="${ly}" r="3.2" fill="${c}"/></svg>`;
}

function bigChart(h) {
  if (!h || h.length < 2) return '<div class="chart"><div class="empty" style="padding:8px">Noch keine Preisgeschichte. Der Preis ändert sich nach dem ersten abgeschlossenen Spieltag.</div></div>';
  const mn = Math.min(...h), mx = Math.max(...h), r = mx - mn || 1, w = 320, ht = 90;
  const xy = h.map((v, i) => [i / (h.length - 1) * w, 8 + (ht - 20) - ((v - mn) / r) * (ht - 28)]);
  const line = xy.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const c = h[h.length - 1] >= h[0] ? 'var(--up)' : 'var(--down)';
  const l = xy[xy.length - 1];
  return `<div class="chart"><svg viewBox="0 0 ${w} ${ht}" preserveAspectRatio="none" aria-label="Preisverlauf"><polyline points="${line}" fill="none" stroke="${c}" stroke-width="2.5" vector-effect="non-scaling-stroke" stroke-linejoin="round"/><circle cx="${(l[0] - 3).toFixed(1)}" cy="${l[1].toFixed(1)}" r="4" fill="${c}"/></svg></div>`;
}

/* ---------- player card + detail ---------- */
const hoursText = (h) => (h == null ? '' : h <= 1 ? '1 Std' : `${h} Std`);

function injuryBadge(p) {
  if (p.injury) {
    const out = p.injury.status === 'out';
    return `<span class="lock" style="background:${out ? 'var(--down-bg)' : 'rgba(246,205,69,.18)'};color:${out ? 'var(--down)' : 'var(--yellow)'}">${out ? 'Verletzt' : 'Fraglich'}${p.injury.text ? ' · ' + esc(p.injury.text) : ''}</span>`;
  }
  if (p.missedLast) return '<span class="lock">Im letzten Spiel nicht dabei</span>';
  return '';
}

function card(p) {
  const live = p.todayPts ? `<span class="livepts">${p.todayPts > 0 ? '+' : ''}${p.todayPts} live</span>` : (S.tab === 'market' && p.onMarket ? `<span class="pill flat">noch ${hoursText(p.hoursLeft)}</span>` : '');
  let info = p.owned ? '<span class="lock" style="background:var(--yellow);color:var(--navy)">Im Kader</span>' : '';
  info += ' ' + injuryBadge(p);
  if (p.locked) info += ' <span class="lock">Gesperrt</span>';
  info = info.trim();
  return `<div class="card" data-open="${p.id}" tabindex="0" role="button" aria-label="${esc(p.first + ' ' + p.last)}">
    <div class="row">${avatar(p)}
      <div class="grow"><div class="pname"><span>${logo(p.team)}${esc(p.team)} · ${POS[p.pos]}</span>${esc(p.first)} ${esc(p.last)}</div></div>
      <div class="price"><b>${fmt(p.price)}</b>${pill(p)}</div></div>
    <div class="stats"><div class="mini"><div><b>${p.goals}</b>Tore</div><div><b>${p.assists}</b>Assists</div><div><b>${fmt(p.points)}</b>Punkte</div></div>${spark(p.hist)}</div>
    <div class="foot"><span class="meta">${info || 'Tippen für Details'}</span>${live}</div></div>`;
}

async function openPlayer(id) {
  let d;
  try { d = await api(`/api/players/${id}`); } catch (e) { return toast(e.message); }
  const bg = document.createElement('div');
  bg.className = 'sheet-bg';
  const gain = d.boughtFor != null ? d.price - d.boughtFor : null;
  const action = d.owned
    ? `<button class="btn sell wide" data-sell="${d.id}" ${d.locked ? 'disabled' : ''}>Verkaufen für ${fmt(d.price)}</button>`
    : d.onMarket
      ? `<button class="btn buy wide" data-buy="${d.id}" ${d.locked ? 'disabled' : ''}>Kaufen für ${fmt(d.price)} · noch ${hoursText(d.hoursLeft)} auf dem Markt</button>`
      : '<button class="btn buy wide" disabled>Nicht auf dem Markt</button>';
  const injBlock = d.injury
    ? `<div class="chart" style="border:1px solid ${d.injury.status === 'out' ? 'var(--down)' : 'var(--yellow)'}"><b class="${d.injury.status === 'out' ? 'down' : ''}">${d.injury.status === 'out' ? 'Verletzt' : 'Fraglich'}</b><div style="color:var(--mute);font-size:13px;margin-top:4px">${esc(d.injury.text || '')}${d.injury.returnDate ? ' · Rückkehr ca. ' + esc(d.injury.returnDate) : ''}</div></div>`
    : d.missedLast
      ? '<div class="chart"><b>Im letzten Spiel nicht dabei</b><div style="color:var(--mute);font-size:13px;margin-top:4px">Dieser Spieler stand im letzten Spiel seines Teams nicht im Einsatz (verletzt, überzählig oder abwesend). Der Grund ist nicht bekannt.</div></div>'
      : '';
  const lockInfo = d.locked ? '<p class="note" style="margin:8px 0 0">Gesperrt: Das Team spielt heute oder der Tag ist noch nicht abgeschlossen. Am nächsten Morgen ist der neue Preis da.</p>' : '';
  const live = d.live ? `<div class="chart"><b>Heute live: ${d.live.pts} Punkte</b><div class="meta" style="color:var(--mute);font-size:13px;margin-top:4px">${d.live.goals} Tore, ${d.live.assists} Assists, ${d.live.shots} Schüsse. Voraussichtlicher Preis morgen: <b>${fmt(d.tomorrow)}</b></div></div>` : '';
  bg.innerHTML = `<div class="sheet" role="dialog" aria-label="${esc(d.first + ' ' + d.last)}">
    <div class="head">${avatar(d, true)}<div class="grow"><div class="pname"><span>${logo(d.team)}${esc(d.team)} · ${POS[d.pos]}${d.number != null ? ' · #' + d.number : ''}</span>${esc(d.first)} ${esc(d.last)}</div>
      <div class="row" style="margin-top:8px"><b style="font-family:var(--f-display);font-size:30px">${fmt(d.price)}</b>${pill(d)}</div></div>
      <button class="close" data-close aria-label="Schliessen">✕</button></div>
    <div class="grid4"><div><b>${fmt(d.points)}</b><span>Punkte</span></div><div><b>${d.games}</b><span>Spiele</span></div><div><b>${d.games ? Math.round(d.points / d.games) : 0}</b><span>Ø Punkte</span></div><div><b class="${gain == null ? '' : gain >= 0 ? 'up' : 'down'}">${gain == null ? '–' : (gain >= 0 ? '+' : '−') + fmt(Math.abs(gain))}</b><span>Gewinn</span></div>
      <div><b>${d.goals}</b><span>Tore</span></div><div><b>${d.assists}</b><span>Assists</span></div><div><b>${d.plusMinus > 0 ? '+' : ''}${d.plusMinus}</b><span>+/−</span></div><div><b>${d.shots}</b><span>Schüsse</span></div>
      <div><b>${d.todayPts}</b><span>Heute live</span></div><div><b>${d.pim}</b><span>Strafmin.</span></div><div><b>${d.wins}</b><span>Siege</span></div><div><b>${d.number ?? '–'}</b><span>Nummer</span></div></div>
    ${injBlock}${live}${bigChart(d.hist)}
    <h2 style="margin-top:8px">Letzte Spiele <small>echte NHL-Daten</small></h2>
    ${d.recent && d.recent.length ? `<ul class="log">${d.recent.map((g) => `<li><div>${esc(g.date)} · ${g.home ? 'vs' : '@'} ${esc(g.opp)}<small>${esc(g.text)}</small></div><div style="text-align:right"><b>${g.pts > 0 ? '+' : ''}${g.pts} Pkt</b></div></li>`).join('')}</ul>` : '<div class="empty">Die letzten Spiele konnten gerade nicht geladen werden.</div>'}
    <h2 style="margin-top:8px">Preisänderungen <small>seit Start der App</small></h2>
    ${d.log.length ? `<ul class="log">${d.log.map((l) => `<li><div>${esc(l.day)}<small>${esc(l.summary || '')}</small></div><div style="text-align:right"><b>${l.pts > 0 ? '+' : ''}${l.pts} Pkt</b><small>${fmt(l.price)}</small></div></li>`).join('')}</ul>` : '<div class="empty">Noch keine Preisänderung. Sie kommt nach dem ersten abgeschlossenen Spieltag.</div>'}
    ${action}${lockInfo}</div>`;
  const close = () => { bg.remove(); document.removeEventListener('keydown', esc_); };
  const esc_ = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', esc_);
  bg.addEventListener('click', async (e) => {
    if (e.target === bg || e.target.closest('[data-close]')) return close();
    const b = e.target.closest('[data-buy],[data-sell]');
    if (!b) return;
    if (b.dataset.buy && d.injury && !confirm(`${d.first} ${d.last} ist ${d.injury.status === 'out' ? 'verletzt' : 'fraglich'}${d.injury.text ? ' (' + d.injury.text + ')' : ''}. Trotzdem kaufen?`)) return;
    try {
      await api(b.dataset.buy ? '/api/buy' : '/api/sell', { body: { playerId: Number(b.dataset.buy || b.dataset.sell) } });
      toast(b.dataset.buy ? 'Gekauft' : 'Verkauft');
      close();
      await refreshMe();
      render();
    } catch (err) { toast(err.message); }
  });
  document.body.append(bg);
}

/* ---------- views ---------- */
const views = {
  async board() {
    const [team, moves, live] = await Promise.all([api('/api/team'), api('/api/moves'), api('/api/live')]);
    const gain = team.value - team.invested;
    const gc = gain > 0 ? 'up' : gain < 0 ? 'down' : 'flat';
    const hurt = team.players.filter((p) => p.injury || p.missedLast);
    const running = live.games.filter((g) => g.state === 'LIVE' || g.state === 'CRIT').length;
    return `<section class="hero"><div class="lbl">Teamwert</div><div class="big">${fmt(team.value)}</div>
      <span class="pill ${gc}">${arrow(gc)} ${gain >= 0 ? '+' : '−'}${fmt(Math.abs(gain))} seit Kauf</span></section>
      <div class="tiles"><div class="tile"><b>${S.me.rank}.</b><span>Rang</span></div><div class="tile"><b>${fmt(team.points + live.myPoints)}</b><span>Punkte</span></div><div class="tile"><b>${team.players.length}/20</b><span>Im Kader</span></div></div>
      <h2>Heute <small>${running ? running + ' Spiele laufen' : 'kein Spiel läuft'}</small></h2>
      ${live.mine.length ? live.mine.slice(0, 3).map((r) => `<div class="card" data-open="${r.id}"><div class="row"><div class="grow"><div class="pname"><span>${esc(r.team)}</span>${esc(r.name)}</div></div><div class="price"><b>${r.pts > 0 ? '+' : ''}${r.pts}</b><span class="pill flat">morgen ca. ${fmt(r.tomorrow)}</span></div></div></div>`).join('') : '<div class="empty">Heute noch keine Punkte für dein Team.</div>'}
      ${hurt.length ? `<h2>Achtung im Team <small>${hurt.length} Spieler</small></h2>${hurt.map(card).join('')}` : ''}
      <h2>Letzte Preisbewegungen <small>Spieltag ${esc(moves[0]?.day || '–')}</small></h2>
      ${moves.length ? moves.slice(0, 8).map((m) => { const up = m.price > m.prev_price; return `<div class="card" data-open="${m.id}"><div class="row"><div class="grow"><div class="pname"><span>${esc(m.team)} · ${esc(m.summary)}</span>${esc(m.first)} ${esc(m.last)}</div></div><div class="price"><b>${fmt(m.price)}</b><span class="pill ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${Math.abs((m.price - m.prev_price) / m.prev_price * 100).toFixed(1)}%</span></div></div></div>`; }).join('') : '<div class="empty">Noch keine Preisbewegungen. Sie erscheinen nach dem ersten abgeschlossenen Spieltag.</div>'}`;
  },

  async market() {
    const qs = new URLSearchParams({ pos: S.pos, sort: S.sort, q: S.q });
    const list = await api(`/api/players?${qs}`);
    const f = [['', 'Alle'], ['F', 'Stürmer'], ['D', 'Verteidiger'], ['G', 'Torhüter']];
    return `<h2>Transfermarkt <small>${list.length} Spieler · jede Stunde wechselt einer</small></h2>
      <div class="row2"><input class="field" id="q" type="search" placeholder="Spieler oder Team suchen" value="${esc(S.q)}" autocomplete="off">
      <select class="field" id="sort" aria-label="Sortierung">${[['expiry', 'Läuft ab'], ['price', 'Preis'], ['change', 'Änderung'], ['points', 'Punkte'], ['live', 'Live']].map(([v, l]) => `<option value="${v}" ${S.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="tabs">${f.map(([v, l]) => `<button data-pos="${v}" aria-pressed="${S.pos === v}">${l}</button>`).join('')}</div>
      <div style="margin-top:12px">${list.length ? list.map(card).join('') : '<div class="empty">Keine Spieler gefunden. Falls der Markt ganz leer bleibt, wurden die NHL-Kader noch nicht geladen (siehe README: npm run sync).</div>'}</div>`;
  },

  async team() {
    const t = await api('/api/team');
    const g = t.value - t.invested;
    return `<div class="tiles" style="margin-top:18px"><div class="tile"><b>${fmt(t.value / 1000)}k</b><span>Teamwert</span></div><div class="tile"><b class="${g >= 0 ? 'up' : 'down'}">${g >= 0 ? '+' : '−'}${fmt(Math.abs(g) / 1000)}k</b><span>Gewinn</span></div><div class="tile"><b>${fmt(t.balance / 1000)}k</b><span>Konto</span></div></div>
      <h2>Dein Kader <small>${t.players.length} von 20</small></h2>
      ${t.players.length ? t.players.map(card).join('') : '<div class="empty">Noch keine Spieler. Kaufe welche im Markt.</div>'}`;
  },

  async league() {
    const rows = await api('/api/league');
    return `<h2>Rangliste <small>nach Punkten (inkl. live)</small></h2>
      ${rows.map((r, i) => `<div class="rank${r.me ? ' me' : ''}"><div class="n">${i + 1}</div><div class="grow"><div class="pname"><span>Vermögen ${fmt(r.wealth)}</span>${esc(r.name)}</div></div><div class="pts"><b>${fmt(r.points)}</b>${r.live ? '+' + r.live + ' heute' : 'Punkte'}</div></div>`).join('')}`;
  },

  async live() {
    const d = await api('/api/live');
    const zone = { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit' };
    const stateText = (g) => (g.state === 'LIVE' || g.state === 'CRIT') ? '<small class="live">Live</small>' : (g.state === 'FINAL' || g.state === 'OFF') ? '<small>Ende</small>' : `<small>${g.start ? new Date(g.start).toLocaleTimeString('de-CH', zone) : 'bald'}</small>`;
    return `<h2>Spiele</h2>
      ${d.games.length ? d.games.map((g) => `<div class="game"><div class="t">${logo(g.home)}${esc(g.home)}</div><div class="mid"><b>${g.homeScore ?? '–'} : ${g.awayScore ?? '–'}</b>${stateText(g)}</div><div class="t r">${esc(g.away)}${logo(g.away)}</div></div>`).join('') : '<div class="empty">Keine Spiele im Spielplan.</div>'}
      <h2>Dein Team heute <small>${d.myPoints} Punkte</small></h2>
      ${d.mine.length ? d.mine.map((r) => `<div class="card" data-open="${r.id}"><div class="row"><div class="grow"><div class="pname"><span>${esc(r.team)} · ${r.goals} T, ${r.assists} A</span>${esc(r.name)}</div></div><div class="price"><b>${r.pts > 0 ? '+' : ''}${r.pts}</b><span class="pill flat">morgen ca. ${fmt(r.tomorrow)}</span></div></div></div>`).join('') : '<div class="empty">Noch keine Punkte für dein Team.</div>'}
      <h2>Top Punkte heute</h2>
      ${d.top.length ? d.top.map((r) => `<div class="card" data-open="${r.id}"><div class="row">${avatar({ ...r, first: r.name.split(' ')[0], last: r.name.split(' ').slice(1).join(' ') })}<div class="grow"><div class="pname"><span>${esc(r.team)} · ${r.goals} T, ${r.assists} A</span>${esc(r.name)}</div></div><div class="price"><b>${r.pts}</b>${r.mine ? '<span class="lock" style="background:var(--yellow);color:var(--navy)">Dein Spieler</span>' : ''}</div></div></div>`).join('') : '<div class="empty">Sobald ein Spiel läuft, erscheinen hier die Punkte.</div>'}
      <div class="note">Die Punkte laufen live. Der Preis ändert sich einmal am nächsten Morgen, wenn alle Spiele des Tages fertig sind.</div>`;
  },
};

async function render() {
  clearTimeout(S.timer);
  $nav.hidden = false;
  $nav.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', b.dataset.t === S.tab));
  let html;
  try { html = await views[S.tab](); } catch (e) { if (e.message === 'login') return; html = `<div class="err" style="margin-top:20px">${esc(e.message)}</div>`; }
  const keep = document.activeElement?.id === 'q';
  $app.innerHTML = header() + `<main>${html}</main>`;
  if (keep) { const q = document.getElementById('q'); q?.focus(); q?.setSelectionRange(q.value.length, q.value.length); }
  if (S.tab === 'live' || S.tab === 'board') S.timer = setTimeout(render, 30_000);
}

function header() {
  return `<header class="top"><div class="top-in"><div class="brand">NHL<br>Topscorer<small>${esc(S.me?.name || '')} · SAISON 26/27</small></div>
    <button class="bal" data-logout title="Abmelden"><span>Konto · Abmelden</span><b>${fmt(S.me?.balance || 0)}</b></button></div></header>`;
}

async function refreshMe() { S.me = await api('/api/me'); }

/* ---------- auth ---------- */
function showAuth(mode = 'login', error = '') {
  clearTimeout(S.timer);
  $nav.hidden = true;
  const reg = mode === 'register';
  $app.innerHTML = `<form class="auth" id="auth" autocomplete="on"><div class="brand">NHL<br>Topscorer</div>
    ${error ? `<div class="err">${esc(error)}</div>` : ''}
    <label>Name<input class="field" name="name" autocomplete="username" required minlength="2" maxlength="20"></label>
    <label>Passwort<input class="field" name="password" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" required minlength="8"></label>
    ${reg ? '<label>Einladungscode<input class="field" name="invite" autocomplete="off" required></label>' : ''}
    <button class="btn buy wide" type="submit">${reg ? 'Konto erstellen' : 'Anmelden'}</button>
    <button class="link" type="button" data-mode="${reg ? 'login' : 'register'}">${reg ? 'Schon ein Konto? Anmelden' : 'Neu hier? Konto erstellen'}</button></form>`;
}

document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'auth') return;
  e.preventDefault();
  const f = new FormData(e.target);
  const reg = f.has('invite');
  try {
    await api(reg ? '/api/register' : '/api/login', { body: Object.fromEntries(f), quiet: true });
    await refreshMe();
    S.tab = 'board';
    render();
  } catch (err) { showAuth(reg ? 'register' : 'login', err.message); }
});

/* ---------- events ---------- */
document.addEventListener('click', async (e) => {
  const t = e.target;
  const open = t.closest('[data-open]');
  if (open && !t.closest('.sheet')) return openPlayer(open.dataset.open);
  const tab = t.closest('nav.bar button');
  if (tab) { S.tab = tab.dataset.t; window.scrollTo(0, 0); return render(); }
  const pos = t.closest('[data-pos]');
  if (pos) { S.pos = pos.dataset.pos; return render(); }
  const mode = t.closest('[data-mode]');
  if (mode) return showAuth(mode.dataset.mode);
  if (t.closest('[data-logout]')) { await api('/api/logout', { body: {} }).catch(() => {}); S.me = null; return showAuth(); }
});
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('.card[data-open]')) { e.preventDefault(); openPlayer(e.target.dataset.open); }
});
let typing;
document.addEventListener('input', (e) => {
  if (e.target.id === 'q') { S.q = e.target.value; clearTimeout(typing); typing = setTimeout(render, 250); }
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'sort') { S.sort = e.target.value; render(); }
});

/* ---------- start ---------- */
(async () => {
  try { await refreshMe(); render(); } catch { showAuth(); }
})();
