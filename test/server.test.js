import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import WebSocket from 'ws';
import { createApp } from '../server/index.js';
import { areNeighbors } from '../shared/layout.js';

async function boot(options) {
  const app = createApp({ graceMs: 150, ringMs: 300, ...options });
  await new Promise((r) => app.server.listen(0, r));
  const url = `ws://127.0.0.1:${app.server.address().port}/ws`;
  return { ...app, url };
}

/** 테스트용 클라이언트: 받은 메시지를 쌓아 두고 조건에 맞는 메시지를 기다린다 */
function connect(url, session = crypto.randomUUID(), extra = {}) {
  const ws = new WebSocket(url);
  const inbox = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    const i = waiters.findIndex((w) => w.pred(msg));
    if (i >= 0) waiters.splice(i, 1)[0].resolve(msg);
    else inbox.push(msg);
  });
  const next = (pred, label = 'message') =>
    new Promise((resolve, reject) => {
      const i = inbox.findIndex(pred);
      if (i >= 0) return resolve(inbox.splice(i, 1)[0]);
      const t = setTimeout(() => reject(new Error(`timeout waiting for ${label}`)), 2000);
      waiters.push({ pred, resolve: (m) => (clearTimeout(t), resolve(m)) });
    });
  const type = (t) => next((m) => m.type === t, t);
  const sendMsg = (msg) => ws.send(JSON.stringify(msg));
  const ready = new Promise((r) => ws.on('open', r)).then(() => {
    sendMsg({ type: 'hello', session, ...extra });
    return type('welcome');
  });
  return { ws, session, next, type, send: sendMsg, ready, inbox };
}

async function enter(url, gender, name) {
  const c = connect(url);
  c.me = await c.ready;
  c.send({ type: 'join', gender, name, drink: 'beer', color: 1 });
  return c;
}

test('입장 → 옆자리 배정 → 1:1 채팅 → 통화 시그널 중계', async () => {
  const app = await boot();
  try {
    const a = await enter(app.url, 'm', '철수');
    const sa = await a.type('seated');
    const b = await enter(app.url, 'f', '영희');
    const sb = await b.type('seated');
    assert.ok(areNeighbors(sa.seatId, sb.seatId));

    // 1:1 채팅
    a.send({ type: 'chat', scope: 'dm', to: b.me.id, text: '  안녕하세요\n<b>!</b> ' });
    const got = await b.next((m) => m.type === 'chat');
    assert.equal(got.text, '안녕하세요 <b>!</b>');
    assert.equal(got.from, a.me.id);
    assert.equal(got.scope, 'dm');

    // 통화 성립 전에는 rtc 중계 안 됨
    a.send({ type: 'rtc', to: b.me.id, data: { sdp: 'x' } });
    a.send({ type: 'call', action: 'invite', to: b.me.id });
    assert.equal((await b.next((m) => m.type === 'call')).action, 'invite');
    assert.equal((await a.next((m) => m.type === 'call')).action, 'ringing');
    b.send({ type: 'call', action: 'accept', to: a.me.id });
    assert.equal((await a.next((m) => m.type === 'call')).action, 'accept');
    a.send({ type: 'rtc', to: b.me.id, data: { sdp: { type: 'offer' } } });
    const rtc = await b.type('rtc');
    assert.deepEqual(rtc.data, { sdp: { type: 'offer' } });
    assert.equal(rtc.from, a.me.id);

    // 통화 중 표시가 상태에 반영
    const st = await a.next((m) => m.type === 'state' && m.users.some((u) => u.busy));
    assert.equal(st.users.filter((u) => u.busy).length, 2);

    // 끊기
    b.send({ type: 'call', action: 'end' });
    const end = await a.next((m) => m.type === 'call' && m.action === 'end');
    assert.equal(end.reason, 'hangup');
  } finally {
    await app.close();
  }
});

test('성비 대기열: 대기 순번 안내 후 이성 입장 시 자동 착석', async () => {
  const app = await boot({ maxGap: 1 });
  try {
    const m1 = await enter(app.url, 'm', '남1');
    await m1.type('seated');
    const m2 = await enter(app.url, 'm', '남2');
    await m2.type('waiting');
    const q = await m2.type('queue');
    assert.equal(q.position, 1);
    assert.equal(q.reason, 'ratio');

    const f1 = await enter(app.url, 'f', '여1');
    await f1.type('seated');
    const seated = await m2.type('seated');
    assert.equal(seated.fromQueue, true);
    assert.deepEqual(app.bar.counts(), { m: 2, f: 1 });
  } finally {
    await app.close();
  }
});

