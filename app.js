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

const S = { scrollNext: false, wantNext: false, gsub: 'up', line: 1, team: null, tab: 'board', sub: { team: 'roster', league: 'rank', nhl: 'games', live: 'play' }, mode: 'buy', me: null, pos: '', sort: 'expiry', q: '', top: '', timer: null, cd: null };

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

/* ---------- player rows + detail ---------- */
const hoursText = (h) => (h == null ? '' : h <= 1 ? '1 Std' : `${h} Std`);
const sign = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n));
const avg = (p) => (p.games ? Math.round(p.points / p.games) : 0);
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
  const badges = [p.lineup > 0 ? '<span class="lock lineup">In Aufstellung</span>' : '', gameBadge(p), injuryBadge(p), p.locked ? '<span class="lock">Gesperrt</span>' : '', p.owned && o.owned ? '<span class="lock own">Im Kader</span>' : '', p.ownerName && !p.owned ? `<span class="lock">Im Kader von ${esc(p.ownerName)}</span>` : '', p.myBid ? `<span class="lock own">Dein Gebot ${fmt(p.myBid)}</span>` : '', p.listedBy ? `<span class="lock">Angebot von ${esc(p.listedBy)}</span>` : ''].filter(Boolean).join(' ');
  const right = o.right ?? `<b>${fmt(p.price)}</b><small>${o.rightLabel || 'Marktwert'}</small>`;
  const sub = o.sub ?? `<b>${fmt(p.points)}</b><small>Punkte</small><b>${avg(p)}</b><small>Ø Punkte</small>`;
  return `<div class="prow${o.btn ? ' hasbtn' : ''}" data-open="${p.id}" tabindex="0" role="button" aria-label="${esc(p.first + ' ' + p.last)}">
    ${avatar(p)}<div class="pmain"><div class="ptag">${esc(tag)}${nhl}${o.timer && p.onMarket ? ` <span class="timer">noch ${hoursText(p.hoursLeft)}</span>` : ''}</div>
      <div class="pn">${esc(p.last)}${p.first ? `<small>${esc(p.first)}</small>` : ''}</div>
      <div class="pnums">${sub}</div>${badges ? `<div class="pbadges">${badges}</div>` : ''}</div>
    <div class="pright">${logo(p.team)}<div class="pval">${right}</div>${o.btn || ''}</div></div>`;
}

