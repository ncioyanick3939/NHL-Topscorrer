import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { extname, join } from 'node:path';
import * as game from './game.js';
import { SCORING, PRICE, RULES } from './config.js';
import { startScheduler, getGameLog, getGameEvents } from './nhl.js';

const ROOT = new URL('.', import.meta.url).pathname;
const PORT = Number(process.env.PORT || 3000);
const SECURE = process.env.COOKIE_SECURE === '1'; // set to 1 when served over HTTPS

/* Invite code: env INVITE_CODE, else a random one saved to data/invite-code.txt */
async function loadInvite() {
  if (process.env.INVITE_CODE) return process.env.INVITE_CODE;
  const f = join(ROOT, 'data', 'invite-code.txt');
  if (existsSync(f)) return readFileSync(f, 'utf8').trim();
  const code = randomBytes(4).toString('hex');
  await mkdir(join(ROOT, 'data'), { recursive: true });
  await writeFile(f, code + '\n');
  return code;
}
const INVITE = await loadInvite();

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

const attempts = new Map(); // ip -> [timestamps]
function tooManyLogins(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) ?? []).filter((t) => now - t < 60_000);
  list.push(now);
  attempts.set(ip, list);
  return list.length > 8;
}

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

async function body(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 10_000) throw new game.HttpError(413, 'Anfrage zu gross.');
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new game.HttpError(400, 'Ungültige Anfrage.'); }
}

function send(res, status, data, headers = {}) {
  const json = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(json);
}

const sessionCookie = (token, expires) =>
  `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Expires=${new Date(expires).toUTCString()}${SECURE ? '; Secure' : ''}`;

async function api(req, res, url) {
  const route = `${req.method} ${url.pathname}`;
  const q = url.searchParams;
  const ip = req.socket.remoteAddress;

  if (req.method === 'POST' && !String(req.headers['content-type'] || '').startsWith('application/json')) {
    throw new game.HttpError(415, 'Nur JSON erlaubt.');
  }

  if (route === 'POST /api/register' || route === 'POST /api/login') {
    if (tooManyLogins(ip)) throw new game.HttpError(429, 'Zu viele Versuche. Bitte eine Minute warten.');
    const b = await body(req);
    const id = route.endsWith('register') ? game.register(b.name, b.password, b.invite, INVITE) : game.login(b.name, b.password);
    const s = game.createSession(id);
    return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(s.token, s.expires) });
  }

  const token = cookies(req).sid;
  const user = game.userFromToken(token);
  if (!user) throw new game.HttpError(401, 'Bitte anmelden.');

  switch (route) {
    case 'POST /api/logout':
      game.destroySession(token);
      return send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; Path=/; Max-Age=0' });
    case 'GET /api/me': {
      game.ensureStarterTeam(user.id); // accounts made before the starter team existed get it now
      const team = game.myTeam(user.id);
      const rank = game.league(user.id).findIndex((r) => r.me) + 1;
      return send(res, 200, { name: user.name, balance: team.balance, value: team.value, points: team.points, rank, count: team.players.length });
    }
    case 'GET /api/players':
      return send(res, 200, game.listPlayers(user.id, { pos: q.get('pos'), q: q.get('q'), sort: q.get('sort'), limit: q.get('limit') }));
    case 'GET /api/team': return send(res, 200, game.myTeam(user.id));
    case 'GET /api/league': return send(res, 200, game.league(user.id));
    case 'GET /api/live': return send(res, 200, game.liveView(user.id));
    case 'GET /api/rules': return send(res, 200, { SCORING, PRICE, RULES });
    case 'GET /api/games': return send(res, 200, game.allGames());
    case 'GET /api/ticker': return send(res, 200, game.ticker());
    case 'GET /api/topscorers': return send(res, 200, game.topscorers(user.id, { pos: q.get('pos') }));
    case 'GET /api/moves': return send(res, 200, game.recentMoves());
    case 'GET /api/auctions': return send(res, 200, game.auctions(user.id));
    case 'POST /api/bid': { const b = await body(req); return send(res, 200, game.placeBid(user.id, Number(b.playerId), b.amount)); }
    case 'POST /api/bid/cancel': return send(res, 200, game.cancelBid(user.id, Number((await body(req)).playerId)));
    case 'POST /api/offer': return send(res, 200, game.offerPlayer(user.id, Number((await body(req)).playerId)));
    case 'POST /api/offer/cancel': return send(res, 200, game.cancelOffer(user.id, Number((await body(req)).playerId)));
    case 'POST /api/accept': { const b = await body(req); return send(res, 200, game.acceptBid(user.id, Number(b.playerId), Number(b.bidderId))); }
    case 'POST /api/lineup': { const b = await body(req); return send(res, 200, game.setLineup(user.id, Number(b.playerId), Number(b.line))); }
    case 'POST /api/sell': return send(res, 200, game.sell(user.id, Number((await body(req)).playerId)));
  }
  const ge = url.pathname.match(/^\/api\/games\/(\d+)\/events$/);
  if (ge && req.method === 'GET') {
    try {
      const ev = await getGameEvents(Number(ge[1]));
      if (!ev) throw new game.HttpError(404, 'Spiel nicht gefunden.');
      return send(res, 200, ev);
    } catch (e) {
      if (e instanceof game.HttpError) throw e;
      throw new game.HttpError(502, 'Die NHL liefert die Spieldetails gerade nicht.');
    }
  }
  const m = url.pathname.match(/^\/api\/players\/(\d+)$/);
  if (m && req.method === 'GET') {
    const detail = game.playerDetail(user.id, Number(m[1]));
    detail.recent = await getGameLog(detail.id); // real last games from the NHL, null if unavailable
    return send(res, 200, detail);
  }
  throw new game.HttpError(404, 'Nicht gefunden.');
}

// Only these three files are public. Code, database and invite code live in the same folder and must never be served.
const STATIC = { '/': 'index.html', '/index.html': 'index.html', '/style.css': 'style.css', '/app.js': 'app.js' };

async function serveStatic(req, res, url) {
  const name = STATIC[url.pathname];
  const file = name && join(ROOT, name);
  try {
    if (!file) throw new Error('not public');
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Nicht gefunden');
  }
}

const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; img-src 'self' https://assets.nhle.com data:; style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; font-src https://fonts.gstatic.com; script-src 'self'");
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    return await serveStatic(req, res, url);
  } catch (e) {
    if (e instanceof game.HttpError) return send(res, e.status, { error: e.message });
    console.error(e);
    return send(res, 500, { error: 'Serverfehler.' });
  }
});

server.listen(PORT, () => {
  console.log(`NHL Topscorer läuft auf http://localhost:${PORT}`);
  console.log(`Einladungscode für neue Manager: ${INVITE}`);
  if (process.env.NO_SCHEDULER !== '1') startScheduler();
});

export { server };
