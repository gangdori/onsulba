import test from 'node:test';
import assert from 'node:assert/strict';
import { Bar } from '../server/bar.js';
import { SEATS, SEAT_BY_ID, areNeighbors, neighborSeats, BAR_COUNT, SEATS_PER_BAR, GEO, NAV, barCenterX, walkRoute, queueSlot } from '../shared/layout.js';

test('좌석 배치: 3개 바 × 8석, 남녀 자리가 번갈아 놓인다', () => {
  assert.equal(SEATS.length, BAR_COUNT * SEATS_PER_BAR);
  assert.equal(SEATS.filter((s) => s.gender === 'm').length, 12);
  for (const s of SEATS) {
    const { left, right } = neighborSeats(s.id);
    for (const n of [left, right]) {
      if (n) assert.notEqual(SEAT_BY_ID.get(n).gender, s.gender, `${s.id} 옆자리는 이성 자리여야 함`);
    }
  }
  assert.ok(areNeighbors('0-2', '0-3'));
  assert.ok(!areNeighbors('0-7', '1-0'), '다른 바끼리는 옆자리가 아님');
});

test('첫 손님은 바로 앉고, 이성 손님은 그 옆자리에 배정된다', () => {
  const bar = new Bar();
  const a = bar.join('a', 'm');
  assert.equal(a.status, 'seated');
  const b = bar.join('b', 'f');
  assert.equal(b.status, 'seated');
  assert.ok(areNeighbors(a.seatId, b.seatId));
  const c = bar.join('c', 'm');
  assert.ok(areNeighbors(c.seatId, b.seatId), '세 번째 손님도 기존 손님 옆에 붙어 앉는다');
});

test('성비가 기울면 대기열로 가고, 이성이 들어오면 자동 입장한다', () => {
  const bar = new Bar({ maxGap: 2 });
  assert.equal(bar.join('m1', 'm').status, 'seated');
  assert.equal(bar.join('m2', 'm').status, 'seated');
  assert.equal(bar.join('m3', 'm').status, 'waiting');
  assert.equal(bar.join('m4', 'm').status, 'waiting');
  assert.deepEqual(bar.queueInfo('m3'), { position: 1, total: 2, reason: 'ratio' });
  assert.equal(bar.queueInfo('m4').position, 2);

  const f1 = bar.join('f1', 'f');
  assert.equal(f1.status, 'seated');
  assert.deepEqual(f1.admitted, ['m3'], '여성 1명 입장 → 대기 1번 남성 입장');
  assert.equal(bar.queueInfo('m4').position, 1);
  assert.deepEqual(bar.counts(), { m: 3, f: 1 });
});

test('손님이 나가면 대기자가 선착순으로 들어온다', () => {
  const bar = new Bar({ maxGap: 1 });
  bar.join('m1', 'm');
  assert.equal(bar.join('m2', 'm').status, 'waiting');
  assert.equal(bar.join('m3', 'm').status, 'waiting');
  assert.deepEqual(bar.leave('m1'), ['m2']);
  assert.equal(bar.queueInfo('m3').position, 1);
  assert.deepEqual(bar.leave('m3'), [], '대기 중 이탈은 아무도 들이지 않음');
  assert.equal(bar.queue.m.length, 0);
});

test('한 성별 좌석이 꽉 차면 full 사유로 대기한다', () => {
  const bar = new Bar({ maxGap: 100 });
  for (let i = 0; i < 12; i++) assert.equal(bar.join(`m${i}`, 'm').status, 'seated');
  assert.equal(bar.join('m12', 'm').status, 'waiting');
  assert.equal(bar.queueInfo('m12').reason, 'full');
  assert.equal(bar.join('f0', 'f').status, 'seated');
});

test('자리 옮기기: 같은 성별 빈자리만 가능', () => {
  const bar = new Bar();
  const a = bar.join('a', 'm');
  const b = bar.join('b', 'f');
  assert.equal(bar.move('a', b.seatId).reason, 'gender');
  const femaleSeat = SEATS.find((s) => s.gender === 'f' && s.id !== b.seatId).id;
  assert.equal(bar.move('a', femaleSeat).reason, 'gender');
  const maleSeat = SEATS.find((s) => s.gender === 'm' && s.id !== a.seatId).id;
  assert.deepEqual(bar.move('a', maleSeat), { ok: true });
  assert.equal(bar.userAt(a.seatId), null);
  assert.equal(bar.userAt(maleSeat), 'a');
});

