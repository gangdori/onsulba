// 온술바 서버: 정적 파일 + WebSocket(입장/좌석/채팅/통화 시그널링)
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { Bar } from './bar.js';
import { SEAT_BY_ID, areNeighbors, DRINK_IDS, AVATAR_COLORS } from '../shared/layout.js';

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

export function createApp(options = {}) {
  const {
    maxGap = Number(process.env.MAX_GENDER_GAP ?? 2),
    graceMs = Number(process.env.GRACE_MS ?? 20000),
    ringMs = 30000,
    maxClients = Number(process.env.MAX_CLIENTS ?? 500),
    iceServers = process.env.ICE_SERVERS ? JSON.parse(process.env.ICE_SERVERS) : DEFAULT_ICE,
  } = options;

  const bar = new Bar({ maxGap });
  const bySession = new Map();
  const byId = new Map();

  // ---------- HTTP ----------
  const app = express();
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
    return {
      type: 'state',
      now: Date.now(),
      users,
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
      c.orderedAt = Date.now();
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
      leaveBar(client, 'left');
      client.profile = {
        name: cleanText(msg.name, 12) || randomNick(),
        gender,
        drink: DRINK_IDS.includes(msg.drink) ? msg.drink : DRINK_IDS[0],
        color: Number.isInteger(msg.color) && msg.color >= 0 && msg.color < AVATAR_COLORS.length ? msg.color : 0,
      };
      const r = bar.join(client.id, gender);
      if (r.status === 'rejected') {
        fail(client, 'queue_full', '지금은 대기 인원이 너무 많아요. 잠시 후 다시 와 주세요.');
      } else if (r.status === 'seated') {
        client.status = 'seated';
        client.orderedAt = Date.now();
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
      if (client.status !== 'seated' || msg.kind !== 'cheers') return;
      if (!allow(client, 2)) return;
      const out = { type: 'emote', from: client.id, kind: 'cheers' };
      for (const c of byId.values()) send(c, out);
    },

    order(client, msg) {
      if (client.status !== 'seated' || !DRINK_IDS.includes(msg.drink)) return;
      if (!allow(client, 3)) return fail(client, 'rate_limited', '주문이 너무 빨라요. 천천히 드세요 :)');
      client.profile.drink = msg.drink;
      client.orderedAt = Date.now();
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
      bySession.set(session, client);
      byId.set(client.id, client);
    }
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

  function close() {
    clearInterval(heartbeat);
    for (const c of byId.values()) {
      if (c.graceTimer) clearTimeout(c.graceTimer);
      if (c.callTimer) clearTimeout(c.callTimer);
    }
    for (const ws of wss.clients) ws.terminate();
    return new Promise((resolve) => wss.close(() => server.close(resolve)));
  }

  return { server, bar, close };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 3000);
  const { server } = createApp();
  server.listen(port, () => console.log(`온술바 열림 → http://localhost:${port}`));
}
