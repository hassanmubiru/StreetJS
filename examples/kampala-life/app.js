const modalBackdrop = document.querySelector('#modal-backdrop');
const modalClose = document.querySelector('#modal-close');
const modalTitle = document.querySelector('#modal-title');
const modalCopy = document.querySelector('#modal-copy');
const modalEmoji = document.querySelector('#modal-emoji');
const modalEyebrow = document.querySelector('#modal-eyebrow');
const modalSubmit = document.querySelector('#modal-submit');
const modalEnter = document.querySelector('#modal-enter');
const modalSignout = document.querySelector('#modal-signout');
const formNote = document.querySelector('#form-note');
const formError = document.querySelector('#form-error');
const signupForm = document.querySelector('#signup-form');
const storyButton = document.querySelector('#story-button');
const startStoryButton = document.querySelector('#start-story-button');
const playerTitle = document.querySelector('#player-title');
const playerSubtitle = document.querySelector('#player-subtitle');
const dayNumber = document.querySelector('#day-number');
const goalTitle = document.querySelector('#goal-title');
const goalDescription = document.querySelector('#goal-description');
const goalProgress = document.querySelector('#goal-progress');
const goalProgressBar = document.querySelector('#goal-progress-bar');
const endDayButton = document.querySelector('#end-day-button');
const tickerCopy = document.querySelector('#ticker-copy');
const toastTitle = document.querySelector('#toast-title');
const toastCopy = document.querySelector('#toast-copy');
const musicToggle = document.querySelector('#music-toggle');
const moodToggle = document.querySelector('#mood-toggle');
const cityMap = document.querySelector('.city-map');
const multiplayerLayer = document.querySelector('#multiplayer-layer');
const multiplayerStatus = document.querySelector('#multiplayer-status');
const multiplayerStatusCopy = document.querySelector('#multiplayer-status-copy');
const activityFeed = document.querySelector('#activity-feed');
const activityList = document.querySelector('#activity-list');

const sessionStorageKey = 'kampala-life-session';
const tickerMessages = [
  'Boda bodas are moving — who will you meet on the way?',
  'Fresh rolex at Kabalagala. Your hunger bar is calling.',
  'A new neighbour just moved in near Nakasero.',
  'Sunset at Ggaba is looking good. Make a plan.',
];

const modalModes = {
  signup: {
    emoji: '🌇', eyebrow: 'YOUR NEXT CHAPTER', title: 'Make Kampala yours.',
    copy: 'Create an account, choose your first move, and start building a life across the seven hills.',
    submit: 'Create my account', note: 'Your account is stored by the Kampala Life server.',
  },
  login: {
    emoji: '👋🏾', eyebrow: 'WELCOME BACK', title: 'Your city remembers you.',
    copy: 'Log back in and pick up your Kampala story right where you left it.',
    submit: 'Log me in', note: 'Use the email and password you signed up with.',
  },
};

let currentMode = 'signup';
let currentPlayer = null;
let currentGame = null;
let tickerIndex = 0;
let realtimeSocket = null;
let reconnectTimer = null;
const onlinePlayers = new Map();

function getSessionToken() {
  try { return window.localStorage.getItem(sessionStorageKey); } catch { return null; }
}

function setSessionToken(token) {
  try {
    if (token) window.localStorage.setItem(sessionStorageKey, token);
    else window.localStorage.removeItem(sessionStorageKey);
  } catch {
    // The HttpOnly cookie still keeps the current browser session alive.
  }
}

async function api(path, options = {}) {
  const headers = { 'content-type': 'application/json', ...(options.headers || {}) };
  const token = getSessionToken();
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(path, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'The city could not complete that request.');
  return body;
}

function formatCash(cash) {
  return `UGX ${Number(cash).toLocaleString('en-UG')}`;
}

function setMultiplayerStatus(state, text) {
  multiplayerStatus.classList.toggle('is-online', state === 'online');
  multiplayerStatus.classList.toggle('is-connecting', state === 'connecting');
  multiplayerStatusCopy.textContent = text;
}

function playerAvatar(id) {
  return ['🧑🏾', '👩🏾', '👨🏿', '🧕🏾'][Array.from(id || '0').reduce((sum, char) => sum + char.charCodeAt(0), 0) % 4];
}