test('옆자리가 아니면 채팅·통화 불가, 통화 무응답은 시간 초과', async () => {
  const app = await boot({ maxGap: 5 });
  try {
    const a = await enter(app.url, 'm', 'a');
    await a.type('seated');
    const b = await enter(app.url, 'f', 'b');
    await b.type('seated');
    const c = await enter(app.url, 'm', 'c');
    const sc = await c.type('seated');
    // c 는 b 옆, a 와는 옆자리가 아님
    assert.ok(!areNeighbors(sc.seatId, app.bar.seatOf(a.me.id)));
    c.send({ type: 'chat', scope: 'dm', to: a.me.id, text: 'hi' });
    assert.equal((await c.type('error')).code, 'not_neighbor');
    c.send({ type: 'call', action: 'invite', to: a.me.id });
    assert.equal((await c.type('error')).code, 'not_neighbor');

    // 바 전체 채팅은 같은 바 모두에게
    c.send({ type: 'chat', scope: 'bar', text: '건배!' });
    assert.equal((await a.next((m) => m.type === 'chat')).text, '건배!');

    // 무응답 → timeout
    c.send({ type: 'call', action: 'invite', to: b.me.id });
    await b.next((m) => m.type === 'call' && m.action === 'invite');
    const end = await c.next((m) => m.type === 'call' && m.action === 'end');
    assert.equal(end.reason, 'timeout');
    assert.equal((await b.next((m) => m.type === 'call' && m.action === 'end')).reason, 'timeout');
  } finally {
    await app.close();
  }
});

test('재접속하면 자리를 유지하고, 오래 끊기면 자리가 비워진다', async () => {
  const app = await boot({ graceMs: 200 });
  try {
    const a = await enter(app.url, 'm', 'a');
    const seat = (await a.type('seated')).seatId;
    a.ws.close();
    await new Promise((r) => setTimeout(r, 50));
    const again = connect(app.url, a.session);
    const w = await again.ready;
    assert.equal(w.status, 'seated');
    assert.equal(w.seatId, seat);
    assert.equal(w.id, a.me.id);

    again.ws.close();
    await new Promise((r) => setTimeout(r, 350));
    assert.deepEqual(app.bar.counts(), { m: 0, f: 0 });
  } finally {
    await app.close();
  }
});

test('통화 중 연결이 잠깐 끊겨도 통화는 유지되고, 돌아오지 않으면 끊긴다', async () => {
  const app = await boot({ graceMs: 200 });
  try {
    const a = await enter(app.url, 'm', 'a');
    await a.type('seated');
    const b = await enter(app.url, 'f', 'b');
    await b.type('seated');
    a.send({ type: 'call', action: 'invite', to: b.me.id });
    await b.next((m) => m.type === 'call' && m.action === 'invite');
    b.send({ type: 'call', action: 'accept', to: a.me.id });
    await a.next((m) => m.type === 'call' && m.action === 'accept');

    a.ws.close();
    await new Promise((r) => setTimeout(r, 50));
    const again = connect(app.url, a.session);
    assert.equal((await again.ready).callPeer, b.me.id, '재접속하면 통화 상대가 그대로');
    again.send({ type: 'rtc', to: b.me.id, data: { candidate: 'x' } });
    assert.deepEqual((await b.type('rtc')).data, { candidate: 'x' });

    again.ws.close();
    const end = await b.next((m) => m.type === 'call' && m.action === 'end');
    assert.equal(end.reason, 'left');
  } finally {
    await app.close();
  }
});

