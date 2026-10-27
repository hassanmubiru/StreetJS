import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { ChannelHub, StreetWebSocketServer } from 'streetjs';

const scrypt = promisify(scryptCallback);
const root = fileURLToPath(new URL('.', import.meta.url));
const dataDir = join(root, 'data');
const playersPath = join(dataDir, 'players.json');
const sessionsPath = join(dataDir, 'sessions.json');
const port = Number(process.env.PORT || 4173);
const sessionLifetimeMs = 1000 * 60 * 60 * 24 * 30;
const actionsPerDay = 3;
const dailyGoalTarget = 3;
const districtRoom = 'kampala:central';
const worldWidth = 1000;
const worldHeight = 620;
const maxMoveDistance = 110;
const worldActivities = [];

const actionDefinitions = {
  'Boda stage': { cash: -1500, energy: -8, reputation: 1, message: 'You caught a boda through the rush. Kampala is moving with you.' },
  'Rolex spot': { cash: -800, energy: 6, reputation: 1, message: 'A hot rolex restored your energy. That is proper Kampala fuel.' },
  'Live music': { cash: -3000, energy: -10, reputation: 2, message: 'You found the beat and made a new connection.' },
  'Fresh start': { cash: -5000, energy: 12, reputation: 0, message: 'You invested in a fresh start and found your rhythm.' },
  'Market gig': { cash: 6000, energy: -20, reputation: 1, message: 'You helped a vendor at Owino Market and earned an honest day’s pay.' },
  'Rest at home': { cash: 0, energy: 25, reputation: 0, message: 'You took a quiet afternoon at home and got your energy back.' },
};

function normalizePlayer(player) {
  return {
    ...player,
    day: Number(player.day || 1),
    actionsToday: Number(player.actionsToday || 0),
    dailyReputation: Number(player.dailyReputation || 0),
    dailyGoal: player.dailyGoal || { title: 'Build your network', description: 'Earn 3 reputation today', target: dailyGoalTarget, progress: 0, complete: false },
    history: Array.isArray(player.history) ? player.history : [],
    position: player.position || { x: 500, y: 300 },
  };
}

function publicPresence(player) {
  return { id: player.id, name: player.name, position: player.position || { x: 500, y: 300 } };
}

function publicGame(player) {
  const normalized = normalizePlayer(player);
  return {
    day: normalized.day,
    actionsToday: normalized.actionsToday,
    actionsPerDay,
    dailyGoal: normalized.dailyGoal,
    lastAction: normalized.lastAction,
    history: normalized.history.slice(-5).reverse(),
  };
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

async function initializeStore() {
  await mkdir(dataDir, { recursive: true });
  if (!existsSync(playersPath)) await writeJson(playersPath, []);
  if (!existsSync(sessionsPath)) await writeJson(sessionsPath, []);
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function publicPlayer(player) {
  const { passwordHash, passwordSalt, ...safePlayer } = player;
  return safePlayer;
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

async function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const derived = await scrypt(password, salt, 64);
  return { salt, hash: Buffer.from(derived).toString('hex') };
}

async function verifyPassword(password, player) {
  const candidate = await hashPassword(password, player.passwordSalt);
  return timingSafeEqual(Buffer.from(candidate.hash, 'hex'), Buffer.from(player.passwordHash, 'hex'));
}

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map((part) => {
    const [key, ...value] = part.trim().split('=');
    return [key, decodeURIComponent(value.join('='))];
  }));
}

async function requestBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10_000) throw new Error('Request body too large');
  }
  return raw ? JSON.parse(raw) : {};
}

async function authenticate(req) {
  const cookies = parseCookies(req);
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : cookies.kampala_session;
  if (!token) return null;
  const sessions = await readJson(sessionsPath, []);
  const tokenHash = hashToken(token);
  const session = sessions.find((entry) => entry.tokenHash === tokenHash && Date.parse(entry.expiresAt) > Date.now());
  if (!session) return null;
  const players = await readJson(playersPath, []);
  const player = players.find((entry) => entry.id === session.playerId) || null;
  return player ? normalizePlayer(player) : null;
}

function sessionResponse(res, token, player) {
  res.setHeader('set-cookie', `kampala_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${sessionLifetimeMs / 1000}`);
  json(res, 200, { token, player: publicPlayer(player), game: publicGame(player) });
}

async function createSession(player) {
  const token = randomBytes(32).toString('hex');
  const sessions = await readJson(sessionsPath, []);
  sessions.push({ tokenHash: hashToken(token), playerId: player.id, expiresAt: new Date(Date.now() + sessionLifetimeMs).toISOString() });
  await writeJson(sessionsPath, sessions);
  return token;
}

