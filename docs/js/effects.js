/**
 * effects.js — Particle systems, pulses, breach FX, glow, data streams
 */
import * as THREE from 'three';

/**
 * Radar scan ring — expanding detection circle at source before action.
 * Visualizes the "recon / detection check" concept.
 */
export class RadarScan {
  constructor(scene, position, onComplete) {
    this.scene = scene;
    this.elapsed = 0;
    this.duration = 1.2; // seconds for full scan
    this.onComplete = onComplete;
    this.done = false;
    this.rings = [];

    const center = new THREE.Vector3(position.x, 0.15, position.z);

    // 3 expanding rings
    for (let i = 0; i < 3; i++) {
      const ringGeo = new THREE.RingGeometry(0.3, 0.5, 48);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x44ff44,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.copy(center);
      ring.userData.delay = i * 0.3;
      ring.scale.set(0.1, 0.1, 0.1);
      scene.add(ring);
      this.rings.push(ring);
    }

    // Sweeping line (radar arm)
    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(8, 0, 0),
    ]);
    const lineMat = new THREE.LineBasicMaterial({
      color: 0x44ff44,
      transparent: true,
      opacity: 0.5,
    });
    this.sweepLine = new THREE.Line(lineGeo, lineMat);
    this.sweepLine.position.copy(center);
    scene.add(this.sweepLine);
  }

  update(dt) {
    if (this.done) return;

    this.elapsed += dt;
    const t = this.elapsed / this.duration;

    // Expand rings
    for (const ring of this.rings) {
      const rt = Math.max(0, t - ring.userData.delay / this.duration);
      if (rt <= 0) continue;
      const scale = rt * 12;
      ring.scale.set(scale, scale, 1);
      ring.material.opacity = Math.max(0, 0.5 * (1 - rt));
    }

    // Rotate sweep line
    this.sweepLine.rotation.y = this.elapsed * 6;
    this.sweepLine.material.opacity = Math.max(0, 0.5 * (1 - t));

    if (t >= 1) {
      this.done = true;
      for (const ring of this.rings) this.scene.remove(ring);
      this.scene.remove(this.sweepLine);
      if (this.onComplete) this.onComplete();
    }
  }
}

/**
 * Ninja attacker — a single stealthy figure that sneaks from source to target.
 * Wears a mask with the account name. Leaves a directional arrow on the ground.
 */
export class WalkingAttacker {
  constructor(scene, from, to, accountName, onComplete) {
    this.scene = scene;
    this.elapsed = 0;
    this.duration = 2.8;
    this.onComplete = onComplete;
    this.done = false;

    this.startPos = new THREE.Vector3(from.x, 0, from.z);
    this.endPos = new THREE.Vector3(to.x, 0, to.z);

    // Ninja figure — scaled up 3x so visible from far camera
    this.ninja = new THREE.Group();

    // Body — tall dark form
    const bodyGeo = new THREE.CylinderGeometry(0.8, 1.0, 4, 8);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x111111,
      emissive: 0x330000,
      emissiveIntensity: 0.5,
      roughness: 0.9,
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 2;
    this.ninja.add(body);

    // Hood / head
    const headGeo = new THREE.SphereGeometry(0.7, 8, 6);
    const headMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 4.5;
    this.ninja.add(head);

    // Glowing red eyes — big enough to see
    const eyeGeo = new THREE.SphereGeometry(0.12, 4, 4);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(-0.25, 4.6, 0.55);
    this.ninja.add(eyeL);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
    eyeR.position.set(0.25, 4.6, 0.55);
    this.ninja.add(eyeR);

    // Mask / name plate above head
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = 256;
    maskCanvas.height = 64;
    const ctx = maskCanvas.getContext('2d');
    ctx.fillStyle = 'rgba(180,20,20,0.9)';
    ctx.fillRect(0, 0, 256, 64);
    ctx.strokeStyle = '#ff4444';
    ctx.lineWidth = 3;
    ctx.strokeRect(2, 2, 252, 60);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px Courier New';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(accountName, 128, 32);
    const maskTex = new THREE.CanvasTexture(maskCanvas);
    const maskMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(3, 0.8),
      new THREE.MeshBasicMaterial({ map: maskTex, transparent: true, depthTest: false })
    );
    maskMesh.position.set(0, 6, 0);
    this.ninja.add(maskMesh);
    this.maskMesh = maskMesh;

