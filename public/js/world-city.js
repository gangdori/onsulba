// 바깥 세상: 밤하늘, 도시 스카이라인, 우리 빌딩 외벽, 그리고 1층 골목의 간판 없는 문
import { THREE, std, glow, canvasTexture, mesh, box, seeded, M, mergeStatic } from './kit.js';

export const GROUND_Y = -70; // 루프탑(0)에서 70m 아래가 길바닥
export const BUILDING = { x0: -12.2, x1: 21.4, z0: -7.7, z1: 10.4 };
const FOG = '#1c1b33';

export function makeGlowTexture(inner = 'rgba(255,214,160,1)', mid = 'rgba(255,170,90,0.5)', outer = 'rgba(255,150,60,0)') {
  return canvasTexture(128, 128, (c, w, h) => {
    const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, inner);
    g.addColorStop(0.25, mid);
    g.addColorStop(1, outer);
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  });
}

/** 불 켜진 창문이 드문드문 있는 빌딩 외벽 (가로 8칸 × 세로 16층) */
function windowTexture(seed, litRatio = 0.3) {
  const rnd = seeded(seed);
  const tex = canvasTexture(256, 512, (c, w, h) => {
    c.fillStyle = '#0b0d17';
    c.fillRect(0, 0, w, h);
    for (let row = 0; row < 16; row++) {
      for (let col = 0; col < 8; col++) {
        const r = rnd();
        c.fillStyle = r < litRatio * 0.75 ? `rgba(255,${190 + rnd() * 40},${120 + rnd() * 50},${0.4 + rnd() * 0.5})` : r < litRatio ? 'rgba(170,205,255,0.6)' : '#11152a';
        c.fillRect(col * 32 + 8, row * 32 + 9, 16, 15);
      }
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function buildSky(scene) {
  scene.background = new THREE.Color('#070a14');
  scene.fog = new THREE.Fog(FOG, 90, 430);
  const tex = canvasTexture(8, 256, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#04060d');
    g.addColorStop(0.38, '#0a0f24');
    g.addColorStop(0.5, '#2b2347'); // 지평선의 도시 불빛
    g.addColorStop(0.56, FOG);
    g.addColorStop(1, '#0d0d1a');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(440, 24, 16), new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false }));
  dome.position.y = -30;
  scene.add(dome);

  const rnd = seeded(11);
  const pos = [];
  for (let i = 0; i < 420; i++) {
    const a = rnd() * Math.PI * 2;
    const e = 0.12 + rnd() * 1.3;
    pos.push(Math.cos(a) * Math.cos(e) * 420, Math.sin(e) * 420 - 30, Math.sin(a) * Math.cos(e) * 420);
  }
  const stars = new THREE.BufferGeometry();
  stars.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  scene.add(new THREE.Points(stars, new THREE.PointsMaterial({ color: '#cdd7ff', size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.75, fog: false, depthWrite: false })));

  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlowTexture('rgba(255,250,235,1)', 'rgba(220,225,255,0.35)', 'rgba(160,180,255,0)'), fog: false, depthWrite: false }));
  moon.position.set(-170, 150, -330);
  moon.scale.setScalar(60);
  scene.add(moon);
}

