const els = {
  entryPanel: document.getElementById('entryPanel'),
  gamePanel: document.getElementById('gamePanel'),
  nameInput: document.getElementById('nameInput'),
  roomInput: document.getElementById('roomInput'),
  createButton: document.getElementById('createButton'),
  joinButton: document.getElementById('joinButton'),
  roomPill: document.getElementById('roomPill'),
  roomCodeLabel: document.getElementById('roomCodeLabel'),
  copyLinkButton: document.getElementById('copyLinkButton'),
  statusEyebrow: document.getElementById('statusEyebrow'),
  mainStatus: document.getElementById('mainStatus'),
  turnPrompt: document.getElementById('turnPrompt'),
  latestAction: document.getElementById('latestAction'),
  hostControls: document.getElementById('hostControls'),
  playersGrid: document.getElementById('playersGrid'),
  roundResult: document.getElementById('roundResult'),
  handTitle: document.getElementById('handTitle'),
  privateNotice: document.getElementById('privateNotice'),
  countessWarning: document.getElementById('countessWarning'),
  hand: document.getElementById('hand'),
  actionBox: document.getElementById('actionBox'),
  actionHint: document.getElementById('actionHint'),
  guessLabel: document.getElementById('guessLabel'),
  guessSelect: document.getElementById('guessSelect'),
  playButton: document.getElementById('playButton'),
  rulesList: document.getElementById('rulesList'),
  deckCount: document.getElementById('deckCount'),
  publicBurn: document.getElementById('publicBurn'),
  toastZone: document.getElementById('toastZone'),
  spotlight: document.getElementById('spotlight'),
};

const storage = {
  name: 'normalLoveLetter.name',
  room: 'normalLoveLetter.room',
  player: 'normalLoveLetter.player',
};

let state = null;
let eventSource = null;
let selectedCardId = null;
let selectedTargetId = null;
let lastEventId = 0;
let lastRoundKey = '';

const visibleActionTypes = [
  'guard-hit',
  'guard-miss',
  'private-effect',
  'baron-result',
  'baron-draw',
  'prince-redraw',
  'prince-princess',
  'king-trade',
  'protected',
  'countess',
  'princess-played',
  'no-target',
];

function getStoredSession() {
  const urlRoom = normalizeRoom(new URL(window.location.href).searchParams.get('room'));
  return {
    name: localStorage.getItem(storage.name) || '',
    roomCode: sessionStorage.getItem(storage.room) || urlRoom || '',
    playerId: sessionStorage.getItem(storage.player) || '',
  };
}

function saveSession({ name, roomCode, playerId }) {
  if (name) localStorage.setItem(storage.name, name);
  if (roomCode) sessionStorage.setItem(storage.room, roomCode);
  if (playerId) sessionStorage.setItem(storage.player, playerId);
}

function normalizeRoom(value) {
  return String(value || '').trim().toUpperCase();
}

function nameValue() {
  return els.nameInput.value.trim() || 'Player';
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) throw new Error(data.error || 'Request failed.');
  return data;
}

function showError(error) {
  showToast(error.message || String(error), 'error');
}

