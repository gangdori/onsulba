// 건물 바깥벽을 타고 오르는 전망 엘리베이터 (한쪽 벽이 유리라 도시가 내려다보인다)
import { THREE, std, glow, box, M, mergeStatic } from './kit.js';
import { NAV } from '/shared/layout.js';

export const CAB = { x: 20.5, z: NAV.doorZ, half: 1.1, height: 2.5 };

export function buildElevator(scene) {
  const g = new THREE.Group();
  g.position.set(CAB.x, 0, CAB.z);
  const h = CAB.half;
  const H = CAB.height;
  const wood = std('#3a2418', { roughness: 0.6 });
  const dark = std('#15161b', { roughness: 0.6, metalness: 0.4 });

  g.add(box(std('#3a161c', { roughness: 0.95 }), -h, h, -0.08, 0, -h, h)); // 바닥 카펫
  g.add(box(dark, -h, h, H, H + 0.1, -h, h));
  g.add(box(glow('#ffe2bd'), -0.55, 0.55, H - 0.03, H - 0.01, -0.55, 0.55));
  for (const side of [-1, 1]) {
    const z = side * h;
    g.add(box(wood, -h, h, 0, H, Math.min(z, z + side * 0.06), Math.max(z, z + side * 0.06)));
    g.add(box(M.brass, -h + 0.1, h - 0.1, 0.98, 1.03, z - side * 0.07, z - side * 0.03)); // 손잡이
    g.add(box(M.brass, -h, h, 0, 0.1, z - side * 0.02, z)); // 걸레받이
  }
  // 바깥쪽 유리벽과 황동 프레임
  g.add(box(M.pane, h, h + 0.02, 0, H, -h, h));
  for (const z of [-h, 0, h]) g.add(box(M.brass, h - 0.02, h + 0.04, 0, H, z - 0.025, z + 0.025));
  g.add(box(M.brass, h - 0.02, h + 0.04, 1.0, 1.05, -h, h));

  // 문 (로비 쪽): 양쪽으로 열리는 두 짝
  const steel = std('#8b7a5e', { roughness: 0.4, metalness: 0.5 });
  g.add(box(dark, -h - 0.06, -h, 0, H, -h, -0.9), box(dark, -h - 0.06, -h, 0, H, 0.9, h), box(dark, -h - 0.06, -h, 2.2, H, -0.9, 0.9));
  const indicator = box(glow('#ffb35c'), -h + 0.001, -h + 0.02, 2.27, 2.4, -0.28, 0.28);
  g.add(indicator);
  const doors = [-1, 1].map((side) => {
    const d = box(steel, -h - 0.05, -h - 0.01, 0, 2.2, side < 0 ? -0.9 : 0, side < 0 ? 0 : 0.9);
    d.userData.closedZ = d.position.z;
    d.userData.side = side;
    d.userData.dynamic = true;
    g.add(d);
    return d;
  });

  const light = new THREE.PointLight(0xffd2a0, 7, 6, 1.6);
  light.position.set(0, H - 0.4, 0);
  g.add(light);
  mergeStatic(g);
  scene.add(g);

  let open = 0;
  return {
    group: g,
    light,
    get open() {
      return open;
    },
    /** 0 = 닫힘, 1 = 활짝 열림 */
    setOpen(k) {
      open = k;
      for (const d of doors) d.position.z = d.userData.closedZ + d.userData.side * 0.86 * k;
    },
  };
}
