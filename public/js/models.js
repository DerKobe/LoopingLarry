// Procedural low-poly models: plane with pilot Larry, tower, levers, chickens, coops, props.
import * as THREE from 'three';
import * as P from '/shared/physics.js';

export const SEAT_COLORS = [0xe63946, 0xffb703, 0x2a9d8f, 0x8e44ad, 0x2f80ed];
export const SEAT_CSS = ['#e63946', '#ffb703', '#2a9d8f', '#8e44ad', '#2f80ed'];
export const SEAT_NAMES = ['Rot', 'Gelb', 'Grün', 'Lila', 'Blau'];

const matCache = new Map();
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05, ...opts }));
  }
  return matCache.get(key);
}

function mesh(geo, material, { cast = true, receive = false } = {}) {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

// ------------------------------------------------------------------ plane

export function buildPlane() {
  const g = new THREE.Group();
  const red = mat(0xd62828);
  const yellow = mat(0xfcbf49);
  const cream = mat(0xfff3d6);
  const metal = mat(0xb8c0cc, { metalness: 0.7, roughness: 0.3 });
  const dark = mat(0x222222);

  // Fuselage (lathe profile, nose at +z)
  const prof = [
    [0.0, -0.42],
    [0.05, -0.4],
    [0.08, -0.3],
    [0.11, -0.1],
    [0.13, 0.08],
    [0.13, 0.2],
    [0.12, 0.28],
    [0.0, 0.3],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const fus = mesh(new THREE.LatheGeometry(prof, 18), red);
  fus.rotation.x = Math.PI / 2;
  g.add(fus);

  // Engine cowling + propeller
  const cowl = mesh(new THREE.CylinderGeometry(0.12, 0.135, 0.1, 18), metal);
  cowl.rotation.x = Math.PI / 2;
  cowl.position.z = 0.3;
  g.add(cowl);
  const prop = new THREE.Group();
  prop.position.z = 0.37;
  const hub = mesh(new THREE.ConeGeometry(0.05, 0.1, 12), cream);
  hub.rotation.x = Math.PI / 2;
  hub.position.z = 0.03;
  prop.add(hub);
  const bladeGeo = new THREE.BoxGeometry(0.04, 0.44, 0.012);
  const b1 = mesh(bladeGeo, mat(0x5c4033));
  b1.rotation.y = 0.25;
  prop.add(b1);
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(0.23, 24),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide })
  );
  prop.add(disc);
  g.add(prop);
  g.userData.prop = prop;
  g.userData.propBlur = disc;

  // Wings (biplane)
  const wingGeo = new THREE.BoxGeometry(0.95, 0.03, 0.2);
  const lower = mesh(wingGeo, yellow);
  lower.position.set(0, -0.08, 0.1);
  g.add(lower);
  const upper = mesh(wingGeo, yellow);
  upper.position.set(0, 0.17, 0.12);
  g.add(upper);
  for (const x of [-0.36, 0.36]) {
    for (const z of [0.04, 0.18]) {
      const strut = mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.25, 5), dark);
      strut.position.set(x, 0.045, z);
      g.add(strut);
    }
  }
  // Roundels
  for (const x of [-0.3, 0.3]) {
    const ring = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.034, 16), red, { cast: false });
    ring.position.set(x, 0.17, 0.12);
    g.add(ring);
  }

  // Tail
  const stab = mesh(new THREE.BoxGeometry(0.34, 0.02, 0.1), yellow);
  stab.position.set(0, 0.02, -0.36);
  g.add(stab);
  const fin = mesh(new THREE.BoxGeometry(0.02, 0.16, 0.12), yellow);
  fin.position.set(0, 0.1, -0.36);
  g.add(fin);

  // Landing gear
  for (const x of [-0.1, 0.1]) {
    const leg = mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.12, 5), dark);
    leg.position.set(x, -0.15, 0.15);
    g.add(leg);
    const wheel = mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 14), dark);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, -0.21, 0.15);
    g.add(wheel);
  }

  // Pilot Larry
  const larry = new THREE.Group();
  larry.position.set(0, 0.12, -0.08);
  const skin = mat(0xffcc99);
  const head = mesh(new THREE.SphereGeometry(0.085, 16, 12), skin);
  head.position.y = 0.06;
  larry.add(head);
  const nose = mesh(new THREE.SphereGeometry(0.035, 10, 8), mat(0xff9f80));
  nose.position.set(0, 0.05, 0.085);
  larry.add(nose);
  const cap = mesh(new THREE.SphereGeometry(0.09, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), mat(0x7a4a24));
  cap.position.y = 0.07;
  larry.add(cap);
  for (const x of [-0.035, 0.035]) {
    const gog = mesh(new THREE.TorusGeometry(0.027, 0.01, 6, 14), metal);
    gog.position.set(x, 0.1, 0.07);
    larry.add(gog);
    const lens = mesh(new THREE.CircleGeometry(0.024, 12), mat(0x8fd3ff, { metalness: 0.5, roughness: 0.1 }), { cast: false });
    lens.position.set(x, 0.1, 0.075);
    larry.add(lens);
    const ear = mesh(new THREE.SphereGeometry(0.02, 8, 6), skin);
    ear.position.set(x * 2.5, 0.06, 0);
    larry.add(ear);
  }
  const smile = mesh(new THREE.TorusGeometry(0.03, 0.007, 5, 12, Math.PI), dark, { cast: false });
  smile.rotation.z = Math.PI;
  smile.position.set(0, 0.025, 0.078);
  larry.add(smile);
  const body = mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.08, 12), mat(0x3a6ea5));
  body.position.y = -0.03;
  larry.add(body);
  g.add(larry);

  // Scarf (animated ribbon)
  const scarfGeo = new THREE.PlaneGeometry(0.34, 0.05, 10, 1);
  scarfGeo.translate(0, 0, 0);
  const scarf = new THREE.Mesh(scarfGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.8 }));
  scarf.castShadow = true;
  scarf.rotation.y = Math.PI / 2;
  scarf.position.set(0, 0.14, -0.26);
  g.add(scarf);
  g.userData.scarf = scarf;
  g.userData.scarfBase = scarfGeo.attributes.position.array.slice();

  g.scale.setScalar(1.15);
  return g;
}

