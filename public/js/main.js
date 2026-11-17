// 온술바 클라이언트: 입장 → (성비 대기) → 착석 → 옆자리와 채팅/통화
import { SEATS, SEAT_BY_ID, neighborSeats, DRINKS, AVATAR_COLORS } from '/shared/layout.js';
import { BarScene } from './scene.js';
import { Net } from './net.js';
import { Voice } from './voice.js';
import { sfx, unlockAudio } from './sfx.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const GENDER = { m: '남성', f: '여성' };
const SIDE = { left: '왼쪽', right: '오른쪽' };
const drinkOf = (id) => DRINKS.find((d) => d.id === id) || DRINKS[0];

const NICK_A = ['조용한', '수줍은', '느긋한', '말랑한', '담백한', '포근한', '엉뚱한', '나른한', '솔직한', '반짝이는'];
const NICK_B = ['하이볼', '소주잔', '맥주거품', '안주왕', '올빼미', '퇴근러', '단골', '달빛', '얼음', '레몬'];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randomNick = () => `${pick(NICK_A)} ${pick(NICK_B)}`;

const state = {
  phase: 'lobby', // lobby | waiting | seated
  myId: null,
  mySeat: null,
  profile: loadProfile(),
  users: [],
  byId: new Map(),
  neighbors: { left: null, right: null },
  tab: 'bar',
  logs: new Map(), // 'bar' 또는 상대 userId -> 메시지 배열
  unread: new Set(),
  blocked: new Set(),
  moveMode: false,
  view: 'bar',
};

function loadProfile() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem('onsulba.profile') || '{}');
  } catch {
    /* 저장된 값이 깨졌으면 새로 만든다 */
  }
  return {
    name: typeof saved.name === 'string' && saved.name ? saved.name : randomNick(),
    gender: saved.gender === 'm' || saved.gender === 'f' ? saved.gender : null,
    drink: DRINKS.some((d) => d.id === saved.drink) ? saved.drink : 'soju',
    color: Number.isInteger(saved.color) && AVATAR_COLORS[saved.color] ? saved.color : Math.floor(Math.random() * AVATAR_COLORS.length),
  };
}
const saveProfile = () => {
  try {
    localStorage.setItem('onsulba.profile', JSON.stringify(state.profile));
  } catch {
    /* 시크릿 모드 등 */
  }
};

const scene = new BarScene($('stage'), $('labels'));
const net = new Net();
const voice = new Voice(net, $('remoteAudio'));
if (new URLSearchParams(location.search).has('debug')) window.__onsulba = { state, scene, net, voice };

// ---------- 알림 ----------
let toastTimer;
function toast(text, ms = 3200) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}
function hint(text) {
  $('hint').textContent = text || '';
  $('hint').hidden = !text;
}

// ---------- 화면 전환 ----------
function setPhase(phase) {
  state.phase = phase;
  document.body.dataset.phase = phase;
  $('entry').hidden = phase !== 'lobby';
  $('waiting').hidden = phase !== 'waiting';
  $('dock').hidden = phase !== 'seated';
  $('leaveBtn').hidden = phase !== 'seated';
  $('viewBtn').hidden = phase !== 'seated';
  if (phase !== 'seated') {
    state.mySeat = null;
    setMoveMode(false);
    closeProfile();
    $('orderMenu').hidden = true;
    scene.setView('overview');
  }
}

function setView(view) {
  state.view = view;
  const seat = SEAT_BY_ID.get(state.mySeat);
  scene.setView(view === 'bar' && seat ? { bar: seat.bar } : 'overview');
  $('viewBtn').textContent = view === 'bar' ? '전체 보기' : '내 자리';
}

