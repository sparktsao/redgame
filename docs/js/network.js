/**
 * network.js — 3D buildings, machines, flags, ambient props, connection lines
 */
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const MACHINE_COLORS = {
  workstation: 0x7788aa,
  server: 0x5588bb,
  dc: 0xbbaa55,
};

/**
 * Build all machines in the scene. Returns a map: name → { group, mesh, flag, label }
 */
export function createMachines(scene, machines) {
  const machineMap = {};

  for (const m of machines) {
    const group = new THREE.Group();
    group.position.set(m.x, 0, m.z);
    group.userData = { name: m.name, type: m.type, compromised: false };

    // Building mesh
    const dims = getMachineDims(m.type);
    const geo = new THREE.BoxGeometry(dims.w, dims.h, dims.d);
    const baseColor = MACHINE_COLORS[m.type] || 0x555555;
    const mat = new THREE.MeshStandardMaterial({
      color: baseColor,
      roughness: 0.6,
      metalness: 0.3,
      emissive: baseColor,
      emissiveIntensity: 0.15,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = dims.h / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);

    // DC gets extra battlements
    if (m.type === 'dc') {
      addBattlements(group, dims);
    }

    // Single local light (only for DC to save draw calls)
    if (m.type === 'dc') {
      const localLight = new THREE.PointLight(0x6688cc, 0.8, 15);
      localLight.position.set(0, dims.h + 1, 0);
      group.add(localLight);
    }

    // Blue defender flag (default)
    const flag = createFlag(0x2244aa, dims.h);
    group.add(flag);
    group.userData.defenderFlag = flag;

    // Label
    const labelDiv = document.createElement('div');
    labelDiv.className = 'machine-label' + (m.type === 'dc' ? ' dc' : '');
    labelDiv.textContent = m.name;
    if (m.sessions?.length) {
      labelDiv.textContent += ` [${m.sessions.join(', ')}]`;
    }
    const label = new CSS2DObject(labelDiv);
    label.position.set(0, dims.h + 5, 0); // high above the flag so no overlap
    group.add(label);

    scene.add(group);
    machineMap[m.name] = { group, mesh, flag, label: labelDiv, dims };
  }

  return machineMap;
}

function getMachineDims(type) {
  switch (type) {
    case 'workstation': return { w: 2, h: 1.5, d: 1.5 };
    case 'server':      return { w: 1.5, h: 4, d: 1.5 };
    case 'dc':          return { w: 4, h: 5, d: 4 };
    default:            return { w: 2, h: 2, d: 2 };
  }
}

function addBattlements(group, dims) {
  const bGeo = new THREE.BoxGeometry(0.6, 0.8, 0.6);
  const bMat = new THREE.MeshStandardMaterial({ color: 0xccbb77, roughness: 0.7 });
  const positions = [
    [-dims.w/2 + 0.3, dims.h + 0.4, -dims.d/2 + 0.3],
    [ dims.w/2 - 0.3, dims.h + 0.4, -dims.d/2 + 0.3],
    [-dims.w/2 + 0.3, dims.h + 0.4,  dims.d/2 - 0.3],
    [ dims.w/2 - 0.3, dims.h + 0.4,  dims.d/2 - 0.3],
  ];
  for (const [px, py, pz] of positions) {
    const b = new THREE.Mesh(bGeo, bMat);
    b.position.set(px, py, pz);
    b.castShadow = true;
    group.add(b);
  }
}

/**
 * Create a simple flag (pole + cloth plane)
 */
function createFlag(color, buildingHeight) {
  const flagGroup = new THREE.Group();

  // Pole
  const poleGeo = new THREE.CylinderGeometry(0.06, 0.06, 3, 6);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x888888 });
  const pole = new THREE.Mesh(poleGeo, poleMat);
  pole.position.y = buildingHeight + 1.5;
  flagGroup.add(pole);

  // Cloth
  const clothGeo = new THREE.PlaneGeometry(1.2, 0.8, 8, 4);
  const clothMat = new THREE.MeshStandardMaterial({
    color,
    side: THREE.DoubleSide,
    roughness: 0.8,
  });
  const cloth = new THREE.Mesh(clothGeo, clothMat);
  cloth.position.set(0.7, buildingHeight + 2.5, 0);
  // Store original positions for wave animation
  clothGeo.userData.origPositions = new Float32Array(clothGeo.attributes.position.array);
  flagGroup.add(cloth);
  flagGroup.userData.cloth = cloth;

  return flagGroup;
}

