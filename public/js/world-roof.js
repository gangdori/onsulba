// 루프탑: 유리벽 너머로 도시가 보이는 바(지그재그 카운터) + 엘리베이터에서 내려 줄 서는 비밀 로비
import { THREE, std, glow, canvasTexture, mesh, box, hash, G, M, TOP_Y, buildPerson, mergeStatic } from './kit.js';
import { makeGlowTexture } from './world-city.js';
import { GEO, SEATS, BAR_COUNT, barCenterX, NAV } from '/shared/layout.js';

const W = GEO.roomHalfWidth;
const WALL_H = 4.2; // 유리벽·퍼걸러 높이
const add = (g, ...items) => g.add(...items);

function buildDeck(g) {
  const depth = GEO.roomFrontZ - GEO.wallZ;
  const tex = canvasTexture(512, 512, (c, w, h) => {
    c.fillStyle = '#1d1c20';
    c.fillRect(0, 0, w, h);
    const rows = 8;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * 90 + ((r * 53) % 70);
      for (let x = -200; x < w; x += 190) {
        const shade = 18 + ((r * 31 + x * 7) % 16);
        c.fillStyle = `rgb(${shade + 26},${shade + 20},${shade + 20})`;
        c.fillRect(x + off + 1, (r * h) / rows + 1, 188, h / rows - 2);
      }
    }
    for (let i = 0; i < 1400; i++) {
      c.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`;
      c.fillRect(Math.random() * w, Math.random() * h, 30 + Math.random() * 60, 1);
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(7, 6);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, depth), std('#ffffff', { map: tex, roughness: 0.62 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, (GEO.roomFrontZ + GEO.wallZ) / 2);
  floor.receiveShadow = true;
  g.add(floor);

  // 직원 구역 바닥(가로 통로 + 튀어나온 바의 가운데 통로)을 어두운 매트로 구분
  const matMat = std('#12141a', { roughness: 0.9 });
  const addMat = (x0, x1, z0, z1) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), matMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set((x0 + x1) / 2, 0.006, (z0 + z1) / 2);
    m.receiveShadow = true;
    g.add(m);
  };
  addMat(-W, W, GEO.wallZ, GEO.frontZ);
  for (let b = 0; b < BAR_COUNT; b++) {
    const cx = barCenterX(b);
    addMat(cx - GEO.laneWidth / 2, cx + GEO.laneWidth / 2, GEO.frontZ, GEO.tipZ - GEO.counterDepth);
  }
}

/** 유리벽(뒤·왼쪽), 앞쪽 유리 난간, 로비와 맞닿은 오른쪽 벽, 퍼걸러와 줄조명 */
function buildShell(g) {
  const frame = std('#16171c', { roughness: 0.45, metalness: 0.7 });
  const zB = GEO.wallZ;
  const zF = GEO.roomFrontZ;

  // 뒤 유리벽 (백바 위로 도시가 보인다)
  add(g, box(M.pane, -W, W, 0, WALL_H, zB - 0.02, zB));
  for (let x = -W; x <= W + 0.01; x += 2.3) add(g, box(frame, x - 0.04, x + 0.04, 0, WALL_H, zB - 0.06, zB + 0.02));
  add(g, box(frame, -W, W, WALL_H - 0.08, WALL_H, zB - 0.06, zB + 0.02));
  // 왼쪽 유리벽
  add(g, box(M.pane, -W - 0.02, -W, 0, WALL_H, zB, zF));
  for (let z = zB; z <= zF + 0.01; z += 2.125) add(g, box(frame, -W - 0.06, -W + 0.02, 0, WALL_H, z - 0.04, z + 0.04));
  add(g, box(frame, -W - 0.06, -W + 0.02, WALL_H - 0.08, WALL_H, zB, zF), box(frame, -W - 0.06, -W + 0.02, 1.05, 1.1, zB, zF));
  // 앞쪽: 허리 높이 유리 난간
  add(g, box(M.pane, -W, W, 0.08, 1.1, zF - 0.02, zF), box(M.brass, -W, W, 1.1, 1.15, zF - 0.05, zF + 0.03), box(frame, -W, W, 0, 0.08, zF - 0.05, zF + 0.03));
  for (let x = -W; x <= W + 0.01; x += 2.3) add(g, box(frame, x - 0.03, x + 0.03, 0, 1.1, zF - 0.04, zF + 0.02));

  // 오른쪽: 로비와 사이의 벽 (문 자리만 뚫려 있다)
  const plaster = std('#1c2a26', { roughness: 0.9 });
  const wains = std('#2b1b14', { roughness: 0.8 });
  const d0 = NAV.doorZ - 0.75;
  const d1 = NAV.doorZ + 0.75;
  for (const [z0, z1] of [[zB, d0], [d1, zF]]) {
    add(g, box(plaster, W, W + 0.16, 0, 3.3, z0, z1, true), box(wains, W - 0.03, W + 0.19, 0, 1.1, z0, z1));
  }
  add(g, box(plaster, W, W + 0.16, 2.45, 3.3, d0, d1), box(M.brass, W - 0.02, W + 0.18, 2.4, 2.46, d0 - 0.06, d1 + 0.06));
  add(g, box(wains, W - 0.03, W + 0.19, 0, 2.46, d0 - 0.1, d0), box(wains, W - 0.03, W + 0.19, 0, 2.46, d1, d1 + 0.1));

  // 퍼걸러: 기둥과 보 (펜던트 조명과 줄조명이 여기에 매달린다)
  const beam = std('#2a1c15', { roughness: 0.8 });
  for (const x of [-W + 0.1, W - 0.1]) for (const z of [zB + 0.3, zF - 0.2]) add(g, box(beam, x - 0.08, x + 0.08, 0, WALL_H + 0.12, z - 0.08, z + 0.08, true));
  for (const z of [-3.5, -1.3, 3.2, 6.6]) add(g, box(beam, -W, W, WALL_H, WALL_H + 0.12, z - 0.05, z + 0.05));
  for (const x of [-W + 0.1, W - 0.1]) add(g, box(beam, x - 0.06, x + 0.06, WALL_H + 0.12, WALL_H + 0.22, zB, zF));

  // 줄조명: 보 사이에 늘어진 전구들
  const bulbs = [];
  for (const [za, zb] of [[3.2, 6.6], [6.6, zF - 0.2]]) {
    for (let x = -W + 1; x <= W - 1; x += 2.75) {
      for (let k = 0; k <= 6; k++) {
        const t = k / 6;
        bulbs.push([x + Math.sin(t * Math.PI) * 0.5, WALL_H - 0.05 - Math.sin(t * Math.PI) * 0.45, za + (zb - za) * t]);
      }
    }
  }
  const festoon = new THREE.InstancedMesh(new THREE.SphereGeometry(0.036, 8, 6), glow('#ffd9a3'), bulbs.length);
  const dummy = new THREE.Object3D();
  bulbs.forEach((p, i) => {
    dummy.position.set(...p);
    dummy.updateMatrix();
    festoon.setMatrixAt(i, dummy.matrix);
  });
  g.add(festoon);

  // 화분과 라운지 소품 (걸어 다니는 길 바깥에만 둔다)
  const leaf = std('#3f7a54', { roughness: 0.9, flatShading: true });
  const planter = std('#3a3f4b', { roughness: 0.8 });
  for (const z of [-0.5, 3.4, 8.6]) {
    add(g, box(planter, -W + 0.2, -W + 0.9, 0, 0.55, z - 0.9, z + 0.9, true));
    for (let i = 0; i < 6; i++) add(g, mesh(new THREE.IcosahedronGeometry(0.3 + (i % 3) * 0.09, 0), leaf, -W + 0.55 + Math.sin(i * 2.3) * 0.12, 0.8 + (i % 3) * 0.22, z - 0.7 + i * 0.28));
  }
  const sofa = std('#243a34', { roughness: 0.85 });
  const tableTop = std('#4a352b', { roughness: 0.45 });
  for (const x of [-7.6, -2.2, 3.2]) {
    add(g, box(sofa, x - 1.3, x + 1.3, 0, 0.42, 8.6, 9.5, true), box(sofa, x - 1.3, x + 1.3, 0.42, 0.9, 9.3, 9.55, true));
    add(g, mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.05, 20), tableTop, x, 0.5, 7.7), mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 8), M.metal, x, 0.25, 7.7));
    add(g, mesh(new THREE.SphereGeometry(0.06, 10, 8), glow('#ffcf8f'), x, 0.6, 7.7, false));
  }
}

function buildCounters(g) {
  const H = GEO.counterHeight;
  const D = GEO.counterDepth;
  const bodyMat = std('#35211a', { roughness: 0.8 });
  const topMat = std('#76584a', { roughness: 0.42 });
  const glowMat = glow('#ffb066');
  const seg = (x0, x1, z0, z1) => add(g, box(bodyMat, x0, x1, 0, H, z0, z1, true), box(topMat, x0, x1, H, H + 0.07, z0, z1, true));
  // 손님 쪽 면: 상판 아래 간접조명 + 황동 발걸이
  const trim = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(alongX ? len : 0.02, 0.025, alongX ? 0.02 : len), glowMat);
    strip.position.set((x0 + x1) / 2, H - 0.03, (z0 + z1) / 2);
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, len, 8), M.brass);
    rail.rotation.set(alongX ? 0 : Math.PI / 2, 0, alongX ? Math.PI / 2 : 0);
    rail.position.set((x0 + x1) / 2, 0.24, (z0 + z1) / 2);
    g.add(strip, rail);
  };
  const edges = [-W];
  for (let b = 0; b < BAR_COUNT; b++) {
    const cx = barCenterX(b);
    const h = GEO.barWidth / 2;
    seg(cx - h, cx - h + D, GEO.frontZ, GEO.tipZ); // 왼쪽 팔
    seg(cx + h - D, cx + h, GEO.frontZ, GEO.tipZ); // 오른쪽 팔
    seg(cx - h + D, cx + h - D, GEO.tipZ - D, GEO.tipZ); // 끝
    const o = 0.07;
    trim(cx - h - o, GEO.frontZ + D, cx - h - o, GEO.tipZ + o);
    trim(cx + h + o, GEO.frontZ + D, cx + h + o, GEO.tipZ + o);
    trim(cx - h - o, GEO.tipZ + o, cx + h + o, GEO.tipZ + o);
    edges.push(cx - h, cx + h);
  }
  edges.push(W);
  // 바와 바를 잇는 연결 카운터 → 전체가 한 줄의 지그재그 카운터가 된다
  for (let i = 0; i < edges.length; i += 2) {
    seg(edges[i], edges[i + 1], GEO.frontZ, GEO.frontZ + D);
    trim(edges[i], GEO.frontZ + D + 0.07, edges[i + 1], GEO.frontZ + D + 0.07);
  }
}

function buildBackbar(g) {
  const z0 = GEO.wallZ;
  const d = GEO.backbarDepth;
  const half = W - 0.6;
  const wood = std('#2a1a13', { roughness: 0.7 });
  add(g, box(wood, -half, half, 0, 0.95, z0, z0 + d, true), box(std('#6d4a30', { roughness: 0.4 }), -half, half, 0.95, 1.0, z0, z0 + d + 0.06));

  // 은은하게 빛나는 뒷판 (그 위로는 유리 너머 야경)
  const glowTex = canvasTexture(512, 128, (c, w, h) => {
    const grad = c.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#2a1508');
    grad.addColorStop(0.55, '#b5632a');
    grad.addColorStop(1, '#3a1d0c');
    c.fillStyle = grad;
    c.fillRect(0, 0, w, h);
  });
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, 1.85), new THREE.MeshBasicMaterial({ map: glowTex, toneMapped: false }));
  panel.position.set(0, 1.93, z0 + 0.03);
  g.add(panel, box(wood, -half, half, 2.85, 2.93, z0, z0 + 0.4));

  const shelfYs = [1.4, 1.9, 2.4];
  const stripMat = glow('#ffd9a3');
  for (const y of shelfYs) add(g, box(wood, -half, half, y - 0.02, y + 0.02, z0 + 0.02, z0 + 0.36), box(stripMat, -half, half, y - 0.04, y - 0.025, z0 + 0.33, z0 + 0.35));
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
  g.add(bottles);

  // 유리벽에 걸린 네온 간판
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
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 1.72), signMat);
  sign.position.set(0, 3.72, z0 + 0.08);
  g.add(sign);
  document.fonts?.load('800 190px "Pretendard Variable"', '온술바혼자여도괜찮은밤쉿').then(() => {
    signMat.map.dispose();
    signMat.map = makeSign();
  });
}

function buildSeats(g) {
  const seatMarkers = new Map();
  const hits = [];
  const markerMat = new THREE.MeshBasicMaterial({ color: '#ffc46b', transparent: true, opacity: 0.9, toneMapped: false, side: THREE.DoubleSide, depthWrite: false });
  for (const s of SEATS) {
    const stool = new THREE.Group();
    stool.position.set(s.x, 0, s.z);
    const ring = mesh(G.stoolRing, M.brass, 0, 0.3, 0, false);
    ring.rotation.x = Math.PI / 2;
    stool.add(mesh(G.stoolSeat, M.cushion[s.gender], 0, GEO.seatHeight - 0.04, 0), mesh(G.stoolPole, M.metal, 0, 0.35, 0), mesh(G.stoolBase, M.metal, 0, 0.015, 0), ring);
    g.add(stool);

    const marker = new THREE.Mesh(G.ring, markerMat.clone());
    marker.rotation.x = -Math.PI / 2;
    marker.position.set(s.x, 0.02, s.z);
    marker.visible = false;
    marker.userData.dynamic = true;
    g.add(marker);
    seatMarkers.set(s.id, marker);

    const hit = new THREE.Mesh(G.hit, new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(s.x, 0.475, s.z);
    hit.scale.y = 0.5;
    hit.userData.seatId = s.id;
    hit.userData.dynamic = true;
    g.add(hit);
    hits.push(hit);
  }
  return { seatMarkers, hits };
}

function buildLights(g, lowPower) {
  const lights = [];
  const glowMat = new THREE.SpriteMaterial({ map: makeGlowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  const shadeMat = std('#16171c', { roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide });
  const bulbMat = glow('#ffe0b0');
  for (let b = 0; b < BAR_COUNT; b++) {
    const cx = barCenterX(b);
    const light = new THREE.PointLight(0xffb873, 17, 12, 1.8);
    light.position.set(cx, 3.7, -2.1);
    lights.push(light);
    for (const z of [-3.5, -1.3]) {
      const halo = new THREE.Sprite(glowMat);
      halo.scale.setScalar(1.5);
      halo.position.set(cx, 2.9, z);
      add(g, mesh(new THREE.CylinderGeometry(0.008, 0.008, WALL_H - 3.1, 4), M.metal, cx, (WALL_H + 3.1) / 2, z, false));
      add(g, mesh(new THREE.ConeGeometry(0.3, 0.26, 20, 1, true), shadeMat, cx, 3.02, z, false), mesh(new THREE.SphereGeometry(0.075, 12, 10), bulbMat, cx, 2.93, z, false), halo);
    }
  }
  for (const x of [-5.5, 5.5]) {
    const l = new THREE.PointLight(0xff9c5a, 11, 10, 1.8); // 백바
    l.position.set(x, 2.2, GEO.wallZ + 1.1);
    lights.push(l);
  }
  const festoon = new THREE.PointLight(0xffc98f, 7, 16, 1.6); // 줄조명 아래 라운지
  festoon.position.set(0, 3.6, 6.2);
  lights.push(festoon);
  g.add(...lights);
  return lights;
}

/** 엘리베이터에서 내리면 나오는 로비: 로프를 따라 줄을 서고, 호스트가 문을 열어 준다 */
function buildFoyer(g) {
  const { x0, x1, z0, z1 } = NAV.foyer;
  const xe = x1 + 2.2; // 엘리베이터 뒤쪽 끝
  const carpet = std('#16261f', { roughness: 0.95 });
  const runner = std('#5a1a22', { roughness: 0.95 });
  const plaster = std('#1c2a26', { roughness: 0.9 });
  const wains = std('#2b1b14', { roughness: 0.8 });
  add(g, box(carpet, x0, x1, -0.02, 0.012, z0, z1), box(runner, x0, x1, 0.012, 0.02, NAV.doorZ - 0.65, NAV.doorZ + 0.65));
  // 뒤쪽 벽 (앞쪽은 들여다보이도록 비워 둔다)
  add(g, box(plaster, x0, xe, 0, 3.3, z0 - 0.16, z0, true), box(wains, x0, xe, 0, 1.1, z0, z0 + 0.03));
  // 엘리베이터 쪽 벽: 문 자리만 뚫림
  const e0 = NAV.doorZ - 0.9;
  const e1 = NAV.doorZ + 0.9;
  add(g, box(plaster, x1, x1 + 0.1, 0, 3.3, z0, e0, true), box(plaster, x1, x1 + 0.1, 0, 3.3, e1, z1, true), box(plaster, x1, x1 + 0.1, 2.5, 3.3, e0, e1));
  add(g, box(M.brass, x1 - 0.03, x1, 0, 2.5, e0 - 0.08, e0), box(M.brass, x1 - 0.03, x1, 0, 2.5, e1, e1 + 0.08), box(M.brass, x1 - 0.03, x1, 2.5, 2.58, e0 - 0.08, e1 + 0.08));
  add(g, box(plaster, x1, xe, 0, 3.3, z1 - 0.1, z1, true), box(std('#15161b'), x1, xe + 0.05, 3.3, 3.42, z0 - 0.16, z1));

  // 벽등, 액자, 네온 "쉿"
  const sconceLight = new THREE.PointLight(0xffa860, 9, 9, 1.7);
  sconceLight.position.set(15.2, 2.5, z0 + 1.2);
  g.add(sconceLight);
  const halo = new THREE.SpriteMaterial({ map: makeGlowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  for (const x of [13.4, 15.9, 18.3]) {
    const s = new THREE.Sprite(halo);
    s.position.set(x, 2.25, z0 + 0.2);
    s.scale.setScalar(1.1);
    add(g, box(M.brass, x - 0.05, x + 0.05, 2.0, 2.2, z0, z0 + 0.1), mesh(new THREE.SphereGeometry(0.07, 10, 8), glow('#ffd9a8'), x, 2.26, z0 + 0.14, false), s);
  }
  for (const [x, w] of [[14.65, 0.9], [17.1, 0.7]]) add(g, box(M.brass, x - w / 2, x + w / 2, 1.45, 2.35, z0, z0 + 0.03), box(std('#0f1512'), x - w / 2 + 0.06, x + w / 2 - 0.06, 1.51, 2.29, z0 + 0.03, z0 + 0.04));
  const neon = canvasTexture(256, 256, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = '800 170px "Pretendard Variable", sans-serif';
    for (const b of [44, 20, 8]) {
      c.shadowColor = '#ff5d8f';
      c.shadowBlur = b;
      c.fillStyle = '#ff5d8f';
      c.fillText('쉿', w / 2, h / 2 + 8);
    }
    c.shadowBlur = 0;
    c.fillStyle = '#fff1f5';
    c.fillText('쉿', w / 2, h / 2 + 8);
  });
  const shh = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshBasicMaterial({ map: neon, transparent: true, toneMapped: false, depthWrite: false }));
  shh.position.set(x0 + 0.18, 2.95, NAV.doorZ);
  shh.rotation.y = Math.PI / 2;
  g.add(shh);
  document.fonts?.load('800 170px "Pretendard Variable"', '쉿').then(() => (neon.needsUpdate = true));

  // 대기 줄을 가르는 로프
  const rope = std('#7a1f2a', { roughness: 0.8 });
  const posts = [12.5, 14.4, 16.3, 18.2];
  for (const x of posts) add(g, mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.95, 10), M.brass, x, 0.475, 6.38), mesh(new THREE.SphereGeometry(0.06, 10, 8), M.brass, x, 0.97, 6.38), mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.04, 14), M.brass, x, 0.02, 6.38));
  for (let i = 0; i < posts.length - 1; i++) {
    const r = mesh(new THREE.CylinderGeometry(0.022, 0.022, posts[i + 1] - posts[i], 6), rope, (posts[i] + posts[i + 1]) / 2, 0.84, 6.38, false);
    r.rotation.z = Math.PI / 2;
    g.add(r);
  }

  // 바로 들어가는 문 (양쪽으로 열리는 두 짝, 둥근 창)
  const doorMat = std('#10261d', { roughness: 0.55 });
  const leaves = [-1, 1].map((side) => {
    const hinge = new THREE.Group();
    hinge.position.set(W + 0.08, 0, NAV.doorZ + side * 0.75);
    const zA = side < 0 ? 0 : -0.74;
    hinge.add(box(doorMat, -0.035, 0.035, 0, 2.4, zA, zA + 0.74, true), box(M.brass, -0.045, 0.045, 0.02, 0.3, zA + 0.05, zA + 0.69));
    hinge.add(mesh(new THREE.TorusGeometry(0.15, 0.025, 8, 20), M.brass, 0, 1.6, zA + 0.37, false).rotateY(Math.PI / 2));
    hinge.add(mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.08, 16), glow('#ffb46a'), 0, 1.6, zA + 0.37, false).rotateZ(Math.PI / 2));
    hinge.userData.side = side;
    hinge.userData.dynamic = true;
    g.add(hinge);
    return hinge;
  });

  // 호스트: 명단을 든 채 문 옆에 서 있다
  const host = buildPerson({ seed: hash('host'), staff: true });
  host.group.position.set(12.25, 0, 4.5);
  host.group.rotation.y = Math.PI * 0.42;
  host.group.scale.setScalar(1.06);
  host.arms[1].add(box(std('#e9e2d2'), -0.11, 0.11, -0.42, -0.4, -0.02, 0.26));
  host.arms[1].rotation.x = -1.0;
  g.add(host.group);
  add(g, box(wains, 12.55, 13.05, 0, 1.05, 3.95, 4.35, true), box(M.brass, 12.5, 13.1, 1.05, 1.09, 3.9, 4.4), mesh(new THREE.SphereGeometry(0.07, 10, 8), glow('#ffcf8f'), 12.8, 1.2, 4.15, false));

  return { leaves, host, lights: [sconceLight] };
}

export function buildRoof(scene, lowPower) {
  const g = new THREE.Group();
  buildDeck(g);
  buildShell(g);
  buildCounters(g);
  buildBackbar(g);
  const seats = buildSeats(g);
  const lights = buildLights(g, lowPower);
  const foyer = buildFoyer(g);
  mergeStatic(g);
  scene.add(g);
  let doorOpen = 0;
  return {
    group: g,
    lights: [...lights, ...foyer.lights],
    ...seats,
    host: foyer.host,
    get doorOpen() {
      return doorOpen;
    },
    /** 바 문: 0 닫힘 → 1 바 안쪽으로 활짝 */
    setDoor(k) {
      doorOpen = k;
      for (const leaf of foyer.leaves) leaf.rotation.y = leaf.userData.side * k * 1.35;
    },
    topY: TOP_Y,
  };
}