// ---------- 입장 카드 ----------
function buildEntry() {
  $('nick').value = state.profile.name;
  $('nick').oninput = syncEntry;
  $('reroll').onclick = () => {
    $('nick').value = randomNick();
    syncEntry();
  };
  $('custom').open = window.innerWidth >= 860; // 넓은 화면에서는 꾸미기 옵션을 펼쳐 둔다

  const chips = $('drinkChips');
  for (const d of DRINKS) {
    const b = el('button', 'chip', `${d.emoji} ${d.label}`);
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.dataset.drink = d.id;
    b.onclick = () => {
      state.profile.drink = d.id;
      syncEntry();
    };
    chips.appendChild(b);
  }
  const sw = $('swatches');
  AVATAR_COLORS.forEach((c, i) => {
    const b = el('button', 'swatch');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', `색 ${i + 1}`);
    b.style.setProperty('--c', c);
    b.onclick = () => {
      state.profile.color = i;
      syncEntry();
    };
    sw.appendChild(b);
  });
  for (const b of $('genderSeg').children) {
    b.onclick = () => {
      state.profile.gender = b.dataset.gender;
      syncEntry();
    };
  }
  $('entryForm').onsubmit = (e) => {
    e.preventDefault();
    if (!state.profile.gender) return;
    unlockAudio();
    state.profile.name = $('nick').value.trim() || randomNick();
    saveProfile();
    join();
  };
  syncEntry();
}

function syncEntry() {
  for (const b of $('drinkChips').children) b.setAttribute('aria-checked', String(b.dataset.drink === state.profile.drink));
  [...$('swatches').children].forEach((b, i) => b.setAttribute('aria-checked', String(i === state.profile.color)));
  for (const b of $('genderSeg').children) b.setAttribute('aria-checked', String(b.dataset.gender === state.profile.gender));
  $('sumDot').style.background = AVATAR_COLORS[state.profile.color];
  const d = drinkOf(state.profile.drink);
  $('sumText').textContent = `${$('nick').value.trim() || '닉네임'} · ${d.emoji} ${d.label}`;
  const btn = $('enterBtn');
  btn.disabled = !state.profile.gender;
  btn.textContent = state.profile.gender ? '바로 자리에 앉기' : '성별을 선택해 주세요';
}

function join() {
  state.wantsIn = true;
  net.send({ type: 'join', ...state.profile });
}

// ---------- 서버 이벤트 ----------
net.on('status', ({ connected, replaced }) => {
  $('offline').hidden = connected;
  if (replaced) $('offline').textContent = '다른 탭에서 접속해 이 탭의 연결이 종료됐어요.';
});

net.on('welcome', (m) => {
  state.myId = m.id;
  voice.iceServers = m.iceServers || [];
  if (m.status === 'seated') {
    if (m.profile) state.profile = m.profile;
    onSeated(m.seatId, { silent: true });
  } else if (m.status === 'waiting') {
    setPhase('waiting');
  } else if (state.wantsIn && state.profile.gender) {
    join(); // 서버가 내 자리를 잊었으면(재시작 등) 다시 입장
  } else {
    setPhase('lobby');
  }
});

net.on('seated', (m) => {
  if (m.profile) state.profile = m.profile;
  onSeated(m.seatId, m);
});

net.on('waiting', () => {
  setPhase('waiting');
});

net.on('queue', (q) => {
  $('queuePos').textContent = q.position;
  const mine = state.profile.gender;
  const otherLabel = GENDER[mine === 'm' ? 'f' : 'm'];
  $('queueWhy').textContent =
    q.reason === 'full'
      ? `${GENDER[mine]} 자리가 모두 찼어요. 자리가 나면 바로 안내해 드릴게요.`
      : `지금은 ${GENDER[mine]} 손님이 더 많아요. ${otherLabel} 손님이 들어오면 바로 자리가 나요.`;
  const total = Math.max(1, q.counts.m + q.counts.f);
  $('ratioM').style.width = `${(q.counts.m / total) * 100}%`;
  $('ratioF').style.width = `${(q.counts.f / total) * 100}%`;
  $('waitM').textContent = q.counts.m;
  $('waitF').textContent = q.counts.f;
});

net.on('left', () => {
  state.wantsIn = false;
  setPhase('lobby');
});

net.on('error', (m) => toast(m.message || '문제가 생겼어요.'));

net.on('state', (m) => {
  state.users = m.users;
  state.byId = new Map(m.users.map((u) => [u.id, u]));
  $('countM').textContent = m.counts.m;
  $('countF').textContent = m.counts.f;
  $('countFree').textContent = SEATS.length - m.counts.m - m.counts.f;
  const waiting = m.waiting.m + m.waiting.f;
  $('waitStat').hidden = waiting === 0;
  $('countWait').textContent = waiting;
  scene.setUsers(m.users, state.myId, m.now);
  if (state.phase === 'seated') refreshNeighbors();
  if (!$('profile').hidden) renderProfile();
});

