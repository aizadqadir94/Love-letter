const assert = require('assert');
const http = require('http');
const {
  makeDeck,
  createRoom,
  addPlayer,
  startRound,
  playCard,
  serializeState,
} = require('../game');
const { server, rooms } = require('../server');

function countBy(deck, keyFn) {
  return deck.reduce((acc, card) => {
    const key = keyFn(card);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function setCard(player, rank, code = String(rank)) {
  player.hand = [{
    id: `test-${player.id}-${rank}-${Math.random()}`,
    code,
    rank,
    suit: '♠',
    face: `${code}♠`,
    role: rank === 1 ? 'Guard' : ({2:'Priest',3:'Baron',4:'Handmaid',5:'Prince',6:'King',7:'Countess',8:'Princess'}[rank]),
    title: '',
    text: '',
  }];
  return player.hand[0];
}

function addCard(player, rank, code = String(rank)) {
  const card = {
    id: `test-${player.id}-${rank}-${Math.random()}`,
    code,
    rank,
    suit: '♠',
    face: `${code}♠`,
    role: rank === 1 ? 'Guard' : ({2:'Priest',3:'Baron',4:'Handmaid',5:'Prince',6:'King',7:'Countess',8:'Princess'}[rank]),
    title: '',
    text: '',
  };
  player.hand.push(card);
  return card;
}

function makePlayingRoom() {
  const room = createRoom('TEST1', 'Aizad');
  const p2 = addPlayer(room, 'Friend');
  const host = room.players[0];
  startRound(room, host.id);
  room.deck = [];
  room.status = 'playing';
  room.turnIndex = 0;
  host.alive = true;
  p2.alive = true;
  host.protected = false;
  p2.protected = false;
  host.discards = [];
  p2.discards = [];
  host.privateNotice = null;
  p2.privateNotice = null;
  return { room, host, p2 };
}

async function request(baseUrl, path, method = 'GET', body = null) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'HTTP error');
  return data;
}

async function runHttpTest() {
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    const created = await request(base, '/api/create', 'POST', { name: 'Host' });
    assert.ok(created.roomCode);
    assert.ok(created.playerId);

    const joined = await request(base, '/api/join', 'POST', { roomCode: created.roomCode, name: 'Guest' });
    assert.ok(joined.playerId);

    const action = await request(base, '/api/action', 'POST', {
      roomCode: created.roomCode,
      playerId: created.playerId,
      action: 'startRound',
    });
    assert.strictEqual(action.state.status, 'playing');
    assert.strictEqual(action.state.players.length, 2);
    assert.ok(action.state.deckCount >= 0);
  } finally {
    rooms.clear();
    await new Promise((resolve) => server.close(resolve));
  }
}

function runUnitTests() {
  const deck = makeDeck();
  assert.strictEqual(deck.length, 23, 'custom deck should have 23 cards');
  const ranks = countBy(deck, (card) => card.rank);
  assert.strictEqual(ranks[1], 6, 'A/J guards should total 6');
  assert.strictEqual(ranks[2], 3);
  assert.strictEqual(ranks[3], 3);
  assert.strictEqual(ranks[4], 3);
  assert.strictEqual(ranks[5], 3);
  assert.strictEqual(ranks[6], 2);
  assert.strictEqual(ranks[7], 2);
  assert.strictEqual(ranks[8], 1);

  {
    const { room, host } = makePlayingRoom();
    host.hand = [];
    addCard(host, 7);
    const prince = addCard(host, 5);
    room.deck = [setCard(room.players[1], 2)];
    assert.throws(() => playCard(room, host.id, { cardId: prince.id, targetId: host.id }), /Countess rule/);
  }

  {
    const { room, host, p2 } = makePlayingRoom();
    host.hand = [];
    const guard = addCard(host, 1, 'A');
    addCard(host, 2);
    setCard(p2, 8);
    room.deck = [setCard({ id: 'deck' }, 2)];
    playCard(room, host.id, { cardId: guard.id, targetId: p2.id, guessRank: 8 });
    assert.strictEqual(p2.alive, false, 'correct Guard guess should eliminate target');
  }

  {
    const { room, host, p2 } = makePlayingRoom();
    host.hand = [];
    const guard = addCard(host, 1, 'J');
    addCard(host, 2);
    setCard(p2, 8);
    p2.protected = true;
    room.deck = [setCard({ id: 'deck' }, 2)];
    playCard(room, host.id, { cardId: guard.id, targetId: p2.id, guessRank: 8 });
    assert.strictEqual(p2.alive, true, 'Guard should fizzle when every opponent is protected');
  }

  {
    const { room, host, p2 } = makePlayingRoom();
    host.hand = [];
    const prince = addCard(host, 5);
    addCard(host, 2);
    setCard(p2, 8);
    room.deck = [setCard({ id: 'deck' }, 2)];
    playCard(room, host.id, { cardId: prince.id, targetId: p2.id });
    assert.strictEqual(p2.alive, false, 'Prince forcing Princess discard should eliminate target');
  }



  {
    const { room, host, p2 } = makePlayingRoom();
    host.hand = [];
    const baron = addCard(host, 3);
    addCard(host, 4);
    setCard(p2, 4);
    room.deck = [setCard({ id: 'deck' }, 2)];
    playCard(room, host.id, { cardId: baron.id, targetId: p2.id });
    assert.strictEqual(host.alive, true, 'Baron draw should not eliminate actor');
    assert.strictEqual(p2.alive, true, 'Baron draw should not eliminate target');
    assert.ok(room.logs.some((log) => log.type === 'baron-draw' && /Draw/.test(log.message)), 'Baron draw should be visible in log');
  }

  {
    const { room, host, p2 } = makePlayingRoom();
    host.hand = [];
    const priest = addCard(host, 2);
    addCard(host, 5);
    setCard(p2, 6);
    room.deck = [setCard({ id: 'deck' }, 2)];
    playCard(room, host.id, { cardId: priest.id, targetId: p2.id });
    const hostState = serializeState(room, host.id);
    const guestState = serializeState(room, p2.id);
    assert.match(hostState.privateNotice, /6/);
    assert.ok(!guestState.privateNotice, 'Priest information must remain private');
  }
}

(async () => {
  runUnitTests();
  await runHttpTest();
  console.log('All tests passed.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
