import * as fx from './fx.js';

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
const TEAM_NAMES = {
  ANA: 'Anaheim Ducks', BOS: 'Boston Bruins', BUF: 'Buffalo Sabres', CGY: 'Calgary Flames', CAR: 'Carolina Hurricanes',
  CHI: 'Chicago Blackhawks', COL: 'Colorado Avalanche', CBJ: 'Columbus Blue Jackets', DAL: 'Dallas Stars', DET: 'Detroit Red Wings',
  EDM: 'Edmonton Oilers', FLA: 'Florida Panthers', LAK: 'Los Angeles Kings', MIN: 'Minnesota Wild', MTL: 'Montréal Canadiens',
  NSH: 'Nashville Predators', NJD: 'New Jersey Devils', NYI: 'New York Islanders', NYR: 'New York Rangers', OTT: 'Ottawa Senators',
  PHI: 'Philadelphia Flyers', PIT: 'Pittsburgh Penguins', SEA: 'Seattle Kraken', SJS: 'San Jose Sharks', STL: 'St. Louis Blues',
  TBL: 'Tampa Bay Lightning', TOR: 'Toronto Maple Leafs', UTA: 'Utah Mammoth', VAN: 'Vancouver Canucks', VGK: 'Vegas Golden Knights',
  WSH: 'Washington Capitals', WPG: 'Winnipeg Jets',
};
const teamName = (t) => TEAM_NAMES[t] || t;

const S = { scrollNext: false, wantNext: false, gsub: 'up', line: 1, team: null, tab: 'board', sub: { team: 'market', league: 'rank', nhl: 'games', live: 'team' }, liveSeg: 'lineup', mode: 'buy', me: null, pos: '', sort: 'expiry', q: '', top: '', timer: null, cd: null };