net.on('chat', (m) => {
  if (state.blocked.has(m.from)) return;
  const mine = m.from === state.myId;
  const key = m.scope === 'dm' ? (mine ? m.to : m.from) : 'bar';
  pushLog(key, { from: m.from, name: m.name, text: m.text, mine });
  scene.say(m.from, m.text, m.scope === 'dm' ? 'dm' : '');
  if (!mine) sfx.pop();
});

net.on('emote', (m) => {
  scene.cheers(m.from);
  const u = state.byId.get(m.from);
  const me = SEAT_BY_ID.get(state.mySeat);
  if (u && me && SEAT_BY_ID.get(u.seatId)?.bar === me.bar) {
    scene.say(m.from, '🍻 건배!');
    sfx.clink();
  }
});

function onSeated(seatId, { fromQueue, moved, silent } = {}) {
  const firstTime = state.phase !== 'seated';
  const seat = SEAT_BY_ID.get(seatId);
  state.mySeat = seatId;
  state.wantsIn = true;
  if (firstTime || moved) {
    state.logs.clear();
    state.unread.clear();
    $('log').replaceChildren();
    $('log').dataset.key = '';
    state.prevNeighbors = null;
    state.tab = 'bar';
    pushLog('bar', { system: true, text: `${seat.bar + 1}번 바에 앉았어요. 주문한 ${drinkOf(state.profile.drink).label}은 직원이 곧 가져다 드려요.` });
  }
  setPhase('seated');
  setMoveMode(false);
  setView('bar');
  refreshNeighbors();
  if (silent) return;
  sfx.seated();
  if (fromQueue) {
    navigator.vibrate?.([120, 60, 120]);
    toast('자리가 났어요! 바로 앉혀 드렸어요 🍶', 4500);
  } else if (moved) {
    toast(`${seat.bar + 1}번 바로 옮겨 앉았어요`);
  }
}

// ---------- 옆자리 ----------
function refreshNeighbors() {
  if (!state.mySeat) return;
  const ids = neighborSeats(state.mySeat);
  const bySeat = new Map(state.users.map((u) => [u.seatId, u]));
  const next = { left: bySeat.get(ids.left) || null, right: bySeat.get(ids.right) || null };
  const prev = state.prevNeighbors;
  if (prev) {
    for (const side of ['left', 'right']) {
      if (prev[side] === (next[side]?.id || null)) continue;
      if (next[side]) {
        pushLog('bar', { system: true, text: `${next[side].name} 님이 ${SIDE[side]} 자리에 앉았어요.` });
        toast(`${SIDE[side]} 자리에 ${next[side].name} 님이 앉았어요`);
      } else {
        pushLog('bar', { system: true, text: `${SIDE[side]} 자리 손님이 떠났어요.` });
      }
    }
  }
  state.prevNeighbors = { left: next.left?.id || null, right: next.right?.id || null };
  state.neighbors = next;
  renderTabs();
}

const tabKey = (tab = state.tab) => (tab === 'bar' ? 'bar' : state.neighbors[tab]?.id || null);

function renderTabs() {
  for (const btn of document.querySelectorAll('#dock .tabs button')) {
    const tab = btn.dataset.tab;
    const peer = tab === 'bar' ? null : state.neighbors[tab];
    const label = btn.querySelector('.tab-label');
    if (tab === 'bar') label.textContent = '우리 바';
    else label.textContent = peer ? peer.name : `${SIDE[tab]} 빈자리`;
    btn.dataset.gender = peer?.gender || '';
    btn.classList.toggle('empty', tab !== 'bar' && !peer);
    btn.classList.toggle('busy', !!peer?.busy);
    btn.setAttribute('aria-selected', String(tab === state.tab));
    btn.querySelector('.unread').hidden = !state.unread.has(tabKey(tab));
  }
  const peer = state.tab === 'bar' ? null : state.neighbors[state.tab];
  const input = $('msg');
  input.disabled = state.tab !== 'bar' && !peer;
  input.placeholder =
    state.tab === 'bar' ? '우리 바 손님들에게 한마디' : peer ? `${peer.name} 님에게만 보여요` : `${SIDE[state.tab]} 자리가 비어 있어요`;
  $('callBtn').hidden = !peer || voice.state !== 'idle';
  renderLog();
}