async function createRoom() {
  try {
    const name = nameValue();
    const data = await api('/api/create', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    saveSession({ name, roomCode: data.roomCode, playerId: data.playerId });
    setUrlRoom(data.roomCode);
    openStream(data.roomCode, data.playerId);
    applyState(data.state);
  } catch (error) {
    showError(error);
  }
}

async function joinRoom() {
  try {
    const name = nameValue();
    const roomCode = normalizeRoom(els.roomInput.value);
    if (!roomCode) throw new Error('Enter a room code.');
    const data = await api('/api/join', {
      method: 'POST',
      body: JSON.stringify({ name, roomCode }),
    });
    saveSession({ name, roomCode: data.roomCode, playerId: data.playerId });
    setUrlRoom(data.roomCode);
    openStream(data.roomCode, data.playerId);
    applyState(data.state);
  } catch (error) {
    showError(error);
  }
}

function setUrlRoom(roomCode) {
  const url = new URL(window.location.href);
  url.searchParams.set('room', roomCode);
  window.history.replaceState({}, '', url.toString());
}

function openStream(roomCode, playerId) {
  if (eventSource) eventSource.close();
  eventSource = new EventSource(`/events?room=${encodeURIComponent(roomCode)}&player=${encodeURIComponent(playerId)}`);
  eventSource.onmessage = (event) => {
    try {
      applyState(JSON.parse(event.data));
    } catch (error) {
      console.error(error);
    }
  };
  eventSource.onerror = () => {
    // EventSource reconnects automatically.
  };
}

async function sendAction(action, payload = {}) {
  if (!state) return;
  try {
    const session = getStoredSession();
    const data = await api('/api/action', {
      method: 'POST',
      body: JSON.stringify({
        roomCode: state.code || session.roomCode,
        playerId: state.viewerId || session.playerId,
        action,
        payload,
      }),
    });
    applyState(data.state);
  } catch (error) {
    showError(error);
  }
}

function applyState(nextState) {
  if (!nextState) return;
  const previous = state;
  state = nextState;

  els.entryPanel.hidden = true;
  els.gamePanel.hidden = false;
  els.roomPill.hidden = false;
  els.roomCodeLabel.textContent = state.code;

  renderStatus();
  renderHostControls();
  renderHand();
  renderPlayers();
  renderLog();
  handleNewEvents(previous, state);
}

function renderStatus() {
  const statusLabels = {
    lobby: 'Lobby',
    playing: 'Round active',
    round_over: 'Round over',
    game_over: 'Game over',
  };
  els.statusEyebrow.textContent = statusLabels[state.status] || state.status;

  if (state.status === 'lobby') {
    els.mainStatus.textContent = state.canStart ? 'Ready' : 'Waiting';
    els.turnPrompt.textContent = '';
  } else if (state.status === 'playing') {
    const isYou = state.activePlayerId === state.viewerId;
    els.mainStatus.textContent = isYou ? 'Your turn' : `${state.activePlayerName || 'Player'}’s turn`;
    els.turnPrompt.textContent = '';
  } else if (state.status === 'round_over') {
    els.mainStatus.textContent = `${state.roundResult?.winnerNames?.join(' and ') || 'Nobody'} won`;
    els.turnPrompt.textContent = '';
  } else if (state.status === 'game_over') {
    const names = state.players.filter((p) => state.gameWinnerIds.includes(p.id)).map((p) => p.name).join(' and ');
    els.mainStatus.textContent = `${names || 'A player'} won`;
    els.turnPrompt.textContent = '';
  }

  els.latestAction.textContent = '';

  els.roundResult.hidden = !state.roundResult;
  if (state.roundResult) {
    const reveal = state.roundResult.reveal?.length
      ? `<div class="reveal-list">${state.roundResult.reveal.map((item) => `${escapeHtml(item.name)}: <strong>${item.card?.face || '—'}</strong> (${item.card?.role || 'No card'})`).join(' · ')}</div>`
      : '';
    els.roundResult.innerHTML = `
      <strong>${escapeHtml(state.roundResult.reason || '')}</strong>
      ${reveal}
    `;
  }
}

function renderHostControls() {
  els.hostControls.innerHTML = '';
  if (!state.isHost) return;

  if (state.status === 'lobby') {
    const button = makeButton('Start round', 'primary', () => sendAction('startRound'));
    button.disabled = !state.canStart;
    els.hostControls.append(button);
  }

  if (state.status === 'round_over') {
    els.hostControls.append(makeButton('Next round', 'primary', () => sendAction('nextRound')));
  }

  if (state.status === 'game_over') {
    els.hostControls.append(makeButton('New game', 'primary', () => sendAction('newGame')));
  }
}

function makeButton(text, className, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = text;
  button.addEventListener('click', onClick);
  return button;
}

function renderPlayers() {
  const felt = els.playersGrid.querySelector('.table-felt');
  const center = els.playersGrid.querySelector('.table-center');
  const handZone = document.getElementById('tableHandZone');
  els.playersGrid.innerHTML = '';
  els.playersGrid.append(felt, center, handZone);

  const orderedPlayers = orderedSeatPlayers();
  const latest = latestInteractiveLog();
  const selectedCard = selectedCardFromState();
  const targetIds = selectedCard ? (state.validTargets?.[selectedCard.id] || []) : [];
  if (selectedTargetId && !targetIds.includes(selectedTargetId)) selectedTargetId = null;

  orderedPlayers.forEach((player, seatIndex) => {
    const pos = getSeatPosition(seatIndex, orderedPlayers.length);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'player-seat';
    button.style.left = `${pos.x}%`;
    button.style.top = `${pos.y}%`;

    const isTargetable = isMyTurn() && selectedCard && targetIds.includes(player.id);
    if (player.id === state.activePlayerId) button.classList.add('active');
    if (!player.alive && state.status !== 'lobby') button.classList.add('eliminated');
    if (player.isYou) button.classList.add('you', 'self-seat');
    if (isTargetable) button.classList.add('targetable');
    if (selectedTargetId === player.id) button.classList.add('target-selected');
    if (latest?.actorId === player.id) button.classList.add('recent-actor');
    if (latest?.targetId === player.id) button.classList.add('recent-target');

    const originalSeat = state.players.findIndex((p) => p.id === player.id) + 1;
    const scoreDots = Array.from({ length: state.targetScore }, (_, index) => (
      `<span class="dot ${index < player.score ? 'filled' : ''}"></span>`
    )).join('');

    const badges = [
      `<span class="badge seat-num">P${originalSeat}</span>`,
      player.isYou ? '<span class="badge blue">You</span>' : '',
      player.isHost ? '<span class="badge">Host</span>' : '',
      player.protected ? '<span class="badge ok">Protected</span>' : '',
      !player.connected ? '<span class="badge danger">Offline</span>' : '',
      isTargetable ? '<span class="badge target-badge">Tap target</span>' : '',
      selectedTargetId === player.id ? '<span class="badge target-badge">Selected</span>' : '',
    ].join('');

    const hiddenCards = Math.max(0, player.handCount || 0);
    const handPreview = player.visibleHand?.length
      ? `<div class="mini-cards">${player.visibleHand.map((c) => `<span class="mini-card revealed" title="${escapeHtml(c.role)}">${escapeHtml(c.face)}</span>`).join('')}</div>`
      : `<div class="mini-cards">${Array.from({ length: hiddenCards }, () => '<span class="mini-card">?</span>').join('')}</div>`;

    const discards = player.discards?.length
      ? `<div class="discard-row">${player.discards.slice(-3).map((c) => `<span class="mini-card revealed" title="${escapeHtml(c.role)}">${escapeHtml(c.face)}</span>`).join('')}</div>`
      : '';

    button.innerHTML = `
      <div class="player-top">
        <div>
          <div class="player-name">${escapeHtml(player.name)}</div>
          <div class="badges">${badges}</div>
        </div>
        <div class="score-dots" title="${player.score}/${state.targetScore}">${scoreDots}</div>
      </div>
      ${handPreview}
      ${discards}
    `;

    button.disabled = !isTargetable;
    button.addEventListener('click', () => {
      if (!isTargetable || !selectedCard) return;
      const info = state.cards[selectedCard.rank];
      const payload = { cardId: selectedCard.id, targetId: player.id };
      if (info.needsGuess) payload.guessRank = Number(els.guessSelect.value);
      selectedCardId = null;
      selectedTargetId = null;
      sendAction('playCard', payload);
    });

    els.playersGrid.append(button);
  });
}

function orderedSeatPlayers() {
  const players = state.players || [];
  const index = players.findIndex((player) => player.id === state.viewerId);
  if (index < 0) return players;
  return players.slice(index).concat(players.slice(0, index));
}

function getSeatPosition(index, count) {
  const maps = {
    1: [{ x: 50, y: 88 }],
    2: [{ x: 50, y: 88 }, { x: 50, y: 13 }],
    3: [{ x: 50, y: 88 }, { x: 21, y: 27 }, { x: 79, y: 27 }],
    4: [{ x: 50, y: 88 }, { x: 12, y: 50 }, { x: 50, y: 12 }, { x: 88, y: 50 }],
    5: [{ x: 50, y: 88 }, { x: 15, y: 68 }, { x: 24, y: 24 }, { x: 76, y: 24 }, { x: 85, y: 68 }],
    6: [{ x: 50, y: 88 }, { x: 14, y: 70 }, { x: 14, y: 30 }, { x: 50, y: 12 }, { x: 86, y: 30 }, { x: 86, y: 70 }],
  };
  return (maps[count] || maps[6])[index] || { x: 50, y: 50 };
}

function renderHand() {
  const mine = isMyTurn();
  const hand = state.ownHand || [];

  if (!hand.find((card) => card.id === selectedCardId)) {
    selectedCardId = null;
    selectedTargetId = null;
  }

  els.handTitle.textContent = '';
  els.handTitle.hidden = true;
  els.privateNotice.hidden = !state.privateNotice;
  els.privateNotice.textContent = state.privateNotice || '';
  els.countessWarning.hidden = !state.mustPlayCountess;
  els.hand.innerHTML = '';

  if (state.status === 'lobby') {
    selectedCardId = null;
    selectedTargetId = null;
    els.privateNotice.hidden = true;
    els.countessWarning.hidden = true;
    els.actionBox.hidden = true;
    els.guessLabel.hidden = true;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'primary lobby-start-button';
    if (state.isHost) {
      button.textContent = state.canStart ? 'START' : 'WAITING';
      button.disabled = !state.canStart;
      if (state.canStart) button.addEventListener('click', () => sendAction('startRound'));
    } else {
      button.textContent = 'WAITING';
      button.disabled = true;
    }
    els.hand.append(button);
    return;
  }

  if (state.status === 'round_over' || state.status === 'game_over') {
    selectedCardId = null;
    selectedTargetId = null;
    els.privateNotice.hidden = true;
    els.countessWarning.hidden = true;
    els.actionBox.hidden = true;
    els.guessLabel.hidden = true;

    if (state.isHost) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'primary lobby-start-button';
      button.textContent = state.status === 'game_over' ? 'NEW GAME' : 'NEXT ROUND';
      button.addEventListener('click', () => sendAction(state.status === 'game_over' ? 'newGame' : 'nextRound'));
      els.hand.append(button);
    }
    return;
  }

  for (const card of hand) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'playing-card';
    const blockedByCountess = state.mustPlayCountess && card.rank !== 7;
    if (mine && !blockedByCountess) button.classList.add('selectable');
    if (blockedByCountess) button.classList.add('blocked');
    if (card.id === selectedCardId) button.classList.add('selected');
    button.disabled = !mine || blockedByCountess;
    button.title = `${card.face} — ${card.role}`;
    button.innerHTML = `
      <div class="card-face"><span>${escapeHtml(card.face)}</span><span>${card.rank}</span></div>
    `;
    button.addEventListener('click', () => {
      if (!mine) return;
      if (state.mustPlayCountess && card.rank !== 7) return;

      selectedCardId = card.id;
      selectedTargetId = null;

      const info = state.cards[card.rank];
      const targetIds = state.validTargets?.[card.id] || [];

      if (!info.needsTarget || targetIds.length === 0) {
        const payload = { cardId: card.id };
        if (info.needsGuess) payload.guessRank = Number(els.guessSelect.value);
        selectedCardId = null;
        sendAction('playCard', payload);
        return;
      }

      if (card.rank === 5 && targetIds.length === 1 && targetIds[0] === state.viewerId) {
        selectedCardId = null;
        sendAction('playCard', { cardId: card.id, targetId: state.viewerId });
        return;
      }

      renderHand();
      renderPlayers();
    });
    els.hand.append(button);
  }

  renderActionBox(mine, selectedCardFromState());
}