async function auth(req, res, mode) {
  const body = await requestBody(req);
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 8) {
    return json(res, 400, { error: 'Use a valid email and a password of at least 8 characters.' });
  }

  const players = await readJson(playersPath, []);
  const existing = players.find((player) => player.email === email);
  if (mode === 'signup' && existing) return json(res, 409, { error: 'That email already has a Kampala story. Log in instead.' });
  if (mode === 'login' && (!existing || !(await verifyPassword(password, existing)))) {
    return json(res, 401, { error: 'Email or password is incorrect.' });
  }

  const player = existing || (() => {
    const name = email.split('@')[0].split(/[._-]/)[0] || 'friend';
    return { id: randomUUID(), email, name, cash: 25000, energy: 80, reputation: 0, location: 'Kampala', createdAt: new Date().toISOString(), lastAction: null, day: 1, actionsToday: 0, dailyReputation: 0, dailyGoal: { title: 'Build your network', description: 'Earn 3 reputation today', target: dailyGoalTarget, progress: 0, complete: false }, history: [], position: { x: 500, y: 300 } };
  })();
  if (!existing) {
    const credentials = await hashPassword(password);
    player.passwordHash = credentials.hash;
    player.passwordSalt = credentials.salt;
    players.push(player);
    await writeJson(playersPath, players);
  }
  return sessionResponse(res, await createSession(player), normalizePlayer(player));
}

async function logout(req, res) {
  const cookies = parseCookies(req);
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : cookies.kampala_session;
  if (token) {
    const sessions = await readJson(sessionsPath, []);
    await writeJson(sessionsPath, sessions.filter((entry) => entry.tokenHash !== hashToken(token)));
  }
  res.setHeader('set-cookie', 'kampala_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  json(res, 200, { ok: true });
}

async function performAction(req, res) {
  const player = await authenticate(req);
  if (!player) return json(res, 401, { error: 'Sign in to make a move.' });
  const body = await requestBody(req);
  const action = actionDefinitions[String(body.action || '')];
  if (!action) return json(res, 400, { error: 'That move is not available.' });
  if (player.actionsToday >= actionsPerDay) return json(res, 400, { error: 'You have used today’s 3 moves. End the day to continue your story.' });
  if (player.cash + action.cash < 0) return json(res, 400, { error: 'You need more cash for that move.' });
  if (player.energy + action.energy < 0) return json(res, 400, { error: 'You need more energy for that move.' });

  player.cash += action.cash;
  player.energy = Math.min(100, player.energy + action.energy);
  player.reputation += action.reputation;
  player.actionsToday += 1;
  player.dailyReputation += action.reputation;
  player.dailyGoal.progress = Math.min(player.dailyGoal.target, player.dailyReputation);
  const completedGoalNow = !player.dailyGoal.complete && player.dailyGoal.progress >= player.dailyGoal.target;
  if (completedGoalNow) {
    player.dailyGoal.complete = true;
    player.cash += 5000;
  }
  const now = new Date().toISOString();
  player.lastAction = { name: String(body.action), message: action.message, at: now };
  player.history.push({ day: player.day, name: String(body.action), message: action.message, at: now });
  const players = await readJson(playersPath, []);
  await writeJson(playersPath, players.map((entry) => entry.id === player.id ? player : entry));
  const bonus = completedGoalNow ? ' Daily goal complete: +UGX 5,000.' : '';
  publishWorldActivity({ id: randomUUID(), playerId: player.id, playerName: player.name, action: String(body.action), message: action.message + bonus, at: now });
  json(res, 200, { player: publicPlayer(player), game: publicGame(player), event: action.message + bonus });
}

async function endDay(req, res) {
  const player = await authenticate(req);
  if (!player) return json(res, 401, { error: 'Sign in to end your day.' });
  if (player.actionsToday === 0) return json(res, 400, { error: 'Make at least one move before ending the day.' });
  const completedGoal = player.dailyGoal.complete;
  player.day += 1;
  player.actionsToday = 0;
  player.dailyReputation = 0;
  player.energy = Math.min(100, player.energy + 15);
  player.dailyGoal = { title: 'Build your network', description: 'Earn 3 reputation today', target: dailyGoalTarget, progress: 0, complete: false };
  const summary = completedGoal
    ? `You completed your goal and rested well. Day ${player.day} begins with a clear head.`
    : `Day ${player.day} begins. Your next goal is waiting across Kampala.`;
  player.lastAction = { name: 'New day', message: summary, at: new Date().toISOString() };
  const players = await readJson(playersPath, []);
  await writeJson(playersPath, players.map((entry) => entry.id === player.id ? player : entry));
  publishWorldActivity({ id: randomUUID(), playerId: player.id, playerName: player.name, action: 'New day', message: summary, at: player.lastAction.at });
  json(res, 200, { player: publicPlayer(player), game: publicGame(player), event: summary });
}

async function persistPosition(playerId, position) {
  const players = await readJson(playersPath, []);
  await writeJson(playersPath, players.map((entry) => entry.id === playerId ? { ...entry, position } : entry));
}

function validPosition(value) {
  const x = Number(value?.x);
  const y = Number(value?.y);
  return Number.isFinite(x) && Number.isFinite(y)
    ? { x: Math.max(0, Math.min(worldWidth, x)), y: Math.max(0, Math.min(worldHeight, y)) }
    : null;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function publishWorldActivity(activity) {
  worldActivities.push(activity);
  if (worldActivities.length > 20) worldActivities.shift();
  realtimeHub.publish(districtRoom, 'world:activity', activity);
}

function contentType(path) {
  return ({ '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' })[extname(path)] || 'application/octet-stream';
}

async function serveStatic(req, res) {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const requested = normalize(pathname === '/' ? '/index.html' : pathname).replace(/^\.\.(\/|\\)/, '');
  const path = join(root, requested);
  if (!path.startsWith(root)) return json(res, 403, { error: 'forbidden' });
  try {
    const content = await readFile(path);
    res.writeHead(200, { 'content-type': contentType(path), 'cache-control': 'no-store' });
    res.end(content);
  } catch {
    json(res, 404, { error: 'not found' });
  }
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && (req.url === '/api/health' || req.url === '/health/live')) return json(res, 200, { status: 'ok' });
    if (req.method === 'POST' && req.url === '/api/auth/signup') return await auth(req, res, 'signup');
    if (req.method === 'POST' && req.url === '/api/auth/login') return await auth(req, res, 'login');
    if (req.method === 'POST' && req.url === '/api/auth/logout') return await logout(req, res);
    if (req.method === 'GET' && req.url === '/api/me') {
      const player = await authenticate(req);
      return player ? json(res, 200, { player: publicPlayer(player), game: publicGame(player) }) : json(res, 401, { error: 'Not signed in.' });
    }
    if (req.method === 'POST' && req.url === '/api/actions') return await performAction(req, res);
    if (req.method === 'POST' && req.url === '/api/day/end') return await endDay(req, res);
    if (req.method === 'GET') return await serveStatic(req, res);
    json(res, 404, { error: 'not found' });
  } catch (error) {
    json(res, error instanceof SyntaxError ? 400 : 500, { error: error instanceof SyntaxError ? 'Invalid JSON.' : 'Request failed.' });
  }
});