    // Katana on back
    const katanaGeo = new THREE.BoxGeometry(0.12, 3, 0.12);
    const katanaMat = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.9, roughness: 0.2 });
    const katana = new THREE.Mesh(katanaGeo, katanaMat);
    katana.position.set(0.5, 3, -0.5);
    katana.rotation.z = 0.3;
    this.ninja.add(katana);

    // Position and face target
    this.ninja.position.copy(this.startPos);
    this.ninja.lookAt(this.endPos.x, 0, this.endPos.z);
    scene.add(this.ninja);

    // --- Ground arrow (large, bright, unmissable) ---
    this.arrow = createGroundArrow(scene, this.startPos, this.endPos, 0xff3333);
  }

  update(dt) {
    if (this.done) return;

    this.elapsed += dt;
    const t = Math.min(this.elapsed / this.duration, 1);

    // Smooth sneak movement
    const smooth = t * t * (3 - 2 * t);
    const pos = new THREE.Vector3().lerpVectors(this.startPos, this.endPos, smooth);

    // Ninja crouch-run bob
    pos.y = Math.abs(Math.sin(this.elapsed * 10)) * 0.08;
    this.ninja.position.copy(pos);

    // Slight body lean forward while running
    this.ninja.children[0].rotation.x = -0.15 + Math.sin(this.elapsed * 8) * 0.05;

    // Eyes flicker
    const flicker = Math.sin(this.elapsed * 15) > 0.3 ? 1 : 0.3;
    this.ninja.children[2].material.color.setRGB(flicker, 0, 0);
    this.ninja.children[3].material.color.setRGB(flicker, 0, 0);

    // Mask always faces camera-ish (billboard Y)
    // (handled by CSS2D in the future, for now it faces forward with the ninja)

    // Arrow opacity pulses
    if (this.arrow) {
      this.arrow.material.opacity = 0.3 + smooth * 0.4;
    }

    if (t >= 1) {
      this.done = true;
      this.scene.remove(this.ninja);
      // Arrow stays but fades
      if (this.arrow) {
        this.arrow.material.opacity = 0.15;
      }
      if (this.onComplete) this.onComplete();
    }
  }
}

/**
 * Ground arrow — large arrow shape on the ground showing attack direction.
 * Like the Sekigahara movement arrows.
 */
function createGroundArrow(scene, from, to, color) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const length = dir.length();
  dir.normalize();
  const right = new THREE.Vector3(-dir.z, 0, dir.x);

  const arrowWidth = 2.5;
  const headLength = 4;
  const headWidth = 4;
  const shaftLength = Math.max(length - headLength, 2);

  // Build arrow shape from vertices
  const vertices = [];
  const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);

  // Shaft (rectangle)
  const s0 = from.clone().add(right.clone().multiplyScalar(arrowWidth / 2));
  const s1 = from.clone().add(right.clone().multiplyScalar(-arrowWidth / 2));
  const s2 = from.clone().add(dir.clone().multiplyScalar(shaftLength)).add(right.clone().multiplyScalar(-arrowWidth / 2));
  const s3 = from.clone().add(dir.clone().multiplyScalar(shaftLength)).add(right.clone().multiplyScalar(arrowWidth / 2));

  // Head (triangle)
  const h0 = from.clone().add(dir.clone().multiplyScalar(shaftLength)).add(right.clone().multiplyScalar(-headWidth / 2));
  const h1 = from.clone().add(dir.clone().multiplyScalar(shaftLength)).add(right.clone().multiplyScalar(headWidth / 2));
  const h2 = to.clone(); // tip

  const y = 1.5;
  const positions = new Float32Array([
    // Shaft triangle 1
    s0.x, y, s0.z,  s1.x, y, s1.z,  s2.x, y, s2.z,
    // Shaft triangle 2
    s0.x, y, s0.z,  s2.x, y, s2.z,  s3.x, y, s3.z,
    // Head triangle
    h0.x, y, h0.z,  h2.x, y, h2.z,  h1.x, y, h1.z,
  ]);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.35,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(geo, mat);
  scene.add(mesh);
  return mesh;
}

/**
 * Artillery barrage — projectile arcs fired from source toward target
 * during lateral movement. Multiple shots with smoke trails.
 */