function renderActionBox(mine, selectedCard) {
  els.actionBox.hidden = true;
  els.actionHint.textContent = '';
  els.playButton.disabled = true;
  els.playButton.onclick = null;
  els.playButton.textContent = '';

  const showGuess = state.status === 'playing' && mine && selectedCard && state.cards[selectedCard.rank]?.needsGuess;
  els.guessLabel.hidden = !showGuess;
  if (showGuess) {
    els.actionBox.hidden = false;
  }
}

function renderRules() {
  if (!els.rulesList || els.rulesList.dataset.rendered) return;
  const lines = [
    ['A / J', 'Guard', 'Guess another player’s card. You cannot guess Guard.'],
    ['2', 'Priest', 'Look at another player’s hand.'],
    ['3', 'Baron', 'Compare hands. Lower card is eliminated. Same value is a draw.'],
    ['4', 'Handmaid', 'Protection until your next turn.'],
    ['5', 'Prince', 'Chosen player discards and draws. Princess eliminates.'],
    ['6', 'King', 'Trade hands with another player.'],
    ['7', 'Countess', 'Must be played if held with 5 or 6.'],
    ['8', 'Princess', 'If played or discarded, you are eliminated.'],
  ];
  els.rulesList.innerHTML = lines.map(([card, role, text]) => `
    <div class="rule-line">
      <div class="rule-card">${card}</div>
      <div><strong>${role}</strong><div class="rule-text">${text}</div></div>
    </div>
  `).join('');
  els.rulesList.dataset.rendered = 'true';
}