/* ---------- helpers ---------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Math.round(n).toLocaleString('de-CH');
/** Short money: 2.35 Mio, 840k */
const money = (n) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(2)} Mio` : `${fmt(n / 1000)}k`);
/** NHL season of today, e.g. "26/27" (a new season starts in September). */
const seasonLabel = (() => { const d = new Date(); const y = d.getFullYear() % 100 - (d.getMonth() < 8 ? 1 : 0); return `${String(y).padStart(2, '0')}/${String(y + 1).padStart(2, '0')}`; })();
const pct = (p) => (p.prev ? ((p.price - p.prev) / p.prev) * 100 : 0);
const cls = (p) => (p.price > p.prev ? 'up' : p.price < p.prev ? 'down' : 'flat');
const arrow = (c) => (c === 'up' ? '▲' : c === 'down' ? '▼' : '–');
const pill = (p) => { const c = cls(p); return `<span class="pill ${c}">${arrow(c)} ${Math.abs(pct(p)).toFixed(1)}%</span>`; };
const logo = (t) => `<img src="https://assets.nhle.com/logos/nhl/svg/${esc(t)}_dark.svg" alt="" loading="lazy">`; // version for dark backgrounds

const apiCache = new Map(); // GET responses for a few seconds, so switching tabs back and forth feels instant
const apiFlight = new Map();
async function api(path, opts = {}) {
  const isGet = !opts.body;
  if (isGet) {
    const hit = apiCache.get(path);
    if (hit && Date.now() - hit.t < 15_000 && !opts.fresh) return hit.data;
    if (apiFlight.has(path)) return apiFlight.get(path);
  } else apiCache.clear(); // any change invalidates everything
  const run = (async () => {
    let res;
    try {
      res = await fetch(path, {
        method: isGet ? 'GET' : 'POST',
        headers: isGet ? {} : { 'Content-Type': 'application/json' },
        body: isGet ? undefined : JSON.stringify(opts.body),
        signal: AbortSignal.timeout(30_000), // never spin forever
      });
    } catch {
      throw new Error('Der Server antwortet gerade nicht. Bitte in einer Minute neu laden.');
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !opts.quiet) { showAuth(); throw new Error('login'); }
    if (!res.ok) throw new Error(data.error || 'Fehler');
    if (isGet) apiCache.set(path, { t: Date.now(), data });
    return data;
  })();
  if (isGet) { apiFlight.set(path, run); run.finally(() => apiFlight.delete(path)).catch(() => {}); }
  return run;
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  el.setAttribute('role', 'status');
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  document.body.append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, 2600);
}

document.addEventListener('error', (e) => {
  if (e.target.tagName !== 'IMG') return;
  const src = e.target.getAttribute('src') || '';
  if (src.endsWith('_dark.svg')) { e.target.src = src.replace('_dark.svg', '_light.svg'); return; } // no dark logo: use the normal one
  e.target.remove(); // missing photo or logo: fall back to initials or nothing
}, true);

function avatar(p, large) {
  const c = TEAM_COLORS[p.team] || ['#2c3e63', '#fff'];
  const ini = ((p.first || '').charAt(0) + (p.last || '').charAt(0)).toUpperCase();
  const img = p.headshot ? `<img class="ph" src="${esc(p.headshot)}" alt="" loading="lazy">` : '';
  return `<div class="av${large ? ' lg' : ''}" style="background:${c[0]};color:${c[1]}">${esc(ini)}${img}<i>${esc(p.number != null ? p.number : p.pos)}</i></div>`;
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

/* ---------- player rows + detail ---------- */
const hoursText = (h) => (h == null ? '' : h <= 1 ? '1 Std' : `${h} Std`);
const sign = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n));
const avg = (p) => (p.games ? Math.round(p.points / p.games) : 0);
/** Save percentage like 91.2 %, or – when the goalie has not faced a shot yet. */
const pctText = (v) => (v == null ? '–' : `${(v * 100).toFixed(1)}%`);
const ago = (iso) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000));
  return m < 60 ? `${m} Min` : m < 1440 ? `${Math.round(m / 60)} Std` : `${Math.round(m / 1440)} T`;
};

/** Im Spiel = he is on the ice in the running game (the NHL publishes no lineup before puck drop). Before: when the team plays. */
function gameBadge(p) {
  const g = p.nextGame;
  if (p.nhlLineup === 'out' && !p.dressed) return '<span class="lock bad">Nicht im Line-Up</span>';
  if (p.dressed) return g ? '<span class="lock lineup">Im Spiel</span>' : '<span class="lock">Gespielt</span>';
  if (g && (g.state === 'FUT' || g.state === 'PRE') && p.nhlLineup !== 'in') {
    const t = new Date(g.start).toLocaleString('de-CH', { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' });
    return `<span class="lock">Spielt ${t}</span>`;
  }
  return '';
}

function injuryBadge(p) {
  if (p.injury) {
    const out = p.injury.status === 'out';
    return `<span class="lock ${out ? 'bad' : 'warn'}">${out ? 'Verletzt' : 'Fraglich'}${p.injury.text ? ' · ' + esc(p.injury.text) : ''}</span>`;
  }
  if (p.missedLast) return '<span class="lock">Letztes Spiel nicht dabei</span>';
  return '';
}

/** One player row in the Topscorers style: photo, position, name, points, value. */
function prow(p, o = {}) {
  const tag = (p.number != null ? '#' + p.number + ' ' : '') + POS[p.pos];
  const nhl = p.nhlLineup === 'in' ? ' <span class="nhlin">Line-Up</span>' : '';
  const badges = [p.lineup > 0 ? '<span class="lock lineup">In Aufstellung</span>' : '', gameBadge(p), injuryBadge(p), p.tradeLocked ? '<span class="lock">Gesperrt</span>' : '', p.owned && o.owned ? '<span class="lock own">Im Kader</span>' : '', p.ownerName && !p.owned ? `<span class="lock">Im Kader von ${esc(p.ownerName)}</span>` : '', p.myBid ? `<span class="lock own">Dein Gebot ${fmt(p.myBid)}</span>` : '', p.listedBy ? `<span class="lock">Angebot von ${esc(p.listedBy)}</span>` : ''].filter(Boolean).join(' ');
  const right = o.right ?? `<b>${fmt(p.price)}</b><small>${o.rightLabel || 'Marktwert'}</small>`;
  const sub = o.sub ?? `<span class="pair"><b>${fmt(p.points)}</b><small>Punkte</small></span><span class="pair"><b>${avg(p)}</b><small>Ø Punkte</small></span>${p.pos === 'G' && p.savePct != null ? `<span class="pair"><b>${pctText(p.savePct)}</b><small>Fangquote</small></span>` : ''}`;
  const tc = (TEAM_COLORS[p.team] || ['#2c3e63'])[0];
  return `<div class="prow${o.btn ? ' hasbtn' : ''}" style="--tc:${tc}" data-open="${p.id}" tabindex="0" role="button" aria-label="${esc(p.first + ' ' + p.last)}">
    ${avatar(p)}<div class="pmain"><div class="ptag">${esc(tag)}${nhl}${o.timer && p.onMarket ? ` <span class="timer">${hoursText(p.hoursLeft)}</span>` : ''}</div>
      <div class="pn">${esc(p.last)}${p.first ? `<small>${esc(p.first)}</small>` : ''}</div>
      <div class="pclub">${esc(teamName(p.team))}</div>
      <div class="pnums">${sub}</div>${badges ? `<div class="pbadges">${badges}</div>` : ''}</div>
    <div class="pright"><span class="plogo">${logo(p.team)}</span><div class="pval">${right}</div>${o.btn || ''}</div></div>`;
}

async function openPlayer(id) {
  let d;
  try { d = await api(`/api/players/${id}`); } catch (e) { return toast(e.message); }
  const bg = document.createElement('div');
  bg.className = 'sheet-bg';
  const gain = d.boughtFor != null ? d.price - d.boughtFor : null;
  const action = d.owned
    ? `<button class="btn sell wide" data-sellmenu="${d.id}" ${d.tradeLocked ? 'disabled' : ''}>Verkaufen</button>`
    : d.onMarket
      ? `<button class="btn buy wide" data-bid="${d.id}" ${d.tradeLocked ? 'disabled' : ''}>${d.myBid ? 'Gebot ändern (' + fmt(d.myBid) + ')' : 'Bieten ab ' + fmt(d.listedBy ? d.minBid : d.price)} · noch ${hoursText(d.hoursLeft)}</button>`
      : '<button class="btn buy wide" disabled>Nicht auf dem Markt</button>';
  const injBlock = d.injury
    ? `<div class="chart" style="border:1px solid ${d.injury.status === 'out' ? 'var(--down)' : 'var(--yellow)'}"><b class="${d.injury.status === 'out' ? 'down' : ''}">${d.injury.status === 'out' ? 'Verletzt' : 'Fraglich'}</b><div style="color:var(--mute);font-size:13px;margin-top:4px">${esc(d.injury.text || '')}${d.injury.returnDate ? ' · Rückkehr ca. ' + esc(d.injury.returnDate) : ''}</div></div>`
    : d.missedLast
      ? '<div class="chart"><b>Im letzten Spiel nicht dabei</b><div style="color:var(--mute);font-size:13px;margin-top:4px">Dieser Spieler stand im letzten Spiel seines Teams nicht im Einsatz (verletzt, überzählig oder abwesend). Der Grund ist nicht bekannt.</div></div>'
      : '';
  const lockInfo = d.tradeLocked ? '<p class="note" style="margin:8px 0 0">Gesperrt: Das Team spielt heute oder der Tag ist noch nicht abgeschlossen. Am nächsten Morgen ist der neue Preis da.</p>' : '';
  const sgn = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n));
  const live = d.live ? `<div class="calc"><div class="calch"><span>Heute live</span><b class="${d.live.pts > 0 ? 'up' : d.live.pts < 0 ? 'down' : ''}">${sgn(d.live.pts)}</b></div>
    <ul>${(d.live.breakdown || []).map((r) => `<li><span><i>${r.n != null ? r.n + '×' : ''}</i>${esc(r.label)}</span><b class="${r.pts > 0 ? 'up' : 'down'}">${sgn(r.pts)}</b></li>`).join('') || '<li><span>Noch keine Punkte</span><b>0</b></li>'}</ul>
    <div class="calcf"><span>Total</span><b>${sgn(d.live.pts)} Punkte</b></div>
    <small>Voraussichtlicher Preis morgen: <b>${fmt(d.tomorrow)}</b> ${pill({ price: d.tomorrow, prev: d.price })}</small></div>` : '';
  const trans = d.transfers?.length
    ? `<h2>Transfers</h2><ul class="log">${d.transfers.map((t) => `<li><div>${esc(t.user)} ${t.kind === 'buy' ? 'kauft' : 'verkauft'}<small>vor ${ago(t.at)}</small></div><div style="text-align:right"><b>${fmt(t.price)}</b></div></li>`).join('')}</ul>` : '';
  bg.innerHTML = `<div class="sheet center" role="dialog" aria-modal="true" tabindex="-1" aria-label="${esc(d.first + ' ' + d.last)}">
    <button class="close" data-close aria-label="Schliessen">✕</button>
    <div class="wmlogo">${logo(d.team)}</div><div class="shead">${logo(d.team)}<div class="sname">${esc(d.first)} ${esc(d.last)}</div><div class="ptag">#${d.number ?? '–'} · ${POS[d.pos]}</div><div class="sclub">${esc(teamName(d.team))}</div></div>
    <div class="photo"><div class="wm">${esc(d.number ?? '')}</div>${avatar(d, true)}</div>
    <div class="big3"><div><b>${fmt(d.points)}</b><span>Punkte</span></div><div><b>${avg(d)}</b><span>Ø Punkte</span></div><div><b>${fmt(d.price)}</b><span>Marktwert ${pill(d)}</span></div></div>
    ${live}${d.pos === 'G' ? `<div class="grid4"><div><b>${d.games}</b><span>Spiele</span></div><div><b>${d.wins}</b><span>Siege</span></div><div><b>${d.shutouts ?? 0}</b><span>Shutouts</span></div><div class="hi"><b data-svpct>${pctText(d.savePct)}</b><span>Fangquote</span></div>
      <div><b>${fmt(d.saves ?? 0)}</b><span>Paraden</span></div><div><b>${d.goalsAgainst ?? 0}</b><span>Gegentore</span></div><div><b>${d.games ? ((d.goalsAgainst ?? 0) / d.games).toFixed(2) : '–'}</b><span>GT / Spiel</span></div><div><b>${d.pim}</b><span>Strafmin.</span></div></div>`
    : `<div class="grid4 g"><div><b>${d.games}</b><span>Spiele</span></div><div><b>${d.goals}</b><span>Tore</span></div><div><b>${d.assists}</b><span>Assists</span></div><div><b>${d.plusMinus > 0 ? '+' : ''}${d.plusMinus}</b><span>Plus/Minus</span></div>
      <div><b>${d.shots}</b><span>Schüsse aufs Tor</span></div><div><b>${d.blocked ?? 0}</b><span>Geblockte Schüsse</span></div><div><b>${d.foWon ?? 0}</b><span>Bullys gewonnen</span></div><div><b>${d.pim}</b><span>Strafminuten</span></div></div>
      ${d.games && d.seasonExact < d.games ? `<div class="snote">Geblockte Schüsse und Bullys: ${d.seasonExact === 1 ? 'aus dem 1 Spiel, das' : `aus den ${d.seasonExact} Spielen, die`} die App live verfolgt hat (die NHL-Saisontabelle hat diese Werte nicht).</div>` : ''}`}
    ${injBlock}
    <div id="g1"><div class="empty">Spiele werden geladen …</div></div>
    <div class="big3 small"><div><b>${d.boughtFor != null ? fmt(d.boughtFor) : '–'}</b><span>Gekauft für</span></div><div><b class="${gain == null ? '' : gain >= 0 ? 'up' : 'down'}">${gain == null ? '–' : sign(gain)}</b><span>Gewinn</span></div><div><b>${fmt(d.price)} <i class="${cls(d)}">${arrow(cls(d))}</i></b><span>Marktwert</span></div></div>
    ${priceChart(d)}
    ${transferTimeline(d)}
    <div id="g2"></div>
    <details class="fold"><summary><h2>Preisänderungen${d.log.length ? ` <small>${d.log.length}</small>` : ''}</h2></summary>
    ${d.log.length ? `<ul class="log">${d.log.map((l) => `<li><div>${esc(l.day)}<small>${esc(l.summary || '')}</small></div><div style="text-align:right"><b>${l.pts > 0 ? '+' : ''}${l.pts} Pkt</b><small>${fmt(l.price)}</small></div></li>`).join('')}</ul>` : '<div class="empty">Noch keine Preisänderung. Sie kommt nach dem ersten abgeschlossenen Spieltag.</div>'}</details>
    ${action}${lockInfo}</div>`;
  const close = () => closeSheet(bg);
  bg.addEventListener('click', async (e) => {
    if (e.target === bg || e.target.closest('[data-close]')) return close();
    const bid = e.target.closest('[data-bid]');
    if (bid) { close(); return bidSheet(d.id); }
    const sm = e.target.closest('[data-sellmenu]');
    if (sm) { close(); return sellSheet(d.id); }
  });
  mountSheet(bg);
  api(`/api/players/${d.id}/games`).then((g) => {
    const a = bg.querySelector('#g1'), b = bg.querySelector('#g2');
    if (!a) return;
    a.innerHTML = gamesHtml(g.recent, g.error, d);
    // goalie without season numbers yet: save percentage from his games in the NHL log
    const sv = bg.querySelector('[data-svpct]');
    if (sv && d.savePct == null) {
      const games = (g.recent || []).filter((x) => !x.missed && x.sa > 0);
      const sa = games.reduce((s, x) => s + x.sa, 0), ga = games.reduce((s, x) => s + x.ga, 0);
      if (sa) sv.textContent = pctText((sa - ga) / sa);
    }
    const sc = a.querySelector('[data-scrollend]'); if (sc) sc.scrollLeft = sc.scrollWidth; // newest game on the right
    b.innerHTML = gamesListHtml(g.recent);
  }).catch(() => { const a = bg.querySelector('#g1'); if (a) a.innerHTML = '<div class="empty">Die Spiele konnten gerade nicht geladen werden.</div>'; });
}

/** Points per game like Topscorers: bars of the last games with both logos and the score, season block on the right. */
const res = (g) => (g.result ? `<span class="res ${g.result.win ? 'win' : 'loss'}">${g.result.own}:${g.result.opp}${g.result.ot ? ' n.V.' : ''} ${g.result.win ? 'S' : 'N'}</span>` : '');
const dm = (s) => { const [y, m, d] = String(s).split('-'); return d && m ? `${d}.${m}.` : s; };
function gamesHtml(log, err, d) {
  if (!log || !log.length) return `<div class="empty">${log ? 'Noch keine Spiele in dieser Saison.' : 'Die Spiele konnten gerade nicht geladen werden.'}${err ? `<br><small>${esc(err)}</small>` : ''}</div>`;
  const last = [...log].reverse(); // oldest on the left
  const mx = Math.max(1, ...last.filter((g) => !g.missed).map((g) => Math.abs(g.pts)));
  const av = d.games ? d.points / d.games : 0;
  const cols = last.map((g) => {
    const left = g.home ? g.team : g.opp, right = g.home ? g.opp : g.team;
    const r = g.result;
    const score = r ? (g.home ? `${r.own}:${r.opp}` : `${r.opp}:${r.own}`) : '';
    if (g.missed) return `<div class="gcol miss" title="Nicht eingesetzt"><div class="gbar"><span class="gx">✕</span></div><b>–</b><div class="glogos">${logo(left)}${logo(right)}</div><small>${score}</small></div>`;
    const h = Math.max(10, Math.round(Math.abs(g.pts) / mx * 96));
    const hot = g.pts > av * 1.15;
    return `<div class="gcol"><div class="gbar"><i class="${hot ? 'hot' : ''}${g.pts < 0 ? ' neg' : ''}" style="height:${h}px"></i></div><b>${g.pts}</b><div class="glogos">${logo(left)}${logo(right)}</div><small>${score}</small></div>`;
  }).join('');
  return `<div class="gwrap"><div class="gcols" data-scrollend>${cols}</div><div class="season"><span>Saison ${seasonLabel}</span><b>${fmt(d.points)}</b><small>Punkte</small><b>${avg(d)}</b><small>Ø</small><b>${d.games}</b><small>Spiele</small></div></div>${seasonNote(d)}`;
}
/** How the season points were made: exact for games the app followed live, estimated before that. */
function seasonNote(d) {
  if (!d.games) return '';
  const txt = d.seasonExact >= d.games ? 'Alle Saisonpunkte exakt nach den Spielregeln.'
    : d.seasonExact ? `${d.seasonExact} von ${d.games} Spielen exakt, die übrigen aus der NHL-Saisonstatistik geschätzt.`
      : 'Saisonpunkte aus der NHL-Saisonstatistik geschätzt (exakt ab dem ersten Spiel, das die App live verfolgt).';
  return `<div class="snote">${txt}</div>`;
}
function gamesListHtml(log) {
  if (!log || !log.length) return '';
  let n = log.filter((g) => !g.missed).length; // games he played, counted down from the newest
  const total = n;
  const list = log.map((g) => g.missed
    ? `<li class="miss"><div><b>✕ Nicht eingesetzt</b> · ${g.home ? 'vs' : '@'} ${esc(g.opp)} ${res(g)}<small>${dm(g.date)}</small></div><div style="text-align:right"><b>–</b></div></li>`
    : `<li><div><b>${n--}. Spiel</b> · ${g.home ? 'vs' : '@'} ${esc(g.opp)} ${res(g)}<small>${dm(g.date)} · ${esc(g.text)}</small></div><div style="text-align:right"><b>${g.pts} Pkt</b></div></li>`).join('');
  return `<details class="fold" open><summary><h2>Punkte pro Spiel <small>${total} Spiele</small></h2></summary><ul class="log">${list}</ul></details>`;
}

/** Price curve with axis labels, like Topscorers. */
function priceChart(d) {
  const h = d.histFull || [];
  if (h.length < 2) return '<div class="chart"><div class="empty" style="padding:8px">Noch keine Preisgeschichte. Der Preis ändert sich nach dem ersten abgeschlossenen Spieltag.</div></div>';
  const vals = h.map((x) => x.price);
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const W = 340, H = 140, L = 6, R = 44, T = 10, B = 22;
  const x = (i) => L + (i / (h.length - 1)) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / span) * (H - T - B);
  const pts = h.map((p, i) => `${x(i).toFixed(1)},${y(p.price).toFixed(1)}`).join(' ');
  const k = (v) => `${Math.round(v / 1000)}k`;
  const ticks = [hi, (hi + lo) / 2, lo];
  const grid = ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" stroke="rgba(255,255,255,.08)"/><text x="${W - 2}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end" class="ax">${k(t)}</text>`).join('');
  const lbl = [0, Math.floor((h.length - 1) / 2), h.length - 1].map((i, n) => `<text x="${x(i).toFixed(1)}" y="${H - 4}" text-anchor="${n === 0 ? 'start' : n === 2 ? 'end' : 'middle'}" class="ax">${dm(h[i].day)}</text>`).join('');
  const c = vals[vals.length - 1] >= vals[0] ? 'var(--yellow)' : 'var(--down)';
  const lx = x(h.length - 1), ly = y(vals[vals.length - 1]);
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" aria-label="Preisverlauf">${grid}<polyline points="${pts}" fill="none" stroke="${c}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="4" fill="${c}"/>${lbl}</svg></div>`;
}

/** Transfer history as a timeline: market, price, manager, price, manager ... */
function transferTimeline(d) {
  const list = [...(d.transfers || [])].reverse();
  if (!list.length) return '';
  const date = (iso) => { const t = new Date(iso); return `${String(t.getDate()).padStart(2, '0')}-${String(t.getMonth() + 1).padStart(2, '0')}-${t.getFullYear()}`; };
  const node = (label, market) => `<div class="tn">${market ? '<img src="/nhl-logo.png" alt="">' : `<span class="tav">${esc(label.slice(0, 1).toUpperCase())}</span>`}<b>${esc(market ? 'Markt' : label)}</b></div>`;
  const parts = [node('', true)];
  for (const t of list) {
    parts.push(`<div class="tl"><span>⇄</span><b>${fmt(t.price)}</b><small>${date(t.at)}</small></div>`);
    parts.push(t.kind === 'buy' ? node(t.user, false) : node('', true));
  }
  return `<div class="thist"><div class="thead">Transfers</div><div class="tline">${parts.join('')}</div></div>`;
}

/** Market trend card: last change, live forecast, biggest movers. */
function trendHtml(t, full) {
  const arrowOf = (v) => (v > 0 ? '▲' : v < 0 ? '▼' : '–');
  const clsOf = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : 'flat');
  const pctTxt = (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)} %`;
  const big = (label, v, sub) => `<div class="tr"><span>${label}</span><b class="${clsOf(v)}">${arrowOf(v)} ${pctTxt(v)}</b><small>${sub}</small></div>`;
  const movers = (list, label) => (list.length ? `<div class="grp">${label}</div>${list.map((p) => `<div class="mv" data-open="${p.id}"><span>${esc(p.first[0] || '')}. ${esc(p.last)} <small>${esc(p.team)}</small></span><b class="${clsOf(p.delta)}">${p.delta > 0 ? '+' : '−'}${fmt(Math.abs(p.delta))}</b></div>`).join('')}` : '');
  const head = `<div class="trend">${big('Markt gestern', t.last.pct, `${t.last.delta >= 0 ? '+' : '−'}${fmt(Math.abs(t.last.delta))} Gesamtwert`)}${big('Prognose heute', t.forecast.pct, 'aus den Live-Punkten')}${big('Transfermarkt', t.listed.pct, 'Ø der Angebote')}</div>`;
  return full ? head + movers(t.liveRisers, 'Steiger heute (live)') + movers(t.liveFallers, 'Absteiger heute (live)') + movers(t.risers, 'Gewinner letzter Tag') + movers(t.fallers, 'Verlierer letzter Tag') : head;
}