function renderOnlinePlayers() {
  multiplayerLayer.replaceChildren();
  for (const player of onlinePlayers.values()) {
    const token = document.createElement('div');
    token.className = `player-token${player.id === currentPlayer?.id ? ' is-self' : ''}`;
    token.style.left = `${(player.position.x / 1000) * 100}%`;
    token.style.top = `${(player.position.y / 620) * 100}%`;
    token.title = `${player.name} is in Kampala`;

    const avatar = document.createElement('div');
    avatar.className = 'player-token-avatar';
    const avatarText = document.createElement('span');
    avatarText.textContent = playerAvatar(player.id);
    avatar.append(avatarText);
    const name = document.createElement('span');
    name.className = 'player-token-name';
    name.textContent = player.id === currentPlayer?.id ? 'You' : player.name;
    token.append(avatar, name);
    multiplayerLayer.append(token);
  }
}

function addActivity(activity, prepend = true) {
  const item = document.createElement('li');
  const name = document.createElement('strong');
  name.textContent = activity.playerId === currentPlayer?.id ? 'You' : activity.playerName;
  const message = document.createElement('span');
  message.textContent = ` ${activity.message}`;
  item.append(name, message);
  if (prepend) activityList.prepend(item);
  else activityList.append(item);
  while (activityList.children.length > 4) activityList.lastElementChild.remove();
}

function renderActivities(activities = []) {
  activityList.replaceChildren();
  if (!activities.length) {
    const item = document.createElement('li');
    item.textContent = 'No activity yet. Make the first move.';
    activityList.append(item);
    return;
  }
  [...activities].reverse().forEach((activity) => addActivity(activity, false));
}

function handleRealtimeMessage(message) {
  const { type, payload } = message;
  if (type === 'world:snapshot') {
    onlinePlayers.clear();
    for (const player of payload.players || []) onlinePlayers.set(player.id, player);
    if (payload.self) onlinePlayers.set(payload.self.id, payload.self);
    renderOnlinePlayers();
    renderActivities(payload.activities);
    setMultiplayerStatus('online', `${onlinePlayers.size} player${onlinePlayers.size === 1 ? '' : 's'} nearby`);
  } else if (type === 'player:joined' || type === 'player:moved') {
    onlinePlayers.set(payload.id, payload);
    renderOnlinePlayers();
    setMultiplayerStatus('online', `${onlinePlayers.size} player${onlinePlayers.size === 1 ? '' : 's'} nearby`);
  } else if (type === 'player:left') {
    onlinePlayers.delete(payload.id);
    renderOnlinePlayers();
    setMultiplayerStatus('online', `${onlinePlayers.size} player${onlinePlayers.size === 1 ? '' : 's'} nearby`);
  } else if (type === 'player:move:rejected') {
    toastTitle.textContent = 'Move rejected';
    toastCopy.textContent = payload.reason;
  } else if (type === 'world:activity') {
    addActivity(payload);
    tickerCopy.textContent = `${payload.playerName} ${payload.message}`;
    toastTitle.textContent = payload.playerId === currentPlayer?.id ? 'Your move' : `${payload.playerName} is active`;
    toastCopy.textContent = payload.message;
  }
}

function disconnectRealtime() {
  if (reconnectTimer) window.clearTimeout(reconnectTimer);
  reconnectTimer = null;
  const socket = realtimeSocket;
  realtimeSocket = null;
  if (socket) socket.close(1000, 'Signed out');
  onlinePlayers.clear();
  renderOnlinePlayers();
  renderActivities();
  activityFeed.classList.remove('is-live');
  setMultiplayerStatus('offline', 'Sign in to enter the city');
}

function connectRealtime() {
  if (!currentPlayer || (realtimeSocket && realtimeSocket.readyState <= WebSocket.OPEN)) return;
  if (reconnectTimer) window.clearTimeout(reconnectTimer);
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(`${scheme}://${window.location.host}/ws`);
  realtimeSocket = socket;
  setMultiplayerStatus('connecting', 'Joining Kampala…');
  socket.addEventListener('open', () => setMultiplayerStatus('connecting', 'Loading nearby players…'));
  socket.addEventListener('message', (event) => {
    try { handleRealtimeMessage(JSON.parse(event.data)); } catch { /* ignore malformed server frames */ }
  });
  socket.addEventListener('close', () => {
    if (realtimeSocket !== socket) return;
    realtimeSocket = null;
    onlinePlayers.clear();
    renderOnlinePlayers();
    setMultiplayerStatus('offline', 'Reconnecting…');
    activityFeed.classList.remove('is-live');
    if (currentPlayer) reconnectTimer = window.setTimeout(connectRealtime, 2000);
  });
  socket.addEventListener('open', () => activityFeed.classList.add('is-live'));
}