function renderLog() {
  els.deckCount.textContent = `Deck: ${state.deckCount}`;

  if (state.publicBurn?.length) {
    els.publicBurn.hidden = false;
    els.publicBurn.innerHTML = `2-player public removed: ${state.publicBurn.map((card) => `<strong>${escapeHtml(card.face)}</strong>`).join(' ')}`;
  } else {
    els.publicBurn.hidden = true;
  }
}


function selectedCardFromState() {
  return (state.ownHand || []).find((card) => card.id === selectedCardId) || null;
}

function isMyTurn() {
  return state.status === 'playing' && state.activePlayerId === state.viewerId;
}

function latestVisibleLog() {
  return [...(state.logs || [])].reverse().find((log) => !['turn'].includes(log.type)) || null;
}

function latestInteractiveLog() {
  return [...(state.logs || [])].reverse().find((log) => log.actorId || log.targetId) || null;
}

function handleNewEvents(previous, current) {
  const logs = current.logs || [];
  const roundKey = `${current.code}:${current.roundNumber}:${current.status}`;

  if (!previous || lastRoundKey !== roundKey) {
    lastRoundKey = roundKey;
    lastEventId = logs.reduce((max, log) => Math.max(max, log.id), 0);
    return;
  }

  const newLogs = logs.filter((log) => log.id > lastEventId);
  if (newLogs.length === 0) return;

  for (const log of newLogs) {
    if (log.type === 'elimination') {
      showToast(log.message, 'elimination');
      showSpotlight('Eliminated', log.message, '✕', 'danger');
      spawnParticles(22);
    } else if (visibleActionTypes.includes(log.type)) {
      showToast(log.message, log.type === 'baron-draw' ? 'draw' : 'action');
      showSpotlight(actionTitle(log.type), log.message, actionIcon(log.type), log.type === 'baron-draw' ? 'draw' : 'action');
      if (['guard-hit', 'baron-result', 'prince-princess', 'princess-played'].includes(log.type)) {
        spawnParticles(14);
      }
    } else if (log.type === 'round-win' || log.type === 'game-over') {
      showToast(log.message, 'win');
      showSpotlight(log.type === 'game-over' ? 'Game won' : 'Round won', log.message, '★', 'win');
      spawnParticles(28);
    }
  }

  lastEventId = Math.max(...logs.map((log) => log.id), lastEventId);
}