/** Where the numbers come from and how fresh they are; a clear note when the NHL does not answer. */
function dataStamp() {
  const d = S.me?.data;
  if (!d) return '';
  const time = (ms) => new Date(ms).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' });
  if (d.error && d.error.at > (d.updatedAt || 0)) {
    return `<div class="stamp bad" title="${esc(d.error.msg)}"><i></i>Die NHL antwortet gerade nicht. ${d.updatedAt ? `Daten von ${time(d.updatedAt)} Uhr.` : 'Noch keine Daten geladen.'}</div>`;
  }
  if (!d.updatedAt) return '<div class="stamp"><i></i>NHL-Daten werden geladen …</div>';
  return `<div class="stamp ok"><i></i>NHL-Daten aktualisiert vor ${ago(new Date(d.updatedAt).toISOString())}</div>`;
}

/** The latest finished NHL games, newest first. */
function resultsHtml(games) {
  const done = (games || []).filter((g) => g.state === 'FINAL' || g.state === 'OFF').sort((a, b) => String(b.start).localeCompare(String(a.start))).slice(0, 4);
  if (!done.length) return '';
  return `<h2>Letzte Resultate <small>NHL</small></h2>${done.map((g) => `<div class="game" data-game="${g.id}" role="button" tabindex="0"><div class="t">${logo(g.home)}${esc(g.home)}</div><div class="mid"><b>${g.homeScore ?? '–'} : ${g.awayScore ?? '–'}</b><small>Ende</small></div><div class="t r">${esc(g.away)}${logo(g.away)}</div></div>`).join('')}`;
}

/* ---------- views ---------- */
const medal = (i) => (i < 3 ? ` m${i + 1}` : '');
const subtabs = (key, items) => `<div class="subtabs">${items.map(([v, l]) => `<button data-sub="${key}:${v}" aria-selected="${S.sub[key] === v}">${l}</button>`).join('')}</div>`;
const seg = (attr, cur, items) => `<div class="seg">${items.map(([v, l]) => `<button data-${attr}="${v}" aria-pressed="${cur === v}">${l}</button>`).join('')}</div>`;
const TEAMTABS = () => subtabs('team', [['market', 'Transfermarkt'], ['roster', 'Kader'], ['lineup', 'Aufstellung']]);
/* Rink like Topscorers: the neutral zone with the centre circle on top, the defending zone with two faceoff circles and the crease below. */
const RINK = `<svg class="rink" viewBox="0 0 360 620" preserveAspectRatio="none" aria-hidden="true">
  <path d="M2 2H358V540Q358 618 280 618H80Q2 618 2 540Z" fill="none" stroke="#fff" stroke-opacity=".14" stroke-width="2.5"/>
  <line x1="2" y1="44" x2="358" y2="44" stroke="#e5384f" stroke-opacity=".45" stroke-width="3"/>
  <circle cx="180" cy="170" r="62" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="2"/>
  <circle cx="180" cy="170" r="3.5" fill="#fff" fill-opacity=".2"/>
  <circle cx="58" cy="72" r="5" fill="#fff" fill-opacity=".14"/><circle cx="302" cy="72" r="5" fill="#fff" fill-opacity=".14"/>
  <line x1="2" y1="300" x2="358" y2="300" stroke="#3d7bff" stroke-opacity=".45" stroke-width="5"/>
  <g stroke="#fff" stroke-opacity=".12" stroke-width="2" fill="none">
    <circle cx="90" cy="470" r="54"/><circle cx="270" cy="470" r="54"/>
    <path d="M78 456v-12M102 456v-12M78 484v12M102 484v12M66 464h-14M66 476h-14M114 464h14M114 476h14"/>
    <path d="M258 456v-12M282 456v-12M258 484v12M282 484v12M246 464h-14M246 476h-14M294 464h14M294 476h14"/>
  </g>
  <circle cx="90" cy="470" r="5" fill="#fff" fill-opacity=".14"/><circle cx="270" cy="470" r="5" fill="#fff" fill-opacity=".14"/>
  <line x1="12" y1="566" x2="348" y2="566" stroke="#e5384f" stroke-opacity=".4" stroke-width="2.5"/>
  <path d="M150 566a30 30 0 0160 0z" fill="#3d7bff" fill-opacity=".18" stroke="#3d7bff" stroke-opacity=".45" stroke-width="2"/>
</svg>`;
const SLOT_AT = { F: ['c', 'lw', 'rw'], D: ['ld', 'rd'], G: ['g'] };
/**
 * The lineup of one line as a formation on the rink: centre on top, wingers lower left and right, the two defencemen,
 * the goalie at the bottom. edit: slots open the "Spieler wechseln" sheet; otherwise they open the player.
 */
function rinkHtml(players, line, edit) {
  const slot = (pos, ln, i) => {
    const p = players.filter((x) => x.pos === pos && x.lineup === ln)[i];
    const at = SLOT_AT[pos][i];
    if (!p) {
      const attr = edit ? `data-add="${pos}:${ln}"` : '';
      return `<${edit ? 'button' : 'div'} class="slot empty s-${at}" ${attr}><span class="plusc">${edit ? '+' : ''}</span><span class="sp">${POS[pos]}</span><span class="sn">−50 Pkt.</span></${edit ? 'button' : 'div'}>`;
    }
    const attr = edit ? `data-slot="${p.id}"` : `data-open="${p.id}"`;
    return `<button class="slot s-${at}" ${attr} aria-label="${esc(p.first + ' ' + p.last)}">${avatar(p)}${p.injury || p.missedLast ? '<i class="sx">!</i>' : ''}
      <span class="sp">${logo(p.team)}${POS[p.pos]}</span><span class="sn">${esc(p.last)}</span></button>`;
  };
  return `<div class="ice">${RINK}${slot('F', line, 0)}${slot('F', line, 1)}${slot('F', line, 2)}${slot('D', line, 0)}${slot('D', line, 1)}${slot('G', 9, 0)}</div>`;
}
const MODES = [['buy', 'Bieten'], ['sell', 'Verkaufen'], ['mine', 'Meine']];
const dayLong = (iso) => new Date(iso).toLocaleDateString('de-CH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Zurich' });

function countdown(iso) {
  if (!iso) return '';
  return `<div class="cd" data-cd="${esc(iso)}"><div class="cdday">${esc(dayLong(iso))}</div><div class="cdnums"><div><b data-u="d">0</b><span>Tage</span></div><div><b data-u="h">0</b><span>Std</span></div><div><b data-u="m">0</b><span>Min</span></div><div><b data-u="s">0</b><span>Sek</span></div></div></div>`;
}
function tickCountdown() {
  const el = document.querySelector('[data-cd]');
  if (!el) return;
  let s = Math.max(0, Math.floor((new Date(el.dataset.cd) - Date.now()) / 1000));
  const set = (u, v) => { el.querySelector(`[data-u=${u}]`).textContent = v; };
  set('d', Math.floor(s / 86400)); s %= 86400; set('h', Math.floor(s / 3600)); s %= 3600; set('m', Math.floor(s / 60)); set('s', s % 60);
}

