const http = require('http');
const fs = require('fs');
const path = require('path');
const {
  createRoom,
  addPlayer,
  findPlayer,
  startRound,
  startNewGame,
  playCard,
  serializeState,
} = require('./game');

const PORT = process.env.PORT || 3000;
const STATIC_DIR = path.join(__dirname, 'static');
const rooms = new Map();
const connections = new Map();

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error('Request body too large.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error('Invalid JSON request.'));
      }
    });
    req.on('error', reject);
  });
}

function roomCodeFrom(input) {
  return String(input || '').trim().toUpperCase();
}

function getRoom(code) {
  const room = rooms.get(roomCodeFrom(code));
  if (!room) throw new Error('Room not found. Check the room code.');
  return room;
}

function existingCodes() {
  return new Set(rooms.keys());
}

function generateCode() {
  const { generateRoomCode } = require('./room-code');
  return generateRoomCode(existingCodes());
}

function broadcast(room) {
  const set = connections.get(room.code);
  if (!set) return;
  for (const conn of Array.from(set)) {
    try {
      conn.res.write(`data: ${JSON.stringify(serializeState(room, conn.playerId))}\n\n`);
    } catch (_) {
      set.delete(conn);
    }
  }
}

function markConnected(room, playerId, connected) {
  const player = findPlayer(room, playerId);
  if (player) player.connected = connected;
}

function cleanupOldRooms() {
  const now = Date.now();
  const maxAge = 1000 * 60 * 60 * 12;
  for (const [code, room] of rooms.entries()) {
    if (now - room.updatedAt > maxAge) {
      rooms.delete(code);
      connections.delete(code);
    }
  }
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.json') return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

function serveStatic(req, res, pathname) {
  const safePath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(STATIC_DIR, safePath));
  if (!filePath.startsWith(STATIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      fs.readFile(path.join(STATIC_DIR, 'index.html'), (indexErr, indexData) => {
        if (indexErr) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(indexData);
      });
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType(filePath),
      'Cache-Control': 'public, max-age=60',
    });
    res.end(data);
  });
}

async function handleApi(req, res, url) {
  try {
    if (req.method === 'POST' && url.pathname === '/api/create') {
      const body = await readBody(req);
      const code = generateCode();
      const room = createRoom(code, body.name);
      rooms.set(code, room);
      sendJson(res, 200, { roomCode: code, playerId: room.hostId, state: serializeState(room, room.hostId) });
      broadcast(room);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/join') {
      const body = await readBody(req);
      const room = getRoom(body.roomCode);
      const player = addPlayer(room, body.name);
      sendJson(res, 200, { roomCode: room.code, playerId: player.id, state: serializeState(room, player.id) });
      broadcast(room);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/state') {
      const room = getRoom(url.searchParams.get('room'));
      const playerId = url.searchParams.get('player');
      sendJson(res, 200, { state: serializeState(room, playerId) });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/action') {
      const body = await readBody(req);
      const room = getRoom(body.roomCode);
      const playerId = body.playerId;
      const player = findPlayer(room, playerId);
      if (!player) throw new Error('Player not found in this room.');

      if (body.action === 'startRound') startRound(room, playerId);
      else if (body.action === 'nextRound') startRound(room, playerId);
      else if (body.action === 'newGame') startNewGame(room, playerId);
      else if (body.action === 'playCard') playCard(room, playerId, body.payload || {});
      else throw new Error('Unknown action.');

      sendJson(res, 200, { state: serializeState(room, playerId) });
      broadcast(room);
      return;
    }

    sendJson(res, 404, { error: 'API route not found.' });
  } catch (error) {
    sendJson(res, 400, { error: error.message || 'Something went wrong.' });
  }
}

function handleEvents(req, res, url) {
  try {
    const room = getRoom(url.searchParams.get('room'));
    const playerId = url.searchParams.get('player');
    if (!findPlayer(room, playerId)) throw new Error('Player not found.');

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const conn = { res, playerId };
    if (!connections.has(room.code)) connections.set(room.code, new Set());
    connections.get(room.code).add(conn);
    markConnected(room, playerId, true);
    res.write(`data: ${JSON.stringify(serializeState(room, playerId))}\n\n`);
    broadcast(room);

    const heartbeat = setInterval(() => {
      try {
        res.write(': heartbeat\n\n');
      } catch (_) {
        clearInterval(heartbeat);
      }
    }, 25000);

    req.on('close', () => {
      clearInterval(heartbeat);
      const set = connections.get(room.code);
      if (set) set.delete(conn);
      const stillConnected = set && Array.from(set).some((c) => c.playerId === playerId);
      if (!stillConnected) markConnected(room, playerId, false);
      broadcast(room);
    });
  } catch (error) {
    sendJson(res, 400, { error: error.message || 'Could not open event stream.' });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (url.pathname === '/events') {
    handleEvents(req, res, url);
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url);
    return;
  }

  serveStatic(req, res, url.pathname);
});

setInterval(cleanupOldRooms, 1000 * 60 * 30).unref();

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Love Letter Online running on http://localhost:${PORT}`);
  });
}

module.exports = { server, rooms, connections };