function actionTitle(type) {
  const map = {
    'guard-hit': 'Correct guess',
    'guard-miss': 'Wrong guess',
    'private-effect': 'Priest used',
    'baron-result': 'Baron comparison',
    'baron-draw': 'Baron draw',
    'prince-redraw': 'Prince used',
    'prince-princess': 'Princess discarded',
    'king-trade': 'King trade',
    protected: 'Handmaid used',
    countess: 'Countess used',
    'princess-played': 'Princess played',
    'no-target': 'No target',
  };
  return map[type] || 'Action';
}


function actionIcon(type) {
  const map = {
    'guard-hit': '✓',
    'guard-miss': '?',
    'private-effect': '👁',
    'baron-result': '⚔',
    'baron-draw': '＝',
    'prince-redraw': '↻',
    'prince-princess': '✕',
    'king-trade': '⇄',
    protected: '◇',
    countess: '7',
    'princess-played': '8',
    'no-target': '–',
  };
  return map[type] || '•';
}


function showToast(message, type = '') {
  const div = document.createElement('div');
  div.className = `toast ${type}`;
  div.textContent = message;
  els.toastZone.append(div);
  setTimeout(() => {
    div.style.opacity = '0';
    div.style.transform = 'translateY(8px)';
    setTimeout(() => div.remove(), 250);
  }, 3600);
}