test('남녀가 번갈아 24명 들어오면 만석이 되고 성비는 12:12', () => {
  const bar = new Bar();
  for (let i = 0; i < 12; i++) {
    assert.equal(bar.join(`m${i}`, 'm').status, 'seated');
    assert.equal(bar.join(`f${i}`, 'f').status, 'seated');
  }
  assert.deepEqual(bar.counts(), { m: 12, f: 12 });
  assert.equal(new Set([...bar.users.values()].map((u) => u.seatId)).size, 24);
});

test('걷는 경로는 카운터와 다른 스툴을 지나가지 않는다', () => {
  // 카운터가 차지하는 사각형들 (여유 0.15m)
  const boxes = [];
  const pad = 0.15;
  for (let b = 0; b < BAR_COUNT; b++) {
    const cx = barCenterX(b);
    boxes.push([cx - GEO.barWidth / 2 - pad, cx + GEO.barWidth / 2 + pad, GEO.frontZ, GEO.tipZ + pad]);
  }
  boxes.push([-GEO.roomHalfWidth, GEO.roomHalfWidth, GEO.wallZ, GEO.frontZ + GEO.counterDepth + pad]);
  const blocked = (p) => boxes.some(([x0, x1, z0, z1]) => p.x > x0 && p.x < x1 && p.z > z0 && p.z < z1);

  const check = (from, fromSeatId, target, label) => {
    const route = walkRoute(from, fromSeatId, target);
    assert.ok(route.length > 0, label);
    const ends = [fromSeatId, target.seatId];
    let prev = from;
    for (const next of route) {
      for (let t = 0; t <= 1; t += 0.02) {
        const p = { x: prev.x + (next.x - prev.x) * t, z: prev.z + (next.z - prev.z) * t };
        assert.ok(!blocked(p), `${label}: 카운터를 통과 (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`);
        assert.ok(p.x < NAV.wallX - 0.3 || Math.abs(p.z - NAV.doorZ) < 0.6 || p.x > NAV.wallX + 0.3, `${label}: 벽을 통과`);
        for (const s of SEATS) {
          if (ends.includes(s.id)) continue;
          assert.ok(Math.hypot(p.x - s.x, p.z - s.z) > 0.45, `${label}: ${s.id} 스툴과 겹침`);
        }
      }
      prev = next;
    }
    const last = route.at(-1);
    const goal = target.seatId ? SEAT_BY_ID.get(target.seatId) : target.point;
    assert.ok(Math.hypot(last.x - goal.x, last.z - goal.z) < 1e-9, `${label}: 목적지에 도착`);
  };

  for (const to of SEATS) {
    check(NAV.elevator, null, { seatId: to.id }, `엘리베이터→${to.id}`);
    check(queueSlot(7), null, { seatId: to.id }, `대기줄→${to.id}`);
    check(to, to.id, { point: NAV.elevator }, `${to.id}→엘리베이터`);
    check({ x: to.bayX ?? to.x, z: to.bayX == null ? 1.2 : to.z }, null, { seatId: '1-4' }, `${to.id} 앞에서 방향 전환`);
    for (const from of SEATS) if (from.id !== to.id) check(from, from.id, { seatId: to.id }, `${from.id}→${to.id}`);
  }
});

test('대기 줄은 온 순서대로 서고, 서로 겹치지 않는다', () => {
  const bar = new Bar({ maxGap: 0 });
  bar.join('m1', 'm');
  bar.join('f1', 'f');
  bar.join('m2', 'm');
  bar.join('f2', 'f');
  bar.join('m3', 'm');
  assert.deepEqual(bar.waitingOrder(), ['m1', 'f1', 'm2', 'f2', 'm3'].filter((id) => !bar.seatOf(id)));
  const slots = Array.from({ length: 12 }, (_, i) => queueSlot(i));
  for (let i = 0; i < slots.length; i++) {
    assert.ok(slots[i].x > NAV.foyer.x0 + 0.5 && slots[i].x < NAV.foyer.x1 - 0.5 && slots[i].z < NAV.foyer.z1 - 0.3);
    for (let j = 0; j < i; j++) assert.ok(Math.hypot(slots[i].x - slots[j].x, slots[i].z - slots[j].z) > 0.8);
  }
});