const views = {
  async board() {
    const [team, moves, live, trend, tops] = await Promise.all([api('/api/team'), api('/api/moves'), api('/api/live'), api('/api/trend'), api('/api/topscorers').catch(() => [])]);
    S.games = S.games || live.games; // so a tap on a result opens the game sheet
    const gain = team.value - team.invested;
    const gc = gain > 0 ? 'up' : gain < 0 ? 'down' : 'flat';
    const hurt = team.players.filter((p) => p.injury || p.missedLast);
    const running = live.games.filter((g) => g.state === 'LIVE' || g.state === 'CRIT').length;
    return `<section class="hero"><div class="lbl">Teamwert</div><div class="big" data-count="${team.value}" data-count-key="teamvalue">${fmt(team.value)}</div>
      <span class="pill ${gc}">${gain ? `${arrow(gc)} ${gain > 0 ? '+' : '−'}${fmt(Math.abs(gain))} seit Kauf` : 'Unverändert seit Kauf'}</span></section>
      <div class="tiles"><div class="tile"><b>${S.me.rank}.</b><span>Rang</span></div><div class="tile"><b>${fmt(team.points + live.myPoints)}</b><span>Punkte</span></div><div class="tile"><b>${money(team.balance)}</b><span>Konto</span></div></div>${dataStamp()}
      ${resultsHtml(live.games)}
      ${tops.length ? `<h2>NHL-Topscorer <small>Fantasy-Punkte der Saison</small></h2>${tops.slice(0, 3).map((p, i) => `<div class="mv" data-open="${p.id}"><span><b class="tsn">${i + 1}.</b> ${esc(p.first[0] || '')}. ${esc(p.last)} <small>${esc(p.team)}</small></span><b>${fmt(p.points)}</b></div>`).join('')}<button class="link more" data-goto="nhl:top">Alle Topscorer</button>` : ''}
      <h2>Markt <small>geht er hoch oder runter?</small></h2>${trendHtml(trend, true)}
      <h2>Heute <small>${running ? running + ' Spiele laufen' : 'kein Spiel läuft'}</small></h2>
      ${live.mine.length ? live.mine.slice(0, 3).map((r) => `<div class="card" data-open="${r.id}"><div class="row"><div class="grow"><div class="pname"><span>${esc(r.team)}</span>${esc(r.name)}</div></div><div class="price"><b>${r.pts > 0 ? '+' : ''}${r.pts}</b><span class="pill flat">morgen ca. ${fmt(r.tomorrow)}</span></div></div></div>`).join('') : '<div class="empty">Heute noch keine Punkte für dein Team.</div>'}
      ${hurt.length ? `<h2>Achtung im Team <small>${hurt.length} Spieler</small></h2>${hurt.map((p) => prow(p)).join('')}` : ''}
      <h2>Letzte Preisbewegungen <small>Spieltag ${esc(moves[0]?.day || '–')}</small></h2>
      ${moves.length ? moves.slice(0, 8).map((m) => { const up = m.price > m.prev_price; return `<div class="card" data-open="${m.id}"><div class="row"><div class="grow"><div class="pname"><span>${esc(m.team)} · ${esc(m.summary)}</span>${esc(m.first)} ${esc(m.last)}</div></div><div class="price"><b>${fmt(m.price)}</b><span class="pill ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${Math.abs((m.price - m.prev_price) / m.prev_price * 100).toFixed(1)}%</span></div></div></div>`; }).join('') : '<div class="empty">Noch keine Preisbewegungen. Sie erscheinen nach dem ersten abgeschlossenen Spieltag.</div>'}`;
  },

  async team() {
    if (S.sub.team === 'market') return views.market();
    const head = TEAMTABS();
    const t = await api('/api/team');
    S.team = t;
    if (S.sub.team === 'lineup') {
      const L = S.line;
      const placed = t.players.filter((p) => p.lineup > 0).length;
      const bench = t.players.filter((p) => p.lineup === 0);
      return `${head}<div class="balbar"><span>Aufstellung<b>${placed}/16</b></span><span>Bank<b>${bench.length}</b></span></div>
        ${rinkHtml(t.players, L, true)}
        <div class="floatseg lineseg">${seg('line', String(L), [['1', '1. Linie'], ['2', '2. Linie'], ['3', '3. Linie']])}</div>
        ${bench.length ? `<div class="grp">Bank</div>${bench.map((p) => prow(p)).join('')}` : ''}
        <div class="note">Nur Spieler in der Aufstellung bringen Punkte. Tippe auf ein Feld, um einen Spieler einzusetzen oder auf die Bank zu setzen. Spieler, deren Team heute spielt, sind gesperrt.</div>`;
    }
    const bal = `<div class="balbar"><span>Kontostand</span><b>${fmt(t.balance)}</b><span>Kader ${t.players.length}/20</span></div>`;
    {
      const groups = [['G', 'Torhüter'], ['D', 'Verteidiger'], ['F', 'Stürmer']];
      const g = t.value - t.invested;
      return `${head}${bal}<div class="tiles"><div class="tile"><b>${money(t.value)}</b><span>Teamwert</span></div><div class="tile"><b class="${g > 0 ? 'up' : g < 0 ? 'down' : ''}">${g > 0 ? '+' : g < 0 ? '−' : ''}${money(Math.abs(g))}</b><span>Gewinn</span></div><div class="tile"><b>${fmt(t.points)}</b><span>Punkte</span></div></div>
        ${t.players.length ? groups.map(([k, l]) => { const ps = t.players.filter((p) => p.pos === k); return ps.length ? `<div class="grp">${l}</div>${ps.map((p) => prow(p)).join('')}` : ''; }).join('') : '<div class="empty">Noch keine Spieler. Kaufe welche im Transfermarkt.</div>'}`;
    }
  },

  async market() {
    const [t, au, trend] = await Promise.all([api('/api/team'), api('/api/auctions'), api('/api/trend')]);
    const bidSum = au.bids.reduce((s, b) => s + b.amount, 0);
    const after = t.balance - bidSum;
    const bal = `<div class="balbar"><span>Kontostand<b>${fmt(t.balance)}</b></span><span>Nach Geboten<b class="${after < 0 ? 'down' : ''}">${fmt(after)}</b></span><span>Kader<b>${t.players.length}/20</b></span></div>`;
    const head = TEAMTABS();
    const f = [['', 'Alle'], ['F', 'Stürmer'], ['D', 'Verteidiger'], ['G', 'Torhüter']];
    const trendBar = trendHtml(trend, false);
    let list;
    if (S.mode === 'mine') {
      return `${head}<div class="floatseg">${seg('mode', S.mode, MODES)}</div>${bal}${trendBar}${auctionsHtml(au)}`;
    }
    if (S.mode === 'sell') {
      list = t.players.filter((p) => !S.pos || p.pos === S.pos);
      list = `${list.length ? list.map((p) => prow(p, { btn: `<button class="plus minus" data-sellmenu="${p.id}" ${p.tradeLocked ? 'disabled' : ''} aria-label="Verkaufen">−</button>`, rightLabel: 'Marktwert' })).join('') : '<div class="empty">Keine Spieler zum Verkaufen.</div>'}`;
    } else {
      const qs = new URLSearchParams({ pos: S.pos, sort: S.sort, q: S.q });
      const market = await api(`/api/players?${qs}`);
      list = market.length ? market.map((p) => prow(p, { timer: true, owned: true, rightLabel: 'Mindestgebot', btn: p.owned || p.listedBy === S.me?.name ? '' : `<button class="plus" data-bid="${p.id}" ${p.tradeLocked ? 'disabled' : ''} aria-label="Bieten">+</button>` })).join('') : '<div class="empty">Keine Spieler gefunden. Falls der Markt ganz leer bleibt, wurden die NHL-Kader noch nicht geladen (siehe README: npm run sync).</div>';
    }
    return `${head}<div class="floatseg">${seg('mode', S.mode, MODES)}</div>${bal}${trendBar}
      <div class="row2"><input class="field" id="q" type="search" placeholder="Spieler oder Team suchen" value="${esc(S.q)}" autocomplete="off">
      <select class="field" id="sort" aria-label="Sortierung">${[['expiry', 'Läuft ab'], ['price', 'Preis'], ['change', 'Änderung'], ['points', 'Punkte'], ['live', 'Live']].map(([v, l]) => `<option value="${v}" ${S.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="tabs">${f.map(([v, l]) => `<button data-pos="${v}" aria-pressed="${S.pos === v}">${l}</button>`).join('')}</div>
      <div style="margin-top:12px">${list}</div>`;
  },

  async league() {
    const head = subtabs('league', [['rank', 'Rangliste'], ['curve', 'Verlauf'], ['ticker', 'Liga-Ticker']]);
    if (S.sub.league === 'curve') return head + curveHtml(await api('/api/league/history'));
    if (S.sub.league === 'ticker') {
      const rows = await api('/api/ticker');
      return `${head}${rows.length ? rows.map((r) => `<div class="tick" data-open="${r.playerId}"><div class="ago">vor ${ago(r.at)}</div><b>${esc(r.user)}</b> ${r.kind === 'buy' ? 'kauft' : 'verkauft'} <b>${esc(r.player.toUpperCase())}</b> für ${fmt(r.price)}</div>`).join('') : '<div class="empty">Noch keine Transfers in deiner Liga.</div>'}`;
    }
    const [rows, hist] = await Promise.all([api('/api/league'), api('/api/league/history').catch(() => null)]);
    const delta = (id) => { const c = hist?.change?.[id] ?? 0; return c > 0 ? `<i class="rch up">▲${c}</i>` : c < 0 ? `<i class="rch down">▼${-c}</i>` : ''; };
    return `${head}<div class="rhead"><span>Teamwert</span><span>Punkte</span></div>
      ${rows.map((r, i) => `<div class="rank${r.me ? ' me' : ''}${medal(i)}" data-manager="${r.id}" role="button" tabindex="0"><div class="n">${i + 1}.</div><div class="grow"><div class="rname">${esc(r.name)}${delta(r.id)}</div></div><div class="rv">${fmt(r.value)}</div><div class="rp">${fmt(r.points)}${r.live ? `<small>+${r.live} heute</small>` : ''}</div></div>`).join('')}`;
  },

  async live() {
    const [d, t, lg] = await Promise.all([api('/api/live'), api('/api/team'), api('/api/league')]);
    const running = d.games.some((g) => g.state === 'LIVE' || g.state === 'CRIT');
    const head = subtabs('live', [['team', 'Team'], ['league', 'Liga']]);
    const nRunning = d.games.filter((g) => g.state === 'LIVE' || g.state === 'CRIT').length;
    const dayRank = [...lg].sort((x, y) => y.live - x.live || y.points - x.points).findIndex((r) => r.me) + 1;
    const hero = running || d.myPoints ? `<section class="livehero${running ? ' on' : ''}"><div class="lbl">${running ? '<i></i>Live · ' + nRunning + (nRunning === 1 ? ' Spiel läuft' : ' Spiele laufen') : 'Heute'}</div>
      <div class="big ${d.myPoints < 0 ? 'down' : ''}" data-count="${d.myPoints}" data-fmt="sign" data-count-key="livepts">${d.myPoints > 0 ? '+' : ''}${fmt(d.myPoints)}</div><div class="sub">Punkte deiner Aufstellung${dayRank ? ` · <b>${dayRank}.</b> heute in der Liga` : ''}</div></section>` : '';
    const top = hero + (running ? '' : countdown(d.nextStart)) + dataStamp();
    if (S.sub.live === 'league') {
      const board = [...lg].sort((x, y) => y.live - x.live || y.points - x.points);
      return `${head}${top}<div class="rhead"><span>Gesamt</span><span>Heute</span></div>
        ${board.map((r, i) => `<div class="rank${r.me ? ' me' : ''}${medal(i)}" data-manager="${r.id}" role="button" tabindex="0"><div class="n">${i + 1}.</div><div class="grow"><div class="rname">${esc(r.name)}${r.me ? ' (du)' : ''}</div></div><div class="rv">${fmt(r.points - r.live)}</div><div class="rp ${r.live > 0 ? 'up' : ''}">${r.live > 0 ? '+' : ''}${r.live}</div></div>`).join('')}
        <div class="note">So viele Punkte machen alle Manager heute mit ihrer Aufstellung. Die Zahlen laufen live mit den Spielen.</div>`;
    }
    const pts = new Map(d.mine.map((r) => [r.id, r]));
    const inL = t.players.filter((p) => p.lineup > 0);
    const bench = t.players.filter((p) => p.lineup <= 0);
    // most points first; players who have not played yet at the end
    const livePts = (p) => (p.dressed ? pts.get(p.id)?.pts ?? 0 : -Infinity);
    const shown = (S.liveSeg === 'bench' ? bench : inL).slice().sort((a, b) => livePts(b) - livePts(a));
    const row = (p) => { const r = pts.get(p.id); return prow(p, { sub: p.dressed ? `<b>${r ? r.goals : 0}</b><small>Tore</small><b>${r ? r.assists : 0}</b><small>Assists</small>` : '<small>noch kein Einsatz</small>', right: `<b class="${r && r.pts > 0 ? 'up' : ''}">${r ? (r.pts > 0 ? '+' : '') + r.pts : 0}</b><small>Live</small>` }); };
    return `${head}${top}
      <div class="floatseg">${seg('lsub', S.liveSeg, [['lineup', 'Aufstellung (' + inL.length + ')'], ['bench', 'Ersatz (' + bench.length + ')']])}</div>
      ${shown.length ? shown.map(row).join('') : `<div class="empty">${S.liveSeg === 'bench' ? 'Alle deine Spieler stehen in der Aufstellung.' : 'Noch niemand in der Aufstellung. Stelle dein Team im Tab Team zusammen.'}</div>`}
      <div class="note">Die Punkte laufen live. Der Preis ändert sich einmal am nächsten Morgen, wenn alle Spiele des Tages fertig sind.</div>`;
  },

  async nhl() {
    const head = subtabs('nhl', [['games', 'Spiele'], ['top', 'Topscorer']]);
    if (S.sub.nhl === 'top') {
      const list = await api(`/api/topscorers?pos=${S.top}`);
      return `${head}<div class="tabs">${[['', 'Alle'], ['F', 'Stürmer'], ['D', 'Verteidiger'], ['G', 'Torhüter']].map(([v, l]) => `<button data-top="${v}" aria-pressed="${S.top === v}">${l}</button>`).join('')}</div>
        <div style="margin-top:12px">${list.length ? list.map((p, i) => `<div class="toprow">${'<div class="n">' + (i + 1) + '.</div>'}${prow(p, { right: `<b>${fmt(p.points)}</b><small>Punkte</small>`, sub: `<b>${p.games}</b><small>Spiele</small><b>${p.goals}</b><small>Tore</small>` })}</div>`).join('') : '<div class="empty">Noch keine Statistiken. Starte <code>npm run stats</code>.</div>'}</div>`;
    }
    const games = await api('/api/games');
    S.games = games;
    const done = (g) => g.state === 'FINAL' || g.state === 'OFF';
    const nextIdx = games.findIndex((g) => !done(g)); // first game that is running or still to come
    const zone = { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit' };
    const dayFmt = (iso) => new Date(iso).toLocaleDateString('de-CH', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Zurich' });
    let lastDay = '';
    const rows = games.map((g, k) => {
      const dd = g.start ? dayFmt(g.start) : g.day;
      const h = dd !== lastDay ? `<div class="dayhead"${k === nextIdx ? ' id="nextgame"' : ''}>${esc(dd)}</div>` : '';
      lastDay = dd;
      const mid = (g.state === 'LIVE' || g.state === 'CRIT') ? `<b>${g.homeScore ?? 0} : ${g.awayScore ?? 0}</b><small class="live">Live</small>`
        : done(g) ? `<b>${g.homeScore ?? '–'} : ${g.awayScore ?? '–'}</b><small>Ende</small>` : `<b class="time">${g.start ? new Date(g.start).toLocaleTimeString('de-CH', zone) : 'bald'}</b>`;
      return `${h}<div class="game${k === nextIdx ? ' next' : ''}" data-game="${g.id}" role="button" tabindex="0"><div class="t">${logo(g.home)}${esc(g.home)}</div><div class="mid">${mid}</div><div class="t r">${esc(g.away)}${logo(g.away)}</div></div>`;
    }).join('');
    if (S.scrollNext) { S.scrollNext = false; S.wantNext = true; }
    return `${head}${games.length ? rows : '<div class="empty">Keine Spiele im Spielplan. Der Spielplan wird von der NHL geladen.</div>'}
      <div class="note">Oben die vergangenen Spiele, unten die kommenden. Tippe auf ein Spiel für Tore, Assists und Strafen.</div>`;
  },
};

let renderId = 0;
const htmlCache = new Map();
const CURVE_COLORS = ['#3d7bff', '#e5384f', '#3fd68a', '#b47cff', '#ff8a3d', '#4fd1e8', '#f472b6', '#a3e635'];
/** Season curve: cumulative points of every manager per closed day. */
function curveHtml(h) {
  if (!h || h.days.length < 2) return '<div class="empty">Der Verlauf erscheint, sobald mindestens zwei Spieltage abgeschlossen sind.</div>';
  const W = 340, H = 220, L = 8, R = 8, T = 12, B = 22;
  const max = Math.max(1, ...h.series.map((s) => s.cum.at(-1)), ...h.series.flatMap((s) => s.cum));
  const min = Math.min(0, ...h.series.flatMap((s) => s.cum));
  const x = (i) => L + (i / (h.days.length - 1)) * (W - L - R);
  const y = (v) => T + (1 - (v - min) / (max - min || 1)) * (H - T - B);
  let k = 0;
  const lines = [...h.series].sort((a, b) => (a.me ? 1 : 0) - (b.me ? 1 : 0)).map((s) => {
    const color = s.me ? '#ffc400' : CURVE_COLORS[k++ % CURVE_COLORS.length];
    s.color = color;
    return `<polyline points="${s.cum.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="${s.me ? 3.5 : 2}" stroke-linejoin="round" stroke-linecap="round" opacity="${s.me ? 1 : 0.85}"/>`;
  }).join('');
  const dm2 = (iso) => { const [, m, d] = iso.split('-'); return `${d}.${m}.`; };
  const lbl = [0, h.days.length - 1].map((i, n) => `<text x="${x(i).toFixed(1)}" y="${H - 5}" text-anchor="${n ? 'end' : 'start'}" class="ax">${dm2(h.days[i])}</text>`).join('');
  const legend = [...h.series].sort((a, b) => b.cum.at(-1) - a.cum.at(-1)).map((s, i) => `<div class="lg${s.me ? ' me' : ''}"><i style="background:${s.color}"></i><span>${i + 1}. ${esc(s.name)}</span><b>${fmt(s.cum.at(-1))}</b></div>`).join('');
  return `<h2>Saisonverlauf <small>Punkte nach jedem Spieltag</small></h2><div class="chart curve"><svg viewBox="0 0 ${W} ${H}" aria-label="Saisonverlauf">${lines}${lbl}</svg></div><div class="legend">${legend}</div>
    <div class="note">Gezählt werden abgeschlossene Spieltage. Die Punkte des laufenden Tages kommen nach dem Tagesabschluss dazu.</div>`;
}

