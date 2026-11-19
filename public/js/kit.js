// 3D 공용 부품: 재질·도형, 사람(앉기/서기/걷기), 음료
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GEO } from '/shared/layout.js';

export { THREE };
export const TOP_Y = GEO.counterHeight + 0.07; // 카운터 상판 윗면
const SKIN = ['#f3cfae', '#e9bb92', '#dba77c', '#f7dcc4'];
const HAIR = ['#231c19', '#3a2a21', '#5b3c28', '#1b1c24', '#7b5b3c', '#44302a'];

export const hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
/** 항상 같은 결과를 내는 난수 (도시 풍경이 접속할 때마다 같도록) */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
export const clamp01 = (t) => Math.min(1, Math.max(0, t));
export const std = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0, ...opts });
export const glow = (color, opts = {}) => new THREE.MeshBasicMaterial({ color, toneMapped: false, ...opts });

export function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export const G = {
  torso: new THREE.CapsuleGeometry(0.19, 0.26, 6, 14),
  head: new THREE.SphereGeometry(0.175, 20, 16),
  hairCap: new THREE.SphereGeometry(0.188, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.56),
  hairBob: new THREE.SphereGeometry(0.2, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.72),
  bun: new THREE.SphereGeometry(0.075, 12, 10),
  eye: new THREE.SphereGeometry(0.018, 8, 8),
  arm: new THREE.CapsuleGeometry(0.052, 0.24, 4, 8),
  thigh: new THREE.CapsuleGeometry(0.07, 0.22, 4, 8),
  shin: new THREE.CapsuleGeometry(0.06, 0.3, 4, 8),
  leg: new THREE.CapsuleGeometry(0.075, 0.5, 4, 8),
  stoolSeat: new THREE.CylinderGeometry(0.2, 0.18, 0.08, 20),
  stoolPole: new THREE.CylinderGeometry(0.025, 0.025, 0.66, 8),
  stoolBase: new THREE.CylinderGeometry(0.19, 0.21, 0.03, 20),
  stoolRing: new THREE.TorusGeometry(0.15, 0.012, 6, 20),
  ring: new THREE.RingGeometry(0.3, 0.38, 40),
  hit: new THREE.CylinderGeometry(0.36, 0.36, 1.9, 8),
};
export const M = {
  eye: std('#1d1a1a', { roughness: 0.4 }),
  pants: std('#2a2e3a'),
  metal: std('#2b2c31', { roughness: 0.35, metalness: 0.8 }),
  brass: std('#c79a55', { roughness: 0.32, metalness: 0.8 }),
  glass: new THREE.MeshStandardMaterial({ color: '#ffffff', transparent: true, opacity: 0.26, roughness: 0.08, depthWrite: false }),
  pane: new THREE.MeshStandardMaterial({ color: '#9fc4e8', transparent: true, opacity: 0.1, roughness: 0.05, metalness: 0.3, depthWrite: false, side: THREE.DoubleSide }),
  cushion: { m: std('#3f628f', { roughness: 0.6 }), f: std('#b4566c', { roughness: 0.6 }) },
  staffShirt: std('#aeaaa2'),
  apron: std('#191a1f'),
};
const matCache = new Map();
export const colorMat = (hex, opts) => {
  const key = hex + JSON.stringify(opts || {});
  if (!matCache.has(key)) matCache.set(key, std(hex, opts));
  return matCache.get(key);
};

export function mesh(geo, mat, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  return m;
}
/** x0..x1, y0..y1, z0..z1 을 채우는 상자 */
export function box(mat, x0, x1, y0, y1, z0, z1, shadow = false) {
  const m = mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, shadow);
  m.receiveShadow = true;
  return m;
}

/**
 * 움직이지 않는 물체들을 재질별로 한 덩어리로 합친다 (그리는 횟수를 줄여 휴대폰에서도 부드럽게).
 * userData.dynamic 이 붙은 가지(문짝, 사람, 표시등 등)는 건드리지 않는다.
 */
export function mergeStatic(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map();
  const done = [];
  const visit = (o) => {
    if (o.userData.dynamic) return;
    if (o.isMesh && !o.isInstancedMesh && !Array.isArray(o.material) && o.visible && o.children.length === 0) {
      const key = `${o.material.uuid}${o.castShadow ? 'c' : ''}${o.receiveShadow ? 'r' : ''}`;
      if (!buckets.has(key)) buckets.set(key, { material: o.material, cast: o.castShadow, recv: o.receiveShadow, geos: [] });
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      buckets.get(key).geos.push(g);
      done.push(o);
      return;
    }
    for (const c of [...o.children]) visit(c);
  };
  for (const c of [...root.children]) visit(c);
  for (const o of done) o.parent.remove(o);
  for (const b of buckets.values()) {
    const m = new THREE.Mesh(mergeGeometries(b.geos, false), b.material);
    m.castShadow = b.cast;
    m.receiveShadow = b.recv;
    root.add(m);
  }
  return root;
}

