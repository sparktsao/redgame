/**
 * camera.js — Camera setup, OrbitControls, cinema keyframes, orbital rotation
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class CameraController {
  constructor(renderer) {
    this.camera = new THREE.PerspectiveCamera(
      50, window.innerWidth / window.innerHeight, 0.5, 500
    );
    this.camera.position.set(-50, 40, 50);

    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.target.set(5, 0, 0);
    this.controls.maxPolarAngle = Math.PI / 2.1;

    this.mode = 'cinema'; // cinema | free | follow | overhead | orbit
    this.cinemaTarget = null;
    this.cinemaLerp = 0;
    this.cinemaFrom = {};
    this.cinemaTo = {};
    this.shakeTime = 0;
    this.shakeIntensity = 0;

    // Orbit state
    this.orbit = null; // { center, radius, height, speed, angle }

    // Detect user interaction → switch to free
    renderer.domElement.addEventListener('pointerdown', () => {
      if (this.mode === 'cinema' || this.mode === 'orbit') {
        this.mode = 'free';
        this.orbit = null;
        this._updateModeLabel();
      }
    });

    // Keyboard
    window.addEventListener('keydown', (e) => {
      if (e.key === 'c' || e.key === 'C') {
        this.mode = 'cinema';
        this._updateModeLabel();
      }
      if (e.key === 'o' || e.key === 'O') {
        this.toggleOverhead();
      }
    });

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
    });
  }

  _updateModeLabel() {
    const el = document.getElementById('camera-mode');
    if (!el) return;
    const labels = {
      cinema: 'CINEMA MODE \u2014 drag to free-look | C: cinema | O: overhead',
      free: 'FREE CAMERA \u2014 C: cinema | O: overhead',
      overhead: 'OVERHEAD VIEW \u2014 C: cinema',
      orbit: 'ORBIT MODE \u2014 drag to free-look',
    };
    el.textContent = labels[this.mode] || '';
  }

  /**
   * Start slow orbital rotation around a center point.
   * Camera orbits at the given radius/height while looking at center.
   */
  startOrbit(center, radius, height, speed) {
    this.mode = 'orbit';
    const angle = Math.atan2(
      this.camera.position.z - center.z,
      this.camera.position.x - center.x
    );
    this.orbit = {
      center: new THREE.Vector3(center.x, center.y || 0, center.z),
      radius,
      height,
      speed: speed || 0.15, // radians per second
      angle,
    };
    this._updateModeLabel();
  }

  /**
   * Stop orbiting and switch to cinema mode
   */
  stopOrbit() {
    this.orbit = null;
    this.mode = 'cinema';
  }

  /**
   * Move camera to look at a target position over time
   */
  cinematicMoveTo(position, lookAt, duration = 2) {
    if (this.mode !== 'cinema' && this.mode !== 'orbit' && this.mode !== 'free') return;

    // Stop any active orbit
    this.orbit = null;
    this.mode = 'cinema';

    this.cinemaFrom = {
      pos: this.camera.position.clone(),
      target: this.controls.target.clone(),
    };
    this.cinemaTo = {
      pos: new THREE.Vector3(position.x, position.y, position.z),
      target: new THREE.Vector3(lookAt.x, lookAt.y, lookAt.z),
    };
    this.cinemaLerp = 0;
    this.cinemaDuration = duration;
  }

  /**
   * Cinematic move, then start orbiting at destination
   */
  cinematicMoveAndOrbit(position, lookAt, moveDuration, orbitSpeed) {
    this.cinematicMoveTo(position, lookAt, moveDuration);
    // After move completes, start orbiting
    this._pendingOrbit = {
      center: { x: lookAt.x, y: lookAt.y, z: lookAt.z },
      radius: Math.sqrt(
        (position.x - lookAt.x) ** 2 + (position.z - lookAt.z) ** 2
      ),
      height: position.y,
      speed: orbitSpeed || 0.12,
    };
  }

  /**
   * Pre-defined camera keyframes for each step type
   */
  getStepKeyframes(step, machineMap) {
    const src = machineMap[step.source_machine];
    const tgt = machineMap[step.target_machine];
    if (!tgt) return null;

    const tp = tgt.group.position;
    const sp = src ? src.group.position : tp;

    if (step.tactic === 'Lateral Movement') {
      const midX = (sp.x + tp.x) / 2;
      const midZ = (sp.z + tp.z) / 2;
      return {
        position: { x: midX - 15, y: 20, z: midZ + 20 },
        lookAt: { x: midX, y: 2, z: midZ },
        duration: 1.5,
        orbit: true,
        orbitSpeed: 0.15,
      };
    }

    if (step.tactic === 'Credential Access') {
      return {
        position: { x: tp.x - 8, y: 8, z: tp.z + 8 },
        lookAt: { x: tp.x, y: 3, z: tp.z },
        duration: 1.2,
        orbit: true,
        orbitSpeed: 0.1,
      };
    }

    return {
      position: { x: tp.x - 12, y: 15, z: tp.z + 15 },
      lookAt: { x: tp.x, y: 2, z: tp.z },
      duration: 1.5,
      orbit: true,
      orbitSpeed: 0.12,
    };
  }

  /**
   * Goal achieved — pull back to orbital view
   */
  pullBackOrbital() {
    this.cinematicMoveAndOrbit(
      { x: 5, y: 60, z: 50 },
      { x: 10, y: 0, z: -5 },
      3,
      0.08
    );
  }

  triggerShake(intensity = 0.5, duration = 0.5) {
    this.shakeIntensity = intensity;
    this.shakeTime = duration;
  }

  toggleOverhead() {
    if (this.mode === 'overhead') {
      this.mode = 'cinema';
    } else {
      this.mode = 'overhead';
      this.orbit = null;
      this.camera.position.set(10, 80, 0);
      this.controls.target.set(10, 0, -5);
    }
    this._updateModeLabel();
  }

  update(dt) {
    // Orbit mode — continuous rotation
    if (this.mode === 'orbit' && this.orbit) {
      const o = this.orbit;
      o.angle += o.speed * dt;
      this.camera.position.x = o.center.x + Math.cos(o.angle) * o.radius;
      this.camera.position.z = o.center.z + Math.sin(o.angle) * o.radius;
      this.camera.position.y = o.height;
      this.controls.target.copy(o.center);
    }

    // Cinema lerp
    if (this.mode === 'cinema' && this.cinemaTo.pos && this.cinemaLerp < 1) {
      this.cinemaLerp += dt / (this.cinemaDuration || 2);
      this.cinemaLerp = Math.min(this.cinemaLerp, 1);
      const t = smoothstep(this.cinemaLerp);

      this.camera.position.lerpVectors(this.cinemaFrom.pos, this.cinemaTo.pos, t);
      this.controls.target.lerpVectors(this.cinemaFrom.target, this.cinemaTo.target, t);

      // Check for pending orbit after cinema move completes
      if (this.cinemaLerp >= 1 && this._pendingOrbit) {
        const po = this._pendingOrbit;
        this.startOrbit(po.center, po.radius, po.height, po.speed);
        this._pendingOrbit = null;
      }
    }

    // Screen shake
    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      const s = this.shakeIntensity * (this.shakeTime / 0.5);
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s * 0.5;
    }

    this.controls.update();
  }
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}