test('잘못된 입력은 무시되고 서버가 죽지 않는다', async () => {
  const app = await boot();
  try {
    const a = connect(app.url);
    await a.ready;
    a.ws.send('not json');
    a.send({ type: '__proto__' });
    a.send({ type: 'constructor' });
    a.send({ type: 'join', gender: 'x' });
    assert.equal((await a.type('error')).code, 'bad_request');
    a.send({ type: 'join', gender: 'f', name: 'ㅋ'.repeat(50), drink: 'nope', color: 99 });
    const s = await a.type('seated');
    assert.equal([...s.profile.name].length, 12);
    assert.equal(s.profile.drink, null, '첫 잔은 앉은 뒤에 주문한다');
    a.send({ type: 'move', seatId: 'zzz' });
    assert.equal((await a.type('error')).code, 'move_failed');
  } finally {
    await app.close();
  }
});

// ---------- 코인 · 체류 시간 ----------
const DAY = 24 * 3600e3;
const MIN = 60e3;
const device = () => crypto.randomUUID();
const wallet = (c, pred = () => true) => c.next((m) => m.type === 'wallet' && pred(m), 'wallet');

test('코인은 하루에 한 번만 지급되고, 주문할 때마다 값을 내고 그 잔의 시간만큼 머문다', async () => {
  let clock = Date.UTC(2026, 10, 18, 3); // 한국 시간 정오
  const app = await boot({ now: () => clock, dailyCoins: 20, coinCap: 40, tickMs: 20 });
  try {
    const dev = device();
    const a = connect(app.url, undefined, { device: dev });
    await a.ready;
    const w0 = await wallet(a);
    assert.equal(w0.balance, 20);
    assert.equal(w0.granted, true);

    a.send({ type: 'join', gender: 'm', name: 'a', color: 0 });
    await a.type('seated');
    const w1 = await wallet(a);
    assert.equal(w1.balance, 20, '앉는 것만으로는 코인이 줄지 않는다');
    assert.equal(w1.orderBy, clock + 3 * MIN, '3분 안에 주문해야 한다');

    a.send({ type: 'order', drink: 'mojito' }); // 5코인 · 20분
    const w2 = await wallet(a);
    assert.equal(w2.balance, 15);
    assert.equal(w2.stayUntil, clock + 20 * MIN);

    clock += 10 * MIN;
    a.send({ type: 'order', drink: 'shirley' }); // 3코인 · 15분 → 남은 10분 + 15분
    const w3 = await wallet(a);
    assert.equal(w3.balance, 12);
    assert.equal(w3.stayUntil, clock + 25 * MIN);

    // 같은 날 다시 접속해도 추가 지급 없음, 같은 기기로 두 자리를 차지할 수 없음
    const again = connect(app.url, undefined, { device: dev });
    await again.ready;
    const w4 = await wallet(again);
    assert.equal(w4.balance, 12);
    assert.equal(w4.granted, false);
    again.send({ type: 'join', gender: 'm', name: 'b', color: 0 });
    assert.equal((await again.type('error')).code, 'duplicate');

    // 다음 날: 접속 중이어도 한 번 지급 (상한 40)
    clock += DAY - 20 * MIN;
    const w5 = await wallet(again, (m) => m.granted);
    assert.equal(w5.balance, 32);
  } finally {
    await app.close();
  }
});

test('앉은 뒤 3분 안에 주문하지 않으면 쫓겨나고, 한동안 다시 올라올 수 없다', async () => {
  let clock = Date.UTC(2026, 10, 18, 3);
  const app = await boot({ now: () => clock, tickMs: 20 });
  try {
    const a = connect(app.url, undefined, { device: device() });
    await a.ready;
    a.send({ type: 'join', gender: 'f', name: 'a', color: 0 });
    await a.type('seated');

    // 나갔다 다시 와도 주문 마감은 늘어나지 않는다
    clock += 2 * MIN;
    a.send({ type: 'leave' });
    await a.type('left');
    a.send({ type: 'join', gender: 'f', name: 'a', color: 0 });
    await a.type('seated');
    assert.equal((await wallet(a, (m) => m.now === clock)).orderBy, clock + 1 * MIN);

    clock += 61e3;
    assert.equal((await a.type('left')).reason, 'noorder');
    assert.deepEqual(app.bar.counts(), { m: 0, f: 0 });

    a.send({ type: 'join', gender: 'f', name: 'a', color: 0 });
    assert.equal((await a.type('error')).code, 'cooldown');
    clock += 5 * MIN;
    a.send({ type: 'join', gender: 'f', name: 'a', color: 0 });
    await a.type('seated');
  } finally {
    await app.close();
  }
});

