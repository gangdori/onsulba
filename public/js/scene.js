// 3D 바 공간: 지그재그(ㄹ자) 카운터에 튀어나온 바 3개, 가운데 통로를 오가는 직원, 앉은 손님들
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GEO, SEATS, SEAT_BY_ID, BAR_COUNT, barCenterX, AVATAR_COLORS } from '/shared/layout.js';

const TOP_Y = GEO.counterHeight + 0.07; // 카운터 상판 윗면
const BG = 0x0c0e15;
const SKIN = ['#f3cfae', '#e9bb92', '#dba77c', '#f7dcc4'];
const HAIR = ['#231c19', '#3a2a21', '#5b3c28', '#1b1c24', '#7b5b3c', '#44302a'];

const hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const std = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0, ...opts });

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ---------- 공용 지오메트리/머티리얼 ----------
const G = {
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
const M = {
  eye: std('#1d1a1a', { roughness: 0.4 }),
  pants: std('#2a2e3a'),
  metal: std('#2b2c31', { roughness: 0.35, metalness: 0.8 }),
  brass: std('#c79a55', { roughness: 0.3, metalness: 0.9 }),
  glass: new THREE.MeshStandardMaterial({ color: '#ffffff', transparent: true, opacity: 0.26, roughness: 0.08, depthWrite: false }),
  cushion: { m: std('#3f628f', { roughness: 0.6 }), f: std('#b4566c', { roughness: 0.6 }) },
  staffShirt: std('#c4c0b8'),
  apron: std('#191a1f'),
};
const matCache = new Map();
const colorMat = (hex, opts) => {
  const key = hex + JSON.stringify(opts || {});
  if (!matCache.has(key)) matCache.set(key, std(hex, opts));
  return matCache.get(key);
};

function mesh(geo, mat, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  return m;
}

// ---------- 사람(손님/직원) ----------
function buildPerson({ color, seed, standing = false, staff = false }) {
  const group = new THREE.Group();
  const body = new THREE.Group(); // 숨쉬기/끄덕임 애니메이션용
  group.add(body);
  const baseY = standing ? 0.78 : GEO.seatHeight + 0.04;
  const shirt = staff ? M.staffShirt : colorMat(color);
  const skin = colorMat(SKIN[seed % SKIN.length], { roughness: 0.6 });
  const hair = colorMat(HAIR[(seed >>> 3) % HAIR.length], { roughness: 0.9 });

  const torso = mesh(G.torso, shirt, 0, baseY + 0.32, 0);
  torso.rotation.x = standing ? 0 : 0.1;
  const head = new THREE.Group();
  head.position.set(0, baseY + 0.8, standing ? 0 : 0.035);
  head.add(mesh(G.head, skin));
  const style = (seed >>> 6) % 3;
  const hairMesh = mesh(style === 1 ? G.hairBob : G.hairCap, hair);
  hairMesh.rotation.x = -0.32;
  head.add(hairMesh);
  if (style === 2) head.add(mesh(G.bun, hair, 0, 0.19, -0.06));
  head.add(mesh(G.eye, M.eye, -0.062, 0.01, 0.162, false), mesh(G.eye, M.eye, 0.062, 0.01, 0.162, false));

  const arms = [-1, 1].map((side) => {
    const pivot = new THREE.Group(); // 어깨
    pivot.position.set(side * 0.225, baseY + 0.5, 0.02);
    const arm = mesh(G.arm, staff ? M.staffShirt : shirt, 0, -0.16, 0);
    pivot.add(arm);
    pivot.rotation.x = standing ? -0.08 : -1.18; // 앉으면 팔을 카운터에 올림
    pivot.rotation.z = side * (standing ? 0.08 : -0.12);
    return pivot;
  });
  body.add(torso, head, ...arms);

  if (standing) {
    group.add(mesh(G.leg, M.pants, -0.09, 0.4, 0), mesh(G.leg, M.pants, 0.09, 0.4, 0));
  } else {
    for (const side of [-1, 1]) {
      const thigh = mesh(G.thigh, M.pants, side * 0.09, GEO.seatHeight + 0.08, 0.15);
      thigh.rotation.x = Math.PI / 2;
      group.add(thigh, mesh(G.shin, M.pants, side * 0.09, GEO.seatHeight - 0.14, 0.31));
    }
  }
  if (staff) {
    body.add(mesh(new THREE.BoxGeometry(0.36, 0.5, 0.03), M.apron, 0, baseY + 0.16, 0.185));
    body.add(mesh(new THREE.BoxGeometry(0.1, 0.045, 0.03), colorMat('#b8323a'), 0, baseY + 0.6, 0.175));
  }
  return { group, body, head, arms };
}

// ---------- 음료 ----------
function buildDrink(kind) {
  const g = new THREE.Group();
  const cyl = (r, h, mat, x = 0, y = h / 2, z = 0, r2 = r) => {
    const m = mesh(new THREE.CylinderGeometry(r2, r, h, 14), mat, x, y, z, false);
    g.add(m);
    return m;
  };
  const liquid = (hex, opacity = 0.9) => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.25, transparent: opacity < 1, opacity });
  if (kind === 'soju') {
    const green = liquid('#3fae70', 0.82);
    cyl(0.034, 0.17, green, -0.05);
    cyl(0.03, 0.035, green, -0.05, 0.187, 0, 0.014);
    cyl(0.014, 0.05, green, -0.05, 0.23);
    cyl(0.016, 0.014, colorMat('#d8d8dc', { metalness: 0.6, roughness: 0.4 }), -0.05, 0.262);
    cyl(0.02, 0.05, M.glass, 0.06, 0.025, 0, 0.026);
    cyl(0.017, 0.03, liquid('#eef6f2', 0.6), 0.06, 0.017, 0, 0.021);
  } else if (kind === 'beer') {
    cyl(0.05, 0.13, liquid('#e3a22c', 0.95));
    cyl(0.052, 0.03, colorMat('#fff8ea', { roughness: 1 }), 0, 0.145);
    const handle = mesh(new THREE.TorusGeometry(0.035, 0.009, 6, 12, Math.PI), M.glass, 0.05, 0.07, 0, false);
    handle.rotation.z = -Math.PI / 2;
    g.add(handle);
  } else if (kind === 'highball') {
    cyl(0.038, 0.17, M.glass, 0, 0.085, 0, 0.042);
    cyl(0.033, 0.13, liquid('#eccb72', 0.82), 0, 0.068, 0, 0.037);
    g.add(mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.008, 12), colorMat('#f4dd4a'), 0.012, 0.14, 0, false));
  } else if (kind === 'wine') {
    cyl(0.036, 0.006, M.glass, 0, 0.003);
    cyl(0.006, 0.09, M.glass, 0, 0.05);
    const bowl = mesh(new THREE.SphereGeometry(0.052, 14, 10, 0, Math.PI * 2, Math.PI * 0.28, Math.PI * 0.72), M.glass, 0, 0.145, 0, false);
    bowl.scale.y = 1.25;
    g.add(bowl);
    g.add(mesh(new THREE.SphereGeometry(0.044, 14, 8, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45), liquid('#8e1f3a'), 0, 0.142, 0, false));
  } else if (kind === 'whisky') {
    cyl(0.04, 0.08, M.glass, 0, 0.04, 0, 0.046);
    cyl(0.036, 0.032, liquid('#b9661e', 0.92), 0, 0.02, 0, 0.039);
    const ice = mesh(new THREE.BoxGeometry(0.032, 0.032, 0.032), liquid('#f4fbff', 0.7), 0.004, 0.045, 0, false);
    ice.rotation.set(0.4, 0.6, 0.2);
    g.add(ice);
  } else {
    cyl(0.036, 0.16, M.glass, 0, 0.08, 0, 0.042);
    cyl(0.032, 0.12, liquid('#7fcbe6', 0.85), 0, 0.062, 0, 0.037);
    const straw = cyl(0.005, 0.2, colorMat('#ef5d5d'), 0.012, 0.12);
    straw.rotation.z = -0.22;
  }
  g.scale.setScalar(1.9); // 멀리서도 보이도록 살짝 과장
  return g;
}