const SUBHEAD = {
  team: () => TEAMTABS(),
  league: () => subtabs('league', [['rank', 'Rangliste'], ['curve', 'Verlauf'], ['ticker', 'Liga-Ticker']]),
  live: () => subtabs('live', [['team', 'Team'], ['league', 'Liga']]),
  nhl: () => subtabs('nhl', [['games', 'Spiele'], ['top', 'Topscorer']]),
};
let lastScreen = '';
function paint(html, screen) {
  const keep = document.activeElement?.id === 'q';
  const y = window.scrollY;
  const fresh = screen !== lastScreen; // animate in only when a new screen opens, not on refresh
  lastScreen = screen;
  $app.innerHTML = header() + `<main${fresh ? '' : ' class="static"'}>${installTip()}${html}</main>`;
  if (keep) { const q = document.getElementById('q'); q?.focus(); q?.setSelectionRange(q.value.length, q.value.length); }
  window.scrollTo(0, y);
  if (S.wantNext) { const el = document.getElementById('nextgame'); if (el) { S.wantNext = false; el.scrollIntoView({ block: 'center' }); } }
  tickCountdown();
  fx.countUp($app);
}

/** After fresh data: celebrate won auctions, goals of lineup players and a better rank. */
async function checkNews() {
  try {
    const [me, live, auctions] = await Promise.all([api('/api/me', { quiet: true }), api('/api/live', { quiet: true }), api('/api/auctions', { quiet: true })]);
    S.me = me;
    fx.news({ me, live, auctions }).forEach((msg, i) => setTimeout(() => toast(msg), 3400 * (i + 1)));
  } catch { /* offline or logged out: no surprises */ }
}

async function render() {
  const my = ++renderId;
  clearTimeout(S.timer);
  clearInterval(S.cd);
  $nav.hidden = false;
  $nav.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', b.dataset.t === S.tab));
  const key = [S.tab, S.sub[S.tab], S.mode, S.pos, S.sort, S.q, S.line, S.liveSeg, S.top].join('|');
  const cached = htmlCache.get(key);
  // Show the last known screen (or a loading hint) right away, then replace it with fresh data.
  paint(cached ?? `${SUBHEAD[S.tab]?.() ?? ''}<div class="loading" aria-label="Lädt"><i></i><i></i><i></i></div>`, key);
  S.cd = setInterval(tickCountdown, 1000);
  let html;
  try { html = await views[S.tab](); } catch (e) { if (e.message === 'login') return; if (my !== renderId) return; html = `<div class="err" style="margin-top:20px">${esc(e.message)}</div>`; }
  if (my !== renderId) return; // a newer render took over
  htmlCache.set(key, html);
  if (html !== cached) paint(html, key);
  if (S.wantNext) { S.wantNext = false; document.getElementById('nextgame')?.scrollIntoView({ block: 'center' }); }
  if (S.tab === 'live' || S.tab === 'board') S.timer = setTimeout(render, 30_000);
  checkNews();
}

