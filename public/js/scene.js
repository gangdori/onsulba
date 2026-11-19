// 3D 연출 총괄: 골목 → 엘리베이터 → 루프탑 로비 → 바. 카메라, 손님(걷기/앉기), 직원, 이름표를 움직인다.
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { THREE, hash, ease, clamp01, G, M, TOP_Y, mesh, buildPerson, buildDrink, setPose, walkCycle } from './kit.js';
import { buildCity, GROUND_Y, BUILDING } from './world-city.js';
import { buildElevator } from './world-elevator.js';
import { buildRoof } from './world-roof.js';
import { GEO, SEATS, SEAT_BY_ID, BAR_COUNT, barCenterX, AVATAR_COLORS, NAV, QUEUE_VISIBLE, queueSlot, walkRoute } from '/shared/layout.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const FOV = 42;
const WALK_SPEED = 2.3; // 손님 걸음 (m/s)
const FACE_DOOR = -Math.PI / 2; // 줄 선 사람은 문(-x) 쪽을 본다

// 정해진 카메라 자리들
const SHOT = {
  streetUp: { pos: V(1.7, GROUND_Y + 1.5, BUILDING.z1 + 10.2), look: V(0.4, GROUND_Y + 46, BUILDING.z1), fov: 50 },
  street: { pos: V(1.7, GROUND_Y + 1.5, BUILDING.z1 + 10.2), look: V(0.25, GROUND_Y + 2.25, BUILDING.z1), fov: 50 },
  doorway: { pos: V(0.15, GROUND_Y + 1.5, BUILDING.z1 + 2.2), look: V(0, GROUND_Y + 1.45, BUILDING.z1 - 2), fov: 50 },
  cabView: { pos: V(-0.75, 1.5, 0.35), look: V(1.4, 1.1, -0.3), fov: 64 }, // 유리 너머 도시
  cabDoor: { pos: V(0.6, 1.5, 0), look: V(-1.2, 1.35, 0), fov: 64 }, // 문 쪽
  stepOut: { pos: V(17.5, 1.62, NAV.doorZ), look: V(13.2, 1.2, NAV.doorZ), fov: 52 },
};

