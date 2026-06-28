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
  hostControls: document.getElementById('hostControls'),
  playersGrid: document.getElementById('playersGrid'),
  roundResult: document.getElementById('roundResult'),
  handTitle: document.getElementById('handTitle'),
  privateNotice: document.getElementById('privateNotice'),
  countessWarning: document.getElementById('countessWarning'),
  hand: document.getElementById('hand'),
  actionBox: document.getElementById('actionBox'),
  targetSelect: document.getElementById('targetSelect'),
  targetLabel: document.getElementById('targetLabel'),
  guessLabel: document.getElementById('guessLabel'),
  guessSelect: document.getElementById('guessSelect'),
  playButton: document.getElementById('playButton'),
  rulesList: document.getElementById('rulesList'),
  deckCount: document.getElementById('deckCount'),
  publicBurn: document.getElementById('publicBurn'),
  logList: document.getElementById('logList'),
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
let lastEventId = 0;
let lastRoundKey = '';

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

function clearSession() {
  localStorage.removeItem(storage.room);
  localStorage.removeItem(storage.player);
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
    // EventSource reconnects automatically. Avoid noisy UI errors.
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
  renderPlayers();
  renderHand();
  renderRules();
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
  } else if (state.status === 'playing') {
    els.mainStatus.textContent = `${state.activePlayerName || 'A player'} is choosing`;
  } else if (state.status === 'round_over') {
    els.mainStatus.textContent = `${state.roundResult?.winnerNames?.join(' and ') || 'Nobody'} won the round`;
  } else if (state.status === 'game_over') {
    const names = state.players.filter((p) => state.gameWinnerIds.includes(p.id)).map((p) => p.name).join(' and ');
    els.mainStatus.textContent = `${names || 'A player'} won the game`;
  }

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
  els.playersGrid.innerHTML = '';
  for (const player of state.players) {
    const card = document.createElement('article');
    card.className = 'player-card';
    if (player.id === state.activePlayerId) card.classList.add('active');
    if (!player.alive && state.status !== 'lobby') card.classList.add('eliminated');

    const scoreDots = Array.from({ length: state.targetScore }, (_, index) => (
      `<span class="dot ${index < player.score ? 'filled' : ''}"></span>`
    )).join('');

    const badges = [
      player.isYou ? '<span class="badge blue">You</span>' : '',
      player.isHost ? '<span class="badge">Host</span>' : '',
      player.protected ? '<span class="badge ok">Protected</span>' : '',
      !player.connected ? '<span class="badge danger">Disconnected</span>' : '',
    ].join('');

    const visibleHand = player.visibleHand?.length
      ? player.visibleHand.map((c) => `<span class="mini-card revealed" title="${escapeHtml(c.role)}">${escapeHtml(c.face)}</span>`).join('')
      : Array.from({ length: player.handCount || 0 }, () => '<span class="mini-card">?</span>').join('');

    const discards = player.discards?.length
      ? `<div class="discard-row">${player.discards.slice(-8).map((c) => `<span class="mini-card revealed" title="${escapeHtml(c.role)}">${escapeHtml(c.face)}</span>`).join('')}</div>`
      : '<div class="discard-row"><span class="muted">No discards</span></div>';

    card.innerHTML = `
      <div class="player-top">
        <div>
          <div class="player-name">${escapeHtml(player.name)}</div>
          <div class="badges">${badges}</div>
        </div>
        <div class="score-dots" title="${player.score}/${state.targetScore}">${scoreDots}</div>
      </div>
      <div class="mini-cards">${visibleHand || '<span class="muted">No hand</span>'}</div>
      ${discards}
    `;
    els.playersGrid.append(card);
  }
}