export function animatePlane(plane, t, speed) {
  const { prop, propBlur, scarf, scarfBase } = plane.userData;
  prop.rotation.z += 0.9 + speed * 0.1;
  propBlur.material.opacity = 0.1 + Math.min(0.15, speed * 0.02);
  const pos = scarf.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = scarfBase[i * 3];
    const along = (0.17 - x) / 0.34; // 0 at neck, 1 at tail end
    const wave = Math.sin(t * 22 + along * 7) * 0.04 * along;
    pos.setZ(i, wave);
    pos.setY(i, scarfBase[i * 3 + 1] + Math.sin(t * 15 + along * 5) * 0.015 * along);
  }
  pos.needsUpdate = true;
}

// ------------------------------------------------------------------ tower + arm

export function buildTower() {
  const g = new THREE.Group();
  // Base / motor housing
  const base = mesh(new THREE.CylinderGeometry(0.75, 0.85, 0.28, 32), mat(0x3d5a80), { receive: true });
  base.position.y = 0.14;
  g.add(base);
  const ring = mesh(new THREE.TorusGeometry(0.76, 0.035, 8, 40), mat(0xf1faee));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.28;
  g.add(ring);

  // Striped column (silo style)
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 256;
  const c = cv.getContext('2d');
  for (let i = 0; i < 8; i++) {
    c.fillStyle = i % 2 ? '#f1faee' : '#e63946';
    c.fillRect(0, i * 32, 64, 32);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const col = mesh(new THREE.CylinderGeometry(0.2, 0.34, P.PIVOT_H - 0.38, 24), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 }));
  col.position.y = 0.28 + (P.PIVOT_H - 0.38) / 2;
  g.add(col);

  // Rotating head
  const head = new THREE.Group();
  head.position.y = P.PIVOT_H;
  const cap = mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.16, 20), mat(0x3d5a80));
  cap.position.y = -0.08;
  head.add(cap);
  const dome = mesh(new THREE.SphereGeometry(0.16, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xfcbf49));
  head.add(dome);
  g.add(head);
  g.userData.head = head;
  return g;
}

export function buildArm() {
  // Group placed at pivot; rotation.y = -theta, inner hinge rotation.z = phi
  const g = new THREE.Group();
  g.position.y = P.PIVOT_H;
  const hinge = new THREE.Group();
  g.add(hinge);
  const metal = mat(0x2b2d42, { metalness: 0.6, roughness: 0.35 });
  const rodGeo = new THREE.CylinderGeometry(0.03, 0.03, 1, 10);
  rodGeo.rotateZ(Math.PI / 2);
  rodGeo.translate(0.5, 0, 0);
  const rod = mesh(rodGeo, metal);
  hinge.add(rod);
  const knuckle = mesh(new THREE.SphereGeometry(0.07, 14, 10), mat(0xe63946));
  hinge.add(knuckle);
  // counter weight stub
  const stubGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.35, 8);
  stubGeo.rotateZ(Math.PI / 2);
  stubGeo.translate(-0.175, 0, 0);
  hinge.add(mesh(stubGeo, metal));
  const weight = mesh(new THREE.SphereGeometry(0.07, 12, 10), mat(0x8d99ae, { metalness: 0.6 }));
  weight.position.x = -0.36;
  hinge.add(weight);
  g.userData = { hinge, rod };
  return g;
}

// ------------------------------------------------------------------ chickens