/**
 * Plant a red skull flag (replaces defender flag).
 * Idempotent — safe to call multiple times on the same machine.
 * @param {boolean} instant — if true, flag appears at full size (no animation)
 */
export function plantSkullFlag(machineObj, instant = false) {
  const { group, dims } = machineObj;

  // Already flagged — just make sure it's visible and full-size
  if (group.userData.skullFlag) {
    group.userData.skullFlag.visible = true;
    group.userData.skullFlag.scale.y = 1;
    return group.userData.skullFlag;
  }

  // Hide defender flag
  if (group.userData.defenderFlag) {
    group.userData.defenderFlag.visible = false;
  }

  // Create skull flag
  const h = dims.h;
  const skullFlag = createFlag(0xcc2222, h);

  // Draw skull on the flag cloth
  const canvas = document.createElement('canvas');
  canvas.width = 64; canvas.height = 48;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#cc2222';
  ctx.fillRect(0, 0, 64, 48);
  ctx.fillStyle = '#ffffff';
  ctx.font = '28px serif';
  ctx.textAlign = 'center';
  ctx.fillText('\u2620', 32, 35); // skull emoji

  const tex = new THREE.CanvasTexture(canvas);
  const cloth = skullFlag.userData.cloth;
  if (cloth) {
    cloth.material = new THREE.MeshStandardMaterial({
      map: tex,
      side: THREE.DoubleSide,
      roughness: 0.8,
    });
  }

  // Start at full size (instant) or zero (will animate)
  skullFlag.scale.y = instant ? 1 : 0;
  group.add(skullFlag);
  group.userData.skullFlag = skullFlag;

  // Mark machine as compromised in userData
  group.userData.compromised = true;

  return skullFlag;
}

/**
 * Connection lines between machines
 */
export function createConnections(scene, connections, machineMap) {
  const lines = [];
  for (const conn of connections) {
    const from = machineMap[conn.from];
    const to = machineMap[conn.to];
    if (!from || !to) continue;

    const points = [
      new THREE.Vector3(from.group.position.x, 0.1, from.group.position.z),
      new THREE.Vector3(to.group.position.x, 0.1, to.group.position.z),
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color: 0x4466aa, transparent: true, opacity: 0.5 });
    const line = new THREE.Line(geo, mat);
    scene.add(line);
    lines.push({ line, from: conn.from, to: conn.to });
  }
  return lines;
}

/**
 * Create tall Sekigahara-style banner flags for zones/departments.
 * Each banner: tall pole + vertical cloth with department label text.
 */
