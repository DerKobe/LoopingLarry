// three.js world: renders a (predicted) simulation state.
import * as THREE from 'three';
import * as P from '/shared/physics.js';
import {
  SEAT_COLORS,
  SEAT_CSS,
  buildPlane,
  animatePlane,
  buildTower,
  buildArm,
  buildChicken,
  buildLever,
  buildCoop,
  buildTree,
  buildHay,
  buildRamp,
  makeLabel,
  mat,
} from './models.js';

const BOARD_R = 4.0;
const TABLE_Y = -0.1;
const SLOT_POS = [
  [0, 0.04],
  [0.4, 0.1],
  [0.78, 0.145],
];

function polar(r, a, y = 0) {
  return new THREE.Vector3(r * Math.cos(a), y, r * Math.sin(a));
}
function faceCenterYaw(a) {
  return Math.atan2(-Math.cos(a), -Math.sin(a));
}

export class World {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    this.mySeat = -1;
    this.camAngle = Math.PI / 2;
    this.camTargetAngle = Math.PI / 2;
    this.shake = 0;
    this.time = 0;

    this.buildEnvironment();
    this.buildBoard();
    this.buildStations();
    this.buildFlyer();
    this.buildEffects();

    this.planeOffset = new THREE.Vector3();
    this.prevRaw = null;
    this.prevVel = new THREE.Vector3();
    this.roundId = -1;
    this.occupied = [false, false, false, false];

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- building

  buildEnvironment() {
    const cv = document.createElement('canvas');
    cv.width = 16;
    cv.height = 256;
    const c = cv.getContext('2d');
    const grd = c.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, '#5aa9e6');
    grd.addColorStop(0.55, '#a8d8f0');
    grd.addColorStop(1, '#fbe8c8');
    c.fillStyle = grd;
    c.fillRect(0, 0, 16, 256);
    const bg = new THREE.CanvasTexture(cv);
    bg.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = bg;
    this.scene.fog = new THREE.Fog(0xf3e3c8, 16, 34);