/** 주변 빌딩들을 한 덩어리로 (그리는 비용을 아끼려고 도형을 합친다) */
function buildSkyline(scene) {
  const rnd = seeded(7);
  const side = { pos: [], uv: [], col: [] };
  const top = [];
  const quad = (arr, a, b, c, d) => arr.push(...a, ...b, ...c, ...a, ...c, ...d);
  let made = 0;
  for (let i = 0; i < 260 && made < 170; i++) {
    const ang = rnd() * Math.PI * 2;
    const r = 42 + rnd() ** 1.25 * 190;
    const x = Math.cos(ang) * r;
    const z = Math.sin(ang) * r;
    const w = 11 + rnd() * 17;
    const d = 11 + rnd() * 17;
    // 가까운 건물은 루프탑보다 낮게(내려다보이게), 높은 타워는 멀리
    let h = r < 95 ? 24 + rnd() * 38 : 30 + rnd() * 58 + (rnd() > 0.84 ? 48 : 0);
    const x0 = x - w / 2;
    const x1 = x + w / 2;
    const z0 = z - d / 2;
    const z1 = z + d / 2;
    // 우리 빌딩 주변과 앞 도로는 비워 둔다
    if (x1 > BUILDING.x0 - 24 && x0 < BUILDING.x1 + 22 && z1 > BUILDING.z0 - 24 && z0 < BUILDING.z1 + 18) continue;
    if (z1 > 12 && z0 < 27 && Math.abs(x) < 90) continue;
    if (z > 12 && Math.abs(x) < 50) h = Math.min(h, 46); // 루프탑 카메라 뒤쪽은 낮게
    made++;
    const y0 = GROUND_Y;
    const y1 = GROUND_Y + h;
    const shade = 0.55 + rnd() * 0.6;
    const uo = Math.floor(rnd() * 8) / 8;
    const vo = Math.floor(rnd() * 16) / 16;
    const face = (ax, az, bx, bz, len) => {
      quad(side.pos, [ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az]);
      const u1 = uo + len / 11;
      const v1 = vo + h / 42;
      side.uv.push(uo, vo, u1, vo, u1, v1, uo, vo, u1, v1, uo, v1);
      for (let k = 0; k < 6; k++) side.col.push(shade, shade, shade * 1.05);
    };
    face(x0, z1, x1, z1, w);
    face(x1, z1, x1, z0, d);
    face(x1, z0, x0, z0, w);
    face(x0, z0, x0, z1, d);
    quad(top, [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]);
  }
  const sides = new THREE.BufferGeometry();
  sides.setAttribute('position', new THREE.Float32BufferAttribute(side.pos, 3));
  sides.setAttribute('uv', new THREE.Float32BufferAttribute(side.uv, 2));
  sides.setAttribute('color', new THREE.Float32BufferAttribute(side.col, 3));
  scene.add(new THREE.Mesh(sides, new THREE.MeshBasicMaterial({ map: windowTexture(3), vertexColors: true, side: THREE.DoubleSide })));
  const tops = new THREE.BufferGeometry();
  tops.setAttribute('position', new THREE.Float32BufferAttribute(top, 3));
  scene.add(new THREE.Mesh(tops, new THREE.MeshBasicMaterial({ color: '#0c0e18', side: THREE.DoubleSide })));

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshBasicMaterial({ color: '#0a0b12' }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = GROUND_Y - 0.02;
  scene.add(ground);
}

/** 우리 빌딩: 1층부터 루프탑 바닥까지의 외벽 + 옥상 슬래브 */
function buildTower(scene) {
  const { x0, x1, z0, z1 } = BUILDING;
  const h = -GROUND_Y - 0.6;
  const wall = (len, x, z, rotY, seed) => {
    const tex = windowTexture(seed, 0.22);
    tex.repeat.set(len / 11, h / 42);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len, h), new THREE.MeshBasicMaterial({ map: tex }));
    m.position.set(x, GROUND_Y + h / 2, z);
    m.rotation.y = rotY;
    scene.add(m);
  };
  wall(x1 - x0, (x0 + x1) / 2, z1, 0, 21);
  wall(x1 - x0, (x0 + x1) / 2, z0, Math.PI, 22);
  wall(z1 - z0, x1, (z0 + z1) / 2, Math.PI / 2, 23);
  wall(z1 - z0, x0, (z0 + z1) / 2, -Math.PI / 2, 24);

  const concrete = std('#24262d', { roughness: 0.95 });
  scene.add(box(concrete, x0, x1, -0.6, -0.02, z0, z1));
  // 옥상 가장자리 턱
  const t = 0.25;
  scene.add(box(concrete, x0, x1, -0.02, 0.4, z0, z0 + t), box(concrete, x0, x0 + t, -0.02, 0.4, z0, z1));
  scene.add(box(concrete, 11.5, x1, -0.02, 0.4, z1 - t, z1), box(concrete, x1 - t, x1, -0.02, 0.4, z0, 4.4), box(concrete, x1 - t, x1, -0.02, 0.4, 6.8, z1));
  // 옥상 설비(실외기·물탱크)
  const unit = std('#3a3d45', { roughness: 0.7, metalness: 0.3 });
  scene.add(box(unit, 13.5, 15.3, 0, 1.1, -5.5, -3.9, true), box(unit, 16, 17.8, 0, 1.1, -5.5, -3.9, true), box(unit, 13.6, 16.4, 0, 0.7, -1.6, 0.4, true));
  scene.add(mesh(new THREE.CylinderGeometry(1.1, 1.1, 2.2, 18), std('#4a4038', { roughness: 0.8 }), 19, 1.5, -4.6), mesh(new THREE.CylinderGeometry(1.25, 1.25, 0.4, 18), unit, 19, 0.2, -4.6));
}