export function buildChicken(color) {
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);
  const c = new THREE.Color(color);
  const bodyMat = mat(c.getHex());
  const light = mat(c.clone().lerp(new THREE.Color(0xffffff), 0.45).getHex());
  const orange = mat(0xff9f1c);
  const red = mat(0xd00000);
  const black = mat(0x111111);

  const torso = mesh(new THREE.SphereGeometry(0.13, 16, 12), bodyMat);
  torso.scale.set(1, 0.95, 1.2);
  torso.position.y = 0.2;
  body.add(torso);
  const belly = mesh(new THREE.SphereGeometry(0.1, 12, 10), light);
  belly.position.set(0, 0.17, 0.06);
  body.add(belly);
  const head = mesh(new THREE.SphereGeometry(0.085, 14, 12), bodyMat);
  head.position.set(0, 0.37, 0.09);
  body.add(head);
  const beak = mesh(new THREE.ConeGeometry(0.03, 0.08, 8), orange);
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, 0.36, 0.19);
  body.add(beak);
  const wattle = mesh(new THREE.SphereGeometry(0.022, 8, 6), red);
  wattle.scale.set(1, 1.6, 1);
  wattle.position.set(0, 0.31, 0.16);
  body.add(wattle);
  for (let i = 0; i < 3; i++) {
    const comb = mesh(new THREE.SphereGeometry(0.03, 8, 6), red);
    comb.position.set(0, 0.45 + (i === 1 ? 0.02 : 0), 0.05 + i * 0.04);
    body.add(comb);
  }
  for (const x of [-0.045, 0.045]) {
    const eyeW = mesh(new THREE.SphereGeometry(0.024, 10, 8), mat(0xffffff), { cast: false });
    eyeW.position.set(x, 0.39, 0.155);
    body.add(eyeW);
    const eye = mesh(new THREE.SphereGeometry(0.013, 8, 6), black, { cast: false });
    eye.position.set(x * 1.05, 0.39, 0.175);
    body.add(eye);
    const wing = mesh(new THREE.SphereGeometry(0.08, 10, 8), light);
    wing.scale.set(0.35, 0.7, 1.1);
    wing.position.set(x * 2.9, 0.21, -0.01);
    body.add(wing);
    const leg = mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.1, 5), orange);
    leg.position.set(x * 0.8, 0.05, 0);
    g.add(leg);
    const foot = mesh(new THREE.BoxGeometry(0.05, 0.012, 0.06), orange);
    foot.position.set(x * 0.8, 0.006, 0.02);
    g.add(foot);
  }
  const tail = mesh(new THREE.ConeGeometry(0.07, 0.16, 8), bodyMat);
  tail.rotation.x = -Math.PI / 3;
  tail.position.set(0, 0.3, -0.15);
  body.add(tail);
  g.userData.body = body;
  return g;
}

// ------------------------------------------------------------------ lever

export function buildLever(color) {
  const g = new THREE.Group(); // positioned at lever pivot, local +x = outward
  const col = mat(color);
  const white = mat(0xf1faee);
  // Pivot block
  const block = mesh(new THREE.BoxGeometry(0.2, 0.2, 0.46), mat(0x4a4e69), { receive: true });
  block.position.set(0, 0.03, 0);
  g.add(block);
  const axle = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.52, 10), mat(0xb8c0cc, { metalness: 0.7 }));
  axle.rotation.x = Math.PI / 2;
  axle.position.y = P.LEVER_BASE_H;
  g.add(axle);

  const beam = new THREE.Group();
  beam.position.y = P.LEVER_BASE_H;
  g.add(beam);
  const len = P.LEVER_PIVOT_R - P.LEVER_INNER_R;
  // Flap: a paddle that widens towards the inner end
  const shape = new THREE.Shape();
  shape.moveTo(0, -0.1);
  shape.lineTo(-len * 0.35, -0.12);
  shape.lineTo(-len, -0.36);
  shape.quadraticCurveTo(-len - 0.08, 0, -len, 0.36);
  shape.lineTo(-len * 0.35, 0.12);
  shape.lineTo(0, 0.1);
  shape.closePath();
  const flapGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2 });
  flapGeo.rotateX(Math.PI / 2);
  flapGeo.translate(0, 0.02, 0);
  const flap = mesh(flapGeo, col, { receive: true });
  beam.add(flap);
  const stripe = mesh(new THREE.BoxGeometry(len * 0.5, 0.012, 0.05), white, { cast: false });
  stripe.position.set(-len * 0.6, 0.03, 0);
  beam.add(stripe);

  // Handle with push button (outer end)
  const handle = new THREE.Group();
  handle.position.y = P.LEVER_BASE_H;
  g.add(handle);
  const arm = mesh(new THREE.BoxGeometry(0.46, 0.05, 0.16), col);
  arm.position.set(0.25, 0, 0);
  handle.add(arm);
  const knob = mesh(new THREE.CylinderGeometry(0.13, 0.14, 0.09, 20), white);
  knob.position.set(0.48, 0.05, 0);
  handle.add(knob);
  const knobTop = mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.04, 20), col);
  knobTop.position.set(0.48, 0.11, 0);
  handle.add(knobTop);

  g.userData = { beam, handle };
  return g;
}

