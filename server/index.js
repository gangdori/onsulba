// 온술바 서버: 정적 파일 + WebSocket(입장/좌석/채팅/통화 시그널링)
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { Bar } from './bar.js';
import { SEAT_BY_ID, areNeighbors, DRINK_IDS, DRINK_BY_ID, WALLET, AVATAR_COLORS } from '../shared/layout.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

const NICK_A = ['조용한', '수줍은', '느긋한', '말랑한', '담백한', '포근한', '엉뚱한', '나른한', '솔직한', '반짝이는'];
const NICK_B = ['하이볼', '소주잔', '맥주거품', '안주왕', '올빼미', '퇴근러', '단골', '달빛', '얼음', '레몬'];
const randomNick = () => `${NICK_A[crypto.randomInt(NICK_A.length)]} ${NICK_B[crypto.randomInt(NICK_B.length)]}`;

function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  // 제어 문자 제거 후 공백 정리
  const s = value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim();
  return [...s].slice(0, max).join('');
}

/**
 * 지갑 사본 서명 키. WALLET_SECRET 을 설정하는 것이 원칙이고,
 * 없으면 Vercel 프로젝트 식별자에서 만들어 재시작해도 같은 키가 되게 한다(그것도 없으면 실행마다 임의).
 */
function defaultWalletSecret() {
  if (process.env.WALLET_SECRET) return process.env.WALLET_SECRET;
  const { VERCEL_PROJECT_ID, VERCEL_ORG_ID } = process.env;
  if (VERCEL_PROJECT_ID) return crypto.createHash('sha256').update(`onsulba-wallet:${VERCEL_ORG_ID ?? ''}:${VERCEL_PROJECT_ID}`).digest('hex');
  return crypto.randomBytes(32).toString('hex');
}

