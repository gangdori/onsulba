// 바 공간의 단일 기준(서버·클라이언트 공용).
// 위에서 본 모습 (z-가 뒷벽, z+가 손님 입구 쪽):
//
//   ████████████████ 백바(술 진열장) ████████████████
//   ░░░░░░░░░░░░░ 직원 통로(가로) ░░░░░░░░░░░░░░░░░░
//   ══╗░░╔══════╗░░╔══════╗░░╔══     ← 카운터가 ㄹ자(지그재그)로 이어짐
//     ║░░║      ║░░║      ║░░║
//     ║░░║      ║░░║      ║░░║       ░ = 직원이 드나드는 뚫린 가운데 통로
//     ╚══╝      ╚══╝      ╚══╝       손님은 튀어나온 바의 바깥 둘레에 앉음
//     1번 바     2번 바     3번 바

export const BAR_COUNT = 3;
export const SEATS_PER_BAR = 8;

export const GEO = {
  counterDepth: 0.7, // 카운터 상판 폭
  counterHeight: 1.05,
  laneWidth: 1.4, // 튀어나온 바 가운데 직원 통로 폭
  pitch: 6.2, // 바와 바 사이 중심 간격
  wallZ: -7.0, // 뒷벽
  backbarDepth: 0.6,
  corridorZ: -5.7, // 가로 직원 통로 중심
  frontZ: -5.0, // 연결 카운터의 통로 쪽 모서리
  tipZ: 0.0, // 튀어나온 바의 끝(손님 쪽) 모서리
  stoolGap: 0.46, // 카운터에서 스툴 중심까지
  seatHeight: 0.72,
  roomHalfWidth: 11.5,
  roomFrontZ: 10, // 루프탑 데크의 앞쪽 끝(난간)
};
GEO.barWidth = GEO.laneWidth + GEO.counterDepth * 2; // 튀어나온 바 전체 폭

export const barCenterX = (bar) => (bar - (BAR_COUNT - 1) / 2) * GEO.pitch;

const SIDE_Z = [-3.35, -2.3, -1.25]; // 옆면 좌석의 z (벽 쪽 → 끝 쪽)
const TIP_DX = 0.62; // 끝면 좌석 2개의 좌우 간격
const BAY_REACH = 3.1; // 바 중심에서, 바와 바 사이 손님 통로(베이) 중심까지

/** 손님이 걸어 다니는 길의 기준점 */
export const NAV = {
  aisleZ: 1.9, // 바 앞을 가로지르는 큰 통로
  wallX: 11.5, // 바와 엘리베이터 로비 사이 벽
  doorZ: 5.6,
  doorIn: { x: 10.5, z: 5.6 }, // 문 안쪽(바)
  doorOut: { x: 12.5, z: 5.6 }, // 문 바깥쪽(로비)
  elevator: { x: 18.6, z: 5.6 }, // 엘리베이터 문 앞
  foyer: { x0: 11.5, x1: 19.4, z0: 2.6, z1: 8.6 },
};

/**
 * 좌석은 바 둘레를 따라 왼쪽면(벽→끝) → 끝면 → 오른쪽면(끝→벽) 순서로 번호가 붙는다.
 * 그래서 order-1 은 항상 내 왼쪽, order+1 은 항상 내 오른쪽 자리다.
 * 남/여 자리는 번갈아 배치되어 양옆에는 항상 이성 자리가 온다.
 */