function renderHand() {
  const isMyTurn = state.status === 'playing' && state.activePlayerId === state.viewerId;
  const hand = state.ownHand || [];

  els.handTitle.textContent = isMyTurn ? 'Choose one card to play' : (state.status === 'playing' ? 'Waiting for your turn' : 'Round not active');
  els.privateNotice.hidden = !state.privateNotice;
  els.privateNotice.textContent = state.privateNotice || '';
  els.countessWarning.hidden = !state.mustPlayCountess;

  if (!hand.find((card) => card.id === selectedCardId)) selectedCardId = null;
  if (!selectedCardId && isMyTurn && hand.length) selectedCardId = hand[0].id;

  els.hand.innerHTML = '';
  for (const card of hand) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'playing-card';
    if (isMyTurn) button.classList.add('selectable');
    if (card.id === selectedCardId) button.classList.add('selected');
    button.disabled = !isMyTurn;
    button.innerHTML = `
      <div class="card-face"><span>${escapeHtml(card.face)}</span><span>${card.rank}</span></div>
      <div class="card-role"><strong>${escapeHtml(card.role)}</strong><span>${escapeHtml(card.text)}</span></div>
    `;
    button.addEventListener('click', () => {
      if (!isMyTurn) return;
      selectedCardId = card.id;
      renderHand();
    });
    els.hand.append(button);
  }

  renderActionBox(isMyTurn, hand.find((card) => card.id === selectedCardId));
}

function renderActionBox(isMyTurn, selectedCard) {
  els.actionBox.hidden = !isMyTurn || !selectedCard;
  if (!isMyTurn || !selectedCard) return;

  const info = state.cards[selectedCard.rank];
  const targetIds = state.validTargets?.[selectedCard.id] || [];
  const targets = state.players.filter((player) => targetIds.includes(player.id));

  els.targetLabel.hidden = !info.needsTarget || targets.length === 0;
  els.guessLabel.hidden = !info.needsGuess;
  els.targetSelect.innerHTML = targets.map((player) => `<option value="${escapeHtml(player.id)}">${escapeHtml(player.name)}</option>`).join('');

  if (info.needsTarget && targets.length === 0) {
    els.playButton.textContent = 'Play card — no valid targets';
  } else {
    els.playButton.textContent = 'Play selected card';
  }

  els.playButton.onclick = () => {
    const payload = { cardId: selectedCard.id };
    if (info.needsTarget && targets.length > 0) payload.targetId = els.targetSelect.value;
    if (info.needsGuess) payload.guessRank = Number(els.guessSelect.value);
    sendAction('playCard', payload);
  };
}

function renderRules() {
  if (els.rulesList.dataset.rendered) return;
  const lines = [
    ['A / J', 'Guard', 'Guess another player’s card. You cannot guess Guard.'],
    ['2', 'Priest', 'Look at another player’s hand.'],
    ['3', 'Baron', 'Compare hands. Lower card is eliminated.'],
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
    els.publicBurn.innerHTML = `2-player public removed cards: ${state.publicBurn.map((card) => `<strong>${escapeHtml(card.face)}</strong>`).join(' ')}`;
  } else {
    els.publicBurn.hidden = true;
  }

  const logs = [...(state.logs || [])].slice(-18).reverse();
  els.logList.innerHTML = logs.map((log) => `
    <div class="log-item ${log.type === 'elimination' ? 'elimination' : ''}">${escapeHtml(log.message)}</div>
  `).join('');
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
      showEliminationSpotlight(log.message);
      spawnParticles();
    }
    if (log.type === 'round-win' || log.type === 'game-over') {
      showToast(log.message, 'win');
      spawnParticles(24);
    }
  }

  lastEventId = Math.max(...logs.map((log) => log.id), lastEventId);
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

function showEliminationSpotlight(message) {
  els.spotlight.hidden = false;
  els.spotlight.innerHTML = `
    <div class="spotlight-card">
      <div class="blast">✕</div>
      <h2>Eliminated</h2>
      <p class="muted">${escapeHtml(message)}</p>
    </div>
  `;
  setTimeout(() => {
    els.spotlight.hidden = true;
    els.spotlight.innerHTML = '';
  }, 1750);
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