export class ArtilleryBarrage {
  constructor(scene, from, to) {
    this.scene = scene;
    this.elapsed = 0;
    this.done = false;
    this.projectiles = [];

    const fromV = new THREE.Vector3(from.x, 2, from.z);
    const toV = new THREE.Vector3(to.x, 2, to.z);

    // Fire 3 projectiles staggered
    const shotCount = 3;
    for (let i = 0; i < shotCount; i++) {
      // Spread target slightly for visual variety
      const spread = 3;
      const targetOffset = new THREE.Vector3(
        (Math.random() - 0.5) * spread,
        0,
        (Math.random() - 0.5) * spread
      );
      const endTarget = toV.clone().add(targetOffset);
      const mid = new THREE.Vector3(
        (fromV.x + endTarget.x) / 2 + (Math.random() - 0.5) * 4,
        10 + Math.random() * 5, // arc height
        (fromV.z + endTarget.z) / 2 + (Math.random() - 0.5) * 4
      );
      const curve = new THREE.QuadraticBezierCurve3(fromV.clone(), mid, endTarget);

      // Projectile sphere
      const geo = new THREE.SphereGeometry(0.2, 6, 4);
      const mat = new THREE.MeshBasicMaterial({ color: 0xff6600 });
      const sphere = new THREE.Mesh(geo, mat);
      scene.add(sphere);

      // Smoke trail
      const trailGeo = new THREE.BufferGeometry();
      const trailMat = new THREE.LineBasicMaterial({
        color: 0xff8844,
        transparent: true,
        opacity: 0.5,
      });
      const trail = new THREE.Line(trailGeo, trailMat);
      scene.add(trail);

      this.projectiles.push({
        curve,
        sphere,
        trail,
        trailGeo,
        trailPoints: [],
        delay: i * 0.3,     // stagger shots
        duration: 0.6 + Math.random() * 0.3,
        elapsed: 0,
        fired: false,
        landed: false,
        impactPos: endTarget,
      });
    }
  }

  update(dt) {
    if (this.done) return;

    this.elapsed += dt;
    let allDone = true;

    for (const p of this.projectiles) {
      if (p.landed) continue;

      if (this.elapsed < p.delay) {
        allDone = false;
        continue;
      }

      if (!p.fired) {
        p.fired = true;
        p.elapsed = 0;
      }

      p.elapsed += dt;
      const t = Math.min(p.elapsed / p.duration, 1);

      const pos = p.curve.getPoint(t);
      p.sphere.position.copy(pos);

      // Trail
      p.trailPoints.push(pos.clone());
      if (p.trailPoints.length % 2 === 0) {
        p.trailGeo.setFromPoints(p.trailPoints);
      }

      if (t >= 1) {
        p.landed = true;
        this.scene.remove(p.sphere);

        // Fade trail
        p.trail.material.opacity = 0.1;
        setTimeout(() => this.scene.remove(p.trail), 3000);
      } else {
        allDone = false;
      }
    }

    if (allDone) {
      this.done = true;
    }
  }
}

/**
 * Breach explosion — shockwave ring + spark particles
 */
export class BreachExplosion {
  constructor(scene, position) {
    this.scene = scene;
    this.elapsed = 0;
    this.duration = 1.2;
    this.done = false;

    // Shockwave ring
    const ringGeo = new THREE.TorusGeometry(0.5, 0.15, 8, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xff3300, transparent: true, opacity: 0.9 });
    this.ring = new THREE.Mesh(ringGeo, ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.copy(position);
    this.ring.position.y = 2;
    scene.add(this.ring);

    this.flash = null;

    // Spark particles
    const sparkCount = 15;
    const sparkGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(sparkCount * 3);
    this.sparkVelocities = [];
    for (let i = 0; i < sparkCount; i++) {
      positions[i * 3] = position.x;
      positions[i * 3 + 1] = position.y + 2;
      positions[i * 3 + 2] = position.z;
      this.sparkVelocities.push(new THREE.Vector3(
        (Math.random() - 0.5) * 15,
        Math.random() * 10 + 3,
        (Math.random() - 0.5) * 15
      ));
    }
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const sparkMat = new THREE.PointsMaterial({ color: 0xff6600, size: 0.3, transparent: true, opacity: 1 });
    this.sparks = new THREE.Points(sparkGeo, sparkMat);
    scene.add(this.sparks);
  }