const STAR = '<svg viewBox="0 0 24 24" class="star" aria-hidden="true"><path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7-6.2-3.7-6.2 3.7 1.6-7L2 9.2l7.1-.6z"/></svg>';
const EMBLEM = '<img src="/nhl-logo.png" alt="NHL" class="shield">';
function header() {
  return `<header class="top"><div class="top-in"><div class="chip">Saison ${seasonLabel}</div><div class="logo" aria-label="NHL Topscorer">${EMBLEM}</div>
    <button class="gear" data-settings aria-label="Einstellungen"><svg viewBox="0 0 24 24"><path d="M19.4 13a7.6 7.6 0 000-2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 00-1.7-1L15 3.4h-4l-.4 2.6a7.5 7.5 0 00-1.7 1l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 000 2l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 001.7 1l.4 2.6h4l.4-2.6a7.5 7.5 0 001.7-1l2.4 1 2-3.4zM13 15.5a3.5 3.5 0 110-7 3.5 3.5 0 010 7z" transform="translate(-1 0)"/></svg></button></div></header>`;
}

async function refreshMe() { S.me = await api('/api/me'); }

/* ---------- another manager's team ---------- */
async function managerSheet(id) {
  let m;
  try { m = await api(`/api/managers/${id}`); } catch (e) { return toast(e.message); }
  let line = 1;
  const placed = m.players.filter((p) => p.lineup > 0).length;
  const bench = m.players.filter((p) => p.lineup === 0);
  const body = () => `${rinkHtml(m.players, line, false)}
    <div class="seg mseg">${[1, 2, 3].map((n) => `<button data-mline="${n}" aria-selected="${n === line}">${n}. Linie</button>`).join('')}</div>
    ${bench.length ? `<div class="grp">Bank</div>${bench.map((p) => prow(p)).join('')}` : ''}`;
  const bg = openSheet(`<div class="shead"><div class="sname">${esc(m.name)}</div><div class="ptag">${placed}/16 in der Aufstellung · ${m.count} Spieler</div></div>
    <div class="big3 small"><div><b>${fmt(m.points)}</b><span>Punkte</span></div><div><b class="${m.live > 0 ? 'up' : ''}">${m.live > 0 ? '+' : ''}${m.live}</b><span>Heute</span></div><div><b>${money(m.value)}</b><span>Teamwert</span></div></div>
    <div id="mbody">${body()}</div>`);
  bg.querySelector('.sheet').classList.add('center');
  bg.addEventListener('click', (e) => {
    const ml = e.target.closest('[data-mline]');
    if (ml) { line = Number(ml.dataset.mline); bg.querySelector('#mbody').innerHTML = body(); return; }
    const op = e.target.closest('[data-open]');
    if (op) openPlayer(op.dataset.open);
  });
}