function selectTab(tab) {
  state.tab = tab;
  state.unread.delete(tabKey());
  renderTabs();
}

// ---------- 대화 기록 ----------
function pushLog(key, entry) {
  if (!state.logs.has(key)) state.logs.set(key, []);
  const list = state.logs.get(key);
  list.push(entry);
  if (list.length > 200) list.shift();
  if (key === tabKey()) appendLog(entry, true);
  else if (!entry.system && !entry.mine) {
    state.unread.add(key);
    renderTabs();
  }
}

function appendLog(entry, scroll) {
  const log = $('log');
  log.querySelector('.empty')?.remove();
  const row = el('div', `msg ${entry.system ? 'sys' : entry.mine ? 'me' : 'them'}`);
  if (!entry.system && !entry.mine) row.appendChild(el('span', 'who', entry.name));
  row.appendChild(el('span', 'text', entry.text));
  log.appendChild(row);
  if (scroll) log.scrollTop = log.scrollHeight;
}

function renderLog() {
  const log = $('log');
  const key = tabKey();
  if (log.dataset.key === String(key) && log.childElementCount) return;
  log.dataset.key = String(key);
  log.replaceChildren();
  const list = (key && state.logs.get(key)) || [];
  if (list.length === 0) {
    const peer = state.tab === 'bar' ? null : state.neighbors[state.tab];
    const text =
      state.tab === 'bar'
        ? '같은 바에 앉은 손님 모두에게 보이는 대화예요.'
        : peer
          ? `${peer.name} 님과 둘만 보는 대화예요. 먼저 인사를 건네 보세요. 📞 버튼으로 통화도 걸 수 있어요.`
          : `${SIDE[state.tab]} 자리가 아직 비어 있어요. 누군가 앉으면 여기서 1:1로 대화할 수 있어요.`;
    log.appendChild(el('div', 'empty', text));
  }
  for (const entry of list) appendLog(entry, false);
  log.scrollTop = log.scrollHeight;
}

// ---------- 도크 조작 ----------
for (const btn of document.querySelectorAll('#dock .tabs button')) btn.onclick = () => selectTab(btn.dataset.tab);

$('composer').onsubmit = (e) => {
  e.preventDefault();
  const input = $('msg');
  const text = input.value.trim();
  if (!text) return;
  if (state.tab === 'bar') net.send({ type: 'chat', scope: 'bar', text });
  else if (state.neighbors[state.tab]) net.send({ type: 'chat', scope: 'dm', to: state.neighbors[state.tab].id, text });
  else return;
  input.value = '';
};

$('cheersBtn').onclick = () => net.send({ type: 'emote', kind: 'cheers' });

$('orderBtn').onclick = () => {
  const menu = $('orderMenu');
  if (!menu.childElementCount) {
    for (const d of DRINKS) {
      const b = el('button', 'chip', `${d.emoji} ${d.label}`);
      b.type = 'button';
      b.onclick = () => {
        state.profile.drink = d.id;
        saveProfile();
        net.send({ type: 'order', drink: d.id });
        menu.hidden = true;
        toast(`${d.label} 주문했어요. 직원이 가져다 드릴게요.`);
      };
      menu.appendChild(b);
    }
  }
  menu.hidden = !menu.hidden;
};

function setMoveMode(on) {
  state.moveMode = on;
  scene.setMoveMode(on ? state.profile.gender : null);
  $('moveBtn').classList.toggle('on', on);
  $('moveBtn').textContent = on ? '✕ 옮기기 취소' : '💺 자리 옮기기';
  hint(on ? '빛나는 빈자리를 누르면 옮겨 앉아요' : '');
  if (on) {
    closeProfile();
    setView('overview');
  }
}
$('moveBtn').onclick = () => {
  setMoveMode(!state.moveMode);
  if (!state.moveMode) setView('bar');
};

$('viewBtn').onclick = () => setView(state.view === 'bar' ? 'overview' : 'bar');
$('leaveBtn').onclick = () => {
  voice.hangup();
  net.send({ type: 'leave' });
};
$('cancelWait').onclick = () => net.send({ type: 'leave' });