  update(dt) {
    if (this.done) return;

    this.elapsed += dt;
    const t = this.elapsed / this.duration;

    // Expand ring
    const scale = 1 + t * 8;
    this.ring.scale.set(scale, scale, 1);
    this.ring.material.opacity = Math.max(0, 0.9 - t);

    // (flash removed for perf)

    // Move sparks
    const pos = this.sparks.geometry.attributes.position;
    for (let i = 0; i < this.sparkVelocities.length; i++) {
      pos.array[i * 3] += this.sparkVelocities[i].x * dt;
      pos.array[i * 3 + 1] += this.sparkVelocities[i].y * dt;
      pos.array[i * 3 + 2] += this.sparkVelocities[i].z * dt;
      this.sparkVelocities[i].y -= 15 * dt; // gravity
    }
    pos.needsUpdate = true;
    this.sparks.material.opacity = Math.max(0, 1 - t);

    if (t >= 1) {
      this.done = true;
      this.scene.remove(this.ring);
      this.scene.remove(this.sparks);
    }
  }
}

/**
 * Data extraction stream — particles flowing upward from machine
 */
export class DataStream {
  constructor(scene, position) {
    this.scene = scene;
    this.elapsed = 0;
    this.duration = 2;
    this.done = false;

    const count = 40;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    this.offsets = [];
    for (let i = 0; i < count; i++) {
      positions[i * 3] = position.x + (Math.random() - 0.5) * 2;
      positions[i * 3 + 1] = position.y + Math.random() * 3;
      positions[i * 3 + 2] = position.z + (Math.random() - 0.5) * 2;
      this.offsets.push(Math.random());
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.PointsMaterial({
      color: 0x44ff88,
      size: 0.2,
      transparent: true,
      opacity: 0.8,
    });
    this.particles = new THREE.Points(geo, mat);
    this.baseY = position.y;
    scene.add(this.particles);
  }

  update(dt) {
    if (this.done) return;

    this.elapsed += dt;
    const t = this.elapsed / this.duration;

    const pos = this.particles.geometry.attributes.position;
    for (let i = 0; i < this.offsets.length; i++) {
      pos.array[i * 3 + 1] += (2 + this.offsets[i]) * dt; // float up
    }
    pos.needsUpdate = true;
    this.particles.material.opacity = Math.max(0, 0.8 - t * 0.8);

    if (t >= 1) {
      this.done = true;
      this.scene.remove(this.particles);
    }
  }
}

/**
 * Golden glow for goal achieved
 */
export class GoalGlow {
  constructor(scene, position) {
    this.light = new THREE.PointLight(0xffaa00, 0, 40);
    this.light.position.set(position.x, 6, position.z);
    scene.add(this.light);
    this.elapsed = 0;
    this.done = false;
  }

  update(dt) {
    this.elapsed += dt;
    this.light.intensity = Math.min(this.elapsed * 3, 5);
    // Keep glowing — never done
  }
}

/**
 * Static garrison troops around a machine — Sekigahara-style cube soldiers
 * Blue = defender, Red = compromised. Arranged in a semicircle.
 */
export function createGarrison(scene, position, color, count) {
  const group = new THREE.Group();
  const soldierGeo = new THREE.BoxGeometry(0.35, 0.7, 0.35);
  const mat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.2,
    roughness: 0.7,
  });

  const radius = 3.5;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 1.5 - Math.PI * 0.75; // semicircle
    const row = Math.floor(i / 8);
    const r = radius + row * 0.8;
    const soldier = new THREE.Mesh(soldierGeo, mat);
    soldier.position.set(
      Math.cos(angle) * r,
      0.35,
      Math.sin(angle) * r
    );
    soldier.castShadow = true;
    group.add(soldier);
  }

  group.position.set(position.x, 0, position.z);
  scene.add(group);
  return group;
}

/**
 * Ambient floating dust particles
 */
export function createDustParticles(scene) {
  const count = 150;
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 150;
    positions[i * 3 + 1] = Math.random() * 25;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 150;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0x334455,
    size: 0.15,
    transparent: true,
    opacity: 0.4,
  });
  const dust = new THREE.Points(geo, mat);
  scene.add(dust);

  return {
    update(dt) {
      const pos = dust.geometry.attributes.position;
      for (let i = 0; i < count; i++) {
        pos.array[i * 3 + 1] += 0.1 * dt;
        if (pos.array[i * 3 + 1] > 25) pos.array[i * 3 + 1] = 0;
      }
      pos.needsUpdate = true;
    }
  };
}