/** 1층 골목: 간판 없는 문 하나 */
function buildStreet(scene) {
  const g = new THREE.Group();
  g.position.y = GROUND_Y;
  const zf = BUILDING.z1; // 건물 정면
  const lights = [];

  const road = new THREE.Mesh(new THREE.PlaneGeometry(160, 14), std('#0d0e14', { roughness: 0.32, metalness: 0.55 }));
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.01, zf + 10);
  g.add(road);
  g.add(box(std('#2b2c33', { roughness: 0.9 }), -40, 50, 0, 0.16, zf, zf + 3));

  const brick = canvasTexture(256, 256, (c, w, h) => {
    c.fillStyle = '#1a1210';
    c.fillRect(0, 0, w, h);
    for (let row = 0; row < 16; row++) {
      for (let col = -1; col < 8; col++) {
        const v = 46 + ((row * 17 + col * 29) % 22);
        c.fillStyle = `rgb(${v + 22},${v - 8},${v - 14})`;
        c.fillRect(col * 32 + (row % 2) * 16 + 1, row * 16 + 1, 30, 14);
      }
    }
  });
  brick.wrapS = brick.wrapT = THREE.RepeatWrapping;
  brick.repeat.set(17, 4);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(BUILDING.x1 - BUILDING.x0, 6.6), std('#ffffff', { map: brick, roughness: 0.9 }));
  wall.position.set((BUILDING.x0 + BUILDING.x1) / 2, 3.3, zf + 0.02);
  g.add(wall);
  g.add(box(std('#15161b'), BUILDING.x0, BUILDING.x1, 6.5, 6.8, zf, zf + 0.25));

  // 문틀 · 문 (경첩은 왼쪽)
  const frame = std('#0e0f12', { roughness: 0.5, metalness: 0.5 });
  g.add(box(frame, -0.72, -0.58, 0.16, 2.62, zf, zf + 0.14), box(frame, 0.58, 0.72, 0.16, 2.62, zf, zf + 0.14), box(frame, -0.72, 0.72, 2.5, 2.66, zf, zf + 0.14));
  const inside = new THREE.Mesh(new THREE.PlaneGeometry(1.16, 2.36), glow('#ffb46a'));
  inside.position.set(0, 1.34, zf - 0.02);
  inside.visible = false;
  inside.userData.dynamic = true;
  g.add(inside);
  const hinge = new THREE.Group();
  hinge.position.set(-0.58, 0.16, zf + 0.08);
  const leaf = box(std('#10261d', { roughness: 0.55 }), 0, 1.16, 0, 2.34, -0.035, 0.035);
  const slotMat = glow('#1b1611');
  hinge.add(leaf, box(M.brass, 0.08, 1.08, 0.06, 0.34, 0.03, 0.045), box(M.brass, 0.3, 0.86, 1.5, 1.68, 0.03, 0.045), box(slotMat, 0.34, 0.82, 1.54, 1.64, 0.04, 0.05));
  hinge.add(mesh(new THREE.SphereGeometry(0.045, 10, 8), M.brass, 1.02, 1.05, 0.07, false));
  hinge.userData.dynamic = true;
  g.add(hinge);
  g.add(box(std('#2b2c33'), -0.9, 0.9, 0.16, 0.24, zf, zf + 0.5));

  // 문 위의 작은 등
  const glowMat = new THREE.SpriteMaterial({ map: makeGlowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  g.add(mesh(new THREE.ConeGeometry(0.2, 0.18, 14, 1, true), std('#15161b', { side: THREE.DoubleSide, metalness: 0.6, roughness: 0.4 }), 0, 3.02, zf + 0.3, false));
  g.add(mesh(new THREE.SphereGeometry(0.06, 10, 8), glow('#ffd9a8'), 0, 2.95, zf + 0.3, false));
  const halo = new THREE.Sprite(glowMat);
  halo.position.set(0, 2.9, zf + 0.35);
  halo.scale.setScalar(1.6);
  g.add(halo);
  const doorLamp = new THREE.PointLight(0xffb070, 10, 11, 1.7);
  doorLamp.position.set(0, 2.85, zf + 0.9);
  g.add(doorLamp);
  lights.push(doorLamp);

  // 유일한 단서: 손바닥만 한 네온
  const neon = canvasTexture(256, 256, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = '800 150px "Pretendard Variable", sans-serif';
    for (const b of [40, 18, 6]) {
      c.shadowColor = '#ff7a59';
      c.shadowBlur = b;
      c.fillStyle = '#ff7a59';
      c.fillText('온', w / 2, h / 2 + 6);
    }
    c.shadowBlur = 0;
    c.fillStyle = '#fff3ea';
    c.fillText('온', w / 2, h / 2 + 6);
  });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62), new THREE.MeshBasicMaterial({ map: neon, transparent: true, toneMapped: false, depthWrite: false }));
  sign.position.set(-1.45, 2.2, zf + 0.06);
  g.add(sign);
  g.add(box(M.brass, 0.92, 1.2, 1.42, 1.6, zf + 0.02, zf + 0.05));

  // 골목 소품: 가로등, 나무 상자, 배수관, 화분
  const post = std('#17181d', { roughness: 0.5, metalness: 0.6 });
  g.add(mesh(new THREE.CylinderGeometry(0.06, 0.08, 4.6, 8), post, 4.6, 2.46, zf + 2.6), box(post, 3.7, 4.6, 4.6, 4.68, zf + 2.56, zf + 2.64), box(glow('#dfe8ff'), 3.6, 3.95, 4.5, 4.58, zf + 2.5, zf + 2.7));
  const lampHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlowTexture('rgba(235,242,255,1)', 'rgba(170,195,255,0.4)', 'rgba(140,170,255,0)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  lampHalo.position.set(3.78, 4.45, zf + 2.6);
  lampHalo.scale.setScalar(2.2);
  g.add(lampHalo);
  const streetLamp = new THREE.PointLight(0xbfd0ff, 16, 18, 1.6);
  streetLamp.position.set(3.78, 4.3, zf + 2.6);
  g.add(streetLamp);
  lights.push(streetLamp);

  const crate = std('#4a3626', { roughness: 0.9 });
  g.add(box(crate, 1.9, 2.6, 0.16, 0.76, zf + 0.15, zf + 0.8, true), box(crate, 2.05, 2.55, 0.76, 1.2, zf + 0.2, zf + 0.7, true), box(crate, 2.75, 3.35, 0.16, 0.66, zf + 0.2, zf + 0.8, true));
  g.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 6.4, 8), post, -3.1, 3.3, zf + 0.1, false));
  g.add(mesh(new THREE.CylinderGeometry(0.26, 0.2, 0.5, 12), std('#3a3f4b'), -2.2, 0.41, zf + 0.55));
  const leaf2 = std('#33684a', { roughness: 0.9, flatShading: true });
  for (let i = 0; i < 4; i++) g.add(mesh(new THREE.IcosahedronGeometry(0.26 + (i % 2) * 0.07, 0), leaf2, -2.2 + Math.sin(i * 2.1) * 0.16, 0.85 + i * 0.2, zf + 0.55 + Math.cos(i * 1.7) * 0.16));

  mergeStatic(g);
  scene.add(g);
  return { group: g, lights, hinge, slotMat, inside };
}

export function buildCity(scene) {
  buildSky(scene);
  buildSkyline(scene);
  buildTower(scene);
  // 아래에서 올려다봤을 때 꼭대기에서 번지는 불빛
  const roofGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.85, fog: false }));
  roofGlow.position.set(0, 1.5, BUILDING.z1 - 1);
  roofGlow.scale.set(34, 16, 1);
  scene.add(roofGlow);
  return { street: buildStreet(scene), roofGlow };
}