// ---------- 손님/빈자리 누르기 ----------
let profileTarget = null;
function closeProfile() {
  profileTarget = null;
  $('profile').hidden = true;
}

function renderProfile() {
  const actions = $('pfActions');
  actions.replaceChildren();
  const add = (label, cls, fn) => {
    const b = el('button', cls, label);
    b.type = 'button';
    b.onclick = fn;
    actions.appendChild(b);
    return b;
  };
  const mySeat = SEAT_BY_ID.get(state.mySeat);

  if (profileTarget?.seatId) {
    // 빈자리
    const seat = SEAT_BY_ID.get(profileTarget.seatId);
    if (state.byId.size && state.users.some((u) => u.seatId === seat.id)) return closeProfile();
    $('pfDot').style.background = 'transparent';
    $('pfName').textContent = `${seat.bar + 1}번 바 빈자리`;
    if (seat.gender === state.profile.gender) {
      $('pfMeta').textContent = '여기로 옮겨 앉을 수 있어요';
      add('여기로 옮기기', 'primary', () => {
        net.send({ type: 'move', seatId: seat.id });
        closeProfile();
      });
    } else {
      $('pfMeta').textContent = `성비를 맞추기 위해 ${GENDER[seat.gender]} 손님 자리로 비워 두었어요`;
    }
    return;
  }

  const u = state.byId.get(profileTarget?.userId);
  if (!u) return closeProfile();
  const seat = SEAT_BY_ID.get(u.seatId);
  $('pfDot').style.background = AVATAR_COLORS[u.color];
  $('pfName').textContent = u.id === state.myId ? `${u.name} (나)` : u.name;
  const meta = [GENDER[u.gender], drinkOf(u.drink).label, `${seat.bar + 1}번 바`];
  if (u.busy) meta.push('통화 중');
  $('pfMeta').textContent = meta.join(' · ');
  if (u.id === state.myId) return;

  const side = state.neighbors.left?.id === u.id ? 'left' : state.neighbors.right?.id === u.id ? 'right' : null;
  if (side) {
    add('💬 말 걸기', 'secondary', () => {
      selectTab(side);
      closeProfile();
      $('msg').focus();
    });
    if (voice.state === 'idle') {
      add('📞 통화 걸기', 'primary', () => {
        closeProfile();
        startCall(u.id);
      });
    }
  } else if (mySeat) {
    // 옆자리가 아니면: 그 손님 옆 빈자리로 옮길 수 있는지 안내
    const n = neighborSeats(u.seatId);
    const free = [n.left, n.right].find((id) => id && SEAT_BY_ID.get(id).gender === state.profile.gender && !state.users.some((x) => x.seatId === id));
    if (free) {
      $('pfMeta').textContent += ' · 옆자리에 앉으면 대화할 수 있어요';
      add('옆자리로 옮기기', 'primary', () => {
        net.send({ type: 'move', seatId: free });
        closeProfile();
      });
    } else {
      $('pfMeta').textContent += ' · 옆자리 손님과만 대화할 수 있어요';
    }
  }
  const blocked = state.blocked.has(u.id);
  add(blocked ? '차단 해제' : '차단', 'ghost', () => {
    if (blocked) state.blocked.delete(u.id);
    else {
      state.blocked.add(u.id);
      if (voice.peerId === u.id) voice.hangup();
    }
    toast(blocked ? '차단을 해제했어요' : `${u.name} 님의 메시지와 통화를 받지 않아요`);
    closeProfile();
  });
}

scene.onPickUser = (userId) => {
  if (state.phase !== 'seated' || !userId) return closeProfile();
  profileTarget = { userId };
  $('profile').hidden = false;
  renderProfile();
};
scene.onPickSeat = (seatId) => {
  if (state.phase !== 'seated') return;
  const seat = SEAT_BY_ID.get(seatId);
  if (state.moveMode) {
    if (seat.gender !== state.profile.gender) return toast(`${GENDER[seat.gender]} 손님 자리예요. 빛나는 자리를 골라 주세요.`);
    net.send({ type: 'move', seatId });
    return;
  }
  profileTarget = { seatId };
  $('profile').hidden = false;
  renderProfile();
};

