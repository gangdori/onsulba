// 좌석 배정 · 성비 균형 · 입장 대기열 (순수 로직 — 네트워크와 분리되어 테스트 가능)
import { SEATS, SEAT_BY_ID, neighborSeats } from '../shared/layout.js';

const other = (g) => (g === 'm' ? 'f' : 'm');

export class Bar {
  /** @param {{maxGap?: number, maxQueue?: number}} opts maxGap = 허용하는 남녀 인원 차이 */
  constructor({ maxGap = 2, maxQueue = 200 } = {}) {
    this.maxGap = maxGap;
    this.maxQueue = maxQueue;
    this.occupant = new Map(SEATS.map((s) => [s.id, null])); // seatId -> userId
    this.users = new Map(); // userId -> { id, gender, seatId, queuedAt }
    this.queue = { m: [], f: [] }; // 성별별 선착순 대기열 (userId)
    this.seq = 0; // 대기 순번
  }

  counts() {
    const c = { m: 0, f: 0 };
    for (const u of this.users.values()) if (u.seatId) c[u.gender]++;
    return c;
  }

  freeSeats(gender) {
    return SEATS.filter((s) => s.gender === gender && !this.occupant.get(s.id));
  }

  /** 이 성별이 지금 입장할 수 있는지. 못 하면 이유('full' | 'ratio')를 돌려준다. */
  admission(gender) {
    if (this.freeSeats(gender).length === 0) return { ok: false, reason: 'full' };
    const c = this.counts();
    if (c[gender] + 1 - c[other(gender)] > this.maxGap) return { ok: false, reason: 'ratio' };
    return { ok: true };
  }

  /** 옆에 사람이 있는 자리, 사람이 모여 있는 바를 우선해서 고른다. */
  pickSeat(gender) {
    let best = null;
    let bestScore = -Infinity;
    const barLoad = [0, 0, 0];
    for (const [seatId, uid] of this.occupant) if (uid) barLoad[SEAT_BY_ID.get(seatId).bar]++;
    for (const s of this.freeSeats(gender)) {
      const n = neighborSeats(s.id);
      const adjacent = [n.left, n.right].filter((id) => id && this.occupant.get(id)).length;
      const isTip = s.order === 3 || s.order === 4;
      const score = adjacent * 100 + barLoad[s.bar] * 10 + (isTip ? 2 : 0) - s.bar * 0.5 - s.order * 0.01;
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return best ? best.id : null;
  }

  /**
   * 입장 시도. 바로 앉거나(seated) 대기열에 선다(waiting).
   * admitted 는 이 입장으로 성비가 맞아 함께 들어오게 된 다른 대기자들.
   * @returns {{status:'seated'|'waiting'|'rejected', seatId?:string, reason?:string, admitted:string[]}}
   */
  join(id, gender) {
    if (this.users.has(id)) this.leave(id);
    const user = { id, gender, seatId: null, queuedAt: 0 };
    // 먼저 온 같은 성별 대기자가 있으면 새치기하지 않는다.
    if (this.queue[gender].length === 0 && this.admission(gender).ok) {
      this.users.set(id, user);
      this._seat(user, this.pickSeat(gender));
      return { status: 'seated', seatId: user.seatId, admitted: this.drain() };
    }
    if (this.queue.m.length + this.queue.f.length >= this.maxQueue) {
      return { status: 'rejected', reason: 'queue_full', admitted: [] };
    }
    user.queuedAt = ++this.seq;
    this.users.set(id, user);
    this.queue[gender].push(id);
    return { status: 'waiting', admitted: [] };
  }

  /** 나가기. 빈자리/성비 변화로 새로 입장하게 된 대기자 id 목록을 돌려준다. */
  leave(id) {
    const user = this.users.get(id);
    if (!user) return [];
    if (user.seatId) this.occupant.set(user.seatId, null);
    else this.queue[user.gender] = this.queue[user.gender].filter((x) => x !== id);
    this.users.delete(id);
    return this.drain();
  }

  move(id, seatId) {
    const user = this.users.get(id);
    const seat = SEAT_BY_ID.get(seatId);
    if (!user || !user.seatId || !seat) return { ok: false, reason: 'invalid' };
    if (seat.gender !== user.gender) return { ok: false, reason: 'gender' };
    if (this.occupant.get(seatId)) return { ok: false, reason: 'taken' };
    this.occupant.set(user.seatId, null);
    this._seat(user, seatId);
    return { ok: true };
  }

  /** 입장 가능한 대기자를 오래 기다린 순서로 들여보낸다. */
  drain() {
    const admitted = [];
    for (;;) {
      const heads = ['m', 'f']
        .filter((g) => this.queue[g].length > 0 && this.admission(g).ok)
        .map((g) => this.users.get(this.queue[g][0]));
      if (heads.length === 0) break;
      heads.sort((a, b) => a.queuedAt - b.queuedAt);
      const user = heads[0];
      this.queue[user.gender].shift();
      this._seat(user, this.pickSeat(user.gender));
      admitted.push(user.id);
    }
    return admitted;
  }

  queueInfo(id) {
    const user = this.users.get(id);
    if (!user || user.seatId) return null;
    const q = this.queue[user.gender];
    return { position: q.indexOf(id) + 1, total: q.length, reason: this.admission(user.gender).reason || 'ratio' };
  }

  /** 대기 중인 손님 전체를 온 순서대로 (문 앞에 서는 줄의 순서) */
  waitingOrder() {
    return [...this.queue.m, ...this.queue.f].sort((a, b) => this.users.get(a).queuedAt - this.users.get(b).queuedAt);
  }

  seatOf(id) {
    return this.users.get(id)?.seatId ?? null;
  }

  userAt(seatId) {
    return this.occupant.get(seatId) ?? null;
  }

  _seat(user, seatId) {
    user.seatId = seatId;
    user.queuedAt = 0;
    this.occupant.set(seatId, user.id);
  }
}