    const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x8a6a4a, 1.1);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
    sun.position.set(4, 10, 3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -6;
    sc.right = 6;
    sc.top = 6;
    sc.bottom = -6;
    sc.near = 1;
    sc.far = 25;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xbcd7ff, 0.5);
    fill.position.set(-5, 4, -4);
    this.scene.add(fill);

    // Wooden table
    const wood = document.createElement('canvas');
    wood.width = 512;
    wood.height = 512;
    const w = wood.getContext('2d');
    w.fillStyle = '#a0683a';
    w.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 16; i++) {
      w.fillStyle = i % 2 ? '#9a6236' : '#a86f3f';
      w.fillRect(0, i * 32, 512, 32);
      w.fillStyle = 'rgba(60,30,10,0.35)';
      w.fillRect(0, i * 32, 512, 2);
    }
    for (let i = 0; i < 260; i++) {
      w.strokeStyle = `rgba(70,35,12,${0.05 + Math.random() * 0.12})`;
      w.lineWidth = 1 + Math.random() * 2;
      const y = Math.random() * 512;
      w.beginPath();
      w.moveTo(0, y);
      for (let x = 0; x <= 512; x += 32) w.lineTo(x, y + Math.sin(x * 0.02 + i) * 3);
      w.stroke();
    }
    const woodTex = new THREE.CanvasTexture(wood);
    woodTex.colorSpace = THREE.SRGBColorSpace;
    woodTex.wrapS = woodTex.wrapT = THREE.RepeatWrapping;
    woodTex.repeat.set(4, 4);
    woodTex.anisotropy = 8;
    const table = new THREE.Mesh(new THREE.CylinderGeometry(11, 11, 0.4, 64), new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.7 }));
    table.position.y = TABLE_Y - 0.2;
    table.receiveShadow = true;
    this.scene.add(table);
  }

  buildBoard() {
    const cv = document.createElement('canvas');
    cv.width = 1024;
    cv.height = 1024;
    const c = cv.getContext('2d');
    const cx = 512;
    const scale = 512 / BOARD_R;
    const g = c.createRadialGradient(cx, cx, 50, cx, cx, 512);
    g.addColorStop(0, '#8fd16a');
    g.addColorStop(1, '#5fae45');
    c.fillStyle = g;
    c.fillRect(0, 0, 1024, 1024);
    // grass speckles
    for (let i = 0; i < 4000; i++) {
      c.fillStyle = `rgba(${40 + Math.random() * 40},${110 + Math.random() * 60},30,${0.25 + Math.random() * 0.3})`;
      c.fillRect(Math.random() * 1024, Math.random() * 1024, 2, 4);
    }
    // dirt flight path ring
    c.strokeStyle = 'rgba(170,120,70,0.55)';
    c.lineWidth = 0.55 * scale;
    c.beginPath();
    c.arc(cx, cx, P.PLANE_LOW_R * scale, 0, Math.PI * 2);
    c.stroke();
    c.setLineDash([18, 14]);
    c.strokeStyle = 'rgba(255,255,255,0.45)';
    c.lineWidth = 4;
    c.beginPath();
    c.arc(cx, cx, P.PLANE_LOW_R * scale, 0, Math.PI * 2);
    c.stroke();
    c.setLineDash([]);
    // seat wedges
    for (let i = 0; i < 4; i++) {
      const a = P.seatAngle(i);
      c.fillStyle = SEAT_CSS[i] + '55';
      c.beginPath();
      c.moveTo(cx, cx);
      c.arc(cx, cx, 505, a - 0.55, a + 0.55);
      c.closePath();
      c.fill();
      // hit zone arc
      const pa = P.paddleAngle(i);
      c.strokeStyle = SEAT_CSS[i];
      c.lineWidth = 10;
      c.beginPath();
      c.arc(cx, cx, 3.2 * scale, pa - P.PADDLE_HALF_WIDTH, pa + P.PADDLE_HALF_WIDTH);
      c.stroke();
    }
    c.fillStyle = 'rgba(95,174,69,0.85)';
    c.beginPath();
    c.arc(cx, cx, 1.35 * scale, 0, Math.PI * 2);
    c.fill();
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const board = new THREE.Mesh(new THREE.CylinderGeometry(BOARD_R, BOARD_R + 0.05, 0.1, 96), mat(0x3d5a80));
    board.position.y = -0.05;
    board.receiveShadow = true;
    this.scene.add(board);
    // Circle UVs map canvas (x, y) directly onto world (x, z) after rotating flat
    const top = new THREE.Mesh(new THREE.CircleGeometry(BOARD_R, 96), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
    top.rotation.x = -Math.PI / 2;
    top.position.y = 0.001;
    top.receiveShadow = true;
    this.scene.add(top);

    this.tower = buildTower();
    this.scene.add(this.tower);

    // Props on the diagonals
    for (let i = 0; i < 4; i++) {
      const a = P.seatAngle(i) + Math.PI / 4;
      const tree = buildTree();
      tree.position.copy(polar(3.55, a + 0.08));
      tree.scale.setScalar(0.9 + Math.random() * 0.3);
      this.scene.add(tree);
      const hay = buildHay();
      hay.position.copy(polar(3.3, a - 0.2));
      hay.rotation.y = Math.random() * 3;
      this.scene.add(hay);
    }
  }

  buildStations() {
    this.stations = [];
    for (let i = 0; i < P.NUM_SEATS; i++) {
      const color = SEAT_COLORS[i];
      const a = P.seatAngle(i);
      const st = { seat: i };

      const coop = buildCoop(color);
      coop.position.copy(polar(3.5, a));
      coop.rotation.y = -a;
      this.scene.add(coop);
      st.coop = coop;

      const lever = buildLever(color);
      const pa = P.paddleAngle(i);
      lever.position.copy(polar(P.LEVER_PIVOT_R, pa));
      lever.rotation.y = -pa;
      this.scene.add(lever);
      st.lever = lever;

      const ca = P.chickenAngle(i);
      const ramp = buildRamp(color);
      ramp.position.copy(polar(P.CHICKEN_SLOT_R, ca));
      ramp.rotation.y = -ca;
      this.scene.add(ramp);
      st.ramp = ramp;

      st.slotPos = SLOT_POS.map(([dx, y]) => polar(P.CHICKEN_SLOT_R + dx, ca, y));
      st.chickens = [];
      for (let k = 0; k < P.START_CHICKENS; k++) {
        const ch = buildChicken(color);
        ch.position.copy(st.slotPos[k]);
        ch.rotation.y = faceCenterYaw(ca);
        ch.userData.mode = 'slot';
        ch.userData.slot = k;
        ch.userData.vel = new THREE.Vector3();
        ch.userData.spin = new THREE.Vector3();
        ch.userData.hop = 0;
        this.scene.add(ch);
        st.chickens.push(ch);
      }
      st.count = P.START_CHICKENS;
      st.label = null;
      st.labelText = '';
      this.stations.push(st);
    }
  }

  buildFlyer() {
    this.arm = buildArm();
    this.scene.add(this.arm);
    this.plane = buildPlane();
    this.scene.add(this.plane);

    const blobTex = (() => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 128;
      const c = cv.getContext('2d');
      const g = c.createRadialGradient(64, 64, 4, 64, 64, 62);
      g.addColorStop(0, 'rgba(0,0,0,0.55)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, 128, 128);
      return new THREE.CanvasTexture(cv);
    })();
    this.blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false }));
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.position.y = 0.006;
    this.blob.renderOrder = 1;
    this.scene.add(this.blob);
  }

  buildEffects() {
    // Smoke puffs
    this.puffs = [];
    const puffGeo = new THREE.IcosahedronGeometry(0.06, 1);
    for (let i = 0; i < 50; i++) {
      const m = new THREE.Mesh(puffGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0, roughness: 1, depthWrite: false }));
      m.visible = false;
      m.userData.life = 0;
      this.scene.add(m);
      this.puffs.push(m);
    }
    this.puffIdx = 0;
    this.puffTimer = 0;

    // Stars / feathers / confetti share one pool of small quads
    this.bits = [];
    const bitGeo = new THREE.PlaneGeometry(0.09, 0.05);
    for (let i = 0; i < 160; i++) {
      const m = new THREE.Mesh(bitGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
      m.visible = false;
      m.userData = { life: 0, vel: new THREE.Vector3(), spin: new THREE.Vector3(), drag: 1, grav: 0 };
      this.scene.add(m);
      this.bits.push(m);
    }
    this.bitIdx = 0;

    // Impact ring
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.2, 0.28, 32),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false })
    );
    this.ring.visible = false;
    this.scene.add(this.ring);
    this.ringLife = 0;
  }

  // ---------------------------------------------------------------- effects

  spawnBits(pos, n, colors, { speed = 2.5, up = 1.5, life = 1, grav = 4, drag = 1.5, size = 1 } = {}) {
    for (let i = 0; i < n; i++) {
      const b = this.bits[this.bitIdx];
      this.bitIdx = (this.bitIdx + 1) % this.bits.length;
      b.visible = true;
      b.position.copy(pos);
      b.material.color.set(colors[i % colors.length]);
      b.material.opacity = 1;
      const d = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize();
      b.userData.vel.copy(d.multiplyScalar(speed * (0.5 + Math.random()))).add(new THREE.Vector3(0, up, 0));
      b.userData.spin.set(Math.random() * 10, Math.random() * 10, Math.random() * 10);
      b.userData.life = life * (0.7 + Math.random() * 0.6);
      b.userData.maxLife = b.userData.life;
      b.userData.grav = grav;
      b.userData.drag = drag;
      b.scale.setScalar(size * (0.7 + Math.random() * 0.6));
    }
  }

  hitEffect(q, kind) {
    const p = this.plane.position.clone();
    const colors = q > 0.75 ? [0xffd60a, 0xffffff, 0xff9f1c] : [0xffffff, 0xffe8a3];
    this.spawnBits(p, kind === 'block' ? 8 : 14 + Math.round(q * 20), colors, { speed: 2 + q * 2.5, up: 1, life: 0.6, grav: 2 });
    this.ring.visible = true;
    this.ring.position.copy(p);
    this.ring.lookAt(this.camera.position);
    this.ring.scale.setScalar(0.5);
    this.ringLife = 0.35;
    this.shake = Math.max(this.shake, 0.04 + q * 0.06);
  }

  knockEffect(seat) {
    const st = this.stations[seat];
    const pos = st.slotPos[0].clone().add(new THREE.Vector3(0, 0.3, 0));
    this.spawnBits(pos, 22, [SEAT_COLORS[seat], 0xffffff, 0xffffff], { speed: 1.6, up: 2.2, life: 2.2, grav: 1.2, drag: 2.5, size: 1.1 });
    if (seat === this.mySeat) this.shake = Math.max(this.shake, 0.15);
  }

  confetti() {
    for (let k = 0; k < 4; k++) {
      this.spawnBits(new THREE.Vector3(0, 3.2, 0), 35, SEAT_COLORS.concat([0xffffff]), { speed: 4, up: 3, life: 3, grav: 3, drag: 1, size: 1.2 });
    }
  }

  updateEffects(dt, speed) {
    // exhaust puffs
    this.puffTimer -= dt;
    if (this.puffTimer <= 0 && this.plane.visible) {
      this.puffTimer = 0.045;
      const pf = this.puffs[this.puffIdx];
      this.puffIdx = (this.puffIdx + 1) % this.puffs.length;
      const back = new THREE.Vector3(0, 0.05, -0.45).applyQuaternion(this.plane.quaternion);
      pf.position.copy(this.plane.position).add(back);
      pf.visible = true;
      pf.userData.life = 0.9;
      pf.scale.setScalar(0.6);
    }
    for (const pf of this.puffs) {
      if (!pf.visible) continue;
      pf.userData.life -= dt;
      if (pf.userData.life <= 0) {
        pf.visible = false;
        continue;
      }
      const l = pf.userData.life / 0.9;
      pf.scale.setScalar(0.6 + (1 - l) * 2.2);
      pf.material.opacity = 0.45 * l;
      pf.position.y += dt * 0.25;
    }
    for (const b of this.bits) {
      if (!b.visible) continue;
      const u = b.userData;
      u.life -= dt;
      if (u.life <= 0) {
        b.visible = false;
        continue;
      }
      u.vel.y -= u.grav * dt;
      u.vel.multiplyScalar(Math.exp(-u.drag * dt));
      b.position.addScaledVector(u.vel, dt);
      if (b.position.y < 0.01) {
        b.position.y = 0.01;
        u.vel.set(0, 0, 0);
      }
      b.rotation.x += u.spin.x * dt;
      b.rotation.y += u.spin.y * dt;
      b.rotation.z += u.spin.z * dt;
      b.material.opacity = Math.min(1, (u.life / u.maxLife) * 2);
    }
    if (this.ringLife > 0) {
      this.ringLife -= dt;
      const k = 1 - this.ringLife / 0.35;
      this.ring.scale.setScalar(0.5 + k * 3);
      this.ring.material.opacity = (1 - k) * 0.8;
      if (this.ringLife <= 0) this.ring.visible = false;
    }
  }

  // ---------------------------------------------------------------- per-seat info

  setSeatInfo(players, mySeat) {
    this.mySeat = mySeat;
    if (mySeat >= 0) this.camTargetAngle = P.seatAngle(mySeat);
    for (let i = 0; i < P.NUM_SEATS; i++) {
      const pl = players.find((p) => p.seat === i);
      const st = this.stations[i];
      const text = pl ? (i === mySeat ? `${pl.name} (du)` : pl.name) : '';
      this.occupied[i] = !!pl;
      if (text !== st.labelText) {
        if (st.label) {
          this.scene.remove(st.label);
          st.label.material.map.dispose();
          st.label.material.dispose();
        }
        st.label = null;
        st.labelText = text;
        if (text) {
          st.label = makeLabel(text, SEAT_CSS[i]);
          st.label.position.copy(polar(3.5, P.seatAngle(i), 1.25));
          this.scene.add(st.label);
        }
      }
      st.lever.visible = !!pl;
    }
  }

  // ---------------------------------------------------------------- chickens

  resetChickens(state) {
    for (let i = 0; i < P.NUM_SEATS; i++) {
      const st = this.stations[i];
      const n = state.seats[i].chickens;
      st.count = n;
      st.chickens.forEach((ch, k) => {
        ch.visible = k < n;
        ch.userData.mode = 'slot';
        ch.userData.slot = k;
        ch.position.copy(st.slotPos[k]);
        ch.rotation.set(0, faceCenterYaw(P.chickenAngle(i)), 0);
        ch.userData.body.rotation.set(0, 0, 0);
      });
      // order so that slot k holds chicken k
      st.queue = st.chickens.slice(0, n);
    }
  }

  syncChickens(state) {
    if (state.roundId !== this.roundId) {
      this.roundId = state.roundId;
      this.resetChickens(state);
      return [];
    }
    const events = [];
    for (let i = 0; i < P.NUM_SEATS; i++) {
      const st = this.stations[i];
      const n = state.seats[i].chickens;
      if (n === st.count) continue;
      if (n < st.count) {
        // knock the front chicken(s)
        while (st.queue.length > n) {
          const ch = st.queue.shift();
          const ca = P.chickenAngle(i);
          const tangent = new THREE.Vector3(-Math.sin(ca), 0, Math.cos(ca));
          const out = new THREE.Vector3(Math.cos(ca), 0, Math.sin(ca));
          ch.userData.mode = 'fly';
          ch.userData.vel
            .copy(tangent)
            .multiplyScalar(2.2 + Math.random())
            .addScaledVector(out, 1.4 + Math.random())
            .add(new THREE.Vector3(0, 3.2 + Math.random(), 0));
          ch.userData.spin.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 14);
          this.knockEffect(i);
          events.push({ type: 'knock', seat: i, left: n });
        }
        st.queue.forEach((ch, k) => {
          ch.userData.slot = k;
          ch.userData.hop = 1;
        });
      } else {
        // restored (rollback) or new round without round id change
        this.resetChickens(state);
      }
      st.count = n;
    }
    return events;
  }

  updateChickens(dt, state) {
    const t = this.time;
    for (let i = 0; i < P.NUM_SEATS; i++) {
      const st = this.stations[i];
      const ca = P.chickenAngle(i);
      for (const ch of st.chickens) {
        const u = ch.userData;
        if (!ch.visible && u.mode === 'slot') continue;
        if (u.mode === 'slot') {
          const target = st.slotPos[u.slot];
          ch.position.x += (target.x - ch.position.x) * Math.min(1, dt * 8);
          ch.position.z += (target.z - ch.position.z) * Math.min(1, dt * 8);
          if (u.hop > 0) u.hop = Math.max(0, u.hop - dt * 3);
          const hopY = Math.sin(u.hop * Math.PI) * 0.15;
          ch.position.y = target.y + hopY;
          // idle bobbing; nervous when the plane is close
          const d = Math.abs(P.wrapAngle(state.theta - ca));
          const nervous = state.phase === 'playing' && d < 0.8 ? 1 - d / 0.8 : 0;
          u.body.rotation.x = Math.sin(t * (3 + nervous * 20) + i * 1.7 + u.slot) * (0.05 + nervous * 0.15);
          u.body.position.y = Math.abs(Math.sin(t * (2 + nervous * 14) + u.slot)) * (0.01 + nervous * 0.03);
        } else if (u.mode === 'fly') {
          u.vel.y -= 9 * dt;
          ch.position.addScaledVector(u.vel, dt);
          ch.rotation.x += u.spin.x * dt;
          ch.rotation.y += u.spin.y * dt;
          ch.rotation.z += u.spin.z * dt;
          const r = Math.hypot(ch.position.x, ch.position.z);
          const floor = r < BOARD_R ? 0 : TABLE_Y;
          if (ch.position.y <= floor) {
            ch.position.y = floor;
            if (Math.abs(u.vel.y) > 1.2) {
              u.vel.y = -u.vel.y * 0.35;
              u.vel.x *= 0.6;
              u.vel.z *= 0.6;
              u.spin.multiplyScalar(0.5);
            } else {
              u.mode = 'fallen';
              ch.rotation.set(0, ch.rotation.y, Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1));
              ch.position.y = floor + 0.12;
            }
          }
        } else if (u.mode === 'fallen') {
          u.body.rotation.x = Math.sin(t * 9 + i) * 0.05; // dazed wiggle
        }
      }
    }
  }

  // ---------------------------------------------------------------- frame

  update(state, rem, dt) {
    this.time += dt;
    if (!state) {
      this.renderer.render(this.scene, this.camera);
      return [];
    }
    const events = this.syncChickens(state);

    // Plane pose, extrapolated by the sub-tick remainder
    let theta = state.theta + state.omega * rem;
    let phi = Math.max(P.PHI_MIN, state.phi + state.phiDot * rem);
    const r = P.ARM_LEN * Math.cos(phi);
    const raw = new THREE.Vector3(r * Math.cos(theta), P.PIVOT_H + P.ARM_LEN * Math.sin(phi), r * Math.sin(theta));

    // Velocity (for orientation + correction smoothing)
    const T = new THREE.Vector3(-Math.sin(theta), 0, Math.cos(theta));
    const N = new THREE.Vector3(-Math.sin(phi) * Math.cos(theta), Math.cos(phi), -Math.sin(phi) * Math.sin(theta));
    const R = new THREE.Vector3(Math.cos(phi) * Math.cos(theta), Math.sin(phi), Math.cos(phi) * Math.sin(theta));
    const vel = T.clone().multiplyScalar(state.omega * r).addScaledVector(N, state.phiDot * P.ARM_LEN);

    // Smooth out prediction corrections
    if (this.prevRaw) {
      const expected = this.prevRaw.clone().addScaledVector(this.prevVel, dt);
      const jump = expected.clone().sub(raw);
      if (jump.length() > 0.03) this.planeOffset.add(jump);
    }
    if (this.planeOffset.length() > 2) this.planeOffset.set(0, 0, 0);
    this.planeOffset.multiplyScalar(Math.exp(-dt / 0.09));
    this.prevRaw = raw.clone();
    this.prevVel.copy(vel);
    const pos = raw.clone().add(this.planeOffset);
    if (pos.y < P.PLANE_MIN_H) pos.y = P.PLANE_MIN_H;
    this.plane.position.copy(pos);

    // Orientation: forward along velocity, wings along the arm, mounted level at rest
    const F = vel.lengthSq() > 1e-4 ? vel.clone().normalize() : T.clone();
    const W = R.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(F, -P.PHI_MIN)).normalize();
    const U = new THREE.Vector3().crossVectors(F, W).normalize();
    const X = new THREE.Vector3().crossVectors(U, F).normalize();
    const m = new THREE.Matrix4().makeBasis(X, U, F);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    this.plane.quaternion.slerp(q, Math.min(1, dt * 25));
    animatePlane(this.plane, this.time, vel.length());

    // Arm from pivot to displayed plane
    const rel = pos.clone().sub(new THREE.Vector3(0, P.PIVOT_H, 0));
    const horiz = Math.hypot(rel.x, rel.z);
    const aTheta = Math.atan2(rel.z, rel.x);
    const aPhi = Math.atan2(rel.y, horiz);
    this.arm.rotation.y = -aTheta;
    this.arm.userData.hinge.rotation.z = aPhi;
    this.arm.userData.rod.scale.x = Math.max(0.1, rel.length() - 0.08);
    this.tower.userData.head.rotation.y = -aTheta;

    // Blob shadow
    const hgt = pos.y;
    this.blob.position.set(pos.x, 0.006, pos.z);
    this.blob.scale.setScalar(0.7 + hgt * 0.25);
    this.blob.material.opacity = Math.max(0, 0.9 - hgt * 0.22);

    // Levers
    for (let i = 0; i < P.NUM_SEATS; i++) {
      const st = this.stations[i];
      const alpha = P.paddleAlpha(state.t + rem - state.seats[i].pressT);
      st.lever.userData.beam.rotation.z = -alpha;
      st.lever.userData.handle.rotation.z = alpha * 0.18;
      const out = state.phase === 'playing' && state.seats[i].active && state.seats[i].chickens <= 0;
      st.coop.scale.y = out ? 0.97 : 1;
    }

    this.updateChickens(dt, state);
    this.updateEffects(dt, vel.length());
    this.updateCamera(dt, state);
    this.renderer.render(this.scene, this.camera);
    return events;
  }

  updateCamera(dt, state) {
    if (this.mySeat < 0) this.camTargetAngle += dt * 0.08;
    let d = P.wrapAngle(this.camTargetAngle - this.camAngle);
    this.camAngle += d * Math.min(1, dt * 3);
    const a = this.camAngle;
    // Slight dolly towards the upright plane during the countdown
    const zoomTarget = state && state.phase === 'countdown' ? 1 : 0;
    this.camZoom = (this.camZoom || 0) + (zoomTarget - (this.camZoom || 0)) * Math.min(1, dt * 2.5);
    const z = this.camZoom;
    const R = 8.2 - z * 1.2;
    const Y = 8.2 - z * 1.0;
    this.camera.position.set(R * Math.cos(a), Y, R * Math.sin(a));
    const look = new THREE.Vector3(0, 1.3 + z * 0.9, 0);
    if (this.shake > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
      this.camera.position.z += (Math.random() - 0.5) * this.shake;
      this.shake *= Math.exp(-dt * 9);
    }
    this.camera.lookAt(look);
  }

  // Screen position of a seat's coop (for HUD popups)
  seatScreenPos(seat) {
    const p = polar(3.3, P.seatAngle(seat), 0.9).project(this.camera);
    return { x: (p.x * 0.5 + 0.5) * window.innerWidth, y: (-p.y * 0.5 + 0.5) * window.innerHeight };
  }

  planeScreenPos() {
    const p = this.plane.position.clone().project(this.camera);
    return { x: (p.x * 0.5 + 0.5) * window.innerWidth, y: (-p.y * 0.5 + 0.5) * window.innerHeight };
  }
}