// ---------- 통화 ----------
const nameOf = (id) => state.byId.get(id)?.name || '손님';
let ringTimer = null;
let callClock = null;

function startCall(userId) {
  unlockAudio();
  if (state.blocked.has(userId)) return toast('차단한 손님이에요.');
  voice.invite(userId);
}
$('callBtn').onclick = () => {
  const peer = state.neighbors[state.tab];
  if (peer) startCall(peer.id);
};
$('acceptBtn').onclick = () => {
  unlockAudio();
  voice.accept();
};
$('declineBtn').onclick = () => voice.decline();
$('hangBtn').onclick = () => voice.hangup();
$('muteBtn').onclick = () => {
  const muted = voice.toggleMute();
  $('muteBtn').textContent = muted ? '음소거 해제' : '음소거';
  $('muteBtn').classList.toggle('on', muted);
};

const END_REASON = {
  declined: '상대가 통화를 거절했어요.',
  busy: '상대가 다른 통화 중이에요.',
  unavailable: '상대가 잠시 자리를 비웠어요.',
  timeout: '응답이 없어 통화를 종료했어요.',
  hangup: '통화가 끝났어요.',
  moved: '상대가 자리를 옮겨 통화가 끝났어요.',
  left: '상대가 바를 떠나 통화가 끝났어요.',
  disconnected: '연결이 끊겨 통화가 끝났어요.',
};

voice.addEventListener('change', (e) => {
  const { state: vs, peerId, reason, message, lastPeer } = e.detail;
  clearInterval(ringTimer);
  clearInterval(callClock);
  $('incoming').hidden = vs !== 'ringing';
  $('callbar').hidden = vs === 'idle' || vs === 'ringing';
  $('callbar').dataset.state = vs;
  $('muteBtn').hidden = vs !== 'active';
  $('callTime').textContent = '';
  $('hangBtn').textContent = vs === 'calling' ? '취소' : '끊기';

  if (vs === 'ringing') {
    if (state.blocked.has(peerId)) return voice.decline();
    $('incTitle').textContent = `${nameOf(peerId)} 님이 통화를 걸었어요`;
    sfx.ring();
    navigator.vibrate?.([200, 100, 200]);
    ringTimer = setInterval(() => sfx.ring(), 2600);
  } else if (vs === 'calling') {
    $('callText').textContent = `${nameOf(peerId)} 님에게 거는 중…`;
  } else if (vs === 'connecting') {
    $('callText').textContent = `${nameOf(peerId)} 님과 연결 중…`;
  } else if (vs === 'active') {
    $('callText').textContent = `${nameOf(peerId)} 님과 통화 중`;
    $('muteBtn').textContent = voice.muted ? '음소거 해제' : '음소거';
    const tick = () => {
      const s = Math.floor((Date.now() - voice.startedAt) / 1000);
      $('callTime').textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    };
    tick();
    callClock = setInterval(tick, 1000);
  } else {
    scene.setSpeaking(state.myId, false);
    if (lastPeer) scene.setSpeaking(lastPeer, false);
    if (reason) sfx.hangup();
    const text = message || END_REASON[reason];
    if (text) toast(text);
  }
  if (state.phase === 'seated') renderTabs();
});

voice.addEventListener('level', (e) => {
  scene.setSpeaking(state.myId, e.detail.local);
  if (voice.peerId) scene.setSpeaking(voice.peerId, e.detail.remote);
});

// 팝오버 바깥을 누르면 닫기
document.addEventListener('pointerdown', (e) => {
  if (!$('orderMenu').hidden && !e.target.closest('#orderMenu, #orderBtn')) $('orderMenu').hidden = true;
  if (!$('profile').hidden && !e.target.closest('#profile, #stage')) closeProfile();
});

// 모바일 키보드가 올라오면 보이는 영역에 맞춰 화면 높이를 줄인다
if (window.visualViewport) {
  const vv = window.visualViewport;
  const fit = () => {
    const app = $('app');
    app.style.height = `${vv.height}px`;
    app.style.top = `${vv.offsetTop}px`;
  };
  vv.addEventListener('resize', fit);
  vv.addEventListener('scroll', fit);
}

buildEntry();
setPhase('lobby');
