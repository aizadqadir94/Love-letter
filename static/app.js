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
  return {
    name: localStorage.getItem(storage.name) || '',
    roomCode: localStorage.getItem(storage.room) || '',
    playerId: localStorage.getItem(storage.player) || '',
  };
}

function saveSession({ name, roomCode, playerId }) {
  if (name) localStorage.setItem(storage.name, name);
  if (roomCode) localStorage.setItem(storage.room, roomCode);
  if (playerId) localStorage.setItem(storage.player, playerId);
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
        roomCode: session.roomCode,
        playerId: session.playerId,
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
    els.mainStatus.textContent = state.canStart ? 'Ready to start' : 'Waiting for at least 2 players';
    els.turnPrompt.textContent = 'Waiting for players';
  } else if (state.status === 'playing') {
    const isYou = state.activePlayerId === state.viewerId;
    els.mainStatus.textContent = isYou ? 'Your turn' : `${state.activePlayerName || 'A player'}’s turn`;
    els.turnPrompt.textContent = isYou ? 'Your turn: choose a card' : `${state.activePlayerName || 'A player'} is choosing`;
  } else if (state.status === 'round_over') {
    els.mainStatus.textContent = `${state.roundResult?.winnerNames?.join(' and ') || 'Nobody'} won the round`;
    els.turnPrompt.textContent = 'Round over';
  } else if (state.status === 'game_over') {
    const names = state.players.filter((p) => state.gameWinnerIds.includes(p.id)).map((p) => p.name).join(' and ');
    els.mainStatus.textContent = `${names || 'A player'} won the game`;
    els.turnPrompt.textContent = 'Game over';
  }

  const latest = latestVisibleLog();
  els.latestAction.textContent = latest ? latest.message : 'No actions yet.';

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

    const handPreview = player.visibleHand?.length
      ? `<div class="mini-cards">${player.visibleHand.map((c) => `<span class="mini-card revealed" title="${escapeHtml(c.role)}">${escapeHtml(c.face)}</span>`).join('')}</div>`
      : `<div class="seat-note"><span class="mini-card">?</span><span>${player.isYou ? 'Your cards are in the play tray.' : `${player.handCount || 0} hidden card${(player.handCount || 0) === 1 ? '' : 's'}`}</span></div>`;

    const discards = player.discards?.length
      ? `<div class="discard-row">${player.discards.slice(-4).map((c) => `<span class="mini-card revealed" title="${escapeHtml(c.role)}">${escapeHtml(c.face)}</span>`).join('')}</div>`
      : '<div class="seat-subtle">No discards</div>';

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
      if (!isTargetable) return;
      selectedTargetId = player.id;
      renderHand();
      renderPlayers();
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

  els.handTitle.textContent = mine ? 'Tap a card below, then tap a highlighted player' : (state.status === 'playing' ? 'Waiting for your turn' : 'Round not active');
  els.privateNotice.hidden = !state.privateNotice;
  els.privateNotice.textContent = state.privateNotice || '';
  els.countessWarning.hidden = !state.mustPlayCountess;

  els.hand.innerHTML = '';
  if (!hand.length) {
    els.hand.innerHTML = '<div class="empty-hand">No cards in hand.</div>';
  }

  for (const card of hand) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'playing-card';
    if (mine) button.classList.add('selectable');
    if (card.id === selectedCardId) button.classList.add('selected');
    button.disabled = !mine;
    button.innerHTML = `
      <div class="card-face"><span>${escapeHtml(card.face)}</span><span>${card.rank}</span></div>
      <div class="card-role"><strong>${escapeHtml(card.role)}</strong><span>${escapeHtml(card.text)}</span></div>
    `;
    button.addEventListener('click', () => {
      if (!mine) return;
      selectedCardId = card.id;
      selectedTargetId = null;
      renderHand();
      renderPlayers();
    });
    els.hand.append(button);
  }

  renderActionBox(mine, selectedCardFromState());
}

function renderActionBox(mine, selectedCard) {
  els.actionBox.hidden = state.status !== 'playing';
  if (state.status !== 'playing') return;

  const noTurn = !mine;
  if (noTurn) {
    els.actionHint.textContent = `${state.activePlayerName || 'A player'} is choosing. Watch the table.`;
    els.guessLabel.hidden = true;
    els.playButton.disabled = true;
    els.playButton.textContent = 'Waiting';
    els.playButton.onclick = null;
    return;
  }

  if (!selectedCard) {
    els.actionHint.textContent = 'Step 1: tap one of your two cards on the table.';
    els.guessLabel.hidden = true;
    els.playButton.disabled = true;
    els.playButton.textContent = 'Select a card first';
    els.playButton.onclick = null;
    return;
  }

  const info = state.cards[selectedCard.rank];
  const targetIds = state.validTargets?.[selectedCard.id] || [];
  const targets = state.players.filter((player) => targetIds.includes(player.id));
  const selfOnlyPrince = selectedCard.rank === 5 && targetIds.length === 1 && targetIds[0] === state.viewerId;
  if (selectedTargetId && !targetIds.includes(selectedTargetId)) selectedTargetId = null;
  if (selfOnlyPrince) selectedTargetId = state.viewerId;

  els.guessLabel.hidden = !info.needsGuess;

  if (info.needsTarget && targets.length > 0 && !selectedTargetId) {
    els.actionHint.textContent = `Step 2: tap a highlighted player on the poker table for ${selectedCard.role}.`;
    els.playButton.disabled = true;
    els.playButton.textContent = 'Select a target';
    els.playButton.onclick = null;
    return;
  }

  if (info.needsTarget && targets.length === 0) {
    els.guessLabel.hidden = true;
    els.actionHint.textContent = `${selectedCard.role} has no valid target because everyone else is protected. It will be played with no effect.`;
    els.playButton.disabled = false;
    els.playButton.textContent = 'Play card — no effect';
  } else if (selfOnlyPrince) {
    els.actionHint.textContent = 'The only valid Prince target is you. Play to discard your own card and redraw.';
    els.playButton.disabled = false;
    els.playButton.textContent = 'Play Prince on yourself';
  } else if (info.needsTarget) {
    const target = state.players.find((player) => player.id === selectedTargetId);
    els.actionHint.textContent = `Ready: play ${selectedCard.face} on ${target ? target.name : 'selected target'}.`;
    els.playButton.disabled = false;
    els.playButton.textContent = 'Play selected card';
  } else {
    els.actionHint.textContent = `Ready: play ${selectedCard.face}.`;
    els.playButton.disabled = false;
    els.playButton.textContent = 'Play selected card';
  }

  els.playButton.onclick = () => {
    const payload = { cardId: selectedCard.id };
    if (info.needsTarget && targets.length > 0) payload.targetId = selectedTargetId;
    if (info.needsGuess) payload.guessRank = Number(els.guessSelect.value);
    selectedCardId = null;
    selectedTargetId = null;
    sendAction('playCard', payload);
  };
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
  els.nameInput.value = session.name || '';
  els.roomInput.value = urlRoom || session.roomCode || '';

  renderRules();

  if (urlRoom && session.playerId && session.roomCode === urlRoom) {
    openStream(urlRoom, session.playerId);
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