const realtimeHub = new ChannelHub();
const realtimeServer = new StreetWebSocketServer({ path: '/ws', heartbeatIntervalMs: 30_000 });
const connectedPlayers = new Map();

realtimeServer.attach(server, (socket, req) => {
  authenticate(req).then((player) => {
    if (!player) {
      socket.close(1008, 'Sign in required');
      return;
    }

    const position = validPosition(player.position) || { x: 500, y: 300 };
    realtimeHub.bind(socket);
    realtimeHub.join(districtRoom, player.id, socket);
    socket.emit('world:snapshot', {
      room: districtRoom,
      players: [...connectedPlayers.values()].map((entry) => publicPresence(entry)),
      self: publicPresence({ ...player, position }),
      activities: worldActivities.slice(-8).reverse(),
    });
    connectedPlayers.set(player.id, { ...player, position, socket });
    realtimeHub.publish(districtRoom, 'player:joined', publicPresence({ ...player, position }), { exceptMemberId: player.id });

    socket.on('player:move', async (payload) => {
      const current = connectedPlayers.get(player.id);
      const next = validPosition(payload);
      if (!current || !next || distance(current.position, next) > maxMoveDistance) {
        socket.emit('player:move:rejected', { reason: 'Move is too far or invalid.', position: current?.position || position });
        return;
      }
      current.position = next;
      await persistPosition(player.id, next);
      const movement = { id: player.id, name: player.name, position: next };
      socket.emit('player:moved', movement);
      realtimeHub.publish(districtRoom, 'player:moved', movement, { exceptMemberId: player.id });
    });

    socket.onClose(() => {
      connectedPlayers.delete(player.id);
      realtimeHub.publish(districtRoom, 'player:left', { id: player.id }, { exceptMemberId: player.id });
    });
  }).catch(() => socket.close(1011, 'Authentication failed'));
});

await initializeStore();
server.listen(port, () => console.log(`[kampala-life] listening on http://localhost:${port}`));