// ---------- 사람(손님/직원) ----------
const HIP_Y = 0.78;
const ARM = { sit: { x: -1.18, z: -0.12 }, stand: { x: -0.06, z: 0.07 } };

/** 앉은 자세와 선 자세를 모두 가진 사람. setPose 로 바꾸고 walkCycle 로 걷는 동작을 준다. */
export function buildPerson({ color, seed, staff = false }) {
  const group = new THREE.Group();
  const body = new THREE.Group(); // 숨쉬기/끄덕임/걸을 때 들썩임
  group.add(body);
  const shirt = staff ? M.staffShirt : colorMat(color);
  const skin = colorMat(SKIN[seed % SKIN.length], { roughness: 0.6 });
  const hair = colorMat(HAIR[(seed >>> 3) % HAIR.length], { roughness: 0.9 });

  const torso = mesh(G.torso, shirt, 0, HIP_Y + 0.32, 0);
  const head = new THREE.Group();
  head.position.set(0, HIP_Y + 0.8, 0);
  head.add(mesh(G.head, skin));
  const style = (seed >>> 6) % 3;
  const hairMesh = mesh(style === 1 ? G.hairBob : G.hairCap, hair);
  hairMesh.rotation.x = -0.32;
  head.add(hairMesh);
  if (style === 2) head.add(mesh(G.bun, hair, 0, 0.19, -0.06));
  head.add(mesh(G.eye, M.eye, -0.062, 0.01, 0.162, false), mesh(G.eye, M.eye, 0.062, 0.01, 0.162, false));
  mergeStatic(head);

  const arms = [-1, 1].map((side) => {
    const pivot = new THREE.Group(); // 어깨
    pivot.position.set(side * 0.225, HIP_Y + 0.5, 0.02);
    pivot.add(mesh(G.arm, shirt, 0, -0.16, 0, false));
    pivot.userData.side = side;
    return pivot;
  });
  body.add(torso, head, ...arms);

  const sitLegs = new THREE.Group();
  for (const side of [-1, 1]) {
    const thigh = mesh(G.thigh, M.pants, side * 0.09, GEO.seatHeight + 0.08, 0.15);
    thigh.rotation.x = Math.PI / 2;
    sitLegs.add(thigh, mesh(G.shin, M.pants, side * 0.09, GEO.seatHeight - 0.14, 0.31));
  }
  mergeStatic(sitLegs);
  const legs = [-1, 1].map((side) => {
    const hip = new THREE.Group();
    hip.position.set(side * 0.09, HIP_Y + 0.02, 0);
    hip.add(mesh(G.leg, M.pants, 0, -0.4, 0, false));
    return hip;
  });
  const standLegs = new THREE.Group();
  standLegs.add(...legs);
  group.add(sitLegs, standLegs);

  if (staff) {
    body.add(mesh(new THREE.BoxGeometry(0.36, 0.5, 0.03), M.apron, 0, HIP_Y + 0.16, 0.185));
    body.add(mesh(new THREE.BoxGeometry(0.1, 0.045, 0.03), colorMat('#b8323a'), 0, HIP_Y + 0.6, 0.175));
  }
  group.userData.dynamic = true;
  const person = { group, body, head, torso, arms, legs, sitLegs, standLegs, pose: null, lift: 0 };
  setPose(person, 'stand');
  return person;
}

export function setPose(p, pose) {
  if (p.pose === pose) return;
  p.pose = pose;
  const sit = pose === 'sit';
  p.sitLegs.visible = sit;
  p.standLegs.visible = !sit;
  p.torso.rotation.x = sit ? 0.1 : 0;
  p.head.position.z = sit ? 0.035 : 0;
  p.lift = sit ? -0.02 : 0;
  for (const arm of p.arms) {
    arm.rotation.x = ARM[pose].x;
    arm.rotation.z = arm.userData.side * ARM[pose].z;
  }
  for (const leg of p.legs) leg.rotation.x = 0;
}

/** 선 자세에서 팔다리를 흔든다. amount 0 이면 가만히 선 자세. */
export function walkCycle(p, phase, amount) {
  const s = Math.sin(phase) * amount;
  p.legs[0].rotation.x = s * 0.6;
  p.legs[1].rotation.x = -s * 0.6;
  p.arms[0].rotation.x = ARM.stand.x - s * 0.45;
  p.arms[1].rotation.x = ARM.stand.x + s * 0.45;
  p.body.position.y = p.lift + Math.abs(Math.cos(phase)) * 0.035 * amount;
}