test('산 시간이 끝나면 나가야 하고, 남은 시간 안에는 나갔다 와도 다시 주문할 필요가 없다', async () => {
  let clock = Date.UTC(2026, 10, 18, 3);
  const app = await boot({ now: () => clock, tickMs: 20 });
  try {
    const a = connect(app.url, undefined, { device: device() });
    await a.ready;
    a.send({ type: 'join', gender: 'm', name: 'a', color: 0 });
    await a.type('seated');
    a.send({ type: 'order', drink: 'gintonic' }); // 4코인 · 15분
    await wallet(a, (m) => m.balance === 16);

    clock += 5 * MIN;
    a.send({ type: 'leave' });
    await a.type('left');
    a.send({ type: 'join', gender: 'm', name: 'a', color: 0 });
    await a.type('seated');
    clock += 4 * MIN; // 주문 없이 3분이 지나도 산 시간이 남아 있으면 그대로
    await new Promise((r) => setTimeout(r, 80));
    assert.deepEqual(app.bar.counts(), { m: 1, f: 0 });

    clock += 7 * MIN;
    assert.equal((await a.type('left')).reason, 'timeup');
  } finally {
    await app.close();
  }
});

test('코인이 모자라면 주문도 입장도 거절된다', async () => {
  const clock = Date.UTC(2026, 10, 18, 3);
  const app = await boot({ now: () => clock, dailyCoins: 8 });
  try {
    const a = connect(app.url, undefined, { device: device() });
    await a.ready;
    a.send({ type: 'join', gender: 'f', name: 'a', color: 0 });
    await a.type('seated');
    a.send({ type: 'order', drink: 'martini' }); // 7코인
    await wallet(a, (m) => m.balance === 1);
    a.send({ type: 'order', drink: 'gintonic' });
    assert.equal((await a.type('error')).code, 'no_coins');

    const poor = connect(app.url, undefined, { device: device() });
    await poor.ready;
    [...app.wallets.values()].at(-1).balance = 2; // 가장 싼 잔(3코인)도 못 사는 손님
    poor.send({ type: 'join', gender: 'm', name: 'p', color: 0 });
    assert.equal((await poor.type('error')).code, 'no_coins');
  } finally {
    await app.close();
  }
});

test('직원 부르기는 모두에게 전달된다', async () => {
  const app = await boot();
  try {
    const a = await enter(app.url, 'm', 'a');
    await a.type('seated');
    const b = await enter(app.url, 'f', 'b');
    await b.type('seated');
    a.send({ type: 'emote', kind: 'call' });
    const e = await b.next((m) => m.type === 'emote');
    assert.equal(e.kind, 'call');
    assert.equal(e.from, a.me.id);
  } finally {
    await app.close();
  }
});

test('서버가 재시작돼도 서명된 지갑 사본으로 잔액과 지급 기록이 이어지고, 위조는 통하지 않는다', async () => {
  const clock = Date.UTC(2026, 10, 18, 3);
  const opts = { now: () => clock, walletSecret: 'test-secret' };
  const dev = device();
  let token;
  const first = await boot(opts);
  try {
    const a = connect(first.url, undefined, { device: dev });
    await a.ready;
    a.send({ type: 'join', gender: 'f', name: 'a', color: 0 });
    await a.type('seated');
    a.send({ type: 'order', drink: 'negroni' }); // 6코인
    token = (await wallet(a, (m) => m.balance === 14)).token;
  } finally {
    await first.close();
  }
  const second = await boot(opts);
  try {
    const b = connect(second.url, undefined, { device: dev, wallet: token });
    await b.ready;
    const w = await wallet(b);
    assert.equal(w.balance, 14, '오늘 이미 받았으므로 다시 지급하지 않는다');
    assert.equal(w.granted, false);
    assert.equal(w.stayUntil, clock + 25 * MIN, '산 시간도 이어진다');

    const forged = { data: token.data.replace('"balance":14', '"balance":40'), sig: token.sig };
    const c = connect(second.url, undefined, { device: device(), wallet: forged });
    await c.ready;
    assert.equal((await wallet(c)).balance, 20, '위조된 사본은 무시하고 새 지갑으로');
  } finally {
    await second.close();
  }
});