function buildSeats() {
  const seats = [];
  for (let bar = 0; bar < BAR_COUNT; bar++) {
    const cx = barCenterX(bar);
    const half = GEO.barWidth / 2;
    const spots = [
      // 왼쪽면: 오른쪽(+x)을 보고 앉음
      ...SIDE_Z.map((z) => ({ x: cx - half - GEO.stoolGap, z, face: [1, 0], lane: [cx, z], bayX: cx - BAY_REACH })),
      // 끝면: 뒷벽(-z)을 보고 앉음
      { x: cx - TIP_DX, z: GEO.tipZ + GEO.stoolGap, face: [0, -1], lane: [cx - 0.3, GEO.tipZ - GEO.counterDepth - 0.45] },
      { x: cx + TIP_DX, z: GEO.tipZ + GEO.stoolGap, face: [0, -1], lane: [cx + 0.3, GEO.tipZ - GEO.counterDepth - 0.45] },
      // 오른쪽면: 왼쪽(-x)을 보고 앉음
      ...[...SIDE_Z].reverse().map((z) => ({ x: cx + half + GEO.stoolGap, z, face: [-1, 0], lane: [cx, z], bayX: cx + BAY_REACH })),
    ];
    spots.forEach((s, order) => {
      seats.push({
        id: `${bar}-${order}`,
        bar,
        order,
        gender: (bar + order) % 2 === 0 ? 'm' : 'f',
        x: s.x,
        z: s.z,
        face: s.face, // 앉은 사람이 바라보는 방향 (x, z)
        bayX: s.bayX ?? null, // 옆면 좌석이면, 그 자리로 걸어 들어가는 베이 통로의 x
        // 음료가 놓이는 카운터 위 위치 (앉은 사람의 오른손 앞)
        drinkX: s.x + s.face[0] * (GEO.stoolGap + 0.3) - s.face[1] * 0.27,
        drinkZ: s.z + s.face[1] * (GEO.stoolGap + 0.3) + s.face[0] * 0.27,
        // 직원이 서빙하러 서는 통로 위 위치
        laneX: s.lane[0],
        laneZ: s.lane[1],
      });
    });
  }
  return seats;
}

export const SEATS = buildSeats();
export const SEAT_BY_ID = new Map(SEATS.map((s) => [s.id, s]));

/** 왼쪽/오른쪽 옆자리 id (없으면 null) */
export function neighborSeats(seatId) {
  const s = SEAT_BY_ID.get(seatId);
  if (!s) return { left: null, right: null };
  return {
    left: s.order > 0 ? `${s.bar}-${s.order - 1}` : null,
    right: s.order < SEATS_PER_BAR - 1 ? `${s.bar}-${s.order + 1}` : null,
  };
}

export function areNeighbors(a, b) {
  const n = neighborSeats(a);
  return n.left === b || n.right === b;
}

// ---------- 걸어 다니는 길 ----------
const QUEUE_PER_ROW = 6;
export const QUEUE_VISIBLE = QUEUE_PER_ROW * 2;

/** 대기 줄의 i번째 자리 (문 바로 옆이 0번, 로프를 따라 ㄹ자로 선다) */
export function queueSlot(i) {
  const k = Math.min(i, QUEUE_VISIBLE - 1);
  const row = Math.floor(k / QUEUE_PER_ROW);
  const col = k % QUEUE_PER_ROW;
  return { x: 12.9 + (row % 2 ? QUEUE_PER_ROW - 1 - col : col) * 0.95, z: 7.0 + row * 0.95 };
}

const BAY_XS = [...new Set(SEATS.map((s) => s.bayX).filter((x) => x != null))];
const seatApproach = (s) =>
  s.bayX == null ? [{ x: s.x, z: NAV.aisleZ }] : [{ x: s.bayX, z: NAV.aisleZ }, { x: s.bayX, z: s.z }];

/**
 * 카운터·스툴을 피해서 걷는 경로(꺾이는 점들)를 만든다.
 * @param from 지금 서 있는 위치 {x, z}
 * @param fromSeatId 지금 앉아 있는 자리(없으면 null)
 * @param target {seatId} 좌석으로, 또는 {point:{x,z}} 로비의 한 지점(대기 줄·엘리베이터)으로
 */