// ------------------------------------------------------------------ coop / props

export function buildCoop(color) {
  const g = new THREE.Group(); // local +x = outward, faces -x (center)
  const wall = mat(color);
  const white = mat(0xf1faee);
  const roofM = mat(0x6d4c41);
  const house = mesh(new THREE.BoxGeometry(0.55, 0.42, 0.62), wall, { receive: true });
  house.position.y = 0.21;
  g.add(house);
  const roofShape = new THREE.Shape();
  roofShape.moveTo(-0.34, 0);
  roofShape.lineTo(0, 0.28);
  roofShape.lineTo(0.34, 0);
  roofShape.closePath();
  const roofGeo = new THREE.ExtrudeGeometry(roofShape, { depth: 0.7, bevelEnabled: false });
  roofGeo.translate(0, 0, -0.35);
  const roof = mesh(roofGeo, roofM);
  roof.position.y = 0.42;
  g.add(roof);
  const door = mesh(new THREE.BoxGeometry(0.02, 0.26, 0.2), mat(0x3e2723), { cast: false });
  door.position.set(-0.28, 0.13, 0);
  g.add(door);
  const trim = mesh(new THREE.BoxGeometry(0.03, 0.3, 0.26), white, { cast: false });
  trim.position.set(-0.27, 0.15, 0);
  g.add(trim);
  const win = mesh(new THREE.CircleGeometry(0.06, 16), mat(0xfff3b0, { emissive: 0x665500 }), { cast: false });
  win.rotation.y = -Math.PI / 2;
  win.position.set(-0.281, 0.33, 0);
  g.add(win);
  return g;
}

export function buildTree() {
  const g = new THREE.Group();
  const trunk = mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.35, 8), mat(0x6d4c41));
  trunk.position.y = 0.17;
  g.add(trunk);
  const leaves = mat(0x55a630, { flatShading: true });
  const sizes = [
    [0.28, 0.45],
    [0.22, 0.62],
    [0.15, 0.76],
  ];
  for (const [r, y] of sizes) {
    const cone = mesh(new THREE.IcosahedronGeometry(r, 0), leaves);
    cone.position.y = y;
    cone.scale.y = 0.9;
    g.add(cone);
  }
  return g;
}

export function buildHay() {
  const g = new THREE.Group();
  const hay = mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.26, 14), mat(0xe9c46a, { roughness: 0.9 }));
  hay.rotation.z = Math.PI / 2;
  hay.position.y = 0.16;
  g.add(hay);
  const band = mesh(new THREE.TorusGeometry(0.162, 0.01, 6, 20), mat(0xbc6c25));
  band.rotation.y = Math.PI / 2;
  band.position.y = 0.16;
  g.add(band);
  return g;
}

export function buildRamp(color) {
  // Holds the chicken queue: slot at the plane path, ramp outward
  const g = new THREE.Group(); // local +x outward, origin at slot
  const m = mat(new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.55).getHex(), { roughness: 0.7 });
  const slot = mesh(new THREE.CylinderGeometry(0.17, 0.19, 0.04, 20), m, { receive: true });
  slot.position.y = 0.02;
  g.add(slot);
  const rampGeo = new THREE.BoxGeometry(0.85, 0.05, 0.3);
  const ramp = mesh(rampGeo, m, { receive: true });
  ramp.position.set(0.62, 0.1, 0);
  ramp.rotation.z = 0.12;
  g.add(ramp);
  for (const z of [-0.16, 0.16]) {
    const rail = mesh(new THREE.BoxGeometry(0.85, 0.07, 0.02), mat(color));
    rail.position.set(0.62, 0.15, z);
    rail.rotation.z = 0.12;
    g.add(rail);
  }
  return g;
}

// Text label sprite
export function makeLabel(text, color) {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 128;
  const c = cv.getContext('2d');
  c.font = 'bold 64px "Baloo 2", "Trebuchet MS", sans-serif';
  const w = Math.min(500, c.measureText(text).width + 60);
  c.fillStyle = 'rgba(20,20,30,0.72)';
  const x = (512 - w) / 2;
  c.beginPath();
  c.roundRect(x, 14, w, 100, 50);
  c.fill();
  c.lineWidth = 8;
  c.strokeStyle = color;
  c.stroke();
  c.fillStyle = '#fff';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(text, 256, 68);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(1.3, 0.325, 1);
  sp.renderOrder = 10;
  return sp;
}