async function openPlayer(id) {
  let d;
  try { d = await api(`/api/players/${id}`); } catch (e) { return toast(e.message); }
  const bg = document.createElement('div');
  bg.className = 'sheet-bg';
  const gain = d.boughtFor != null ? d.price - d.boughtFor : null;
  const action = d.owned
    ? `<button class="btn sell wide" data-sellmenu="${d.id}" ${d.locked ? 'disabled' : ''}>Verkaufen</button>`
    : d.onMarket
      ? `<button class="btn buy wide" data-bid="${d.id}" ${d.locked ? 'disabled' : ''}>${d.myBid ? 'Gebot ändern (' + fmt(d.myBid) + ')' : 'Bieten ab ' + fmt(d.listedBy ? d.minBid : d.price)} · noch ${hoursText(d.hoursLeft)}</button>`
      : '<button class="btn buy wide" disabled>Nicht auf dem Markt</button>';
  const injBlock = d.injury
    ? `<div class="chart" style="border:1px solid ${d.injury.status === 'out' ? 'var(--down)' : 'var(--yellow)'}"><b class="${d.injury.status === 'out' ? 'down' : ''}">${d.injury.status === 'out' ? 'Verletzt' : 'Fraglich'}</b><div style="color:var(--mute);font-size:13px;margin-top:4px">${esc(d.injury.text || '')}${d.injury.returnDate ? ' · Rückkehr ca. ' + esc(d.injury.returnDate) : ''}</div></div>`
    : d.missedLast
      ? '<div class="chart"><b>Im letzten Spiel nicht dabei</b><div style="color:var(--mute);font-size:13px;margin-top:4px">Dieser Spieler stand im letzten Spiel seines Teams nicht im Einsatz (verletzt, überzählig oder abwesend). Der Grund ist nicht bekannt.</div></div>'
      : '';
  const lockInfo = d.locked ? '<p class="note" style="margin:8px 0 0">Gesperrt: Das Team spielt heute oder der Tag ist noch nicht abgeschlossen. Am nächsten Morgen ist der neue Preis da.</p>' : '';
  const live = d.live ? `<div class="chart"><b>Heute live: ${d.live.pts} Punkte</b><div style="color:var(--mute);font-size:13px;margin-top:4px">${d.live.goals} Tore, ${d.live.assists} Assists, ${d.live.shots} Schüsse. Voraussichtlicher Preis morgen: <b>${fmt(d.tomorrow)}</b></div></div>` : '';
  const trans = d.transfers?.length
    ? `<h2>Transfers</h2><ul class="log">${d.transfers.map((t) => `<li><div>${esc(t.user)} ${t.kind === 'buy' ? 'kauft' : 'verkauft'}<small>vor ${ago(t.at)}</small></div><div style="text-align:right"><b>${fmt(t.price)}</b></div></li>`).join('')}</ul>` : '';
  bg.innerHTML = `<div class="sheet center" role="dialog" aria-label="${esc(d.first + ' ' + d.last)}">
    <button class="close" data-close aria-label="Schliessen">✕</button>
    <div class="shead">${logo(d.team)}<div class="sname">${esc(d.first)} ${esc(d.last)}</div><div class="ptag">#${d.number ?? '–'} · ${POS[d.pos]} · ${esc(d.team)}</div></div>
    <div class="photo">${avatar(d, true)}</div>
    <div class="big3"><div><b>${fmt(d.points)}</b><span>Punkte</span></div><div><b>${avg(d)}</b><span>Ø Punkte</span></div><div><b>${fmt(d.price)}</b><span>Marktwert ${pill(d)}</span></div></div>
    <div class="big3 small"><div><b>${d.boughtFor != null ? fmt(d.boughtFor) : '–'}</b><span>Gekauft für</span></div><div><b class="${gain == null ? '' : gain >= 0 ? 'up' : 'down'}">${gain == null ? '–' : sign(gain)}</b><span>Gewinn</span></div><div><b>${d.todayPts}</b><span>Heute live</span></div></div>
    <div class="grid4"><div><b>${d.games}</b><span>Spiele</span></div><div><b>${d.goals}</b><span>Tore</span></div><div><b>${d.assists}</b><span>Assists</span></div><div><b>${d.plusMinus > 0 ? '+' : ''}${d.plusMinus}</b><span>+/−</span></div>
      <div><b>${d.shots}</b><span>Schüsse</span></div><div><b>${d.pim}</b><span>Strafmin.</span></div><div><b>${d.wins}</b><span>Siege</span></div><div><b>${d.blocked ?? 0}</b><span>Geblockt</span></div></div>
    ${injBlock}${live}${bigChart(d.hist)}
    ${gamesHtml(d.recent)}
    <h2>Preisänderungen</h2>
    ${d.log.length ? `<ul class="log">${d.log.map((l) => `<li><div>${esc(l.day)}<small>${esc(l.summary || '')}</small></div><div style="text-align:right"><b>${l.pts > 0 ? '+' : ''}${l.pts} Pkt</b><small>${fmt(l.price)}</small></div></li>`).join('')}</ul>` : '<div class="empty">Noch keine Preisänderung. Sie kommt nach dem ersten abgeschlossenen Spieltag.</div>'}
    ${trans}${action}${lockInfo}</div>`;
  const close = () => { bg.remove(); document.removeEventListener('keydown', esc_); };
  const esc_ = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', esc_);
  bg.addEventListener('click', async (e) => {
    if (e.target === bg || e.target.closest('[data-close]')) return close();
    const bid = e.target.closest('[data-bid]');
    if (bid) { close(); return bidSheet(d.id); }
    const sm = e.target.closest('[data-sellmenu]');
    if (sm) { close(); return sellSheet(d.id); }
  });
  document.body.append(bg);
}