export function createApp(options = {}) {
  const {
    maxGap = Number(process.env.MAX_GENDER_GAP ?? 2),
    graceMs = Number(process.env.GRACE_MS ?? 20000),
    ringMs = 30000,
    maxClients = Number(process.env.MAX_CLIENTS ?? 500),
    iceServers = process.env.ICE_SERVERS ? JSON.parse(process.env.ICE_SERVERS) : DEFAULT_ICE,
    app = express(),
    now = Date.now, // 테스트에서 시계를 바꿔 끼울 수 있게
    tickMs = 2000,
    dailyCoins = Number(process.env.DAILY_COINS ?? WALLET.daily),
    coinCap = Number(process.env.COIN_CAP ?? WALLET.cap),
    walletSecret = defaultWalletSecret(),
    stayScale = Number(process.env.STAY_SCALE ?? 1), // 체류 시간 배율 (시험용으로 줄일 때)
    orderGraceMs = Number(process.env.ORDER_GRACE_MS ?? 180000), // 앉은 뒤 첫 주문까지 주어지는 시간
    graceCooldownMs = Number(process.env.GRACE_COOLDOWN_MS ?? 300000), // 주문 없이 나간 뒤 다시 올 수 있을 때까지
  } = options;

  const bar = new Bar({ maxGap });
  const bySession = new Map();
  const byId = new Map();

  // ---------- 지갑(코인)과 체류 시간 ----------
  // 로그인이 없으므로 기기 ID 단위로 관리한다. 서버가 재시작돼도 이어지도록,
  // 서버가 서명한 지갑 사본을 브라우저가 보관했다가 다시 제시한다.
  const wallets = new Map(); // device -> { balance, day, stayUntil }
  const dayKey = (ms) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10); // 한국 날짜
  const sign = (data) => crypto.createHmac('sha256', walletSecret).update(data).digest('base64url');

  function restoreWallet(device, token) {
    try {
      if (!token || typeof token.data !== 'string' || typeof token.sig !== 'string' || token.data.length > 400) return null;
      const want = Buffer.from(sign(token.data));
      const got = Buffer.from(token.sig);
      if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
      const d = JSON.parse(token.data);
      if (d.device !== device || !Number.isFinite(d.balance) || !Number.isFinite(d.stayUntil)) return null;
      return { balance: Math.max(0, Math.min(coinCap, Math.floor(d.balance))), day: String(d.day), stayUntil: d.stayUntil };
    } catch {
      return null;
    }
  }

  /** 하루에 한 번 코인 지급 */
  function grantDaily(w) {
    const today = dayKey(now());
    if (w.day === today) return false;
    w.balance = Math.min(coinCap, w.balance + dailyCoins);
    w.day = today;
    return true;
  }

  function walletOf(device, token) {
    let w = wallets.get(device);
    if (!w) {
      w = restoreWallet(device, token) || { balance: 0, day: null, stayUntil: 0 };
      if (wallets.size >= 20000) wallets.delete(wallets.keys().next().value);
      wallets.set(device, w);
    }
    return { wallet: w, granted: grantDaily(w) };
  }

  /** 지갑이 바뀌면 같은 기기의 모든 탭에 알린다 */
  function sendWallet(client, granted = false) {
    const w = client.wallet;
    const data = JSON.stringify({ device: client.device, balance: w.balance, day: w.day, stayUntil: w.stayUntil });
    const msg = { type: 'wallet', balance: w.balance, stayUntil: w.stayUntil, orderBy: w.graceUntil || 0, cooldownMs: graceCooldownMs, now: now(), granted, token: { data, sig: sign(data) } };
    for (const c of byId.values()) if (c.wallet === w) send(c, msg);
  }

  const passActive = (w) => w.stayUntil > now() + 5000;

  const MIN_PRICE = Math.min(...[...DRINK_BY_ID.values()].map((d) => d.price));

  /**
   * 자리에 앉는 순간. 이미 산 시간이 남아 있으면 그대로 머물고,
   * 없으면 orderGraceMs 안에 첫 잔을 주문해야 한다(나갔다 와도 이 마감은 다시 늘어나지 않는다).
   */
  function startStay(client) {
    const w = client.wallet;
    client.unpaid = !passActive(w);
    if (client.unpaid && !(w.graceUntil > now())) w.graceUntil = now() + orderGraceMs;
    client.orderedAt = 0;
    sendWallet(client);
  }

  // ---------- HTTP ----------
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'microphone=(self), camera=(), geolocation=()');
    next();
  });
  app.get('/healthz', (req, res) => res.json({ ok: true, ...bar.counts() }));
  app.use('/shared', express.static(path.join(ROOT, 'shared')));
  app.use('/vendor/three/build', express.static(path.join(ROOT, 'node_modules/three/build'), { maxAge: '7d' }));
  app.use('/vendor/three/examples/jsm', express.static(path.join(ROOT, 'node_modules/three/examples/jsm'), { maxAge: '7d' }));
  app.use('/vendor/pretendard', express.static(path.join(ROOT, 'node_modules/pretendard/dist/web/variable'), { maxAge: '7d' }));
  app.use(express.static(path.join(ROOT, 'public')));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 32 * 1024 });

  // ---------- 전송 도우미 ----------
  const send = (client, msg) => {
    if (client.ws && client.ws.readyState === 1) client.ws.send(JSON.stringify(msg));
  };
  const fail = (client, code, message) => send(client, { type: 'error', code, message });

  function snapshot() {
    const users = [];
    for (const c of byId.values()) {
      if (c.status !== 'seated') continue;
      users.push({
        id: c.id,
        name: c.profile.name,
        gender: c.profile.gender,
        drink: c.profile.drink,
        color: c.profile.color,
        seatId: bar.seatOf(c.id),
        orderedAt: c.orderedAt,
        busy: c.call?.state === 'active',
        away: !c.ws,
      });
    }
    // 문 앞 대기 줄 (온 순서)
    const queue = bar.waitingOrder().map((id) => {
      const c = byId.get(id);
      return { id, name: c.profile.name, gender: c.profile.gender, color: c.profile.color };
    });
    return {
      type: 'state',
      now: now(),
      users,
      queue,
      counts: bar.counts(),
      waiting: { m: bar.queue.m.length, f: bar.queue.f.length },
    };
  }

  function broadcastState() {
    const data = JSON.stringify(snapshot());
    for (const c of byId.values()) {
      if (!c.ws || c.ws.readyState !== 1) continue;
      c.ws.send(data);
      if (c.status === 'waiting') send(c, { type: 'queue', ...bar.queueInfo(c.id), counts: bar.counts() });
    }
  }

  function seatAdmitted(ids) {
    for (const id of ids) {
      const c = byId.get(id);
      if (!c) continue;
      c.status = 'seated';
      startStay(c);
      send(c, { type: 'seated', seatId: bar.seatOf(id), fromQueue: true });
    }
  }

  // ---------- 통화 ----------
  function clearCall(client) {
    if (client.callTimer) clearTimeout(client.callTimer);
    client.callTimer = null;
    client.call = null;
  }

  /** 통화(또는 신호 중인 통화)를 끊고 상대에게 알린다. */
  function endCall(client, reason) {
    if (!client.call) return false;
    const wasActive = client.call.state === 'active';
    const peer = byId.get(client.call.peer);
    clearCall(client);
    if (peer && peer.call?.peer === client.id) {
      clearCall(peer);
      send(peer, { type: 'call', action: 'end', from: client.id, reason });
    }
    return wasActive;
  }

  function onCall(client, msg) {
    const action = msg.action;
    if (action === 'invite') {
      const peer = byId.get(msg.to);
      if (client.call) return fail(client, 'call_busy', '이미 통화 중이에요.');
      if (!peer || peer.status !== 'seated' || !areNeighbors(bar.seatOf(client.id), bar.seatOf(peer.id))) {
        return fail(client, 'not_neighbor', '옆자리 손님에게만 통화를 걸 수 있어요.');
      }
      if (!peer.ws) return send(client, { type: 'call', action: 'unavailable', from: peer.id });
      if (peer.call) return send(client, { type: 'call', action: 'busy', from: peer.id });
      client.call = { peer: peer.id, state: 'out' };
      peer.call = { peer: client.id, state: 'in' };
      client.callTimer = setTimeout(() => {
        if (client.call?.state === 'out') {
          send(client, { type: 'call', action: 'end', from: peer.id, reason: 'timeout' });
          endCall(client, 'timeout');
        }
      }, ringMs);
      send(peer, { type: 'call', action: 'invite', from: client.id });
      send(client, { type: 'call', action: 'ringing', from: peer.id });
      return;
    }
    if (!client.call) return;
    const peer = byId.get(client.call.peer);
    if (action === 'accept' && client.call.state === 'in' && peer) {
      if (peer.callTimer) clearTimeout(peer.callTimer);
      peer.callTimer = null;
      client.call.state = 'active';
      peer.call.state = 'active';
      send(peer, { type: 'call', action: 'accept', from: client.id });
      broadcastState();
    } else if (action === 'decline' && client.call.state === 'in') {
      clearCall(client);
      if (peer) {
        clearCall(peer);
        send(peer, { type: 'call', action: 'decline', from: client.id });
      }
    } else if (action === 'end') {
      if (endCall(client, 'hangup')) broadcastState();
    }
  }

  // ---------- 입장/퇴장 ----------
  function leaveBar(client, reason) {
    if (client.status === 'lobby') return;
    const wasActive = endCall(client, reason);
    const admitted = bar.leave(client.id);
    client.status = 'lobby';
    seatAdmitted(admitted);
    return wasActive;
  }

  function removeClient(client) {
    if (client.graceTimer) clearTimeout(client.graceTimer);
    leaveBar(client, 'left');
    bySession.delete(client.session);
    byId.delete(client.id);
    broadcastState();
  }

  function allow(client, cost = 1, capacity = 8, perSec = 2) {
    // 토큰 버킷: 도배 방지
    const now = Date.now();
    client.tokens = Math.min(capacity, (client.tokens ?? capacity) + ((now - (client.tokenAt ?? now)) / 1000) * perSec);
    client.tokenAt = now;
    if (client.tokens < cost) return false;
    client.tokens -= cost;
    return true;
  }

  const handlers = {
    join(client, msg) {
      const gender = msg.gender === 'm' || msg.gender === 'f' ? msg.gender : null;
      if (!gender) return fail(client, 'bad_request', '성별을 선택해 주세요.');
      for (const c of byId.values()) {
        if (c !== client && c.device === client.device && c.status !== 'lobby') {
          return fail(client, 'duplicate', '이미 다른 탭에서 입장해 있어요.');
        }
      }
      const w = client.wallet;
      if (!passActive(w)) {
        if (w.balance < MIN_PRICE) return fail(client, 'no_coins', `${WALLET.unit}이 부족해요. 내일 다시 채워져요.`);
        const sinceKick = now() - (w.graceUntil || 0);
        if (w.graceUntil && sinceKick >= 0 && sinceKick < graceCooldownMs) {
          const mins = Math.ceil((graceCooldownMs - sinceKick) / 60e3);
          return fail(client, 'cooldown', `주문 없이 자리를 떠나셨어요. ${mins}분 뒤에 다시 올라올 수 있어요.`);
        }
      }
      leaveBar(client, 'left');
      client.profile = {
        name: cleanText(msg.name, 12) || randomNick(),
        gender,
        drink: null, // 자리에 앉은 뒤 직원에게 주문한다
        color: Number.isInteger(msg.color) && msg.color >= 0 && msg.color < AVATAR_COLORS.length ? msg.color : 0,
      };
      const r = bar.join(client.id, gender);
      if (r.status === 'rejected') {
        fail(client, 'queue_full', '지금은 대기 인원이 너무 많아요. 잠시 후 다시 와 주세요.');
      } else if (r.status === 'seated') {
        client.status = 'seated';
        startStay(client);
        send(client, { type: 'seated', seatId: r.seatId, profile: client.profile });
      } else {
        client.status = 'waiting';
        send(client, { type: 'waiting', profile: client.profile });
      }
      seatAdmitted(r.admitted);
      broadcastState();
    },

    leave(client) {
      if (client.status === 'lobby') return;
      leaveBar(client, 'left');
      send(client, { type: 'left' });
      broadcastState();
    },

    move(client, msg) {
      if (client.status !== 'seated') return;
      const r = bar.move(client.id, msg.seatId);
      if (!r.ok) {
        const why = { gender: '성비를 맞추기 위해 이 자리는 앉을 수 없어요.', taken: '이미 다른 손님이 앉은 자리예요.' };
        return fail(client, 'move_failed', why[r.reason] || '옮길 수 없는 자리예요.');
      }
      endCall(client, 'moved');
      send(client, { type: 'seated', seatId: msg.seatId, moved: true });
      broadcastState();
    },

    chat(client, msg) {
      if (client.status !== 'seated') return;
      const text = cleanText(msg.text, 200);
      if (!text) return;
      if (!allow(client, 1)) return fail(client, 'rate_limited', '조금 천천히 보내 주세요.');
      const mySeat = SEAT_BY_ID.get(bar.seatOf(client.id));
      const out = { type: 'chat', scope: 'bar', from: client.id, name: client.profile.name, text, ts: Date.now() };
      if (msg.scope === 'dm') {
        const peer = byId.get(msg.to);
        if (!peer || peer.status !== 'seated' || !areNeighbors(mySeat.id, bar.seatOf(peer.id))) {
          return fail(client, 'not_neighbor', '옆자리 손님에게만 말을 걸 수 있어요.');
        }
        out.scope = 'dm';
        out.to = peer.id;
        send(peer, out);
        send(client, out);
        return;
      }
      for (const c of byId.values()) {
        if (c.status === 'seated' && SEAT_BY_ID.get(bar.seatOf(c.id)).bar === mySeat.bar) send(c, out);
      }
    },

    emote(client, msg) {
      // cheers = 건배, call = 직원 부르기 (모두의 화면에서 직원이 그 자리로 걸어간다)
      if (client.status !== 'seated' || !['cheers', 'call'].includes(msg.kind)) return;
      if (!allow(client, 2)) return;
      const out = { type: 'emote', from: client.id, kind: msg.kind };
      for (const c of byId.values()) send(c, out);
    },

    order(client, msg) {
      if (client.status !== 'seated' || !DRINK_IDS.includes(msg.drink)) return;
      if (!allow(client, 3)) return fail(client, 'rate_limited', '주문이 너무 빨라요. 천천히 드세요 :)');
      const drink = DRINK_BY_ID.get(msg.drink);
      const w = client.wallet;
      if (w.balance < drink.price) return fail(client, 'no_coins', `${WALLET.unit}이 부족해요. 내일 다시 채워져요.`);
      // 한 잔 더 = 머무는 시간 연장
      w.balance -= drink.price;
      w.stayUntil = Math.max(w.stayUntil, now()) + drink.minutes * 60e3 * stayScale;
      w.graceUntil = 0;
      client.unpaid = false;
      client.profile.drink = msg.drink;
      client.orderedAt = now();
      sendWallet(client);
      broadcastState();
    },

    call(client, msg) {
      if (client.status === 'seated') onCall(client, msg);
    },

    rtc(client, msg) {
      // WebRTC 시그널(offer/answer/ICE)은 통화가 성립된 두 사람 사이에서만 중계
      if (client.call?.state !== 'active' || client.call.peer !== msg.to) return;
      if (typeof msg.data !== 'object' || msg.data === null) return;
      const peer = byId.get(msg.to);
      if (peer) send(peer, { type: 'rtc', from: client.id, data: msg.data });
    },
  };

  function hello(ws, msg) {
    const session = typeof msg.session === 'string' && /^[\w-]{16,64}$/.test(msg.session) ? msg.session : null;
    if (!session) return null;
    let client = bySession.get(session);
    if (client) {
      // 재접속(새로고침·네트워크 끊김): 앉아 있던 자리/대기 순번 유지
      if (client.graceTimer) clearTimeout(client.graceTimer);
      client.graceTimer = null;
      if (client.ws && client.ws !== ws) {
        const old = client.ws;
        client.ws = null;
        old.client = null;
        old.close(4001, 'replaced');
      }
    } else {
      if (byId.size >= maxClients) {
        ws.close(1013, 'server_full');
        return null;
      }
      client = { session, id: crypto.randomBytes(6).toString('base64url'), status: 'lobby', profile: null, orderedAt: 0, call: null };
      // 지갑은 기기 단위 (기기 ID 가 없으면 이 접속 한정)
      client.device = typeof msg.device === 'string' && /^[\w-]{16,64}$/.test(msg.device) ? msg.device : session;
      bySession.set(session, client);
      byId.set(client.id, client);
    }
    const { wallet, granted } = walletOf(client.device, msg.wallet);
    client.wallet = wallet;
    client.ws = ws;
    ws.client = client;
    send(client, {
      type: 'welcome',
      id: client.id,
      status: client.status,
      seatId: bar.seatOf(client.id),
      profile: client.profile,
      callPeer: client.call?.state === 'active' ? client.call.peer : null,
      iceServers,
      maxGap,
    });
    sendWallet(client, granted);
    if (client.status === 'lobby') {
      send(client, snapshot());
    } else {
      broadcastState(); // away 표시 해제
    }
    return client;
  }

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => (ws.isAlive = true));
    ws.on('error', () => {});
    ws.on('message', (raw, isBinary) => {
      if (isBinary) return;
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
      if (msg.type === 'hello') {
        if (!ws.client) hello(ws, msg);
        return;
      }
      const client = ws.client;
      if (!client || !Object.hasOwn(handlers, msg.type)) return;
      try {
        handlers[msg.type](client, msg);
      } catch (err) {
        console.error('handler error', msg.type, err);
      }
    });
    ws.on('close', () => {
      const client = ws.client;
      if (!client || client.ws !== ws) return;
      client.ws = null;
      // 연결된 통화는 음성이 P2P라 신호 연결이 잠깐 끊겨도 이어진다. 울리는 중인 통화만 정리.
      if (client.call?.state !== 'active') endCall(client, 'disconnected');
      if (client.status === 'lobby') return removeClient(client);
      // 잠깐의 끊김은 자리를 지켜 준다 (돌아오지 않으면 removeClient 가 통화도 끊는다)
      client.graceTimer = setTimeout(() => removeClient(client), graceMs);
      if (client.status === 'seated') broadcastState();
    });
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 25000);

  // 시간이 다 된 손님은 내보내고, 날짜가 바뀌면 접속 중인 손님에게도 코인을 지급한다
  const ticker = setInterval(() => {
    let changed = false;
    for (const c of byId.values()) {
      if (grantDaily(c.wallet)) sendWallet(c, true);
      if (c.status === 'seated' && c.wallet.stayUntil <= now() && !(c.wallet.graceUntil > now())) {
        leaveBar(c, 'left');
        // 한 잔도 주문하지 않았으면 noorder, 산 시간을 다 썼으면 timeup
        send(c, { type: 'left', reason: c.unpaid ? 'noorder' : 'timeup' });
        changed = true;
      }
    }
    if (changed) broadcastState();
  }, tickMs);

  function close() {
    clearInterval(heartbeat);
    clearInterval(ticker);
    for (const c of byId.values()) {
      if (c.graceTimer) clearTimeout(c.graceTimer);
      if (c.callTimer) clearTimeout(c.callTimer);
    }
    for (const ws of wss.clients) ws.terminate();
    return new Promise((resolve) => wss.close(() => server.close(resolve)));
  }

  return { server, bar, wallets, close };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 3000);
  const { server } = createApp();
  server.listen(port, () => console.log(`온술바 열림 → http://localhost:${port}`));
}
