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
  roomFrontZ: 7.5,
};
GEO.barWidth = GEO.laneWidth + GEO.counterDepth * 2; // 튀어나온 바 전체 폭

export const barCenterX = (bar) => (bar - (BAR_COUNT - 1) / 2) * GEO.pitch;

const SIDE_Z = [-3.35, -2.3, -1.25]; // 옆면 좌석의 z (벽 쪽 → 끝 쪽)
const TIP_DX = 0.62; // 끝면 좌석 2개의 좌우 간격

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
      ...SIDE_Z.map((z) => ({ x: cx - half - GEO.stoolGap, z, face: [1, 0], lane: [cx, z] })),
      // 끝면: 뒷벽(-z)을 보고 앉음
      { x: cx - TIP_DX, z: GEO.tipZ + GEO.stoolGap, face: [0, -1], lane: [cx - 0.3, GEO.tipZ - GEO.counterDepth - 0.45] },
      { x: cx + TIP_DX, z: GEO.tipZ + GEO.stoolGap, face: [0, -1], lane: [cx + 0.3, GEO.tipZ - GEO.counterDepth - 0.45] },
      // 오른쪽면: 왼쪽(-x)을 보고 앉음
      ...[...SIDE_Z].reverse().map((z) => ({ x: cx + half + GEO.stoolGap, z, face: [-1, 0], lane: [cx, z] })),
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

export const DRINKS = [
  { id: 'soju', label: '소주', emoji: '🍶' },
  { id: 'beer', label: '맥주', emoji: '🍺' },
  { id: 'highball', label: '하이볼', emoji: '🥃' },
  { id: 'wine', label: '와인', emoji: '🍷' },
  { id: 'whisky', label: '위스키', emoji: '🥃' },
  { id: 'soda', label: '논알콜', emoji: '🥤' },
];
export const DRINK_IDS = DRINKS.map((d) => d.id);

export const AVATAR_COLORS = ['#e8845c', '#e6b84f', '#7fb77e', '#58a6a6', '#6f8fd6', '#a77bd1', '#d66f9b', '#c9c2b4'];