/** Points per game: bar chart (oldest left) and a numbered list (newest first), like Topscorers. */
const res = (g) => (g.result ? `<span class="res ${g.result.win ? 'win' : 'loss'}">${g.result.own}:${g.result.opp}${g.result.ot ? ' n.V.' : ''} ${g.result.win ? 'S' : 'N'}</span>` : '');
function gamesHtml(log) {
  if (!log || !log.length) return '<h2>Spiele <small>echte NHL-Daten</small></h2><div class="empty">Die Spiele konnten gerade nicht geladen werden.</div>';
  const chrono = [...log].reverse();
  const max = Math.max(1, ...chrono.map((g) => Math.abs(g.pts)));
  const dm = (s) => { const [y, m, d] = String(s).split('-'); return d && m ? `${d}.${m}.` : s; };
  const bars = chrono.map((g) => `<div class="pbar"><b>${g.pts}</b><i style="height:${Math.max(3, Math.round(Math.abs(g.pts) / max * 70))}px" class="${g.pts < 0 ? 'neg' : ''}"></i><span>${dm(g.date)}</span><span>${g.home ? 'vs' : '@'} ${esc(g.opp)}</span></div>`).join('');
  const list = log.map((g, k) => `<li><div><b>${chrono.length - k}. Spiel</b> · ${g.home ? 'vs' : '@'} ${esc(g.opp)} ${res(g)}<small>${dm(g.date)} · ${esc(g.text)}</small></div><div style="text-align:right"><b>${g.pts} Pkt</b></div></li>`).join('');
  return `<h2>Punkte pro Spiel <small>${chrono.length} Spiele</small></h2><div class="pbars">${bars}</div><ul class="log">${list}</ul>`;
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

/* ---------- views ---------- */
const subtabs = (key, items) => `<div class="subtabs">${items.map(([v, l]) => `<button data-sub="${key}:${v}" aria-selected="${S.sub[key] === v}">${l}</button>`).join('')}</div>`;
const seg = (attr, cur, items) => `<div class="seg">${items.map(([v, l]) => `<button data-${attr}="${v}" aria-pressed="${cur === v}">${l}</button>`).join('')}</div>`;
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
    const [team, moves, live, trend] = await Promise.all([api('/api/team'), api('/api/moves'), api('/api/live'), api('/api/trend')]);
    const gain = team.value - team.invested;
    const gc = gain > 0 ? 'up' : gain < 0 ? 'down' : 'flat';
    const hurt = team.players.filter((p) => p.injury || p.missedLast);
    const running = live.games.filter((g) => g.state === 'LIVE' || g.state === 'CRIT').length;
    return `<section class="hero"><div class="lbl">Teamwert</div><div class="big">${fmt(team.value)}</div>
      <span class="pill ${gc}">${arrow(gc)} ${gain >= 0 ? '+' : '−'}${fmt(Math.abs(gain))} seit Kauf</span></section>
      <div class="tiles"><div class="tile"><b>${S.me.rank}.</b><span>Rang</span></div><div class="tile"><b>${fmt(team.points + live.myPoints)}</b><span>Punkte</span></div><div class="tile"><b>${fmt(team.balance / 1000)}k</b><span>Konto</span></div></div>
      <h2>Markt <small>geht er hoch oder runter?</small></h2>${trendHtml(trend, true)}
      <h2>Heute <small>${running ? running + ' Spiele laufen' : 'kein Spiel läuft'}</small></h2>
      ${live.mine.length ? live.mine.slice(0, 3).map((r) => `<div class="card" data-open="${r.id}"><div class="row"><div class="grow"><div class="pname"><span>${esc(r.team)}</span>${esc(r.name)}</div></div><div class="price"><b>${r.pts > 0 ? '+' : ''}${r.pts}</b><span class="pill flat">morgen ca. ${fmt(r.tomorrow)}</span></div></div></div>`).join('') : '<div class="empty">Heute noch keine Punkte für dein Team.</div>'}
      ${hurt.length ? `<h2>Achtung im Team <small>${hurt.length} Spieler</small></h2>${hurt.map((p) => prow(p)).join('')}` : ''}
      <h2>Letzte Preisbewegungen <small>Spieltag ${esc(moves[0]?.day || '–')}</small></h2>
      ${moves.length ? moves.slice(0, 8).map((m) => { const up = m.price > m.prev_price; return `<div class="card" data-open="${m.id}"><div class="row"><div class="grow"><div class="pname"><span>${esc(m.team)} · ${esc(m.summary)}</span>${esc(m.first)} ${esc(m.last)}</div></div><div class="price"><b>${fmt(m.price)}</b><span class="pill ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${Math.abs((m.price - m.prev_price) / m.prev_price * 100).toFixed(1)}%</span></div></div></div>`; }).join('') : '<div class="empty">Noch keine Preisbewegungen. Sie erscheinen nach dem ersten abgeschlossenen Spieltag.</div>'}`;
  },

  async team() {
    const head = subtabs('team', [['roster', 'Kader'], ['lineup', 'Aufstellung']]);
    const t = await api('/api/team');
    S.team = t;
    if (S.sub.team === 'lineup') {
      const inL = (pos, line) => t.players.filter((p) => p.pos === pos && p.lineup === line);
      const slot = (pos, line, i) => {
        const p = inL(pos, line)[i];
        const posName = { F: 'Stürmer', D: 'Verteidiger', G: 'Torhüter' }[pos];
        return p
          ? `<button class="slot" data-slot="${p.id}" aria-label="${esc(p.first + ' ' + p.last)}">${avatar(p)}<span class="sn">${esc(p.last)}</span><span class="sv">${fmt(p.price / 1000)}k</span>${p.injury ? '<i class="sx">!</i>' : ''}</button>`
          : `<button class="slot empty" data-add="${pos}:${line}"><span class="plusc">+</span><span class="sn">${posName}</span></button>`;
      };
      const L = S.line;
      const placed = t.players.filter((p) => p.lineup > 0).length;
      const bench = t.players.filter((p) => p.lineup === 0);
      return `${head}<div class="balbar"><span>Aufstellung</span><b>${placed}/16</b><span>Bank ${bench.length}</span></div>
        <div class="ice"><div class="lrow">${slot('F', L, 0)}</div><div class="lrow">${slot('F', L, 1)}${slot('F', L, 2)}</div><div class="lrow">${slot('D', L, 0)}${slot('D', L, 1)}</div><div class="lrow g">${slot('G', 9, 0)}</div></div>
        <div class="floatseg">${seg('line', String(L), [['1', '1. Linie'], ['2', '2. Linie'], ['3', '3. Linie']])}</div>
        ${bench.length ? `<div class="grp">Bank</div>${bench.map((p) => prow(p)).join('')}` : ''}
        <div class="note">Nur Spieler in der Aufstellung bringen Punkte. Tippe auf ein Feld, um einen Spieler einzusetzen oder auf die Bank zu setzen. Spieler, deren Team heute spielt, sind gesperrt.</div>`;
    }
    const bal = `<div class="balbar"><span>Kontostand</span><b>${fmt(t.balance)}</b><span>Kader ${t.players.length}/20</span></div>`;
    {
      const groups = [['G', 'Torhüter'], ['D', 'Verteidiger'], ['F', 'Stürmer']];
      const g = t.value - t.invested;
      return `${head}${bal}<div class="tiles"><div class="tile"><b>${fmt(t.value / 1000)}k</b><span>Teamwert</span></div><div class="tile"><b class="${g >= 0 ? 'up' : 'down'}">${g >= 0 ? '+' : '−'}${fmt(Math.abs(g) / 1000)}k</b><span>Gewinn</span></div><div class="tile"><b>${fmt(t.points)}</b><span>Punkte</span></div></div>
        ${t.players.length ? groups.map(([k, l]) => { const ps = t.players.filter((p) => p.pos === k); return ps.length ? `<div class="grp">${l}</div>${ps.map((p) => prow(p)).join('')}` : ''; }).join('') : '<div class="empty">Noch keine Spieler. Kaufe welche im Transfermarkt.</div>'}`;
    }
  },

  async market() {
    const [t, au, trend] = await Promise.all([api('/api/team'), api('/api/auctions'), api('/api/trend')]);
    const bidSum = au.bids.reduce((s, b) => s + b.amount, 0);
    const after = t.balance - bidSum;
    const bal = `<div class="balbar"><span>Kontostand<b>${fmt(t.balance)}</b></span><span>Nach Geboten<b class="${after < 0 ? 'down' : ''}">${fmt(after)}</b></span><span>Kader<b>${t.players.length}/20</b></span></div>`;
    const head = '';
    const f = [['', 'Alle'], ['F', 'Stürmer'], ['D', 'Verteidiger'], ['G', 'Torhüter']];
    const trendBar = trendHtml(trend, false);
    let list;
    if (S.mode === 'mine') {
      return `${bal}${trendBar}${auctionsHtml(au)}<div class="floatseg">${seg('mode', S.mode, MODES)}</div>`;
    }
    if (S.mode === 'sell') {
      list = t.players.filter((p) => !S.pos || p.pos === S.pos);
      list = `${list.length ? list.map((p) => prow(p, { btn: `<button class="plus minus" data-sellmenu="${p.id}" ${p.locked ? 'disabled' : ''} aria-label="Verkaufen">−</button>`, rightLabel: 'Marktwert' })).join('') : '<div class="empty">Keine Spieler zum Verkaufen.</div>'}`;
    } else {
      const qs = new URLSearchParams({ pos: S.pos, sort: S.sort, q: S.q });
      const market = await api(`/api/players?${qs}`);
      list = market.length ? market.map((p) => prow(p, { timer: true, owned: true, rightLabel: 'Mindestgebot', btn: p.owned || p.listedBy === S.me?.name ? '' : `<button class="plus" data-bid="${p.id}" ${p.locked ? 'disabled' : ''} aria-label="Bieten">+</button>` })).join('') : '<div class="empty">Keine Spieler gefunden. Falls der Markt ganz leer bleibt, wurden die NHL-Kader noch nicht geladen (siehe README: npm run sync).</div>';
    }
    return `${head}${bal}${trendBar}
      <div class="row2"><input class="field" id="q" type="search" placeholder="Spieler oder Team suchen" value="${esc(S.q)}" autocomplete="off">
      <select class="field" id="sort" aria-label="Sortierung">${[['expiry', 'Läuft ab'], ['price', 'Preis'], ['change', 'Änderung'], ['points', 'Punkte'], ['live', 'Live']].map(([v, l]) => `<option value="${v}" ${S.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="tabs">${f.map(([v, l]) => `<button data-pos="${v}" aria-pressed="${S.pos === v}">${l}</button>`).join('')}</div>
      <div style="margin-top:12px">${list}</div>
      <div class="floatseg">${seg('mode', S.mode, MODES)}</div>`;
  },

  async league() {
    const head = subtabs('league', [['rank', 'Rangliste'], ['ticker', 'Liga-Ticker']]);
    if (S.sub.league === 'ticker') {
      const rows = await api('/api/ticker');
      return `${head}${rows.length ? rows.map((r) => `<div class="tick" data-open="${r.playerId}"><div class="ago">vor ${ago(r.at)}</div><b>${esc(r.user)}</b> ${r.kind === 'buy' ? 'kauft' : 'verkauft'} <b>${esc(r.player.toUpperCase())}</b> für ${fmt(r.price)}</div>`).join('') : '<div class="empty">Noch keine Transfers in deiner Liga.</div>'}`;
    }
    const rows = await api('/api/league');
    return `${head}<div class="rhead"><span>Teamwert</span><span>Punkte</span></div>
      ${rows.map((r, i) => `<div class="rank${r.me ? ' me' : ''}"><div class="n">${i + 1}.</div><div class="grow"><div class="rname">${esc(r.name)}</div></div><div class="rv">${fmt(r.value)}</div><div class="rp">${fmt(r.points)}${r.live ? `<small>+${r.live} heute</small>` : ''}</div></div>`).join('')}`;
  },

  async live() {
    const [d, t, lg] = await Promise.all([api('/api/live'), api('/api/team'), api('/api/league')]);
    const running = d.games.some((g) => g.state === 'LIVE' || g.state === 'CRIT');
    const playingTeams = new Set(d.games.filter((g) => g.day === d.openDay).flatMap((g) => [g.home, g.away]));
    const pts = new Map(d.mine.map((r) => [r.id, r]));
    const playing = t.players.filter((p) => playingTeams.has(p.team));
    const off = t.players.filter((p) => !playingTeams.has(p.team));
    const shown = S.sub.live === 'off' ? off : playing;
    const row = (p) => { const r = pts.get(p.id); return prow(p, { sub: p.dressed ? `<b>${r ? r.goals : 0}</b><small>Tore</small><b>${r ? r.assists : 0}</b><small>Assists</small>` : '<small>noch kein Einsatz</small>', right: `<b class="${r && r.pts > 0 ? 'up' : ''}">${r ? (r.pts > 0 ? '+' : '') + r.pts : 0}</b><small>Live</small>` }); };
    const board = [...lg].sort((x, y) => y.live - x.live || y.points - x.points);
    const standings = `<h2>Manager heute <small>Punkte aus der Aufstellung</small></h2>${board.map((r, i) => `<div class="rank${r.me ? ' me' : ''}"><div class="n">${i + 1}.</div><div class="grow"><div class="rname">${esc(r.name)}${r.me ? ' (du)' : ''}</div></div><div class="rv">${fmt(r.points - r.live)} total</div><div class="rp ${r.live > 0 ? 'up' : ''}">${r.live > 0 ? '+' : ''}${r.live}<small>heute</small></div></div>`).join('')}<h2>Deine Spieler</h2>`;
    return `${running ? '<div class="livebar"><i></i>Spiele laufen · deine Punkte heute: <b>' + d.myPoints + '</b></div>' : countdown(d.nextStart)}
      ${standings}
      ${shown.length ? shown.map(row).join('') : `<div class="empty">${S.sub.live === 'off' ? 'Alle deine Spieler haben heute ein Spiel.' : 'Heute spielt keiner deiner Spieler.'}</div>`}
      <div class="floatseg">${seg('lsub', S.sub.live, [['play', 'Im Spiel (' + playing.length + ')'], ['off', 'Spielfrei (' + off.length + ')']])}</div>
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

async function render() {
  clearTimeout(S.timer);
  clearInterval(S.cd);
  $nav.hidden = false;
  $nav.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', b.dataset.t === S.tab));
  const y = window.scrollY;
  let html;
  try { html = await views[S.tab](); } catch (e) { if (e.message === 'login') return; html = `<div class="err" style="margin-top:20px">${esc(e.message)}</div>`; }
  const keep = document.activeElement?.id === 'q';
  $app.innerHTML = header() + `<main>${html}</main>`;
  if (keep) { const q = document.getElementById('q'); q?.focus(); q?.setSelectionRange(q.value.length, q.value.length); }
  window.scrollTo(0, y);
  if (S.wantNext) { S.wantNext = false; const el = document.getElementById('nextgame'); if (el) el.scrollIntoView({ block: 'center' }); }
  tickCountdown();
  S.cd = setInterval(tickCountdown, 1000);
  if (S.tab === 'live' || S.tab === 'board') S.timer = setTimeout(render, 30_000);
}

const STAR = '<svg viewBox="0 0 24 24" class="star" aria-hidden="true"><path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7-6.2-3.7-6.2 3.7 1.6-7L2 9.2l7.1-.6z"/></svg>';
function header() {
  return `<header class="top"><div class="top-in"><div class="chip">Saison 26/27</div><div class="logo">${STAR}<b>NHL</b><span>Topscorer</span></div>
    <button class="gear" data-settings aria-label="Einstellungen"><svg viewBox="0 0 24 24"><path d="M19.4 13a7.6 7.6 0 000-2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 00-1.7-1L15 3.4h-4l-.4 2.6a7.5 7.5 0 00-1.7 1l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 000 2l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 001.7 1l.4 2.6h4l.4-2.6a7.5 7.5 0 001.7-1l2.4 1 2-3.4zM13 15.5a3.5 3.5 0 110-7 3.5 3.5 0 010 7z" transform="translate(-1 0)"/></svg></button></div></header>`;
}

async function refreshMe() { S.me = await api('/api/me'); }

/* ---------- game detail ---------- */
const PERIOD = (e) => (e.periodType === 'SO' ? 'Penaltyschiessen' : e.periodType === 'OT' ? 'Verlängerung' : `${e.period}. Drittel`);
async function gameSheet(id) {
  const g = (S.games || []).find((x) => x.id === id);
  if (!g) return;
  const started = g.state !== 'FUT' && g.state !== 'PRE';
  const head = `<div class="shead"><div class="ptag">${esc(g.day)}</div><div class="sname">${esc(g.home)} ${started ? `${g.homeScore ?? 0} : ${g.awayScore ?? 0}` : 'vs'} ${esc(g.away)}</div>
    <div class="ptag">${started ? (g.state === 'FINAL' || g.state === 'OFF' ? 'Beendet' : 'Läuft') : 'Noch nicht gestartet'}</div></div>`;
  const bg = openSheet(head + (started ? '<div class="empty" id="gbody">Lade Spieldetails …</div>' : '<div class="empty">Das Spiel hat noch nicht begonnen.</div>'));
  if (!started) return;
  let ev;
  try { ev = await api(`/api/games/${id}/events`); } catch (e) { const b = bg.querySelector('#gbody'); if (b) b.textContent = e.message; return; }
  const secs = (e) => { const [m, s] = String(e.time).split(':').map(Number); return (m || 0) * 60 + (s || 0); };
  const periodKey = (e) => (e.periodType === 'SO' ? 9 : e.periodType === 'OT' ? 4 : e.period ?? 0);
  const all = [...ev.goals.map((e) => ({ ...e, kind: 'goal' })), ...ev.penalties.map((e) => ({ ...e, kind: 'pen' }))]
    .sort((x, y) => periodKey(x) - periodKey(y) || secs(x) - secs(y));
  let lastP = '';
  const timeline = all.length ? all.map((e) => {
    const p = PERIOD(e);
    const h = p !== lastP ? `<div class="dayhead">${p}</div>` : '';
    lastP = p;
    const body = e.kind === 'goal'
      ? `<div class="evm"><b>${esc(e.scorer)}</b><small>${e.assists.length ? 'Assists: ' + esc(e.assists.join(', ')) : 'Ohne Assist'}</small></div><div class="evs">${e.home != null ? e.home + ' : ' + e.away : ''}</div>`
      : `<div class="evm"><b>${esc(e.player)}</b><small>${esc(e.text)}</small></div><div class="evs pen">${e.minutes} Min</div>`;
    return `${h}<div class="ev ${e.kind}"><div class="evt">${esc(e.time)}</div>${logo(e.team)}<span class="tagk ${e.kind}">${e.kind === 'goal' ? 'TOR' : 'STRAFE'}</span>${body}</div>`;
  }).join('') : '<div class="empty">Bisher keine Tore und keine Strafen.</div>';
  const b = bg.querySelector('#gbody');
  if (b) b.outerHTML = `<h2>Spielverlauf <small>${ev.goals.length} Tore · ${ev.penalties.length} Strafen</small></h2>${timeline}`;
}

/* ---------- bids, offers ---------- */
async function act(path, body, okMsg, bg) {
  try { await api(path, { body }); toast(okMsg); bg?.remove(); await refreshMe(); render(); } catch (err) { toast(err.message); }
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
    <button class="btn sell wide" data-now style="margin-top:18px" ${d.locked ? 'disabled' : ''}>Sofort verkaufen für ${fmt(d.price)}</button>
    <p style="margin-top:12px;text-align:center">Oder biete ihn den anderen Managern an. Sie bieten ${RULES_HOURS} Stunden lang, nur du siehst die Angebote und wählst eines aus.</p>
    <button class="btn buy wide" data-offer ${d.locked ? 'disabled' : ''}>Den anderen anbieten</button>
    ${d.locked ? '<p class="note">Gesperrt: Das Team spielt heute.</p>' : ''}`);
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

/* ---------- lineup sheets ---------- */
async function moveTo(playerId, line, bg) {
  try { await api('/api/lineup', { body: { playerId, line } }); bg.remove(); render(); } catch (err) { toast(err.message); }
}
function slotSheet(id) {
  const p = S.team?.players.find((x) => x.id === id);
  if (!p) return;
  const bg = openSheet(`<div class="shead">${avatar(p, true)}<div class="sname">${esc(p.first)} ${esc(p.last)}</div><div class="ptag">${POS[p.pos]} · ${esc(p.team)}</div></div>
    <button class="btn sell wide" data-bench style="margin-top:18px">Auf die Bank</button>
    <button class="btn buy wide" data-details style="margin-top:10px">Details</button>`);
  bg.addEventListener('click', (e) => {
    if (e.target.closest('[data-bench]')) moveTo(id, 0, bg);
    if (e.target.closest('[data-details]')) { bg.remove(); openPlayer(id); }
  });
}
function addSheet(pos, line) {
  const bench = (S.team?.players || []).filter((p) => p.pos === pos && p.lineup === 0);
  const bg = openSheet(`<h1 class="rt">${{ F: 'Stürmer', D: 'Verteidiger', G: 'Torhüter' }[pos]} einsetzen</h1>
    ${bench.length ? bench.map((p) => prow(p, { btn: `<button class="plus" data-put="${p.id}">+</button>` })).join('') : '<div class="empty">Kein Spieler auf der Bank. Hole einen im Markt oder setze einen anderen Spieler auf die Bank.</div>'}`);
  bg.addEventListener('click', (e) => {
    const b = e.target.closest('[data-put]');
    if (b) { e.stopPropagation(); moveTo(Number(b.dataset.put), pos === 'G' ? 9 : line, bg); }
    else if (e.target.closest('[data-open]')) { bg.remove(); openPlayer(e.target.closest('[data-open]').dataset.open); }
  });
}

/* ---------- settings + game rules ---------- */
function openSheet(html) {
  const bg = document.createElement('div');
  bg.className = 'sheet-bg';
  bg.innerHTML = `<div class="sheet" role="dialog"><button class="close" data-close aria-label="Schliessen">✕</button>${html}</div>`;
  bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-close]')) bg.remove(); });
  document.body.append(bg);
  return bg;
}

function openSettings() {
  const bg = openSheet(`<div class="shead"><div class="sname">${esc(S.me?.name || '')}</div><div class="ptag">Konto ${fmt(S.me?.balance || 0)}</div></div>
    <button class="btn buy wide" data-rules style="margin-top:18px">Spielregeln</button>
    <button class="btn sell wide" data-logout style="margin-top:10px">Abmelden</button>`);
  bg.addEventListener('click', async (e) => {
    if (e.target.closest('[data-rules]')) { bg.remove(); openRules(); }
    if (e.target.closest('[data-logout]')) { bg.remove(); await api('/api/logout', { body: {} }).catch(() => {}); S.me = null; showAuth(); }
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
    <h3>Sperre</h3><p>Sobald das Team eines Spielers spielt, ist er bis zum Tagesabschluss gesperrt. Er kann weder gekauft noch verkauft werden.</p>
    <h3>Live-Punkte</h3><p>Während der Spiele zählen die echten Ereignisse live:</p><ul class="rl">
    ${line('Tor', s.goal)}${line('Assist', s.assist)}${line('Schuss aufs Tor', s.shot)}${line('Geblockter Schuss', s.blocked)}${line('Strafminute', s.pim)}${line('Plus/Minus (pro Punkt)', s.plusMinus)}
    ${line('Torhüter: Parade', s.save)}${line('Torhüter: Gegentor', s.goalAgainst)}${line('Torhüter: Sieg', s.win)}${line('Torhüter: Shutout', s.shutout)}</ul>
    <p class="note">Nur das Tor mit 50 Punkten ist von Topscorers übernommen. Die anderen Werte sind Platzhalter.</p>
    <h3>Preisänderung</h3><p>Nach dem Ende aller Spiele eines Tages (am nächsten Morgen ab ${u.rolloverHourZurich}:00 Uhr Zürcher Zeit) ändert sich der Preis um ${p.pctPerPoint} % pro Punkt, höchstens ${p.capPct} % pro Tag. Ein Tor (50 Punkte) gibt also ${(50 * p.pctPerPoint).toFixed(1)} %. Der Mindestpreis ist ${fmt(p.minPrice)}.</p>
    <h3>Rangliste</h3><p>Die Rangliste zählt die Punkte deiner Spieler. Der Teamwert ist die Summe der Marktwerte deines Kaders.</p>`);
}

/* ---------- auth ---------- */
function showAuth(mode = 'login', error = '') {
  clearTimeout(S.timer);
  clearInterval(S.cd);
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
  if (t.closest('.sheet')) return;
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
  const gm = t.closest('[data-game]');
  if (gm) return gameSheet(Number(gm.dataset.game));
  const gsub = t.closest('[data-gsub]');
  if (gsub) { S.gsub = gsub.dataset.gsub; return render(); }
  const line = t.closest('[data-line]');
  if (line) { S.line = Number(line.dataset.line); return render(); }
  const slot = t.closest('[data-slot]');
  if (slot) return slotSheet(Number(slot.dataset.slot));
  const add = t.closest('[data-add]');
  if (add) { const [pos, ln] = add.dataset.add.split(':'); return addSheet(pos, Number(ln)); }
  const lsub = t.closest('[data-lsub]');
  if (lsub) { S.sub.live = lsub.dataset.lsub; return render(); }
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
(async () => {
  try { await refreshMe(); render(); } catch { showAuth(); }
})();