/* ---------- game detail ---------- */
const PERIOD = (e) => (e.periodType === 'SO' ? 'Penaltyschiessen' : e.periodType === 'OT' ? 'Verlängerung' : `${e.period}. Drittel`);
const POSD = { G: 'Goalie', D: 'Verteidiger', F: 'Stürmer' };
const minuteOf = (e) => { const [m] = String(e.time).split(':').map(Number); const base = e.periodType === 'OT' ? 60 : ((e.period || 1) - 1) * 20; return base + (m || 0) + 1; };
const numTag = (n) => (n != null ? `#${n} ` : '');
function lineupCell(p, right) {
  if (!p) return '<div class="lp empty-lp"></div>';
  const c = TEAM_COLORS[p.team] || ['#2c3e63', '#fff'];
  const ini = (p.name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const img = p.headshot ? `<img src="${esc(p.headshot)}" alt="" loading="lazy">` : '';
  const ph = `<div class="lph" style="background:${c[0]};color:${c[1]}">${esc(ini)}${img}${p.toi ? `<em>${esc(p.toi)}</em>` : ''}</div>`;
  const txt = `<div class="ltx"><small>${esc(numTag(p.number))}${POSD[p.pos]}</small><b>${esc(p.last)}</b></div>`;
  return `<div class="lp ${right ? 'r' : ''}">${right ? txt + ph : ph + txt}</div>`;
}
function lineupHtml(ev) {
  const H = ev.lineup.home, A = ev.lineup.away;
  const stamp = (side, ab) => ['goalies', 'defense', 'forwards'].forEach((k) => side[k].forEach((p) => { p.team = ab; }));
  stamp(H, ev.home.abbrev); stamp(A, ev.away.abbrev);
  const rows = (l, r) => { const n = Math.max(l.length, r.length); let out = ''; for (let i = 0; i < n; i++) out += `<div class="glrow">${lineupCell(l[i])}${lineupCell(r[i], true)}</div>`; return out; };
  let out = '';
  if (H.goalies.length || A.goalies.length) out += `<div class="dayhead bar">Torhüter</div>${rows(H.goalies, A.goalies)}`;
  for (let i = 0; i < 4; i++) {
    // defensemen and forwards stay aligned row by row
    const ld = H.defense.slice(i * 2, i * 2 + 2), rd = A.defense.slice(i * 2, i * 2 + 2), lf = H.forwards.slice(i * 3, i * 3 + 3), rf = A.forwards.slice(i * 3, i * 3 + 3);
    if (!ld.length && !rd.length && !lf.length && !rf.length) continue;
    out += `<div class="dayhead bar">Linie ${i + 1}</div>${rows(ld, rd)}${rows(lf, rf)}`;
  }
  if (!out) return '<div class="empty">Die Aufstellung ist noch nicht veröffentlicht.</div>';
  return out + (ev.lineup.hasToi ? '<div class="note">Die Linien sind nach Eiszeit geordnet, die NHL meldet keine festen Linien.</div>' : '<div class="note">Die Linien werden nach Eiszeit geordnet, sobald das Spiel läuft.</div>');
}
function detailsHtml(ev) {
  if (!ev.goals.length && !ev.penalties.length) return '<div class="empty">Bisher keine Tore und keine Strafen.</div>';
  const secs = (e) => { const [m, s] = String(e.time).split(':').map(Number); return (m || 0) * 60 + (s || 0); };
  const pk = (e) => (e.periodType === 'SO' ? 9 : e.periodType === 'OT' ? 4 : e.period ?? 0);
  const goals = [...ev.goals].sort((x, y) => pk(x) - pk(y) || secs(x) - secs(y));
  const summary = goals.length ? `<div class="gsum">${goals.map((g) => `<div><i>${g.periodType === 'SO' ? 'PS' : minuteOf(g) + "'"}</i><b>${esc(g.scorer.split(' ').slice(-1)[0].toUpperCase())}</b>${g.assists.length ? ` <small>(${g.assists.map((x) => esc(x.split(' ').slice(-1)[0].toUpperCase())).join(', ')})</small>` : ''}<span>${g.home}:${g.away}</span></div>`).join('')}</div>` : '';
  const all = [...goals.map((e) => ({ ...e, kind: 'goal' })), ...ev.penalties.map((e) => ({ ...e, kind: 'pen' }))].sort((x, y) => pk(x) - pk(y) || secs(x) - secs(y));
  let lastP = '';
  const tl = all.map((e) => {
    const p = PERIOD(e);
    const h = p !== lastP ? `<div class="dayhead bar">${p}</div>` : '';
    lastP = p;
    const left = e.team === ev.home.abbrev;
    const last = (s) => esc(String(s).split(' ').slice(-1)[0].toUpperCase());
    const body = e.kind === 'goal'
      ? `<div class="tt goal">${left ? '' : `Tor ${e.home}:${e.away} · `}${e.periodType === 'SO' ? 'PS' : e.strength}${left ? ` · Tor ${e.home}:${e.away}` : ''}</div><b>${esc(numTag(e.scorerNumber))}${last(e.scorer)}</b>${e.assists.length ? `<small>${e.assists.map((x, i) => esc(numTag(e.assistNumbers[i])) + last(x)).join(', ')}</small>` : ''}`
      : `<div class="tt pen">${e.minutes} Min</div><b>${esc(numTag(e.playerNumber))}${esc(e.player.split(' ').slice(-1)[0].toUpperCase())}</b><small>${esc(e.text)}</small>`;
    return `${h}<div class="trow ${left ? 'l' : 'r'}"><div class="tside">${left ? body : ''}</div><div class="tmid">${esc(e.time)}</div><div class="tside">${left ? '' : body}</div></div>`;
  }).join('');
  return summary + tl;
}
async function gameSheet(id) {
  const g = (S.games || []).find((x) => x.id === id);
  if (!g) return;
  const started = g.state !== 'FUT' && g.state !== 'PRE';
  const over = g.state === 'FINAL' || g.state === 'OFF';
  const hs = started ? (g.homeScore ?? 0) : '–', as = started ? (g.awayScore ?? 0) : '–';
  const headHtml = (periods) => `<div class="gh"><div class="gscore">${started ? `${hs}:${as}` : '–:–'}</div>
    <div class="gper">${periods ? `(${periods})` : started ? (over ? 'Beendet' : 'Läuft') : esc(g.day)}</div>
    <div class="gteams"><div>${logo(g.home)}<b>${esc(g.home)}</b></div><div class="r"><b>${esc(g.away)}</b>${logo(g.away)}</div></div></div>
    <div class="gtabs"><button data-gtab="d" aria-selected="true">Details</button><button data-gtab="l" aria-selected="false">Aufstellung</button></div>`;
  const bg = openSheet(headHtml('') + (started ? '<div class="empty" id="gbody">Lade Spieldetails …</div>' : '<div class="empty">Das Spiel hat noch nicht begonnen.</div>'));
  bg.querySelector('.sheet').classList.add('gsheet');
  if (!started) return;
  let ev;
  try { ev = await api(`/api/games/${id}/events`); } catch (e) { const b = bg.querySelector('#gbody'); if (b) b.textContent = e.message; return; }
  const per = ev.periods.map((p) => `${p.home}:${p.away}`).join('|');
  const gp = bg.querySelector('.gper'); if (gp && per) gp.textContent = `(${per})`;
  const body = bg.querySelector('#gbody');
  const show = (tab) => { body.innerHTML = tab === 'l' ? lineupHtml(ev) : detailsHtml(ev); body.classList.remove('empty'); bg.querySelectorAll('[data-gtab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.gtab === tab))); };
  bg.addEventListener('click', (e) => { const t = e.target.closest('[data-gtab]'); if (t) show(t.dataset.gtab); });
  show('d');
}

/* ---------- bids, offers ---------- */
async function act(path, body, okMsg, bg) {
  try {
    await api(path, { body }); toast(okMsg); closeSheet(bg);
    if (path === '/api/bid') { fx.burst({ count: 80 }); fx.vibrate([30, 40, 60]); }
    if (path === '/api/sell' || path === '/api/accept') { fx.burst({ kind: 'coins', count: 70 }); fx.vibrate(50); }
    await refreshMe(); render();
  } catch (err) { toast(err.message); }
}

async function bidSheet(id) {
  let d;
  try { d = await api(`/api/players/${id}`); } catch (e) { return toast(e.message); }
  const min = d.listedBy ? d.minBid : d.price;
  const bg = openSheet(`<div class="shead">${avatar(d, true)}<div class="sname">${esc(d.first)} ${esc(d.last)}</div><div class="ptag">${POS[d.pos]} · ${esc(d.team)} · noch ${hoursText(d.hoursLeft)}</div></div>
    <p style="margin-top:14px;text-align:center">${d.listedBy ? `Angebot von <b>${esc(d.listedBy)}</b>. Nur er sieht die Gebote und wählt eines aus.` : 'Wer bei Ablauf am meisten geboten hat, bekommt den Spieler. Alle Gebote sind geheim.'} Mindestgebot: <b>${fmt(min)}</b>. Dein Konto: <b>${fmt(S.me?.balance || 0)}</b>.</p>
    <input class="field" id="bidamt" type="number" inputmode="numeric" min="${min}" step="1000" value="${d.myBid || min}" style="margin-top:10px;font-size:22px;text-align:center">
    <button class="btn buy wide" data-place style="margin-top:12px">${d.myBid ? 'Gebot ändern' : 'Gebot abgeben'}</button>
    ${d.myBid ? '<button class="btn sell wide" data-cancel style="margin-top:10px">Gebot zurückziehen</button>' : ''}`);
  bg.addEventListener('click', (e) => {
    if (e.target.closest('[data-place]')) act('/api/bid', { playerId: id, amount: Number(bg.querySelector('#bidamt').value) }, 'Gebot gespeichert', bg);
    if (e.target.closest('[data-cancel]')) act('/api/bid/cancel', { playerId: id }, 'Gebot zurückgezogen', bg);
  });
}

async function sellSheet(id) {
  let d;
  try { d = await api(`/api/players/${id}`); } catch (e) { return toast(e.message); }
  const bg = openSheet(`<div class="shead">${avatar(d, true)}<div class="sname">${esc(d.first)} ${esc(d.last)}</div><div class="ptag">${POS[d.pos]} · ${esc(d.team)} · Marktwert ${fmt(d.price)}</div></div>
    <button class="btn sell wide" data-now style="margin-top:18px" ${d.tradeLocked ? 'disabled' : ''}>Sofort verkaufen für ${fmt(d.price)}</button>
    <p style="margin-top:12px;text-align:center">Oder biete ihn den anderen Managern an. Sie bieten ${RULES_HOURS} Stunden lang, nur du siehst die Angebote und wählst eines aus.</p>
    <button class="btn buy wide" data-offer ${d.tradeLocked ? 'disabled' : ''}>Den anderen anbieten</button>
    ${d.tradeLocked ? '<p class="note">Gesperrt: Das Team spielt heute.</p>' : ''}`);
  bg.addEventListener('click', (e) => {
    if (e.target.closest('[data-now]')) act('/api/sell', { playerId: id }, 'Verkauft', bg);
    if (e.target.closest('[data-offer]')) act('/api/offer', { playerId: id }, 'Angeboten', bg);
  });
}
const RULES_HOURS = 24; // keep in sync with RULES.userListingHours in config.js

function auctionsHtml(au) {
  const part = (title, body) => `<h2>${title}</h2>${body}`;
  const bids = au.bids.length ? au.bids.map((b) => `<div class="tick" data-bid="${b.id}"><div class="ago">noch ${hoursText(b.hoursLeft)}</div><b>${esc(b.name.toUpperCase())}</b><br>Dein Gebot ${fmt(b.amount)} · Marktwert ${fmt(b.price)}</div>`).join('') : '<div class="empty">Du hast keine offenen Gebote.</div>';
  const offers = au.offers.length ? au.offers.map((o) => `<div class="tick"><div class="ago">noch ${hoursText(o.hoursLeft)}</div><b>${esc(o.name.toUpperCase())}</b> · Marktwert ${fmt(o.price)}
      ${o.bids.length ? o.bids.map((x) => `<div class="offer"><span>${esc(x.user)}</span><b>${fmt(x.amount)}</b><button class="btn buy" data-accept="${o.id}:${x.userId}">Annehmen</button></div>`).join('') : '<div class="note" style="margin:6px 0 0">Noch keine Angebote.</div>'}
      <button class="link" data-canceloffer="${o.id}">Angebot zurückziehen</button></div>`).join('') : '<div class="empty">Du hast keine Spieler angeboten.</div>';
  const results = au.results.length ? au.results.map((r) => `<div class="tick"><div class="ago">vor ${ago(r.at)}</div>${r.won ? '<b class="up">Gewonnen</b>' : '<b class="down">Verloren</b>'} · ${esc(r.name)} · Gebot ${fmt(r.amount)}</div>`).join('') : '<div class="empty">Noch keine Ergebnisse.</div>';
  return part('Meine Gebote', bids) + part('Angebote für meine Spieler', offers) + part('Letzte Ergebnisse', results);
}

/* ---------- lineup: change player (like Topscorers) ---------- */
async function moveTo(body, bg) {
  try { await api('/api/lineup', { body }); closeSheet(bg); render(); } catch (err) { toast(err.message); }
}
const LINE_NAME = (l) => (l === 9 ? 'Tor' : l > 0 ? `${l}. Linie` : 'Bank');
/**
 * One sheet for a lineup slot: the player in it on top, "Unbesetzt" to empty it, then every other player of the
 * position. + puts a bench player in, ⇄ swaps with a player from another line.
 */
function changeSheet(pos, line, currentId) {
  const all = (S.team?.players || []).filter((p) => p.pos === pos);
  const cur = all.find((p) => p.id === currentId) ?? null;
  const rank = (p) => (p.lineup > 0 ? 1 : 0); // bench first, then players in other lines
  const slotLine = pos === 'G' ? 9 : line;
  // everyone else of the position, except players already in this line (swapping inside a line changes nothing)
  const others = all.filter((p) => p !== cur && p.lineup !== slotLine).sort((a, b) => rank(a) - rank(b) || b.points - a.points);
  const row = (p, act) => {
    const warn = p.injury || p.missedLast ? '<i class="cw" title="Achtung">!</i>' : '';
    const where = p.lineup > 0 ? `<em>${LINE_NAME(p.lineup)}</em>` : '';
    const btn = act === 'cur' ? '' : `<button class="cbtn${act === 'swap' ? ' swap' : ''}" data-chg="${p.id}" ${p.locked || cur?.locked ? 'disabled' : ''} aria-label="${act === 'swap' ? 'Tauschen' : 'Einsetzen'}">${act === 'swap' ? '⇄' : '+'}</button>`;
    return `<div class="crow${act === 'cur' ? ' cur' : ''}${act === 'swap' ? ' dim' : ''}" data-open="${p.id}">
      <div class="cav">${warn}${avatar(p)}</div>
      <div class="cmain"><small>${p.number != null ? '#' + p.number + ' ' : ''}${POS[p.pos]}${where}</small><b>${esc(p.last)}</b>${p.locked ? '<span class="lock">Gesperrt</span>' : ''}</div>
      ${logo(p.team)}<div class="cpts"><b class="${p.points < 0 ? 'down' : ''}">${fmt(p.points)}</b><small>Punkte</small></div>${btn}</div>`;
  };
  const empty = `<div class="crow unset${cur ? '' : ' cur'}" ${cur ? 'data-unset' : ''} role="button"><div class="cav"><span class="cminus">−50 Pkt.</span></div>
    <div class="cmain"><b>Unbesetzt</b>${cur ? '<small>Tippen, um die Position zu leeren</small>' : ''}</div></div>`;
  const bg = openSheet(`<h1 class="rt ctitle">Spieler wechseln</h1><div class="csub">${POS[pos]} · ${LINE_NAME(pos === 'G' ? 9 : line)}</div>
    <div class="clist">${cur ? row(cur, 'cur') : ''}${empty}
    ${others.map((p) => row(p, p.lineup > 0 ? 'swap' : 'add')).join('') || '<div class="empty">Keine weiteren Spieler auf dieser Position. Hole einen im Transfermarkt.</div>'}</div>`);
  bg.querySelector('.sheet').classList.add('chg');
  bg.addEventListener('click', (e) => {
    const b = e.target.closest('[data-chg]');
    if (b) { e.stopPropagation(); return moveTo({ playerId: Number(b.dataset.chg), line: slotLine, ...(cur ? { replaceId: cur.id } : {}) }, bg); }
    if (e.target.closest('[data-unset]')) { if (cur.locked) return toast('Gesperrt: Das Team spielt heute.'); return moveTo({ playerId: cur.id, line: 0 }, bg); }
    const op = e.target.closest('[data-open]');
    if (op) { closeSheet(bg); openPlayer(op.dataset.open); }
  });
}

/* ---------- settings + game rules ---------- */
function openSheet(html) {
  const bg = document.createElement('div');
  bg.className = 'sheet-bg';
  bg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" tabindex="-1"><button class="close" data-close aria-label="Schliessen">✕</button>${html}</div>`;
  bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-close]')) closeSheet(bg); });
  mountSheet(bg);
  return bg;
}
/** Show a sheet: lock the page behind it and move focus into it. */
function mountSheet(bg) {
  document.body.append(bg);
  document.body.classList.add('locked');
  bg.querySelector('.sheet')?.focus({ preventScroll: true });
}
/** Slide a sheet out, then remove it. Safe to call twice. */
function closeSheet(bg) {
  if (!bg?.isConnected || bg.classList.contains('closing')) return;
  bg.classList.add('closing');
  const done = () => { bg.remove(); if (!document.querySelector('.sheet-bg:not(.closing)')) document.body.classList.remove('locked'); };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) done(); else setTimeout(done, 200);
}
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const open = [...document.querySelectorAll('.sheet-bg:not(.closing)')].pop();
  if (open) closeSheet(open);
});

function openSettings() {
  const bg = openSheet(`<div class="shead"><div class="sname">${esc(S.me?.name || '')}</div><div class="ptag">Konto ${fmt(S.me?.balance || 0)}</div></div>
    <button class="btn buy wide" data-rules style="margin-top:18px">Spielregeln</button>
    <button class="btn buy wide" data-invite style="margin-top:10px">Freunde einladen</button>
    <button class="btn sell wide" data-logout style="margin-top:10px">Abmelden</button>`);
  bg.addEventListener('click', async (e) => {
    if (e.target.closest('[data-rules]')) { closeSheet(bg); openRules(); }
    if (e.target.closest('[data-logout]')) { closeSheet(bg); await api('/api/logout', { body: {} }).catch(() => {}); S.me = null; showAuth(); }
  });
}