// ---------- 칵테일 ----------
export function buildDrink(kind) {
  const g = new THREE.Group();
  const add = (geo, mat, x, y, z) => {
    const m = mesh(geo, mat, x, y, z, false);
    g.add(m);
    return m;
  };
  // 아래 반지름 r, 높이 h, 위 반지름 r2 인 원기둥
  const cyl = (r, h, mat, x = 0, y = h / 2, z = 0, r2 = r) => add(new THREE.CylinderGeometry(r2, r, h, 14), mat, x, y, z);
  const liquid = (hex, opacity = 0.9) => colorMat(hex, { roughness: 0.25, transparent: opacity < 1, opacity });
  const solid = (hex) => colorMat(hex, { roughness: 0.6 });
  const ball = (hex, r, x, y, z = 0) => add(new THREE.SphereGeometry(r, 10, 8), solid(hex), x, y, z);
  const ice = (x, y) => add(new THREE.BoxGeometry(0.03, 0.03, 0.03), liquid('#f4fbff', 0.7), x, y, 0).rotation.set(0.4, 0.6, 0.2);
  const wheel = (hex, x, y) => (cyl(0.026, 0.007, solid(hex), x, y).rotation.z = Math.PI / 2 - 0.3); // 잔에 꽂은 과일 조각
  const straw = (hex) => (cyl(0.005, 0.21, solid(hex), 0.014, 0.125).rotation.z = -0.2);

  const tall = (hex, opacity = 0.82) => {
    cyl(0.036, 0.17, M.glass, 0, 0.085, 0, 0.042);
    cyl(0.031, 0.135, liquid(hex, opacity), 0, 0.07, 0, 0.037);
  };
  const rocks = (hex) => {
    cyl(0.042, 0.085, M.glass, 0, 0.0425, 0, 0.048);
    cyl(0.038, 0.04, liquid(hex, 0.92), 0, 0.022, 0, 0.042);
    ice(0.004, 0.05);
  };
  // 다리가 있는 잔: 받침 + 다리 + 위로 벌어지는 잔
  const stemmed = (hex, opacity, rim, depth = 0.06) => {
    cyl(0.036, 0.006, M.glass, 0, 0.003);
    cyl(0.006, 0.09, M.glass, 0, 0.05);
    cyl(0.005, depth, M.glass, 0, 0.095 + depth / 2, 0, rim);
    cyl(0.005, depth * 0.72, liquid(hex, opacity), 0, 0.095 + depth * 0.36, 0, rim * 0.74);
    return 0.095 + depth * 0.72; // 술의 수면 높이
  };

  if (kind === 'gintonic') {
    tall('#e4f4ee', 0.5);
    ice(0.006, 0.12);
    wheel('#7fc45a', 0.03, 0.165);
  } else if (kind === 'highball') {
    tall('#eccb72');
    ice(-0.004, 0.125);
    wheel('#f4dd4a', 0.03, 0.165);
  } else if (kind === 'mojito') {
    tall('#d6ecb4', 0.72);
    for (const [x, z] of [[0.012, 0.01], [-0.014, 0.004], [0, -0.016]]) add(new THREE.IcosahedronGeometry(0.016, 0), solid('#3f9a55'), x, 0.15, z);
    straw('#f2f2f2');
  } else if (kind === 'margarita') {
    stemmed('#dfe98f', 0.85, 0.07, 0.05);
    const salt = add(new THREE.TorusGeometry(0.07, 0.005, 6, 20), solid('#ffffff'), 0, 0.146, 0);
    salt.rotation.x = Math.PI / 2;
    wheel('#7fc45a', 0.066, 0.155);
  } else if (kind === 'negroni') {
    rocks('#c2331f');
    add(new THREE.BoxGeometry(0.05, 0.006, 0.014), solid('#f08a2c'), 0.006, 0.07, 0.01).rotation.set(0.2, 0.5, 0.25);
  } else if (kind === 'oldfashioned') {
    rocks('#b9661e');
    add(new THREE.BoxGeometry(0.05, 0.006, 0.014), solid('#f08a2c'), -0.004, 0.07, 0.012).rotation.set(0.2, -0.4, -0.2);
    ball('#9b1c2e', 0.011, 0.016, 0.052, -0.012);
  } else if (kind === 'martini') {
    const top = stemmed('#eef5ea', 0.45, 0.066);
    cyl(0.0025, 0.1, solid('#c9a15a'), 0.018, top + 0.012).rotation.z = -0.9;
    ball('#7c9440', 0.012, 0.004, top + 0.004);
  } else if (kind === 'espresso') {
    const top = stemmed('#2a1811', 1, 0.066);
    cyl(0.046, 0.006, solid('#e9d3b0'), 0, top + 0.002, 0, 0.049); // 크레마
    for (const x of [-0.012, 0, 0.012]) ball('#3a2015', 0.006, x, top + 0.007, x === 0 ? -0.006 : 0.004);
  } else {
    // 셜리 템플: 아래는 붉은 그레나딘, 위는 진저에일
    cyl(0.036, 0.17, M.glass, 0, 0.085, 0, 0.042);
    cyl(0.031, 0.06, liquid('#d6344a', 0.9), 0, 0.033, 0, 0.034);
    cyl(0.034, 0.075, liquid('#f3b46a', 0.8), 0, 0.1, 0, 0.037);
    ball('#c81e3a', 0.013, -0.01, 0.145);
    straw('#ef5d5d');
  }
  mergeStatic(g);
  g.scale.setScalar(1.9); // 멀리서도 보이도록 살짝 과장
  g.userData.dynamic = true;
  return g;
}
