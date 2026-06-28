const crypto = require('crypto');

const MAX_PLAYERS = 6;

const CARD_INFO = {
  1: {
    role: 'Guard',
    title: 'Guard',
    text: 'Guess another player’s card. You cannot guess Guard.',
    needsTarget: true,
    canTargetSelf: false,
    needsGuess: true,
  },
  2: {
    role: 'Priest',
    title: 'Priest',
    text: 'Look at another player’s hand.',
    needsTarget: true,
    canTargetSelf: false,
  },
  3: {
    role: 'Baron',
    title: 'Baron',
    text: 'Compare hands. Lower card is eliminated.',
    needsTarget: true,
    canTargetSelf: false,
  },
  4: {
    role: 'Handmaid',
    title: 'Handmaid',
    text: 'You are protected until your next turn.',
    needsTarget: false,
  },
  5: {
    role: 'Prince',
    title: 'Prince',
    text: 'Choose any player. They discard and draw a new card.',
    needsTarget: true,
    canTargetSelf: true,
  },
  6: {
    role: 'King',
    title: 'King',
    text: 'Trade hands with another player.',
    needsTarget: true,
    canTargetSelf: false,
  },
  7: {
    role: 'Countess',
    title: 'Countess',
    text: 'Must be played if held with a 5 or 6.',
    needsTarget: false,
  },
  8: {
    role: 'Princess',
    title: 'Princess',
    text: 'If you discard or play this card, you are eliminated.',
    needsTarget: false,
  },
};

const SUITS = ['♠', '♥', '♦', '♣'];

function newId(prefix = '') {
  return `${prefix}${crypto.randomUUID().slice(0, 8)}`;
}

function normalizeName(name) {
  const clean = String(name || '').replace(/\s+/g, ' ').trim();
  return clean.slice(0, 24) || 'Player';
}

function generateRoomCode(existingCodes = new Set()) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    let code = '';
    for (let i = 0; i < 5; i += 1) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    if (!existingCodes.has(code)) return code;
  }
  throw new Error('Could not generate room code.');
}

function makeCard(code, rank, suit, copyIndex) {
  return {
    id: `${code}-${copyIndex}-${newId()}`,
    code,
    rank,
    suit,
    face: `${code}${suit}`,
    role: CARD_INFO[rank].role,
    title: CARD_INFO[rank].title,
    text: CARD_INFO[rank].text,
  };
}

function makeDeck() {
  const deck = [];
  const add = (code, rank, count) => {
    for (let i = 0; i < count; i += 1) deck.push(makeCard(code, rank, SUITS[i], i));
  };

  add('A', 1, 3);
  add('J', 1, 3);
  add('2', 2, 3);
  add('3', 3, 3);
  add('4', 4, 3);
  add('5', 5, 3);
  add('6', 6, 2);
  add('7', 7, 2);
  add('8', 8, 1);

  return deck;
}