export function walkRoute(from, fromSeatId, target) {
  const pts = [];
  const fromSeat = fromSeatId ? SEAT_BY_ID.get(fromSeatId) : null;
  const toSeat = target.seatId ? SEAT_BY_ID.get(target.seatId) : null;
  const inFoyer = from.x > NAV.wallX;

  // 1) 지금 위치에서 열린 바닥(큰 통로)까지
  if (inFoyer) {
    if (toSeat) pts.push(NAV.doorOut, NAV.doorIn);
  } else if (fromSeat) {
    if (fromSeat.bayX != null) {
      pts.push({ x: fromSeat.bayX, z: fromSeat.z });
      if (toSeat && toSeat.bayX === fromSeat.bayX) {
        // 같은 베이 안에서는 큰 통로까지 나갈 필요 없음
        pts.push({ x: toSeat.bayX, z: toSeat.z }, { x: toSeat.x, z: toSeat.z });
        return pts;
      }
      pts.push({ x: fromSeat.bayX, z: NAV.aisleZ });
    } else {
      pts.push({ x: fromSeat.x, z: NAV.aisleZ });
    }
  } else if (from.z < 0.2) {
    // 베이 안쪽을 걷던 중: 베이 중심선으로 붙은 뒤 큰 통로로
    const bay = BAY_XS.reduce((a, b) => (Math.abs(b - from.x) < Math.abs(a - from.x) ? b : a));
    pts.push({ x: bay, z: from.z }, { x: bay, z: NAV.aisleZ });
  } else if (from.z < NAV.aisleZ - 0.2) {
    pts.push({ x: from.x, z: NAV.aisleZ });
  }

  // 2) 목적지까지
  if (toSeat) {
    pts.push(...seatApproach(toSeat), { x: toSeat.x, z: toSeat.z });
  } else {
    if (!inFoyer) pts.push(NAV.doorIn, NAV.doorOut);
    pts.push(target.point);
  }
  return pts.filter((p, i) => i === 0 || Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z) > 0.05);
}

// 칵테일 메뉴. 한 잔을 주문할 때마다 코인을 내고, 그만큼 바에 머물 시간이 늘어난다.
export const DRINKS = [
  { id: 'gintonic', section: 'long', label: '진토닉', en: 'Gin & Tonic', note: '진 · 토닉워터 · 라임', emoji: '🍸', price: 4, minutes: 15 },
  { id: 'highball', section: 'long', label: '하이볼', en: 'Whisky Highball', note: '위스키 · 탄산수 · 레몬', emoji: '🥃', price: 4, minutes: 15 },
  { id: 'mojito', section: 'long', label: '모히토', en: 'Mojito', note: '럼 · 민트 · 라임 · 소다', emoji: '🍹', price: 5, minutes: 20 },
  { id: 'margarita', section: 'sour', label: '마가리타', en: 'Margarita', note: '테킬라 · 트리플 섹 · 라임 · 소금 림', emoji: '🍸', price: 6, minutes: 25 },
  { id: 'negroni', section: 'stirred', label: '네그로니', en: 'Negroni', note: '진 · 캄파리 · 스위트 베르무트', emoji: '🥃', price: 6, minutes: 25 },
  { id: 'oldfashioned', section: 'stirred', label: '올드 패션드', en: 'Old Fashioned', note: '버번 · 비터스 · 설탕 · 오렌지 필', emoji: '🥃', price: 7, minutes: 30 },
  { id: 'martini', section: 'stirred', label: '드라이 마티니', en: 'Dry Martini', note: '진 · 드라이 베르무트 · 올리브', emoji: '🍸', price: 7, minutes: 30 },
  { id: 'espresso', section: 'after', label: '에스프레소 마티니', en: 'Espresso Martini', note: '보드카 · 에스프레소 · 커피 리큐어', emoji: '☕', price: 7, minutes: 30 },
  { id: 'shirley', section: 'zero', label: '셜리 템플', en: 'Shirley Temple', note: '논알콜 · 진저에일 · 그레나딘 · 체리', emoji: '🍒', price: 3, minutes: 15 },
];
/** 메뉴판의 장 구성 */
export const MENU_SECTIONS = [
  { id: 'long', title: 'Highball & Long', ko: '길고 시원하게' },
  { id: 'sour', title: 'Sour', ko: '새콤하게' },
  { id: 'stirred', title: 'Stirred & Strong', ko: '묵직하게' },
  { id: 'after', title: 'After Dinner', ko: '마무리로' },
  { id: 'zero', title: 'Zero Proof', ko: '논알콜' },
];
export const DRINK_BY_ID = new Map(DRINKS.map((d) => [d.id, d]));
/** 코인: 하루(한국 날짜)에 한 번 daily 만큼 지급, cap 까지만 쌓인다 */
export const WALLET = { daily: 20, cap: 40, unit: '코인' };
export const DRINK_IDS = DRINKS.map((d) => d.id);

export const AVATAR_COLORS = ['#e8845c', '#e6b84f', '#7fb77e', '#58a6a6', '#6f8fd6', '#a77bd1', '#d66f9b', '#c9c2b4'];