export function createBannerFlags(scene, subnets, extraBanners) {
  const allBanners = [];

  // Banners from subnets
  for (const sub of subnets) {
    if (sub.banner) {
      allBanners.push(sub.banner);
    }
  }

  // Extra standalone banners
  if (extraBanners) {
    allBanners.push(...extraBanners);
  }

  for (const b of allBanners) {
    const group = new THREE.Group();
    group.position.set(b.x, 0, b.z);

    const poleHeight = 12;
    const bannerW = 2.5;
    const bannerH = 5;
    const color = new THREE.Color(b.color);

    // Tall pole
    const poleGeo = new THREE.CylinderGeometry(0.08, 0.1, poleHeight, 8);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.6, roughness: 0.4 });
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.y = poleHeight / 2;
    pole.castShadow = true;
    group.add(pole);

    // Pole top ornament (sphere)
    const topGeo = new THREE.SphereGeometry(0.2, 8, 6);
    const topMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.8 });
    const topBall = new THREE.Mesh(topGeo, topMat);
    topBall.position.y = poleHeight + 0.15;
    group.add(topBall);

    // Banner cloth — vertical rectangle hanging from top
    const clothGeo = new THREE.PlaneGeometry(bannerW, bannerH, 10, 6);
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = b.color;
    ctx.fillRect(0, 0, 128, 256);

    // Border
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 4;
    ctx.strokeRect(6, 6, 116, 244);

    // Inner border
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 2;
    ctx.strokeRect(12, 12, 104, 232);

    // Department label — vertical text (top to bottom, one char per line)
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px "Courier New", monospace';
    ctx.textAlign = 'center';
    const chars = b.label.split('');
    const charSpacing = 30;
    const startY = 50;
    for (let i = 0; i < chars.length; i++) {
      ctx.fillText(chars[i], 64, startY + i * charSpacing);
    }

    // Small horizontal line ornament below text
    const textEndY = startY + chars.length * charSpacing + 10;
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(30, textEndY);
    ctx.lineTo(98, textEndY);
    ctx.stroke();

    const tex = new THREE.CanvasTexture(canvas);
    const clothMat = new THREE.MeshStandardMaterial({
      map: tex,
      side: THREE.DoubleSide,
      roughness: 0.85,
      transparent: true,
      opacity: 0.95,
    });
    const cloth = new THREE.Mesh(clothGeo, clothMat);
    cloth.position.set(0, poleHeight - bannerH / 2 - 0.3, 0.15);

    // Store original positions for wave animation
    clothGeo.userData.origPositions = new Float32Array(clothGeo.attributes.position.array);
    group.add(cloth);
    group.userData.bannerCloth = cloth;

    // (glow light removed for performance)

    scene.add(group);
  }
}

/**
 * Ambient props: desks, people, switches
 */
export function createAmbientProps(scene, props) {
  for (const p of props) {
    let mesh;
    switch (p.type) {
      case 'desk': {
        const geo = new THREE.BoxGeometry(1.5, 0.8, 0.8);
        const mat = new THREE.MeshStandardMaterial({ color: 0x775544, roughness: 0.8 });
        mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(p.x, 0.4, p.z);
        break;
      }
      case 'person': {
        const bodyGeo = new THREE.CylinderGeometry(0.2, 0.2, 1.2, 8);
        const bodyMat = new THREE.MeshStandardMaterial({ color: 0x5588cc });
        mesh = new THREE.Mesh(bodyGeo, bodyMat);
        const headGeo = new THREE.SphereGeometry(0.2, 8, 6);
        const head = new THREE.Mesh(headGeo, bodyMat);
        head.position.y = 0.8;
        mesh.add(head);
        mesh.position.set(p.x, 0.6, p.z);
        break;
      }
      case 'printer': {
        const geo = new THREE.BoxGeometry(1, 0.6, 0.8);
        const mat = new THREE.MeshStandardMaterial({ color: 0x999999 });
        mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(p.x, 0.3, p.z);
        break;
      }
      case 'switch': {
        const geo = new THREE.BoxGeometry(0.8, 0.3, 0.5);
        const mat = new THREE.MeshStandardMaterial({ color: 0x44aa66, emissive: 0x224422, emissiveIntensity: 0.4 });
        mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(p.x, 1.2, p.z);
        break;
      }
      case 'rack': {
        const geo = new THREE.BoxGeometry(1, 5, 1);
        const mat = new THREE.MeshStandardMaterial({ color: 0x556677 });
        mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(p.x, 2.5, p.z);
        break;
      }
      default: continue;
    }
    if (mesh) {
      mesh.castShadow = true;
      scene.add(mesh);
    }
  }
}