function showSpotlight(title, message, icon = '•', type = '') {
  els.spotlight.hidden = false;
  els.spotlight.innerHTML = `
    <div class="spotlight-card ${type}">
      <div class="blast">${escapeHtml(icon)}</div>
      <h2>${escapeHtml(title)}</h2>
      <p class="muted">${escapeHtml(message)}</p>
    </div>
  `;
  clearTimeout(showSpotlight.timer);
  showSpotlight.timer = setTimeout(() => {
    els.spotlight.hidden = true;
    els.spotlight.innerHTML = '';
  }, 1550);
}

function spawnParticles(count = 16) {
  const faces = ['A', 'J', '2', '3', '4', '5', '6', '7', '8'];
  for (let i = 0; i < count; i += 1) {
    const particle = document.createElement('div');
    particle.className = 'particle';
    particle.textContent = faces[Math.floor(Math.random() * faces.length)];
    particle.style.left = `${45 + Math.random() * 10}vw`;
    particle.style.top = `${32 + Math.random() * 14}vh`;
    particle.style.setProperty('--dx', `${(Math.random() - 0.5) * 360}px`);
    particle.style.setProperty('--rot', `${(Math.random() - 0.5) * 520}deg`);
    document.body.append(particle);
    setTimeout(() => particle.remove(), 950);
  }
}

function copyRoomLink() {
  const url = new URL(window.location.href);
  url.searchParams.set('room', state?.code || getStoredSession().roomCode);
  navigator.clipboard?.writeText(url.toString()).then(
    () => showToast('Room link copied.'),
    () => showToast('Copy failed. Select the URL manually.')
  );
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function boot() {
  const session = getStoredSession();
  const urlRoom = normalizeRoom(new URL(window.location.href).searchParams.get('room'));
  if (urlRoom && sessionStorage.getItem(storage.room) && sessionStorage.getItem(storage.room) !== urlRoom) {
    sessionStorage.removeItem(storage.player);
  }
  if (urlRoom) sessionStorage.setItem(storage.room, urlRoom);
  const freshSession = getStoredSession();
  els.nameInput.value = freshSession.name || '';
  els.roomInput.value = urlRoom || freshSession.roomCode || '';

  renderRules();

  if (urlRoom && freshSession.playerId && freshSession.roomCode === urlRoom) {
    openStream(urlRoom, freshSession.playerId);
  }

  els.createButton.addEventListener('click', createRoom);
  els.joinButton.addEventListener('click', joinRoom);
  els.copyLinkButton.addEventListener('click', copyRoomLink);
  els.roomInput.addEventListener('input', () => {
    els.roomInput.value = normalizeRoom(els.roomInput.value);
  });
  els.nameInput.addEventListener('input', () => {
    localStorage.setItem(storage.name, els.nameInput.value.trim());
  });
  document.getElementById('entryForm').addEventListener('submit', (event) => {
    event.preventDefault();
    if (els.roomInput.value.trim()) joinRoom();
    else createRoom();
  });
}

boot();