function shuffle(deck, rng = Math.random) {
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function publicCard(card) {
  if (!card) return null;
  return {
    id: card.id,
    code: card.code,
    face: card.face,
    rank: card.rank,
    role: card.role,
    title: card.title,
    text: card.text,
  };
}

function canStart(room) {
  return room.players.length >= 2 && room.players.length <= MAX_PLAYERS;
}

function targetScore(playerCount) {
  if (playerCount <= 2) return 7;
  if (playerCount === 3) return 5;
  if (playerCount === 4) return 4;
  return 3;
}

function createRoom(code, hostName) {
  const host = createPlayer(hostName, true);
  return {
    code,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'lobby',
    players: [host],
    hostId: host.id,
    deck: [],
    burn: null,
    publicBurn: [],
    turnIndex: 0,
    roundNumber: 0,
    logs: [],
    eventCounter: 0,
    roundResult: null,
    gameWinnerIds: [],
  };
}

function createPlayer(name, isHost = false) {
  return {
    id: newId('p_'),
    name: normalizeName(name),
    score: 0,
    hand: [],
    discards: [],
    alive: true,
    protected: false,
    eliminatedReason: '',
    isHost,
    connected: true,
    privateNotice: null,
  };
}

function addPlayer(room, name) {
  if (room.status !== 'lobby') throw new Error('This room is already playing. Join before the game starts.');
  if (room.players.length >= MAX_PLAYERS) throw new Error(`This room is full. Maximum ${MAX_PLAYERS} players.`);
  const player = createPlayer(name, false);
  room.players.push(player);
  addLog(room, 'join', `${player.name} joined the room.`);
  touch(room);
  return player;
}

function findPlayer(room, playerId) {
  return room.players.find((p) => p.id === playerId);
}

function assertHost(room, playerId) {
  if (room.hostId !== playerId) throw new Error('Only the host can do that.');
}

function touch(room) {
  room.updatedAt = Date.now();
}

function addLog(room, type, message, extra = {}) {
  room.eventCounter += 1;
  const event = {
    id: room.eventCounter,
    type,
    message,
    at: Date.now(),
    ...extra,
  };
  room.logs.push(event);
  if (room.logs.length > 80) room.logs.shift();
  return event;
}

function drawCard(room) {
  return room.deck.pop() || null;
}

function drawTo(room, player) {
  const card = drawCard(room);
  if (card) player.hand.push(card);
  return card;
}

function discardCard(player, card, reason = '') {
  if (!card) return;
  player.discards.push({ ...card, discardedAt: Date.now(), reason });
}

function resetRoundPlayer(player) {
  player.hand = [];
  player.discards = [];
  player.alive = true;
  player.protected = false;
  player.eliminatedReason = '';
  player.privateNotice = null;
}

function startNewGame(room, playerId) {
  assertHost(room, playerId);
  room.players.forEach((player) => {
    player.score = 0;
  });
  room.roundNumber = 0;
  room.status = 'lobby';
  room.gameWinnerIds = [];
  room.roundResult = null;
  room.logs = [];
  room.eventCounter = 0;
  addLog(room, 'system', 'New game created.');
  touch(room);
}

function startRound(room, playerId) {
  assertHost(room, playerId);
  if (!canStart(room)) throw new Error(`Start requires 2–${MAX_PLAYERS} players.`);

  room.roundNumber += 1;
  room.status = 'playing';
  room.roundResult = null;
  room.gameWinnerIds = [];
  room.deck = shuffle(makeDeck());
  room.burn = drawCard(room);
  room.publicBurn = [];
  room.logs = [];
  room.eventCounter = 0;

  if (room.players.length === 2) {
    for (let i = 0; i < 3; i += 1) {
      const card = drawCard(room);
      if (card) room.publicBurn.push(card);
    }
  }

  room.players.forEach((player) => {
    resetRoundPlayer(player);
    drawTo(room, player);
  });

  room.turnIndex = (room.roundNumber - 1) % room.players.length;
  addLog(room, 'round', `Round ${room.roundNumber} started.`);
  beginTurn(room);
  touch(room);
}

function getActivePlayer(room) {
  if (room.status !== 'playing') return null;
  return room.players[room.turnIndex] || null;
}

function countAlive(room) {
  return room.players.filter((p) => p.alive).length;
}

function alivePlayers(room) {
  return room.players.filter((p) => p.alive);
}

function beginTurn(room) {
  if (room.status !== 'playing') return;
  if (countAlive(room) <= 1) {
    endRoundByElimination(room);
    return;
  }

  let active = getActivePlayer(room);
  if (!active || !active.alive) {
    advanceTurn(room, false);
    return;
  }

  if (room.deck.length === 0) {
    endRoundByDeck(room);
    return;
  }

  active.protected = false;
  active.privateNotice = null;
  drawTo(room, active);
  addLog(room, 'turn', `${active.name} is choosing a card.`);
}

function advanceTurn(room, shouldBegin = true) {
  if (room.status !== 'playing') return;
  if (countAlive(room) <= 1) {
    endRoundByElimination(room);
    return;
  }
  if (room.deck.length === 0) {
    endRoundByDeck(room);
    return;
  }

  const total = room.players.length;
  for (let step = 1; step <= total; step += 1) {
    const index = (room.turnIndex + step) % total;
    if (room.players[index].alive) {
      room.turnIndex = index;
      if (shouldBegin) beginTurn(room);
      return;
    }
  }
  endRoundByElimination(room);
}

function hasCountessForce(player) {
  const ranks = player.hand.map((card) => card.rank);
  return ranks.includes(7) && (ranks.includes(5) || ranks.includes(6));
}

function validTargets(room, activePlayer, cardRank) {
  return room.players.filter((player) => {
    if (!player.alive) return false;
    if (player.id === activePlayer.id) return CARD_INFO[cardRank].canTargetSelf === true;
    return !player.protected;
  });
}

function requireTarget(room, activePlayer, targetId, cardRank) {
  const targets = validTargets(room, activePlayer, cardRank);
  if (targets.length === 0) return null;
  const target = targets.find((p) => p.id === targetId);
  if (!target) throw new Error('Choose a valid target. Protected or eliminated players cannot be targeted.');
  return target;
}

function eliminate(room, player, reason, byPlayer = null) {
  if (!player.alive) return;
  player.alive = false;
  player.protected = false;
  player.eliminatedReason = reason;
  while (player.hand.length) discardCard(player, player.hand.pop(), 'Eliminated');
  const actor = byPlayer ? ` by ${byPlayer.name}` : '';
  addLog(room, 'elimination', `${player.name} was eliminated${actor}. ${reason}`, {
    playerId: player.id,
    byPlayerId: byPlayer ? byPlayer.id : null,
  });
}

function endRoundByElimination(room) {
  const survivors = alivePlayers(room);
  if (survivors.length === 1) {
    endRound(room, [survivors[0]], `${survivors[0].name} is the last player standing.`);
  } else {
    endRound(room, [], 'No players survived. No point awarded.');
  }
}

function discardTotal(player) {
  return player.discards.reduce((sum, card) => sum + (card.rank || 0), 0);
}

function endRoundByDeck(room) {
  const survivors = alivePlayers(room);
  if (survivors.length === 0) {
    endRound(room, [], 'The deck ran out and no players survived.');
    return;
  }
  const highest = Math.max(...survivors.map((p) => (p.hand[0] ? p.hand[0].rank : 0)));
  let candidates = survivors.filter((p) => p.hand[0] && p.hand[0].rank === highest);
  if (candidates.length > 1) {
    const bestDiscardTotal = Math.max(...candidates.map(discardTotal));
    candidates = candidates.filter((p) => discardTotal(p) === bestDiscardTotal);
  }
  const reveal = survivors.map((player) => ({
    playerId: player.id,
    name: player.name,
    card: publicCard(player.hand[0]),
    discardTotal: discardTotal(player),
  }));
  endRound(room, candidates, 'The deck ran out. Highest remaining card wins.', reveal);
}

function endRound(room, winners, reason, reveal = null) {
  winners.forEach((winner) => {
    winner.score += 1;
  });

  room.roundResult = {
    winnerIds: winners.map((p) => p.id),
    winnerNames: winners.map((p) => p.name),
    reason,
    reveal,
  };

  const scoreToWin = targetScore(room.players.length);
  const gameWinners = winners.filter((winner) => winner.score >= scoreToWin);
  if (gameWinners.length > 0) {
    room.status = 'game_over';
    room.gameWinnerIds = gameWinners.map((p) => p.id);
    addLog(room, 'game-over', `${gameWinners.map((p) => p.name).join(' and ')} won the game.`, {
      playerIds: room.gameWinnerIds,
    });
  } else {
    room.status = 'round_over';
    if (winners.length > 0) {
      addLog(room, 'round-win', `${winners.map((p) => p.name).join(' and ')} won the round.`, {
        playerIds: winners.map((p) => p.id),
      });
    } else {
      addLog(room, 'round-win', 'Round ended with no winner.');
    }
  }
  touch(room);
}

function playCard(room, playerId, payload = {}) {
  if (room.status !== 'playing') throw new Error('The round is not currently active.');
  const active = getActivePlayer(room);
  if (!active || active.id !== playerId) throw new Error('It is not your turn.');
  if (!active.alive) throw new Error('You are eliminated.');
  if (active.hand.length < 2) throw new Error('Wait until your turn card is drawn.');

  const { cardId, targetId, guessRank } = payload;
  const cardIndex = active.hand.findIndex((card) => card.id === cardId);
  if (cardIndex === -1) throw new Error('Choose a card in your hand.');

  const card = active.hand[cardIndex];
  if (hasCountessForce(active) && card.rank !== 7) {
    throw new Error('Countess rule: if you hold a 7 with a 5 or 6, you must play the 7.');
  }

  const info = CARD_INFO[card.rank];
  const targets = validTargets(room, active, card.rank);
  if (info.needsGuess) {
    const guess = Number(guessRank);
    if (!Number.isInteger(guess) || guess < 2 || guess > 8) throw new Error('Guard must guess 2, 3, 4, 5, 6, 7, or 8.');
  }
  if (info.needsTarget && targets.length > 0) {
    const princeSelfDefault = card.rank === 5 && !targetId;
    if (!princeSelfDefault && !targets.some((target) => target.id === targetId)) {
      throw new Error('Choose a valid target. Protected or eliminated players cannot be targeted.');
    }
  }

  active.hand.splice(cardIndex, 1);
  discardCard(active, card, 'Played');
  resolvePlayedCard(room, active, card, { targetId, guessRank });

  if (room.status !== 'playing') return;
  if (countAlive(room) <= 1) {
    endRoundByElimination(room);
    return;
  }
  if (room.deck.length === 0) {
    endRoundByDeck(room);
    return;
  }
  advanceTurn(room, true);
  touch(room);
}

function addPlayLog(room, active, card) {
  addLog(room, 'play', `${active.name} played ${card.face} (${card.role}).`, {
    actorId: active.id,
    actorName: active.name,
    card: publicCard(card),
  });
}

function actionPhrase(active, card, target = null) {
  const targetText = target ? ` on ${target.name}` : '';
  return `${active.name} used ${card.face} (${card.role})${targetText}.`;
}

function addTargetLog(room, type, message, active, target, card, extra = {}) {
  addLog(room, type, message, {
    actorId: active.id,
    actorName: active.name,
    targetId: target ? target.id : null,
    targetName: target ? target.name : null,
    card: publicCard(card),
    ...extra,
  });
}

function resolvePlayedCard(room, active, card, payload) {
  const rank = card.rank;
  addPlayLog(room, active, card);

  if (rank === 8) {
    addTargetLog(room, 'princess-played', `${actionPhrase(active, card)} The Princess was played, so ${active.name} is eliminated.`, active, active, card);
    eliminate(room, active, 'The Princess was played or discarded.', active);
    return;
  }

  if (rank === 7) {
    addTargetLog(room, 'countess', `${actionPhrase(active, card)} No effect.`, active, null, card);
    return;
  }

  if (rank === 4) {
    active.protected = true;
    addTargetLog(room, 'protected', `${actionPhrase(active, card)} ${active.name} is protected until their next turn.`, active, active, card);
    return;
  }

  if (rank === 1) {
    const targets = validTargets(room, active, rank);
    if (targets.length === 0) {
      addTargetLog(room, 'no-target', `${actionPhrase(active, card)} There was no valid target.`, active, null, card);
      return;
    }
    const target = requireTarget(room, active, payload.targetId, rank);
    const guess = Number(payload.guessRank);
    const targetCard = target.hand[0];
    if (targetCard && targetCard.rank === guess) {
      addTargetLog(room, 'guard-hit', `${actionPhrase(active, card, target)} ${active.name} guessed ${guess}. Correct.`, active, target, card, { guessRank: guess });
      eliminate(room, target, `Guard guessed ${guess}.`, active);
    } else {
      addTargetLog(room, 'guard-miss', `${actionPhrase(active, card, target)} ${active.name} guessed ${guess}. Wrong.`, active, target, card, { guessRank: guess });
    }
    return;
  }

  if (rank === 2) {
    const targets = validTargets(room, active, rank);
    if (targets.length === 0) {
      addTargetLog(room, 'no-target', `${actionPhrase(active, card)} There was no valid target.`, active, null, card);
      return;
    }
    const target = requireTarget(room, active, payload.targetId, rank);
    const seen = target.hand[0];
    active.privateNotice = seen
      ? `You looked at ${target.name}: ${seen.face} (${seen.role}).`
      : `You looked at ${target.name}: no card.`;
    addTargetLog(room, 'private-effect', `${actionPhrase(active, card, target)} Only ${active.name} saw the card.`, active, target, card);
    return;
  }

  if (rank === 3) {
    const targets = validTargets(room, active, rank);
    if (targets.length === 0) {
      addTargetLog(room, 'no-target', `${actionPhrase(active, card)} There was no valid target.`, active, null, card);
      return;
    }
    const target = requireTarget(room, active, payload.targetId, rank);
    const activeCard = active.hand[0];
    const targetCard = target.hand[0];
    if (!activeCard || !targetCard) {
      addTargetLog(room, 'baron-draw', `${actionPhrase(active, card, target)} Comparison failed because a player had no card.`, active, target, card);
      return;
    }
    if (activeCard.rank > targetCard.rank) {
      addTargetLog(room, 'baron-result', `${actionPhrase(active, card, target)} ${target.name} had the lower card.`, active, target, card, { outcome: 'target-eliminated' });
      eliminate(room, target, 'Lost a Baron comparison.', active);
    } else if (activeCard.rank < targetCard.rank) {
      addTargetLog(room, 'baron-result', `${actionPhrase(active, card, target)} ${active.name} had the lower card.`, active, target, card, { outcome: 'actor-eliminated' });
      eliminate(room, active, 'Lost a Baron comparison.', target);
    } else {
      addTargetLog(room, 'baron-draw', `${actionPhrase(active, card, target)} Draw: nobody was eliminated.`, active, target, card, { outcome: 'draw' });
    }
    return;
  }

  if (rank === 5) {
    let target = null;
    const targets = validTargets(room, active, rank);
    if (payload.targetId) target = targets.find((p) => p.id === payload.targetId);
    if (!target && !payload.targetId) target = active;
    if (!target) throw new Error('Choose a valid target for Prince.');

    const discarded = target.hand.pop();
    discardCard(target, discarded, 'Prince');
    if (discarded && discarded.rank === 8) {
      addTargetLog(room, 'prince-princess', `${actionPhrase(active, card, target)} ${target.name} discarded the Princess and is eliminated.`, active, target, card);
      eliminate(room, target, 'Discarded the Princess because of Prince.', active);
      return;
    }

    let replacement = drawCard(room);
    if (!replacement && room.burn) {
      replacement = room.burn;
      room.burn = null;
    }
    if (replacement) target.hand.push(replacement);
    addTargetLog(room, 'prince-redraw', `${actionPhrase(active, card, target)} ${target.name} discarded and drew a new card.`, active, target, card);
    return;
  }

  if (rank === 6) {
    const targets = validTargets(room, active, rank);
    if (targets.length === 0) {
      addTargetLog(room, 'no-target', `${actionPhrase(active, card)} There was no valid target.`, active, null, card);
      return;
    }
    const target = requireTarget(room, active, payload.targetId, rank);
    [active.hand, target.hand] = [target.hand, active.hand];
    active.privateNotice = `You traded hands with ${target.name}.`;
    target.privateNotice = `${active.name} traded hands with you.`;
    addTargetLog(room, 'king-trade', `${actionPhrase(active, card, target)} They traded hands.`, active, target, card);
  }
}

function serializeState(room, viewerId) {
  const viewer = findPlayer(room, viewerId);
  const active = getActivePlayer(room);
  const scoreToWin = targetScore(room.players.length || 2);
  const activeCardInfo = viewer && active && viewer.id === active.id && viewer.hand.length === 2
    ? viewer.hand.map((card) => publicCard(card))
    : null;

  return {
    code: room.code,
    status: room.status,
    roundNumber: room.roundNumber,
    targetScore: scoreToWin,
    canStart: canStart(room),
    hostId: room.hostId,
    isHost: viewer ? viewer.id === room.hostId : false,
    viewerId,
    deckCount: room.deck.length,
    publicBurn: room.publicBurn.map(publicCard),
    activePlayerId: active ? active.id : null,
    activePlayerName: active ? active.name : null,
    mustPlayCountess: viewer ? hasCountessForce(viewer) && viewer.id === (active && active.id) : false,
    privateNotice: viewer ? viewer.privateNotice : null,
    roundResult: room.roundResult,
    gameWinnerIds: room.gameWinnerIds,
    currentHand: activeCardInfo || (viewer ? viewer.hand.map(publicCard) : []),
    ownHand: viewer ? viewer.hand.map(publicCard) : [],
    cards: CARD_INFO,
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      score: player.score,
      alive: player.alive,
      protected: player.protected,
      eliminatedReason: player.eliminatedReason,
      isHost: player.id === room.hostId,
      connected: player.connected,
      handCount: player.hand.length,
      isYou: player.id === viewerId,
      discardTotal: discardTotal(player),
      discards: player.discards.map(publicCard),
      visibleHand: (room.status === 'round_over' || room.status === 'game_over')
        ? player.hand.map(publicCard)
        : (player.id === viewerId ? player.hand.map(publicCard) : []),
    })),
    validTargets: viewer && active && viewer.id === active.id && viewer.hand.length === 2
      ? Object.fromEntries(viewer.hand.map((card) => [card.id, validTargets(room, viewer, card.rank).map((p) => p.id)]))
      : {},
    logs: room.logs,
  };
}

module.exports = {
  MAX_PLAYERS,
  CARD_INFO,
  makeDeck,
  shuffle,
  createRoom,
  addPlayer,
  findPlayer,
  startRound,
  startNewGame,
  playCard,
  serializeState,
  targetScore,
  hasCountessForce,
  validTargets,
  eliminate,
  endRoundByDeck,
};