// ---------- 직원이 다니는 길 ----------
const LANE_END_Z = GEO.tipZ - GEO.counterDepth - 0.45;
const laneOf = (x, z) => {
  if (z <= GEO.frontZ + 0.05) return -1; // 가로 통로
  let best = 0;
  for (let b = 1; b < BAR_COUNT; b++) if (Math.abs(x - barCenterX(b)) < Math.abs(x - barCenterX(best))) best = b;
  return best;
};
function staffRoute(from, to) {
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
    this.avatars = new Map(); // userId -> 손님
    this.ghosts = []; // 나가는 중인 손님
    this.seatUser = new Map(); // seatId -> userId
    this.orders = []; // 직원이 배달할 주문
    this.calls = []; // 직원을 부른 손님 (userId)
    this.onStaffArrived = null; // 내가 부른 직원이 자리에 도착했을 때
    this.onSelfSeated = null; // 내 아바타가 실제로 자리에 앉았을 때
    this.tweens = [];
    this.myId = null;
    this.live = false; // 첫 상태를 받은 뒤부터는 변화가 걸어서 일어난다
    this.onPickUser = null;
    this.onPickSeat = null;
    this.moveMode = null;
    this.panel = true; // 넓은 화면 왼쪽에 패널이 떠 있는지
    this.fast = 1; // 건너뛰기 배속
    this.lastFrame = performance.now();
    this.time = 0;
    this.quality = new URLSearchParams(location.search).has('px') ? 0 : 2; // 느린 기기에서는 자동으로 낮춘다 (2 → 0)
    this.perf = { n: 0, sum: 0, hold: 4 };

    const renderer = (this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }));
    this.lowPower = Math.min(window.innerWidth, window.innerHeight) < 600;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    // 자동화 테스트용: ?px=0.4 처럼 주면 해상도를 고정하고 그림자를 끈다 (GPU 없는 환경에서 빨리 돌리려고)
    const px = Number(new URLSearchParams(location.search).get('px'));
    if (px > 0) renderer.setPixelRatio(px);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = !(px > 0);
    renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(renderer.domElement);

    const scene = (this.scene = new THREE.Scene());
    const camera = (this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 950));
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
    controls.addEventListener('start', () => {
      this.goal = null;
      this.follow = false; // 손님이 직접 시점을 잡으면 따라가기를 멈춘다
    });

    this.city = buildCity(scene);
    this.roof = buildRoof(scene, this.lowPower);
    this.cab = buildElevator(scene);
    this.#buildSun();
    this.staff = [this.#makeStaff(0), this.#makeStaff(1)];

    this.look = V(0, 0, 0); // 연출 중 카메라가 보는 점
    this.view = 'overview';
    this.resize();
    this.enterStreet(true);
    new ResizeObserver(() => this.resize()).observe(container);
    this.#bindPicking();
    renderer.setAnimationLoop(() => this.#frame());
  }

  #buildSun() {
    // 황동·유리에 은은한 반사가 생기도록 주변 반사 환경을 깐다 (three.js 내장, 별도 파일 없음)
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.22;
    pmrem.dispose();
    this.scene.add(new THREE.HemisphereLight(0xa9b8ff, 0x2a1a10, 0.75));
    const key = new THREE.DirectionalLight(0xffe6cf, 1.5);
    key.position.set(-5, 13, 9);
    key.target.position.set(0, 0, -2.5);
    key.castShadow = true;
    const size = this.lowPower ? 1024 : 2048;
    key.shadow.mapSize.set(size, size);
    Object.assign(key.shadow.camera, { left: -13, right: 23, top: 11, bottom: -10, near: 1, far: 44 });
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.03;
    this.scene.add(key, key.target);
  }

  // ===== 장면 전환 =====
  /** 지금 무대에 필요한 것만 켠다 (조명 수를 줄여 휴대폰에서도 가볍게) */
  #setStage(stage) {
    this.stage = stage;
    const street = stage === 'street';
    this.city.street.group.visible = street;
    for (const l of this.city.street.lights) l.visible = street;
    this.roof.group.visible = !street;
    for (const l of this.roof.lights) l.visible = !street;
    this.cab.group.visible = !street;
    this.cab.light.visible = !street;
    this.labelLayer.style.display = stage === 'roof' ? '' : 'none';
    this.perf = { n: 0, sum: 0, hold: 3 }; // 장면이 바뀐 직후의 끊김은 성능 측정에서 뺀다
  }

  /** 프레임이 계속 느리면 해상도를 낮추고, 그래도 느리면 그림자를 끈다 */
  #adaptQuality(elapsed) {
    const p = this.perf;
    if (document.hidden || this.quality === 0) return;
    if (p.hold > 0) {
      p.hold -= elapsed;
      return;
    }
    p.n++;
    p.sum += elapsed;
    if (p.n < 45) return;
    const avg = p.sum / p.n;
    this.perf = { n: 0, sum: 0, hold: 2 };
    if (avg < 0.045) return; // 22fps 이상이면 그대로
    this.quality--;
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(this.quality === 1 ? Math.min(dpr, 1.25) : 1);
    if (this.quality === 0) {
      this.renderer.shadowMap.enabled = false;
      this.scene.traverse((o) => {
        if (o.material) o.material.needsUpdate = true;
      });
    }
    this.resize(true);
  }

  #scripted(on) {
    this.script = on;
    this.controls.enabled = !on;
    if (on) this.goal = null;
  }

  #pose(p, attach = null) {
    this.attach = attach;
    this.camPos = p.pos.clone();
    this.look.copy(p.look);
    this.camFov = p.fov;
    this.shot = null;
  }

  /** 카메라를 지금 자리에서 to 까지 부드럽게 옮긴다 */
  #shotTo(to, dur) {
    return new Promise((done) => {
      this.shot = { from: { pos: this.camPos.clone(), look: this.look.clone(), fov: this.camFov }, to, t: 0, dur, done };
    });
  }

  #tween(dur, fn = () => {}) {
    return new Promise((done) => this.tweens.push({ t: 0, dur, fn, done }));
  }

  /** 1층 골목 (입장 전). intro 면 빌딩 꼭대기를 올려다보다가 문으로 내려온다 */
  enterStreet(intro = true) {
    this.#setStage('street');
    this.#scripted(true);
    this.fast = 1;
    const s = this.city.street;
    s.hinge.rotation.y = 0;
    s.inside.visible = false;
    s.slotMat.color.set('#1b1611');
    this.#pose(intro ? SHOT.streetUp : SHOT.street);
    const token = (this.streetIntro = {});
    if (intro) {
      this.#tween(0.9).then(() => {
        if (this.streetIntro === token) this.#shotTo(SHOT.street, 3.4);
      });
    }
  }

  /** 문틈으로 눈이 한번 살피고, 문이 열린다 */
  async openStreetDoor() {
    this.streetIntro = null;
    const s = this.city.street;
    s.slotMat.color.set('#ffc37a');
    await this.#tween(0.55);
    s.inside.visible = true;
    this.#shotTo(SHOT.doorway, 1.9);
    await this.#tween(1.1, (k) => (s.hinge.rotation.y = ease(k) * 1.45));
  }

  /** 엘리베이터를 타고 루프탑까지. onFloor(층) 으로 층수를 알려 준다 */
  async rideElevator(onFloor) {
    this.#setStage('elevator');
    this.#scripted(true);
    this.cab.group.position.y = GROUND_Y;
    this.cab.setOpen(0);
    this.cabHold = true;
    this.#pose(SHOT.cabView, this.cab.group);
    this.riding = true;
    onFloor(1);
    await this.#tween(0.8);
    const rise = this.#tween(6, (k) => {
      const e = ease(k);
      this.cab.group.position.y = GROUND_Y * (1 - e);
      onFloor(1 + Math.round(e * 16));
    });
    await this.#tween(4.4);
    this.#shotTo(SHOT.cabDoor, 1.7);
    await rise;
    this.riding = false;
    await this.#tween(0.4);
    this.fast = 1;
    this.#setStage('roof');
    await this.#tween(0.9, (k) => this.cab.setOpen(ease(k)));
  }

  skipRide() {
    if (this.riding) this.fast = 14;
  }

  /** 엘리베이터에서 걸어 나와 로비를 내려다보는 시점으로 */
  async stepOut() {
    const base = this.cab.group.position;
    this.camPos.add(base);
    this.look.add(base);
    this.attach = null;
    await this.#shotTo(SHOT.stepOut, 1.5);
    const v = this.#viewPose(this.view);
    await this.#shotTo({ pos: v.pos, look: v.target, fov: FOV }, 1.7);
    this.#handOver();
    this.#tween(1.2).then(() => (this.cabHold = false));
  }

  /** 연출 없이 바로 루프탑으로 (새로고침으로 자리에 돌아온 경우 등) */
  showRoof(view) {
    this.#setStage('roof');
    this.fast = 1;
    this.riding = false;
    this.cabHold = false;
    this.cab.group.position.y = 0;
    this.cab.setOpen(0);
    this.attach = null;
    this.shot = null;
    this.camFov = FOV;
    this.view = view;
    this.#handOver(true);
  }

  #handOver(instant = false) {
    this.#scripted(false);
    this.camera.fov = FOV;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(this.look);
    this.setView(this.view, instant);
  }

  // ===== 직원 =====
  #makeStaff(index) {
    const person = buildPerson({ seed: hash(`staff${index}`), staff: true });
    person.group.scale.setScalar(1.06);
    const homeBar = index === 0 ? 0 : BAR_COUNT - 1;
    person.group.position.set(barCenterX(homeBar), 0, GEO.corridorZ);
    this.roof.group.add(person.group);
    const tray = new THREE.Group();
    tray.add(mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.012, 16), M.metal, 0, 0, 0, false));
    tray.position.set(0.3, 1.18, 0.22);
    tray.visible = false;
    person.body.add(tray);
    // 직원 머리 위 말풍선 ("주문하시겠어요?")
    const tag = document.createElement('div');
    tag.className = 'tag staff';
    tag.innerHTML = '<div class="bubble" hidden></div>';
    this.labelLayer.appendChild(tag);
    return { ...person, tray, tag, bubbleEl: tag.firstChild, index, path: [], wait: 1 + index * 2, job: null, attend: null, phase: 'idle', heading: 0, step: 0 };
  }

  #staffIdleTarget(st) {
    // 자기 구역 근처의 통로를 어슬렁거림
    const bars = st.index === 0 ? [0, 0, 1] : [2, 2, 1];
    const b = bars[Math.floor(Math.random() * bars.length)];
    if (Math.random() < 0.35) return { x: barCenterX(b) + (Math.random() - 0.5) * 3, z: GEO.corridorZ + 0.15 };
    return { x: barCenterX(b) + (Math.random() - 0.5) * 0.5, z: GEO.frontZ + 0.6 + Math.random() * (LANE_END_Z - GEO.frontZ - 0.6) };
  }

  /** 경로를 따라 한 걸음. 도착해서 더 갈 곳이 없으면 false */
  #stepAlong(p, dt, speed) {
    const pos = p.group.position;
    if (p.path.length === 0) {
      walkCycle(p, 0, 0);
    } else {
      const tgt = p.path[0];
      const dx = tgt.x - pos.x;
      const dz = tgt.z - pos.z;
      const dist = Math.hypot(dx, dz);
      const stepLen = speed * dt;
      if (dist <= stepLen) {
        pos.x = tgt.x;
        pos.z = tgt.z;
        p.path.shift();
      } else {
        pos.x += (dx / dist) * stepLen;
        pos.z += (dz / dist) * stepLen;
        p.heading = Math.atan2(dx, dz);
      }
      p.step += dt * speed * 3.6;
      walkCycle(p, p.step, 1);
    }
    // 부드럽게 방향 전환
    let d = p.heading - p.group.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    p.group.rotation.y += d * Math.min(1, dt * 10);
    return p.path.length > 0;
  }

  #updateStaff(st, dt) {
    if (!this.#stepAlong(st, dt, 3.0)) {
      st.wait -= dt;
      if (st.wait <= 0) this.#staffNext(st);
    }
  }

  #staffNext(st) {
    const pos = st.group.position;
    if (st.phase === 'toBackbar') {
      // 백바에서 음료 준비 완료 → 손님 자리로
      st.tray.visible = true;
      st.tray.add((st.cargo = buildDrink(st.job.drink)));
      st.cargo.scale.setScalar(1.2);
      const seat = SEAT_BY_ID.get(st.job.seatId);
      st.path = staffRoute(pos, { x: seat.laneX, z: seat.laneZ });
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
    } else if (st.phase === 'attendGo') {
      // 부른 손님 앞에 도착: 주문을 기다린다
      const seat = SEAT_BY_ID.get(st.attend.seatId);
      st.heading = Math.atan2(seat.x - pos.x, seat.z - pos.z);
      st.phase = 'attending';
      st.wait = 25;
      st.bubbleEl.textContent = '주문하시겠어요?';
      st.bubbleEl.hidden = false;
      if (st.attend.userId === this.myId) this.onStaffArrived?.();
    } else if (st.phase === 'attending') {
      this.#endAttend(st);
    } else {
      const caller = this.calls.shift();
      const job = caller ? null : this.orders.shift();
      if (caller) {
        this.#attend(st, caller);
      } else if (job) {
        this.#takeJob(st, job);
      } else {
        st.path = staffRoute(pos, this.#staffIdleTarget(st));
        st.wait = 1.5 + Math.random() * 4;
      }
    }
  }

  #takeJob(st, job) {
    st.job = job;
    const x = THREE.MathUtils.clamp(barCenterX(SEAT_BY_ID.get(job.seatId).bar) + (st.index ? 0.5 : -0.5), -9, 9);
    st.path = staffRoute(st.group.position, { x, z: GEO.corridorZ - 0.25 });
    st.phase = 'toBackbar';
    st.wait = 0.45;
  }

  #attend(st, userId) {
    const av = this.avatars.get(userId);
    if (!av?.seatId) return;
    const seat = SEAT_BY_ID.get(av.seatId);
    st.attend = { userId, seatId: av.seatId };
    st.path = staffRoute(st.group.position, { x: seat.laneX, z: seat.laneZ });
    st.phase = 'attendGo';
    st.wait = 0.01;
  }

  #endAttend(st) {
    st.attend = null;
    st.bubbleEl.hidden = true;
    st.phase = 'idle';
    st.wait = 0.4;
  }

  /** 손님이 직원을 불렀다: 한가한 직원이 그 자리로 걸어간다 */
  summonStaff(userId) {
    const av = this.avatars.get(userId);
    if (!av?.seatId || this.calls.includes(userId) || this.staff.some((st) => st.attend?.userId === userId)) return;
    const seat = SEAT_BY_ID.get(av.seatId);
    const free = this.staff
      .filter((st) => !st.job && !st.attend)
      .sort((a, b) => Math.abs(a.group.position.x - seat.laneX) - Math.abs(b.group.position.x - seat.laneX));
    if (free.length) this.#attend(free[0], userId);
    else this.calls.push(userId); // 모두 바쁘면 일이 끝나는 대로
  }

  /** 주문 없이 메뉴판을 덮었을 때: 직원이 물러난다 */
  dismissStaff(userId) {
    this.calls = this.calls.filter((id) => id !== userId);
    for (const st of this.staff) {
      if (st.attend?.userId !== userId) continue;
      if (st.phase === 'attending') st.wait = 0.3;
      else {
        st.path = [];
        this.#endAttend(st);
      }
    }
  }

  // ===== 손님 =====
  /**
   * 서버 상태에 맞춘다. 처음 받은 상태는 그대로 배치하고,
   * 그 뒤의 변화(입장·대기 줄·자리 옮기기·퇴장)는 전부 걸어서 일어난다.
   */
  setUsers(users, queue, myId, now) {
    this.myId = myId;
    const want = new Map();
    this.seatUser.clear();
    for (const u of users) {
      want.set(u.id, { u, seatId: u.seatId, slot: null });
      this.seatUser.set(u.seatId, u.id);
    }
    queue.forEach((q, i) => want.set(q.id, { u: q, seatId: null, slot: Math.min(i, QUEUE_VISIBLE - 1) }));

    for (const [id, w] of want) {
      const u = w.u;
      let av = this.avatars.get(id);
      const isNew = !av;
      if (!av) av = this.#makeAvatar(u);
      av.user = u;
      av.nameEl.textContent = u.name;
      av.tag.classList.toggle('me', id === myId);
      av.tag.classList.toggle('busy', !!u.busy);
      av.tag.classList.toggle('away', !!u.away);
      av.tag.dataset.gender = u.gender;
      av.selfRing.visible = id === myId;

      const goal = w.seatId ? `seat:${w.seatId}` : `slot:${w.slot}`;
      if (av.goal !== goal) {
        av.goal = goal;
        av.seatId = w.seatId;
        av.slot = w.slot;
        if (w.seatId) {
          const s = SEAT_BY_ID.get(w.seatId);
          av.drinkGroup.position.set(s.drinkX, TOP_Y, s.drinkZ);
          av.drinkGroup.rotation.y = Math.atan2(s.face[0], s.face[1]);
          for (const o of this.orders) if (o.userId === id) o.seatId = w.seatId;
        }
        if (this.live) this.#walk(av);
        else this.#place(av);
      }
      if (w.seatId && u.drink && u.orderedAt && av.orderedAt !== u.orderedAt) {
        av.orderedAt = u.orderedAt;
        this.orders = this.orders.filter((o) => o.userId !== id);
        const job = { userId: id, seatId: w.seatId, drink: u.drink, orderedAt: u.orderedAt };
        const waiter = this.staff.find((st) => st.attend?.userId === id); // 주문을 받고 있던 직원이 바로 만들러 간다
        if (isNew && now - u.orderedAt > 9000) this.#placeDrink(id, u.drink, u.orderedAt);
        else if (waiter) {
          waiter.path = [];
          this.#endAttend(waiter);
          this.#takeJob(waiter, job);
        } else this.orders.push(job);
      }
    }

    for (const [id, av] of this.avatars) {
      if (want.has(id)) continue;
      this.avatars.delete(id);
      this.orders = this.orders.filter((o) => o.userId !== id);
      this.dismissStaff(id);
      av.tag.remove();
      this.roof.group.remove(av.drinkGroup);
      av.selfRing.visible = false;
      // 인사하고 엘리베이터로 걸어 나간다
      setPose(av, 'stand');
      av.path = walkRoute({ x: av.group.position.x, z: av.group.position.z }, av.atSeat, { point: NAV.elevator });
      av.atSeat = null;
      av.group.position.y = 0;
      this.ghosts.push(av);
    }
    this.live = true;
    this.#refreshMarkers();
  }

  #makeAvatar(u) {
    const person = buildPerson({ color: AVATAR_COLORS[u.color] || AVATAR_COLORS[0], seed: hash(u.id) });
    const drinkGroup = new THREE.Group();
    drinkGroup.visible = false;
    const selfRing = new THREE.Mesh(G.ring, new THREE.MeshBasicMaterial({ color: '#ffb35c', transparent: true, opacity: 0.95, toneMapped: false, side: THREE.DoubleSide, depthWrite: false }));
    selfRing.rotation.x = -Math.PI / 2;
    selfRing.position.y = 0.025;
    selfRing.scale.setScalar(1.25);
    person.group.add(selfRing);
    // 새로 온 손님은 엘리베이터에서 내린다
    person.group.position.set(NAV.elevator.x, 0, NAV.elevator.z);
    person.group.rotation.y = FACE_DOOR;
    this.roof.group.add(person.group, drinkGroup);

    const tag = document.createElement('div');
    tag.className = 'tag';
    tag.innerHTML = '<div class="bubble" hidden></div><div class="plate"><i class="dot"></i><span class="name"></span><span class="badge">통화 중</span></div>';
    this.labelLayer.appendChild(tag);
    const av = {
      ...person,
      id: u.id,
      drinkGroup,
      selfRing,
      tag,
      nameEl: tag.querySelector('.name'),
      bubbleEl: tag.querySelector('.bubble'),
      goal: null,
      seatId: null, // 서버가 정해 준 자리
      atSeat: null, // 지금 실제로 앉아 있는 자리
      slot: null,
      path: [],
      heading: FACE_DOOR,
      step: 0,
      settle: 1,
      talk: 0,
      cheers: 0,
      speaking: false,
      seed: hash(u.id) % 100,
      orderedAt: null,
    };
    this.avatars.set(u.id, av);
    return av;
  }

  /** 걷지 않고 바로 제자리에 */
  #place(av) {
    av.path = [];
    if (av.seatId) {
      this.#sit(av);
    } else {
      const p = queueSlot(av.slot);
      setPose(av, 'stand');
      av.atSeat = null;
      av.group.position.set(p.x, 0, p.z);
      av.heading = av.group.rotation.y = FACE_DOOR;
    }
  }

  #walk(av) {
    const target = av.seatId ? { seatId: av.seatId } : { point: queueSlot(av.slot) };
    av.path = walkRoute({ x: av.group.position.x, z: av.group.position.z }, av.atSeat, target);
    av.atSeat = null;
    av.group.position.y = 0;
    av.drinkGroup.visible = false; // 잔은 자리에 앉으면 다시 보인다
    setPose(av, 'stand');
  }

  #sit(av) {
    const s = SEAT_BY_ID.get(av.seatId);
    setPose(av, 'sit');
    av.atSeat = av.seatId;
    av.group.position.set(s.x, 0, s.z);
    av.heading = av.group.rotation.y = Math.atan2(s.face[0], s.face[1]);
    av.drinkGroup.visible = true;
    av.settle = 0;
    if (av.id === this.myId) this.onSelfSeated?.();
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
    if (av?.atSeat) av.cheers = 1.3;
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
      this.roof.seatMarkers.get(s.id).visible = !!this.moveMode && s.gender === this.moveMode && !this.seatUser.has(s.id);
    }
    // 누르는 영역을 보이는 모습에 맞춘다: 빈자리는 스툴 높이, 손님이 있으면 사람 키
    for (const hit of this.roof.hits) {
      const taken = this.seatUser.has(hit.userData.seatId);
      hit.scale.y = taken ? 1 : 0.5;
      hit.position.y = taken ? 0.95 : 0.475;
    }
  }

  // ===== 카메라 =====
  #viewPose(view) {
    // 넓은 화면에서는 왼쪽 패널을 뺀 영역에 맞춘다
    const aspect = (this.size.w - this.inset) / this.size.h;
    const t = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    let target;
    let dir;
    let dist;
    if (view === 'overview') {
      target = V(0, 0.9, -1.2);
      dir = V(0, 0.68, 0.74);
      dist = THREE.MathUtils.clamp(Math.max(11.1 / (t * aspect), 6.2 / t), 13, 40);
    } else if (view === 'foyer') {
      target = V(15.2, 1.0, 5.4);
      dir = V(-0.1, 0.6, 0.8);
      dist = THREE.MathUtils.clamp(Math.max(4.9 / (t * aspect), 3.3 / t), 9, 26);
    } else {
      const cx = barCenterX(view.bar);
      target = V(cx, 1.0, -2.0);
      dir = V((1 - view.bar) * 0.1, 0.66, 0.75);
      dist = THREE.MathUtils.clamp(Math.max(2.9 / (t * aspect), 3.4 / t), 8, 22);
    }
    return { pos: target.clone().addScaledVector(dir.normalize(), dist), target };
  }

  /** 'overview' | 'foyer' | { bar } */
  setView(view, instant = false) {
    this.view = view;
    if (this.script) return; // 연출이 끝나면 이 시점으로 넘어간다
    const v = this.#viewPose(view);
    if (instant) {
      this.camera.position.copy(v.pos);
      this.controls.target.copy(v.target);
      this.goal = null;
    } else {
      this.goal = v;
    }
  }

  /** 내 자리로. 걸어가는 동안은 카메라가 나를 따라가고, 앉으면 그 바를 비춘다 */
  focusSeat(seatId, instant = false) {
    this.follow = !instant;
    if (instant) this.setView({ bar: SEAT_BY_ID.get(seatId).bar }, true);
  }

  #followMe() {
    const me = this.avatars.get(this.myId);
    if (!me || !me.seatId) return;
    if (me.atSeat) {
      this.follow = false;
      this.setView({ bar: SEAT_BY_ID.get(me.atSeat).bar });
    } else if (me.group.position.x > NAV.wallX + 0.2) {
      if (this.view !== 'foyer') this.setView('foyer'); // 아직 로비: 문을 지날 때까지 로비를 비춘다
    } else {
      this.view = { bar: SEAT_BY_ID.get(me.seatId).bar };
      if (this.script) return;
      const t = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
      const aspect = (this.size.w - this.inset) / this.size.h;
      const target = V(me.group.position.x, 1.0, me.group.position.z - 1.2);
      const dist = THREE.MathUtils.clamp(Math.max(3.4 / (t * aspect), 3.9 / t), 9, 22);
      this.goal = { pos: target.clone().addScaledVector(V(0.04, 0.66, 0.75).normalize(), dist), target };
    }
  }

  /** 넓은 화면에서 왼쪽 패널이 있는 동안에는 장면을 오른쪽으로 민다 */
  setPanel(on) {
    if (this.panel === on) return;
    this.panel = on;
    this.resize(true);
  }

  resize(force = false) {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    const changed = force || Math.abs(this.camera.aspect - w / h) > 0.01;
    this.camera.aspect = w / h;
    this.inset = w >= 860 && this.panel ? 430 : 0;
    if (this.inset) this.camera.setViewOffset(w, h, -this.inset / 2, 0, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    this.size = { w, h };
    if (changed && !this.script && this.view) this.setView(this.view, this.time < 0.5);
  }

  #bindPicking() {
    const el = this.renderer.domElement;
    const ray = new THREE.Raycaster();
    let down = null;
    el.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY, t: e.timeStamp }));
    el.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8 || e.timeStamp - down.t > 600) return;
      if (this.script || this.stage !== 'roof') return;
      const r = el.getBoundingClientRect();
      if (this.moveMode) {
        // 자리 옮기기 중에는 누른 곳에서 가장 가까운 빛나는 빈자리를 고른다 (작은 화면에서도 누르기 쉽게)
        const v = new THREE.Vector3();
        let best = null;
        let bestD = 44;
        for (const [seatId, marker] of this.roof.seatMarkers) {
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
      const hit = ray.intersectObjects(this.roof.hits, false)[0];
      if (!hit) return this.onPickUser?.(null);
      const seatId = hit.object.userData.seatId;
      const userId = this.seatUser.get(seatId);
      if (userId) this.onPickUser?.(userId);
      else this.onPickSeat?.(seatId);
    });
  }

  // ===== 매 프레임 =====
  #updateCamera(dt, elapsed, t) {
    if (!this.script) {
      if (this.goal) {
        const k = 1 - Math.exp(-Math.min(elapsed, 0.5) * 3.2);
        this.camera.position.lerp(this.goal.pos, k);
        this.controls.target.lerp(this.goal.target, k);
        if (this.camera.position.distanceTo(this.goal.pos) < 0.02) this.goal = null;
      }
      this.controls.update();
      return;
    }
    const s = this.shot;
    if (s) {
      s.t += dt;
      const k = ease(clamp01(s.t / s.dur));
      this.camPos.lerpVectors(s.from.pos, s.to.pos, k);
      this.look.lerpVectors(s.from.look, s.to.look, k);
      this.camFov = s.from.fov + (s.to.fov - s.from.fov) * k;
      if (s.t >= s.dur) {
        this.shot = null;
        s.done();
      }
    }
    const base = this.attach ? this.attach.position : null;
    const cam = this.camera;
    cam.position.copy(this.camPos);
    if (base) cam.position.add(base);
    // 손에 든 카메라처럼 아주 살짝 흔들림 (엘리베이터가 움직일 때는 조금 더)
    const shake = this.riding ? 0.006 : 0.012;
    cam.position.x += Math.sin(t * (this.riding ? 23 : 0.6)) * shake;
    cam.position.y += Math.sin(t * (this.riding ? 31 : 0.45) + 1) * shake * 0.6;
    const lookAt = base ? this.look.clone().add(base) : this.look;
    cam.lookAt(lookAt);
    if (Math.abs(cam.fov - this.camFov) > 0.01) {
      cam.fov = this.camFov;
      cam.updateProjectionMatrix();
    }
  }

  #updateDoors(dt) {
    if (this.stage === 'street') return;
    let nearBar = false;
    let nearCab = false;
    const check = (p) => {
      const pos = p.group.position;
      if (Math.hypot(pos.x - NAV.wallX, pos.z - NAV.doorZ) < 1.7) nearBar = true;
      if (Math.hypot(pos.x - NAV.elevator.x, pos.z - NAV.elevator.z) < 1.25) nearCab = true;
    };
    for (const av of this.avatars.values()) if (!av.atSeat) check(av);
    for (const g of this.ghosts) check(g);
    const toward = (cur, want, speed) => cur + THREE.MathUtils.clamp(want - cur, -speed * dt, speed * dt);
    this.roof.setDoor(toward(this.roof.doorOpen, nearBar ? 1 : 0, 2.2));
    if (this.stage === 'roof') this.cab.setOpen(toward(this.cab.open, nearCab || this.cabHold ? 1 : 0, 1.5));
  }

  #updateAvatars(dt, t) {
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i];
      if (this.#stepAlong(g, dt, WALK_SPEED)) continue;
      this.roof.group.remove(g.group);
      this.ghosts.splice(i, 1);
    }

    const v = new THREE.Vector3();
    const { w, h } = this.size;
    const far = this.camera.position.distanceTo(this.controls.target) > 19;
    this.labelLayer.classList.toggle('far', far);
    this.labelLayer.classList.toggle('compact', far && w < 600);
    const lobbyCam = this.script || this.view === 'foyer';
    for (const av of this.avatars.values()) {
      if (av.atSeat) {
        // 자리에 앉아서: 숨쉬기, 말할 때 끄덕임
        av.settle = Math.min(1, av.settle + dt * 4);
        av.group.position.y = (1 - ease(av.settle)) * 0.1;
        av.talk = Math.max(0, av.talk - dt);
        const lively = av.talk > 0 || av.speaking ? 1 : 0;
        av.body.position.y = av.lift + Math.sin(t * 1.6 + av.seed) * 0.008 + lively * Math.abs(Math.sin(t * 9)) * 0.018;
        av.head.rotation.y = Math.sin(t * 0.5 + av.seed) * 0.22;
        av.head.rotation.x = Math.sin(t * 0.8 + av.seed * 2) * 0.05 + lively * Math.sin(t * 9) * 0.07;
      } else {
        av.head.rotation.set(0, Math.sin(t * 0.4 + av.seed) * (av.path.length ? 0.05 : 0.3), 0);
        const wasWalking = av.path.length > 0;
        const walking = this.#stepAlong(av, dt, WALK_SPEED);
        if (wasWalking && !walking) {
          if (av.seatId) this.#sit(av);
          else av.heading = FACE_DOOR;
        }
      }
      av.selfRing.material.opacity = 0.65 + Math.sin(t * 3) * 0.3;

      // 음료 등장 / 건배
      if (av.drinkPop !== undefined && av.drinkPop < 1) {
        av.drinkPop = Math.min(1, av.drinkPop + dt * 3);
        av.drinkGroup.scale.setScalar(ease(av.drinkPop));
      }
      if (av.cheers > 0 && av.atSeat) {
        av.cheers = Math.max(0, av.cheers - dt);
        const k = Math.sin((1 - av.cheers / 1.3) * Math.PI);
        const s = SEAT_BY_ID.get(av.atSeat);
        av.drinkGroup.position.set(s.drinkX - s.face[0] * k * 0.12, TOP_Y + k * 0.42, s.drinkZ - s.face[1] * k * 0.12);
        av.arms[1].rotation.x = -1.18 - k * 0.9;
      }

      // 이름표 위치 (로비를 보는 동안에는 벽 너머 바 손님의 이름표를 숨긴다)
      v.set(av.group.position.x, 1.98, av.group.position.z).project(this.camera);
      const behindWall = lobbyCam && av.group.position.x < NAV.wallX;
      const visible = !behindWall && v.z < 1 && Math.abs(v.x) < 1.15 && Math.abs(v.y) < 1.2;
      av.tag.style.display = visible ? '' : 'none';
      if (visible) {
        av.tag.style.transform = `translate(${((v.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-v.y * 0.5 + 0.5) * h).toFixed(1)}px)`;
        av.tag.style.zIndex = String(Math.round((1 - v.z) * 100000));
      }
    }

    if (this.follow) this.#followMe();
  }

  #frame() {
    const nowMs = performance.now();
    const elapsed = (nowMs - this.lastFrame) / 1000;
    this.lastFrame = nowMs;
    this.#adaptQuality(elapsed);
    const real = Math.min(elapsed, 0.1);
    const dt = real * this.fast;
    const t = (this.time += real);

    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i];
      tw.t += dt;
      tw.fn(clamp01(tw.t / tw.dur));
      if (tw.t >= tw.dur) {
        this.tweens.splice(i, 1);
        tw.done();
      }
    }
    this.#updateCamera(dt, elapsed, t);

    if (this.stage !== 'street') {
      for (const st of this.staff) this.#updateStaff(st, real);
      this.#updateDoors(real);
      this.#updateAvatars(real, t);
      // 직원 말풍선 위치
      const sv = new THREE.Vector3();
      for (const st of this.staff) {
        if (st.bubbleEl.hidden) continue;
        sv.set(st.group.position.x, 1.85, st.group.position.z).project(this.camera);
        st.tag.style.transform = `translate(${((sv.x * 0.5 + 0.5) * this.size.w).toFixed(1)}px, ${((-sv.y * 0.5 + 0.5) * this.size.h).toFixed(1)}px)`;
        st.tag.style.zIndex = '200000';
      }
      const host = this.roof.host;
      host.head.rotation.y = Math.sin(t * 0.5) * 0.35;
      host.body.position.y = Math.sin(t * 1.4) * 0.006;
      const pulse = 0.55 + Math.sin(t * 4) * 0.35;
      for (const m of this.roof.seatMarkers.values()) {
        if (!m.visible) continue;
        m.material.opacity = pulse;
        m.scale.setScalar(1.15 + Math.sin(t * 4) * 0.1);
      }
    }
    this.renderer.render(this.scene, this.camera);
  }
}