function updateGameHud() {
  const signedIn = Boolean(currentPlayer);
  const game = currentGame || { day: 1, actionsToday: 0, actionsPerDay: 3, dailyGoal: { title: 'Build your network', description: 'Sign in to start your first day.', progress: 0, target: 3, complete: false } };
  const goal = game.dailyGoal;
  dayNumber.textContent = String(game.day);
  goalTitle.textContent = signedIn ? goal.title : 'Build your network';
  goalDescription.textContent = signedIn ? `${goal.description}${goal.complete ? ' · Complete!' : ''}` : 'Sign in to start your first day.';
  goalProgress.textContent = signedIn ? `${goal.progress}/${goal.target}` : `0/${goal.target}`;
  goalProgressBar.style.width = `${Math.min(100, (goal.progress / goal.target) * 100)}%`;
  endDayButton.disabled = !signedIn || game.actionsToday === 0;
  endDayButton.textContent = signedIn ? `End day · ${game.actionsToday}/${game.actionsPerDay}` : 'End day';
}

function applyProfile(player, game = null) {
  currentPlayer = player;
  currentGame = player ? (game || { day: player.day, actionsToday: player.actionsToday, actionsPerDay: 3, dailyGoal: player.dailyGoal }) : null;
  const signedIn = Boolean(player);
  storyButton.textContent = signedIn ? 'My story' : 'Sign up';
  startStoryButton.textContent = signedIn ? 'Continue your story' : 'Start your story';
  storyButton.dataset.modal = signedIn ? 'profile' : 'signup';
  startStoryButton.dataset.modal = signedIn ? 'profile' : 'signup';
  playerTitle.textContent = signedIn ? `Welcome, ${player.name}` : '1,240 Kampala dreamers';
  playerSubtitle.textContent = signedIn
    ? `${formatCash(player.cash)} · ${player.energy}% energy · ${player.reputation} rep`
    : 'are playing today · free';
  updateGameHud();
  if (signedIn) {
    onlinePlayers.set(player.id, { id: player.id, name: player.name, position: player.position || { x: 500, y: 300 } });
    renderOnlinePlayers();
    connectRealtime();
  } else {
    disconnectRealtime();
  }
}

function showFormError(message = '') {
  formError.textContent = message;
  formError.hidden = !message;
}

function openModal(mode) {
  const profile = currentPlayer;
  const content = mode === 'profile'
    ? {
      emoji: '🧭', eyebrow: 'YOUR KAMPALA STORY', title: `Welcome back, ${profile?.name ?? 'friend'}!`,
      copy: 'Your account is live. Choose a place on the map and keep building your story.',
      submit: 'Continue', note: profile ? `${profile.email} · Day ${currentGame?.day || 1} · ${currentGame?.actionsToday || 0}/3 moves` : '',
    }
    : modalModes[mode];
  currentMode = mode;
  modalEmoji.textContent = content.emoji;
  modalEyebrow.textContent = content.eyebrow;
  modalTitle.textContent = content.title;
  modalCopy.textContent = content.copy;
  modalSubmit.textContent = content.submit;
  formNote.textContent = content.note;
  signupForm.reset();
  signupForm.hidden = mode === 'profile';
  modalEnter.hidden = true;
  modalSignout.hidden = mode !== 'profile';
  modalSubmit.disabled = false;
  showFormError();
  modalBackdrop.hidden = false;
  document.body.style.overflow = 'hidden';
  if (mode !== 'profile') window.setTimeout(() => document.querySelector('#email')?.focus(), 30);
}

function closeModal() {
  modalBackdrop.hidden = true;
  document.body.style.overflow = '';
}

async function loadSession() {
  if (!getSessionToken()) return applyProfile(null);
  try {
    const data = await api('/api/me');
    applyProfile(data.player, data.game);
  } catch {
    setSessionToken(null);
    applyProfile(null);
  }
}

document.querySelectorAll('[data-modal]').forEach((button) => {
  button.addEventListener('click', () => openModal(button.dataset.modal));
});

modalClose.addEventListener('click', closeModal);
modalBackdrop.addEventListener('click', (event) => {
  if (event.target === modalBackdrop) closeModal();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !modalBackdrop.hidden) closeModal();
});

signupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  showFormError();
  modalSubmit.disabled = true;
  try {
    const values = Object.fromEntries(new FormData(signupForm));
    const endpoint = currentMode === 'login' ? '/api/auth/login' : '/api/auth/signup';
    const data = await api(endpoint, { method: 'POST', body: JSON.stringify(values) });
    setSessionToken(data.token);
    applyProfile(data.player, data.game);
    modalEmoji.textContent = currentMode === 'signup' ? '🎉' : '✨';
    modalEyebrow.textContent = 'YOU ARE IN';
    modalTitle.textContent = currentMode === 'signup' ? `Welcome, ${data.player.name}!` : `Good to see you, ${data.player.name}!`;
    modalCopy.textContent = 'Your account is ready. Enter the city and make your first move.';
    signupForm.hidden = true;
    modalEnter.hidden = false;
    formNote.textContent = 'Your player state is saved on the Kampala Life server.';
  } catch (error) {
    showFormError(error.message);
    modalSubmit.disabled = false;
  }
});

modalEnter.addEventListener('click', closeModal);

modalSignout.addEventListener('click', async () => {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* local token is cleared below */ }
  setSessionToken(null);
  applyProfile(null);
  closeModal();
  toastTitle.textContent = 'See you around Kampala';
  toastCopy.textContent = 'Your account has been signed out.';
});

document.querySelectorAll('.map-pin').forEach((pin) => {
  pin.addEventListener('click', async () => {
    const place = pin.dataset.place;
    if (!currentPlayer) {
      toastTitle.textContent = 'Sign in to make a move';
      toastCopy.textContent = 'Create an account to save cash, energy, and reputation.';
      openModal('signup');
      return;
    }
    try {
      const data = await api('/api/actions', { method: 'POST', body: JSON.stringify({ action: place }) });
      applyProfile(data.player, data.game);
      toastTitle.textContent = place;
      toastCopy.textContent = `${data.event} ${formatCash(data.player.cash)} remaining. ${data.game.actionsToday}/${data.game.actionsPerDay} moves used.`;
    } catch (error) {
      toastTitle.textContent = 'That move is blocked';
      toastCopy.textContent = error.message;
    }
  });
});

cityMap.addEventListener('click', (event) => {
  if (!currentPlayer || !realtimeSocket || realtimeSocket.readyState !== WebSocket.OPEN) return;
  if (event.target.closest('button, .landmark')) return;
  const rect = cityMap.getBoundingClientRect();
  const position = {
    x: ((event.clientX - rect.left) / rect.width) * 1000,
    y: ((event.clientY - rect.top) / rect.height) * 620,
  };
  realtimeSocket.send(JSON.stringify({ type: 'player:move', payload: position, ts: Date.now() }));
});

endDayButton.addEventListener('click', async () => {
  if (!currentPlayer) return openModal('signup');
  endDayButton.disabled = true;
  try {
    const data = await api('/api/day/end', { method: 'POST' });
    applyProfile(data.player, data.game);
    toastTitle.textContent = `Day ${data.game.day} begins`;
    toastCopy.textContent = data.event;
  } catch (error) {
    toastTitle.textContent = 'The day is not over yet';
    toastCopy.textContent = error.message;
    updateGameHud();
  }
});

musicToggle.addEventListener('click', () => {
  const isOn = musicToggle.classList.toggle('is-on');
  musicToggle.setAttribute('aria-pressed', String(isOn));
  musicToggle.innerHTML = isOn ? '<span>♫</span> <strong>Playing</strong>' : '<span>♫</span> <strong>Game music</strong>';
});

moodToggle.addEventListener('click', () => {
  const isNight = moodToggle.classList.toggle('is-night');
  moodToggle.setAttribute('aria-pressed', String(isNight));
  moodToggle.textContent = isNight ? '☾ KLA!' : '☼ KLA!';
  document.body.classList.toggle('night-mode', isNight);
});

window.setInterval(() => {
  tickerIndex = (tickerIndex + 1) % tickerMessages.length;
  tickerCopy.animate(
    [{ opacity: 0, transform: 'translateY(3px)' }, { opacity: 1, transform: 'translateY(0)' }],
    { duration: 340, easing: 'ease-out' },
  );
  tickerCopy.textContent = tickerMessages[tickerIndex];
}, 5000);

window.addEventListener('beforeunload', () => { document.body.style.overflow = ''; });
applyProfile(null);
loadSession();