// ---------- 직원이 다니는 길 ----------
const LANE_END_Z = GEO.tipZ - GEO.counterDepth - 0.45;
const laneOf = (x, z) => {
  if (z <= GEO.frontZ + 0.05) return -1; // 가로 통로
  let best = 0;
  for (let b = 1; b < BAR_COUNT; b++) if (Math.abs(x - barCenterX(b)) < Math.abs(x - barCenterX(best))) best = b;
  return best;
};
function routeTo(from, to) {
  const a = laneOf(from.x, from.z);
  const b = laneOf(to.x, to.z);
  const pts = [];
  if (a !== b) {
    if (a >= 0) pts.push({ x: barCenterX(a), z: GEO.corridorZ });
    if (b >= 0) pts.push({ x: barCenterX(b), z: GEO.corridorZ });
  }
  pts.push({ x: to.x, z: to.z });
  return pts;
}

export class BarScene {
  constructor(container, labelLayer) {
    this.container = container;
    this.labelLayer = labelLayer;
    this.avatars = new Map(); // userId -> avatar
    this.seatUser = new Map(); // seatId -> userId
    this.orders = []; // 직원이 배달할 주문
    this.myId = null;
    this.onPickUser = null;
    this.onPickSeat = null;
    this.moveMode = null;
    this.lastFrame = performance.now();
    this.time = 0;

    const renderer = (this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }));
    this.lowPower = Math.min(window.innerWidth, window.innerHeight) < 600;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(renderer.domElement);

    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color(BG);
    scene.fog = new THREE.Fog(BG, 30, 80);
    const camera = (this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 150));
    camera.position.set(0, 14, 16);

    const controls = (this.controls = new OrbitControls(camera, renderer.domElement));
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = 4;
    controls.maxDistance = 50;
    controls.minPolarAngle = 0.25;
    controls.maxPolarAngle = 1.32;
    controls.minAzimuthAngle = -1.15;
    controls.maxAzimuthAngle = 1.15;
    controls.target.set(0, 0.9, -2.2);
    controls.addEventListener('start', () => (this.goal = null));

    this.#buildRoom();
    this.#buildCounters();
    this.#buildBackbar();
    this.#buildSeats();
    this.#buildLights();
    this.staff = [this.#makeStaff(0), this.#makeStaff(1)];

    this.view = 'overview';
    this.resize();
    this.setView('overview', true);
    new ResizeObserver(() => this.resize()).observe(container);
    this.#bindPicking();
    renderer.setAnimationLoop(() => this.#frame());
  }

  // ===== 공간 =====
  #buildRoom() {
    const W = GEO.roomHalfWidth;
    const depth = GEO.roomFrontZ - GEO.wallZ;
    const floorTex = canvasTexture(512, 512, (c, w, h) => {
      c.fillStyle = '#1d1c20';
      c.fillRect(0, 0, w, h);
      const rows = 8;
      for (let r = 0; r < rows; r++) {
        const off = (r % 2) * 90 + ((r * 53) % 70);
        for (let x = -200; x < w; x += 190) {
          const shade = 18 + ((r * 31 + x * 7) % 16);
          c.fillStyle = `rgb(${shade + 24},${shade + 20},${shade + 22})`;
          c.fillRect(x + off + 1, (r * h) / rows + 1, 188, h / rows - 2);
        }
      }
      for (let i = 0; i < 1400; i++) {
        c.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`;
        c.fillRect(Math.random() * w, Math.random() * h, 30 + Math.random() * 60, 1);
      }
    });
    floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
    floorTex.repeat.set(7, 5);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, depth), std('#ffffff', { map: floorTex, roughness: 0.62 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, (GEO.roomFrontZ + GEO.wallZ) / 2);
    floor.receiveShadow = true;
    this.scene.add(floor);

    const wallMat = std('#1b2030', { roughness: 0.95 });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, 6.2), wallMat);
    back.position.set(0, 3.1, GEO.wallZ);
    this.scene.add(back);
    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(depth, 6.2), wallMat);
      wall.position.set(side * W, 3.1, (GEO.roomFrontZ + GEO.wallZ) / 2);
      wall.rotation.y = -side * (Math.PI / 2);
      this.scene.add(wall);
      // 허리 높이 나무 패널
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.1, depth), std('#2b1b14'));
      panel.position.set(side * (W - 0.03), 0.55, (GEO.roomFrontZ + GEO.wallZ) / 2);
      this.scene.add(panel);
    }

    // 직원 구역 바닥(가로 통로 + 튀어나온 바의 가운데 통로)을 어두운 매트로 구분
    const matMat = std('#12141a', { roughness: 0.9 });
    const addMat = (x0, x1, z0, z1) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), matMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set((x0 + x1) / 2, 0.006, (z0 + z1) / 2);
      m.receiveShadow = true;
      this.scene.add(m);
    };
    addMat(-W, W, GEO.wallZ, GEO.frontZ);
    for (let b = 0; b < BAR_COUNT; b++) {
      const cx = barCenterX(b);
      addMat(cx - GEO.laneWidth / 2, cx + GEO.laneWidth / 2, GEO.frontZ, GEO.tipZ - GEO.counterDepth);
    }

    // 구석 화분
    for (const side of [-1, 1]) {
      const pot = mesh(new THREE.CylinderGeometry(0.28, 0.2, 0.5, 14), std('#3a3f4b'), side * (W - 0.9), 0.25, 5.6);
      const leafMat = std('#3f7a54', { roughness: 0.9, flatShading: true });
      for (let i = 0; i < 5; i++) {
        const leaf = mesh(new THREE.IcosahedronGeometry(0.3 + (i % 3) * 0.08, 0), leafMat, side * (W - 0.9) + Math.sin(i * 2.3) * 0.22, 0.75 + i * 0.2, 5.6 + Math.cos(i * 1.9) * 0.22);
        this.scene.add(leaf);
      }
      this.scene.add(pot);
    }
  }

  #buildCounters() {
    const H = GEO.counterHeight;
    const D = GEO.counterDepth;
    const W = GEO.roomHalfWidth;
    const bodyMat = std('#35211a', { roughness: 0.8 });
    const topMat = std('#76584a', { roughness: 0.42 });
    const glowMat = new THREE.MeshBasicMaterial({ color: '#ffb066', toneMapped: false });
    const group = new THREE.Group();
    const box = (x0, x1, z0, z1) => {
      const w = x1 - x0;
      const d = z1 - z0;
      const body = mesh(new THREE.BoxGeometry(w, H, d), bodyMat, (x0 + x1) / 2, H / 2, (z0 + z1) / 2);
      body.receiveShadow = true;
      const top = mesh(new THREE.BoxGeometry(w, 0.07, d), topMat, (x0 + x1) / 2, H + 0.035, (z0 + z1) / 2);
      top.receiveShadow = true;
      group.add(body, top);
    };
    // 손님 쪽 면: 상판 아래 간접조명 + 황동 발걸이
    const trim = (x0, z0, x1, z1) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(alongX ? len : 0.02, 0.025, alongX ? 0.02 : len), glowMat);
      strip.position.set((x0 + x1) / 2, H - 0.03, (z0 + z1) / 2);
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, len, 8), M.brass);
      rail.rotation.set(alongX ? 0 : Math.PI / 2, 0, alongX ? Math.PI / 2 : 0);
      rail.position.set((x0 + x1) / 2, 0.24, (z0 + z1) / 2);
      group.add(strip, rail);
    };
    const edges = [-W];
    for (let b = 0; b < BAR_COUNT; b++) {
      const cx = barCenterX(b);
      const h = GEO.barWidth / 2;
      box(cx - h, cx - h + D, GEO.frontZ, GEO.tipZ); // 왼쪽 팔
      box(cx + h - D, cx + h, GEO.frontZ, GEO.tipZ); // 오른쪽 팔
      box(cx - h + D, cx + h - D, GEO.tipZ - D, GEO.tipZ); // 끝
      const o = 0.07;
      trim(cx - h - o, GEO.frontZ + D, cx - h - o, GEO.tipZ + o);
      trim(cx + h + o, GEO.frontZ + D, cx + h + o, GEO.tipZ + o);
      trim(cx - h - o, GEO.tipZ + o, cx + h + o, GEO.tipZ + o);
      edges.push(cx - h, cx + h);
    }
    edges.push(W);
    // 바와 바를 잇는 연결 카운터 → 전체가 한 줄의 지그재그 카운터가 된다
    for (let i = 0; i < edges.length; i += 2) {
      box(edges[i], edges[i + 1], GEO.frontZ, GEO.frontZ + D);
      trim(edges[i], GEO.frontZ + D + 0.07, edges[i + 1], GEO.frontZ + D + 0.07);
    }
    this.scene.add(group);
  }

  #buildBackbar() {
    const z0 = GEO.wallZ;
    const d = GEO.backbarDepth;
    const half = GEO.roomHalfWidth - 0.6;
    const wood = std('#2a1a13', { roughness: 0.7 });
    const cab = mesh(new THREE.BoxGeometry(half * 2, 0.95, d), wood, 0, 0.475, z0 + d / 2);
    cab.receiveShadow = true;
    this.scene.add(cab, mesh(new THREE.BoxGeometry(half * 2, 0.05, d + 0.06), std('#6d4a30', { roughness: 0.4 }), 0, 0.975, z0 + d / 2));

    // 은은하게 빛나는 뒷판
    const glowTex = canvasTexture(512, 128, (c, w, h) => {
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#2a1508');
      g.addColorStop(0.55, '#b5632a');
      g.addColorStop(1, '#3a1d0c');
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
    });
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, 2.0), new THREE.MeshBasicMaterial({ map: glowTex, toneMapped: false }));
    panel.position.set(0, 2.0, z0 + 0.03);
    this.scene.add(panel);

    const shelfYs = [1.45, 2.0, 2.55];
    const stripMat = new THREE.MeshBasicMaterial({ color: '#ffd9a3', toneMapped: false });
    for (const y of shelfYs) {
      this.scene.add(mesh(new THREE.BoxGeometry(half * 2, 0.04, 0.34), wood, 0, y, z0 + 0.19));
      this.scene.add(mesh(new THREE.BoxGeometry(half * 2, 0.015, 0.02), stripMat, 0, y - 0.03, z0 + 0.34, false));
    }
    // 진열된 술병들
    const profile = [[0, 0], [0.045, 0], [0.047, 0.17], [0.03, 0.22], [0.016, 0.25], [0.016, 0.31], [0, 0.31]].map(([x, y]) => new THREE.Vector2(x, y));
    const per = Math.floor((half * 2 - 0.6) / 0.19);
    const bottles = new THREE.InstancedMesh(
      new THREE.LatheGeometry(profile, 10),
      new THREE.MeshStandardMaterial({ roughness: 0.2, metalness: 0.1, emissive: '#ffffff', emissiveIntensity: 0.06 }),
      per * shelfYs.length,
    );
    const palette = ['#3fae70', '#c98a2b', '#8e1f3a', '#e8e2d0', '#2d5c8a', '#b5521f', '#5f7a3a', '#d9b24a', '#40302a'];
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    let n = 0;
    shelfYs.forEach((y, row) => {
      for (let i = 0; i < per; i++) {
        const k = hash(`${row}:${i}`);
        const s = 0.8 + (k % 40) / 100;
        dummy.position.set(-half + 0.4 + i * 0.19, y + 0.02, z0 + 0.16 + ((k >>> 4) % 10) / 100);
        dummy.scale.set(s * 0.95, s, s * 0.95);
        dummy.updateMatrix();
        bottles.setMatrixAt(n, dummy.matrix);
        bottles.setColorAt(n, col.set(palette[(k >>> 8) % palette.length]));
        n++;
      }
    });
    this.scene.add(bottles);

    // 네온 간판
    const makeSign = () =>
      canvasTexture(1024, 384, (c, w, h) => {
        c.clearRect(0, 0, w, h);
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        const neon = (text, font, y, color, blur) => {
          c.font = font;
          c.shadowColor = color;
          for (const b of [blur, blur * 0.5, blur * 0.2]) {
            c.shadowBlur = b;
            c.fillStyle = color;
            c.fillText(text, w / 2, y);
          }
          c.shadowBlur = 0;
          c.fillStyle = '#fff6ef';
          c.fillText(text, w / 2, y);
        };
        neon('온술바', '800 190px "Pretendard Variable", sans-serif', 150, '#ff7a59', 60);
        neon('혼자여도 괜찮은 밤', '500 54px "Pretendard Variable", sans-serif', 310, '#7fd6ff', 30);
      });
    const signMat = new THREE.MeshBasicMaterial({ map: makeSign(), transparent: true, toneMapped: false, depthWrite: false });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 2.4), signMat);
    sign.position.set(0, 4.45, z0 + 0.06);
    this.scene.add(sign);
    this.signMat = signMat;
    document.fonts?.load('800 190px "Pretendard Variable"', '온술바혼자여도괜찮은밤').then(() => {
      signMat.map.dispose();
      signMat.map = makeSign();
    });
  }

  #buildSeats() {
    this.seatMarkers = new Map();
    this.hits = [];
    const markerMat = new THREE.MeshBasicMaterial({ color: '#ffc46b', transparent: true, opacity: 0.9, toneMapped: false, side: THREE.DoubleSide, depthWrite: false });
    for (const s of SEATS) {
      const g = new THREE.Group();
      g.position.set(s.x, 0, s.z);
      const seat = mesh(G.stoolSeat, M.cushion[s.gender], 0, GEO.seatHeight - 0.04, 0);
      const ring = mesh(G.stoolRing, M.brass, 0, 0.3, 0, false);
      ring.rotation.x = Math.PI / 2;
      g.add(seat, mesh(G.stoolPole, M.metal, 0, 0.35, 0), mesh(G.stoolBase, M.metal, 0, 0.015, 0), ring);
      this.scene.add(g);

      const marker = new THREE.Mesh(G.ring, markerMat.clone());
      marker.rotation.x = -Math.PI / 2;
      marker.position.set(s.x, 0.02, s.z);
      marker.visible = false;
      this.scene.add(marker);
      this.seatMarkers.set(s.id, marker);

      const hit = new THREE.Mesh(G.hit, new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.set(s.x, 0.475, s.z);
      hit.scale.y = 0.5;
      hit.userData.seatId = s.id;
      this.scene.add(hit);
      this.hits.push(hit);
    }
  }

  #buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xa9b8ff, 0x2a1a10, 0.9));
    const key = new THREE.DirectionalLight(0xffe6cf, 1.5);
    key.position.set(-5, 13, 9);
    key.target.position.set(0, 0, -2.5);
    key.castShadow = true;
    const size = this.lowPower ? 1024 : 2048;
    key.shadow.mapSize.set(size, size);
    Object.assign(key.shadow.camera, { left: -13, right: 13, top: 9, bottom: -9, near: 1, far: 40 });
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.03;
    this.scene.add(key, key.target);

    const glowTex = canvasTexture(128, 128, (c, w, h) => {
      const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,214,160,1)');
      g.addColorStop(0.25, 'rgba(255,170,90,0.5)');
      g.addColorStop(1, 'rgba(255,150,60,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
    });
    const glowMat = new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    const shadeMat = std('#16171c', { roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide });
    const bulbMat = new THREE.MeshBasicMaterial({ color: '#ffe0b0', toneMapped: false });
    for (let b = 0; b < BAR_COUNT; b++) {
      const cx = barCenterX(b);
      const light = new THREE.PointLight(0xffb873, 17, 12, 1.8);
      light.position.set(cx, 3.7, -2.1);
      this.scene.add(light);
      for (const z of [-3.5, -1.3]) {
        const cord = mesh(new THREE.CylinderGeometry(0.008, 0.008, 3.1, 4), M.metal, cx, 4.6, z, false);
        const shade = mesh(new THREE.ConeGeometry(0.3, 0.26, 20, 1, true), shadeMat, cx, 3.02, z, false);
        const bulb = mesh(new THREE.SphereGeometry(0.075, 12, 10), bulbMat, cx, 2.93, z, false);
        const glow = new THREE.Sprite(glowMat);
        glow.scale.setScalar(1.5);
        glow.position.set(cx, 2.9, z);
        this.scene.add(cord, shade, bulb, glow);
      }
    }
    // 백바 조명
    for (const x of [-6.5, 0, 6.5]) {
      const l = new THREE.PointLight(0xff9c5a, 9, 8, 1.8);
      l.position.set(x, 2.2, GEO.wallZ + 1.1);
      this.scene.add(l);
    }
  }

  // ===== 직원 =====
  #makeStaff(index) {
    const person = buildPerson({ seed: hash(`staff${index}`), standing: true, staff: true });
    person.group.scale.setScalar(1.06);
    const homeBar = index === 0 ? 0 : BAR_COUNT - 1;
    person.group.position.set(barCenterX(homeBar), 0, GEO.corridorZ);
    this.scene.add(person.group);
    const tray = new THREE.Group();
    tray.add(mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.012, 16), M.metal, 0, 0, 0, false));
    tray.position.set(0.3, 1.18, 0.22);
    tray.visible = false;
    person.body.add(tray);
    return { ...person, tray, index, path: [], wait: 1 + index * 2, job: null, phase: 'idle', heading: 0, step: 0 };
  }

  #staffIdleTarget(st) {
    // 자기 구역 근처의 통로를 어슬렁거림
    const bars = st.index === 0 ? [0, 0, 1] : [2, 2, 1];
    const b = bars[Math.floor(Math.random() * bars.length)];
    if (Math.random() < 0.35) return { x: barCenterX(b) + (Math.random() - 0.5) * 3, z: GEO.corridorZ + 0.15 };
    return { x: barCenterX(b) + (Math.random() - 0.5) * 0.5, z: GEO.frontZ + 0.6 + Math.random() * (LANE_END_Z - GEO.frontZ - 0.6) };
  }

  #updateStaff(st, dt) {
    const pos = st.group.position;
    if (st.path.length) {
      const tgt = st.path[0];
      const dx = tgt.x - pos.x;
      const dz = tgt.z - pos.z;
      const dist = Math.hypot(dx, dz);
      const stepLen = 3.0 * dt;
      if (dist <= stepLen) {
        pos.x = tgt.x;
        pos.z = tgt.z;
        st.path.shift();
      } else {
        pos.x += (dx / dist) * stepLen;
        pos.z += (dz / dist) * stepLen;
        st.heading = Math.atan2(dx, dz);
      }
      st.step += dt * 9;
      st.body.position.y = Math.abs(Math.sin(st.step)) * 0.035;
    } else {
      st.body.position.y *= 0.8;
      st.wait -= dt;
      if (st.wait <= 0) this.#staffNext(st);
    }
    // 부드럽게 방향 전환
    let d = st.heading - st.group.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    st.group.rotation.y += d * Math.min(1, dt * 10);
  }

  #staffNext(st) {
    const pos = st.group.position;
    if (st.phase === 'toBackbar') {
      // 백바에서 음료 준비 완료 → 손님 자리로
      st.tray.visible = true;
      st.tray.add((st.cargo = buildDrink(st.job.drink)));
      st.cargo.scale.setScalar(1.2);
      const seat = SEAT_BY_ID.get(st.job.seatId);
      st.path = routeTo(pos, { x: seat.laneX, z: seat.laneZ });
      st.phase = 'toSeat';
      st.wait = 0.01;
    } else if (st.phase === 'toSeat') {
      const seat = SEAT_BY_ID.get(st.job.seatId);
      st.heading = Math.atan2(seat.x - pos.x, seat.z - pos.z);
      st.phase = 'serve';
      st.wait = 0.55;
    } else if (st.phase === 'serve') {
      st.tray.visible = false;
      if (st.cargo) st.tray.remove(st.cargo);
      st.cargo = null;
      this.#placeDrink(st.job.userId, st.job.drink, st.job.orderedAt);
      st.job = null;
      st.phase = 'idle';
      st.wait = 0.5;
    } else {
      const job = this.orders.shift();
      if (job) {
        st.job = job;
        const x = THREE.MathUtils.clamp(barCenterX(SEAT_BY_ID.get(job.seatId).bar) + (st.index ? 0.5 : -0.5), -9, 9);
        st.path = routeTo(pos, { x, z: GEO.corridorZ - 0.25 });
        st.heading = Math.PI; // 백바를 바라봄
        st.phase = 'toBackbar';
        st.wait = 0.45;
      } else {
        st.path = routeTo(pos, this.#staffIdleTarget(st));
        st.wait = 1.5 + Math.random() * 4;
      }
    }
  }

  // ===== 손님 =====
  /** 서버 상태에 맞춰 아바타를 추가/이동/삭제한다 */
  setUsers(users, myId, now) {
    this.myId = myId;
    const seen = new Set();
    this.seatUser.clear();
    for (const u of users) {
      seen.add(u.id);
      this.seatUser.set(u.seatId, u.id);
      let av = this.avatars.get(u.id);
      const isNew = !av;
      if (!av) av = this.#makeAvatar(u);
      if (av.seatId !== u.seatId) {
        const s = SEAT_BY_ID.get(u.seatId);
        av.seatId = u.seatId;
        av.group.position.set(s.x, 0, s.z);
        av.group.rotation.y = Math.atan2(s.face[0], s.face[1]);
        av.drinkGroup.position.set(s.drinkX, TOP_Y, s.drinkZ);
        av.drinkGroup.rotation.y = av.group.rotation.y;
        av.pop = 0; // 앉는 애니메이션
        for (const o of this.orders) if (o.userId === u.id) o.seatId = u.seatId;
      }
      av.user = u;
      av.nameEl.textContent = u.name;
      av.tag.classList.toggle('me', u.id === myId);
      av.tag.classList.toggle('busy', !!u.busy);
      av.tag.classList.toggle('away', !!u.away);
      av.tag.dataset.gender = u.gender;
      av.selfRing.visible = u.id === myId;
      if (av.orderedAt !== u.orderedAt) {
        av.orderedAt = u.orderedAt;
        this.orders = this.orders.filter((o) => o.userId !== u.id);
        if (isNew && now - u.orderedAt > 9000) this.#placeDrink(u.id, u.drink, u.orderedAt);
        else this.orders.push({ userId: u.id, seatId: u.seatId, drink: u.drink, orderedAt: u.orderedAt });
      }
    }
    for (const [id, av] of this.avatars) {
      if (seen.has(id)) continue;
      this.scene.remove(av.group, av.drinkGroup);
      av.tag.remove();
      this.avatars.delete(id);
      this.orders = this.orders.filter((o) => o.userId !== id);
    }
    this.#refreshMarkers();
  }

  #makeAvatar(u) {
    const person = buildPerson({ color: AVATAR_COLORS[u.color] || AVATAR_COLORS[0], seed: hash(u.id) });
    const drinkGroup = new THREE.Group();
    const selfRing = new THREE.Mesh(G.ring, new THREE.MeshBasicMaterial({ color: '#ffb35c', transparent: true, opacity: 0.95, toneMapped: false, side: THREE.DoubleSide, depthWrite: false }));
    selfRing.rotation.x = -Math.PI / 2;
    selfRing.position.y = 0.025;
    selfRing.scale.setScalar(1.25);
    person.group.add(selfRing);
    this.scene.add(person.group, drinkGroup);

    const tag = document.createElement('div');
    tag.className = 'tag';
    tag.innerHTML = '<div class="bubble" hidden></div><div class="plate"><i class="dot"></i><span class="name"></span><span class="badge">통화 중</span></div>';
    this.labelLayer.appendChild(tag);
    const av = { ...person, drinkGroup, selfRing, tag, nameEl: tag.querySelector('.name'), bubbleEl: tag.querySelector('.bubble'), seatId: null, pop: 0, talk: 0, cheers: 0, speaking: false, seed: hash(u.id) % 100, orderedAt: null };
    this.avatars.set(u.id, av);
    return av;
  }

  #placeDrink(userId, kind, orderedAt) {
    const av = this.avatars.get(userId);
    if (!av || av.orderedAt !== orderedAt) return;
    av.drinkGroup.clear();
    av.drinkGroup.add(buildDrink(kind));
    av.drinkPop = 0;
  }

  /** 말풍선 */
  say(userId, text, kind = '') {
    const av = this.avatars.get(userId);
    if (!av) return;
    av.bubbleEl.textContent = text;
    av.bubbleEl.className = `bubble ${kind}`;
    av.bubbleEl.hidden = false;
    av.talk = 1.2;
    clearTimeout(av.bubbleTimer);
    av.bubbleTimer = setTimeout(() => (av.bubbleEl.hidden = true), Math.min(9000, 3500 + text.length * 90));
  }

  cheers(userId) {
    const av = this.avatars.get(userId);
    if (av) av.cheers = 1.3;
  }

  setSpeaking(userId, on) {
    const av = this.avatars.get(userId);
    if (!av || av.speaking === on) return;
    av.speaking = on;
    av.tag.classList.toggle('speaking', on);
  }

  /** 자리 옮기기 모드: 앉을 수 있는 빈자리를 표시 */
  setMoveMode(gender) {
    this.moveMode = gender || null;
    this.#refreshMarkers();
  }

  #refreshMarkers() {
    for (const s of SEATS) {
      this.seatMarkers.get(s.id).visible = !!this.moveMode && s.gender === this.moveMode && !this.seatUser.has(s.id);
    }
    // 누르는 영역을 보이는 모습에 맞춘다: 빈자리는 스툴 높이, 손님이 있으면 사람 키
    for (const hit of this.hits) {
      const taken = this.seatUser.has(hit.userData.seatId);
      hit.scale.y = taken ? 1 : 0.5;
      hit.position.y = taken ? 0.95 : 0.475;
    }
  }

  // ===== 카메라 =====
  setView(view, instant = false) {
    this.view = view;
    // 넓은 화면에서는 왼쪽 패널(입장 카드/대화창)을 뺀 영역에 맞춘다
    const aspect = (this.size.w - this.inset) / this.size.h;
    const t = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    let target;
    let dir;
    let dist;
    if (view === 'overview') {
      target = new THREE.Vector3(0, 0.9, -1.9);
      dir = new THREE.Vector3(0, 0.68, 0.74);
      dist = THREE.MathUtils.clamp(Math.max(11.1 / (t * aspect), 5.4 / t), 13, 38);
    } else {
      const cx = barCenterX(view.bar);
      target = new THREE.Vector3(cx, 1.0, -2.0);
      dir = new THREE.Vector3((1 - view.bar) * 0.1, 0.66, 0.75);
      dist = THREE.MathUtils.clamp(Math.max(2.9 / (t * aspect), 3.4 / t), 8, 22);
    }
    const pos = target.clone().addScaledVector(dir.normalize(), dist);
    if (instant) {
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.goal = null;
    } else {
      this.goal = { pos, target };
    }
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    const changed = Math.abs(this.camera.aspect - w / h) > 0.01;
    this.camera.aspect = w / h;
    this.inset = w >= 860 ? 430 : 0;
    if (this.inset) this.camera.setViewOffset(w, h, -this.inset / 2, 0, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    this.size = { w, h };
    if (changed && this.view) this.setView(this.view, !this.goal && this.time < 0.5);
  }

  #bindPicking() {
    const el = this.renderer.domElement;
    const ray = new THREE.Raycaster();
    let down = null;
    el.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY, t: e.timeStamp }));
    el.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8 || e.timeStamp - down.t > 600) return;
      const r = el.getBoundingClientRect();
      if (this.moveMode) {
        // 자리 옮기기 중에는 누른 곳에서 가장 가까운 빛나는 빈자리를 고른다 (작은 화면에서도 누르기 쉽게)
        const v = new THREE.Vector3();
        let best = null;
        let bestD = 44;
        for (const [seatId, marker] of this.seatMarkers) {
          if (!marker.visible) continue;
          v.set(marker.position.x, 0.5, marker.position.z).project(this.camera);
          const d = Math.hypot(r.left + (v.x * 0.5 + 0.5) * r.width - e.clientX, r.top + (-v.y * 0.5 + 0.5) * r.height - e.clientY);
          if (d < bestD) {
            bestD = d;
            best = seatId;
          }
        }
        if (best) return this.onPickSeat?.(best);
      }
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
      const hit = ray.intersectObjects(this.hits, false)[0];
      if (!hit) return this.onPickUser?.(null);
      const seatId = hit.object.userData.seatId;
      const userId = this.seatUser.get(seatId);
      if (userId) this.onPickUser?.(userId);
      else this.onPickSeat?.(seatId);
    });
  }

  // ===== 매 프레임 =====
  #frame() {
    const nowMs = performance.now();
    const elapsed = (nowMs - this.lastFrame) / 1000;
    this.lastFrame = nowMs;
    const dt = Math.min(elapsed, 0.1);
    const t = (this.time += dt);

    if (this.goal) {
      const k = 1 - Math.exp(-Math.min(elapsed, 0.5) * 3.2);
      this.camera.position.lerp(this.goal.pos, k);
      this.controls.target.lerp(this.goal.target, k);
      if (this.camera.position.distanceTo(this.goal.pos) < 0.02) this.goal = null;
    }
    this.controls.update();

    for (const st of this.staff) this.#updateStaff(st, dt);

    const pulse = 0.55 + Math.sin(t * 4) * 0.35;
    for (const m of this.seatMarkers.values()) {
      if (m.visible) {
        m.material.opacity = pulse;
        m.scale.setScalar(1.15 + Math.sin(t * 4) * 0.1);
      }
    }

    const v = new THREE.Vector3();
    const { w, h } = this.size;
    const far = this.camera.position.distanceTo(this.controls.target) > 19;
    this.labelLayer.classList.toggle('far', far);
    this.labelLayer.classList.toggle('compact', far && w < 600);
    for (const av of this.avatars.values()) {
      // 앉기 / 숨쉬기 / 말할 때 끄덕임
      av.pop = Math.min(1, av.pop + dt * 2.5);
      const e = ease(av.pop);
      av.group.scale.setScalar(0.6 + 0.4 * e);
      av.group.position.y = (1 - e) * 0.5;
      av.talk = Math.max(0, av.talk - dt);
      const lively = av.talk > 0 || av.speaking ? 1 : 0;
      av.body.position.y = Math.sin(t * 1.6 + av.seed) * 0.008 + lively * Math.abs(Math.sin(t * 9)) * 0.018;
      av.head.rotation.y = Math.sin(t * 0.5 + av.seed) * 0.22;
      av.head.rotation.x = Math.sin(t * 0.8 + av.seed * 2) * 0.05 + lively * Math.sin(t * 9) * 0.07;
      av.selfRing.material.opacity = 0.65 + Math.sin(t * 3) * 0.3;

      // 음료 등장 / 건배
      if (av.drinkPop !== undefined && av.drinkPop < 1) {
        av.drinkPop = Math.min(1, av.drinkPop + dt * 3);
        av.drinkGroup.scale.setScalar(ease(av.drinkPop));
      }
      if (av.cheers > 0) {
        av.cheers = Math.max(0, av.cheers - dt);
        const k = Math.sin((1 - av.cheers / 1.3) * Math.PI);
        const s = SEAT_BY_ID.get(av.seatId);
        av.drinkGroup.position.set(s.drinkX - s.face[0] * k * 0.12, TOP_Y + k * 0.42, s.drinkZ - s.face[1] * k * 0.12);
        av.arms[1].rotation.x = -1.18 - k * 0.9;
      }

      // 이름표 위치
      v.set(av.group.position.x, 1.98, av.group.position.z).project(this.camera);
      const visible = v.z < 1 && Math.abs(v.x) < 1.15 && Math.abs(v.y) < 1.2;
      av.tag.style.display = visible ? '' : 'none';
      if (visible) {
        av.tag.style.transform = `translate(${((v.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-v.y * 0.5 + 0.5) * h).toFixed(1)}px)`;
        av.tag.style.zIndex = String(Math.round((1 - v.z) * 100000));
      }
    }
    this.renderer.render(this.scene, this.camera);
  }
}