async function openRules() {
  let r;
  try { r = await api('/api/rules'); } catch (e) { return toast(e.message); }
  const { SCORING: s, PRICE: p, RULES: u } = r;
  const line = (l, v) => `<li><span>${l}</span><b>${v > 0 ? '+' : ''}${v}</b></li>`;
  openSheet(`<h1 class="rt">Spielregeln</h1>
    <h3>Allgemein</h3><p>Du führst ein Team aus echten NHL-Spielern. Jeder Spieler hat einen Marktwert. Wenn er in einem echten NHL-Spiel Tore, Assists und mehr erzielt, ändert sich sein Preis am nächsten Morgen. Es gibt keine Simulation: alles kommt von den echten Spielen.</p>
    <h3>Start</h3><p>Neue Manager bekommen gratis ein Team mit ${u.starter.F} Stürmern, ${u.starter.D} Verteidigern und ${u.starter.G} Torhüter sowie ein Startbudget von ${fmt(p.startBudget)}. Kader: maximal ${u.maxRoster} Spieler, davon maximal ${u.maxGoalies} Torhüter.</p>
    <h3>Transfermarkt</h3><p>Auf dem Markt stehen ${u.marketSlots} Spieler. Jede Stunde verlässt einer den Markt und ein neuer kommt. Jeder Spieler bleibt ${u.marketHours} Stunden. Verletzte Spieler werden vom Markt genommen.</p>
    <h3>Bieten</h3><p>Du kaufst per geheimem Gebot, mindestens zum Marktwert. Du kannst dein Gebot bis zum Ablauf ändern oder zurückziehen. Wer bei Ablauf am meisten geboten hat, bekommt den Spieler und zahlt sein Gebot (bei Gleichstand gewinnt das frühere Gebot). Wer verliert, zahlt nichts. Niemand sieht, wer wie viel geboten hat.</p>
    <h3>Verkaufen</h3><p>Du kannst einen Spieler sofort zum Marktwert verkaufen. Oder du bietest ihn den anderen Managern ${u.userListingHours} Stunden lang an. Sie bieten, nur du siehst die Angebote und nimmst eines an.</p>
    <h3>Sperre</h3><p>${u.marketLock ? 'Sobald das Team eines Spielers spielt, ist er bis zum Tagesabschluss gesperrt. Er kann weder gekauft noch verkauft werden.' : 'Auf dem Transfermarkt kannst du jederzeit bieten, kaufen und verkaufen. Die Aufstellung ist aber fix: Sobald das Team eines Spielers spielt, kannst du ihn bis zum Tagesabschluss nicht ein- oder auswechseln.'}</p>
    <h3>Live-Punkte</h3><p>Es zählen die echten Ereignisse der NHL-Spiele, mit den Werten von Topscorers:</p><ul class="rl">
    ${line('Tor Torhüter', s.goal.G)}${line('Tor Verteidiger', s.goal.D)}${line('Tor Stürmer', s.goal.F)}
    ${line('Assist Torhüter', s.assist.G)}${line('Assist Verteidiger', s.assist.D)}${line('Assist Stürmer', s.assist.F)}
    ${line('Shutout (Torhüter)', s.shutout)}${line('Hattrick', s.hattrick)}${line('Powerplay-Tor', s.powerplayGoal)}
    ${line('Sieg', s.win)}${line('Sieg in Verlängerung/Penaltys', s.winOT)}${line('Niederlage n.V.', s.lossOT)}${line('Niederlage Penaltyschiessen', s.lossSO)}${line('Niederlage', s.loss)}
    ${line('Zero Against (Torhüter, Verteidiger)', s.zeroAgainst)}${line('Geblockter Schuss', s.blocked)}${line('Schuss aufs Tor', s.shot)}${line('Im Spiel dabei', s.lineup)}${line('Plus/Minus (pro Punkt)', s.plusMinus)}
    ${line('Parade', s.save)}${line('Gegentor', s.goalAgainst)}${line('Strafe 2 Min.', s.penalty2)}${line('Strafe 5 Min.', s.penalty5)}${line('Strafe 10 Min.', s.penalty10)}${line('Leere Aufstellungsposition', s.emptySlot)}</ul>
    <p class="note">Zusätzlich zählen: Unterzahl-Tor ${s.shGoal}, Unterzahl-Assist ${s.shAssist}, Powerplay-Assist ${s.ppAssist}, Siegtor ${s.gwg}, Siegtor im Penaltyschiessen ${s.pwg}, Bully gewonnen ${s.faceoffWon}, Bully verloren ${s.faceoffLost}, Fehlschuss oder Pfosten ${s.missedShot}, Foul mit Penaltyschuss ${s.psFoul}, Matchstrafe ${s.penaltyMatch}, pro Minute Eiszeit +${s.timeOnIce}, Torhüter-Zeitbonus +${s.goalieTime} pro 10 Minuten. Noch nicht eingebaut: Tore und Gegentore der Mannschaft, solange der Spieler auf dem Eis steht, und Penaltyschuss-Tore.</p>
    <h3>Preisänderung</h3><p>Nach dem Ende aller Spiele eines Tages (am nächsten Morgen ab ${u.rolloverHourZurich}:00 Uhr Zürcher Zeit) ändert sich der Preis um ${p.pctPerPoint} % pro Punkt, höchstens ${p.capPct} % pro Tag. Ein Tor eines Stürmers (60 Punkte) gibt also ${(60 * p.pctPerPoint).toFixed(1)} %. Der Mindestpreis ist ${fmt(p.minPrice)}.</p>
    <h3>Rangliste</h3><p>Die Rangliste zählt die Punkte deiner Spieler. Der Teamwert ist die Summe der Marktwerte deines Kaders.</p>`);
}

/* ---------- auth ---------- */
function showAuth(mode = 'login', error = '') {
  clearTimeout(S.timer);
  clearInterval(S.cd);
  $nav.hidden = true;
  const reg = mode === 'register';
  $app.innerHTML = `<form class="auth" id="auth" autocomplete="on"><div class="hello"><img src="/nhl-logo.png" alt="NHL"><div class="brand">NHL <span>Topscorer</span></div>
    <p>${reg ? 'Gründe dein Team mit echten NHL-Spielern und spiel gegen deine Freunde.' : 'Echte Spiele, echte Punkte, echte Preise. Melde dich an.'}</p></div>
    ${error ? `<div class="err">${esc(error)}</div>` : ''}
    <label>Name<input class="field" name="name" autocomplete="username" required minlength="2" maxlength="20"></label>
    <label>Passwort<input class="field" name="password" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" required minlength="8"></label>
    ${reg ? `<label>Einladungscode<input class="field" name="invite" autocomplete="off" required value="${esc(S.inviteFromUrl || '')}"></label>` : ''}
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
  if (t.closest('.sheet')) return;
  if (t.closest('.top .logo')) return fx.logoTap();
  const bidBtn = t.closest('[data-bid]');
  if (bidBtn) return bidSheet(Number(bidBtn.dataset.bid));
  const sellBtn = t.closest('[data-sellmenu]');
  if (sellBtn) return sellSheet(Number(sellBtn.dataset.sellmenu));
  const acc = t.closest('[data-accept]');
  if (acc) { const [pid, uid] = acc.dataset.accept.split(':').map(Number); return act('/api/accept', { playerId: pid, bidderId: uid }, 'Verkauft'); }
  const cn = t.closest('[data-canceloffer]');
  if (cn) return act('/api/offer/cancel', { playerId: Number(cn.dataset.canceloffer) }, 'Angebot zurückgezogen');
  const open = t.closest('[data-open]');
  if (open) return openPlayer(open.dataset.open);
  const go = t.closest('[data-goto]');
  if (go) { const [tab, sub] = go.dataset.goto.split(':'); S.tab = tab; if (sub) S.sub[tab] = sub; window.scrollTo(0, 0); return render(); }
  const tab = t.closest('nav.bar button');
  if (tab) { S.tab = tab.dataset.t; if (S.tab === 'nhl' && S.sub.nhl === 'games') S.scrollNext = true; window.scrollTo(0, 0); return render(); }
  const sub = t.closest('[data-sub]');
  if (sub) { const [k, v] = sub.dataset.sub.split(':'); S.sub[k] = v; if (k === 'nhl' && v === 'games') S.scrollNext = true; window.scrollTo(0, 0); return render(); }
  const pos = t.closest('[data-pos]');
  if (pos) { S.pos = pos.dataset.pos; return render(); }
  const top = t.closest('[data-top]');
  if (top) { S.top = top.dataset.top; return render(); }
  const mode = t.closest('[data-mode]');
  if (mode && mode.closest('.seg')) { S.mode = mode.dataset.mode; return render(); }
  if (mode) return showAuth(mode.dataset.mode);
  const mg = t.closest('[data-manager]');
  if (mg) return managerSheet(Number(mg.dataset.manager));
  const gm = t.closest('[data-game]');
  if (gm) return gameSheet(Number(gm.dataset.game));
  const gsub = t.closest('[data-gsub]');
  if (gsub) { S.gsub = gsub.dataset.gsub; return render(); }
  const line = t.closest('[data-line]');
  if (line) { S.line = Number(line.dataset.line); return render(); }
  const slot = t.closest('[data-slot]');
  if (slot) { const p = S.team?.players.find((x) => x.id === Number(slot.dataset.slot)); if (p) return changeSheet(p.pos, p.lineup, p.id); return; }
  const add = t.closest('[data-add]');
  if (add) { const [pos, ln] = add.dataset.add.split(':'); return changeSheet(pos, Number(ln), null); }
  const lsub = t.closest('[data-lsub]');
  if (lsub) { S.liveSeg = lsub.dataset.lsub; return render(); }
  if (t.closest('[data-settings]')) return openSettings();
});
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[data-open]')) { e.preventDefault(); openPlayer(e.target.dataset.open); }
});
let typing;
document.addEventListener('input', (e) => {
  if (e.target.id === 'q') { S.q = e.target.value; clearTimeout(typing); typing = setTimeout(render, 250); }
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'sort') { S.sort = e.target.value; render(); }
});

/* ---------- start ---------- */
const linkInvite = new URLSearchParams(location.search).get('invite');
if (linkInvite) { S.inviteFromUrl = linkInvite; history.replaceState(null, '', location.pathname); }
(async () => {
  try { await refreshMe(); render(); } catch { showAuth(S.inviteFromUrl ? 'register' : 'login'); }
})();

/* ---------- home screen tip (iPhone and Android) ---------- */
let installEvent = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; });
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const tipSeen = () => { try { return localStorage.getItem('tipSeen') === '1'; } catch { return false; } };
function installTip() {
  if (isStandalone() || tipSeen()) return '';
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua);
  const android = /Android/.test(ua);
  if (!ios && !android) return '';
  const how = ios ? 'Tippe unten auf <b>Teilen</b> (Quadrat mit Pfeil), dann auf <b>Zum Home-Bildschirm</b>.'
    : installEvent ? '<button class="link" data-install type="button">Jetzt installieren</button>'
      : 'Tippe oben rechts auf das <b>Menü ⋮</b>, dann auf <b>Zum Startbildschirm hinzufügen</b>.';
  return `<div class="tip"><div><b>App aufs Handy holen</b><small>${how}</small></div><button class="x" data-tipclose aria-label="Schliessen">✕</button></div>`;
}
document.addEventListener('click', async (e) => {
  if (e.target.closest('[data-tipclose]')) { try { localStorage.setItem('tipSeen', '1'); } catch {} e.target.closest('.tip')?.remove(); }
  if (e.target.closest('[data-install]') && installEvent) { installEvent.prompt(); installEvent = null; try { localStorage.setItem('tipSeen', '1'); } catch {} e.target.closest('.tip')?.remove(); }
  if (e.target.closest('[data-invite]')) {
    const url = `${location.origin}/?invite=${encodeURIComponent(S.me?.invite || '')}`;
    try { if (navigator.share) await navigator.share({ title: 'NHL Topscorer', text: 'Spiel mit mir NHL Topscorer:', url }); else { await navigator.clipboard.writeText(url); toast('Einladungslink kopiert'); } } catch { /* cancelled */ }
  }
});
