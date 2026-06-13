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

    const poleHeight = 10;
    const bannerW = 5;   // horizontal — wider than tall
    const bannerH = 3;

    // Tall dark pole (like the Three Kingdoms screenshot)
    const poleGeo = new THREE.CylinderGeometry(0.1, 0.12, poleHeight, 8);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.7, roughness: 0.3 });
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.y = poleHeight / 2;
    pole.castShadow = true;
    group.add(pole);

    // Pole top ornament (pointed spear tip)
    const tipGeo = new THREE.ConeGeometry(0.15, 0.6, 6);
    const tipMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.8 });
    const tip = new THREE.Mesh(tipGeo, tipMat);
    tip.position.y = poleHeight + 0.3;
    group.add(tip);

    // Horizontal crossbar (flag hangs from pole + crossbar)
    const crossGeo = new THREE.CylinderGeometry(0.06, 0.06, bannerW, 6);
    const cross = new THREE.Mesh(crossGeo, poleMat);
    cross.rotation.z = Math.PI / 2;
    cross.position.set(bannerW / 2, poleHeight - 0.1, 0);
    group.add(cross);

    // Banner cloth — horizontal rectangle, attached to pole on left edge
    const clothGeo = new THREE.PlaneGeometry(bannerW, bannerH, 12, 6);
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    // Background fill
    ctx.fillStyle = b.color;
    ctx.fillRect(0, 0, 512, 256);

    // Outer border (silver frame like the screenshot)
    ctx.strokeStyle = 'rgba(200,200,220,0.5)';
    ctx.lineWidth = 8;
    ctx.strokeRect(8, 8, 496, 240);

    // Inner border
    ctx.strokeStyle = 'rgba(200,200,220,0.25)';
    ctx.lineWidth = 4;
    ctx.strokeRect(20, 20, 472, 216);

    // Corner ornaments (small squares at each corner)
    const corners = [[20,20],[484,20],[20,228],[484,228]];
    ctx.fillStyle = 'rgba(200,200,220,0.3)';
    for (const [cx, cy] of corners) {
      ctx.fillRect(cx - 4, cy - 4, 8, 8);
    }

    // Label text — horizontal, large, centered
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Scale font to fit: shorter labels get bigger text
    const fontSize = b.label.length <= 4 ? 72 : b.label.length <= 8 ? 56 : 40;
    ctx.font = `bold ${fontSize}px "Courier New", monospace`;
    ctx.fillText(b.label, 256, 128);

    // Subtle text shadow effect (draw text slightly offset first)
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillText(b.label, 258, 130);
    ctx.globalCompositeOperation = 'source-over';

    const tex = new THREE.CanvasTexture(canvas);
    const clothMat = new THREE.MeshStandardMaterial({
      map: tex,
      side: THREE.DoubleSide,
      roughness: 0.85,
      transparent: true,
      opacity: 0.95,
    });
    const cloth = new THREE.Mesh(clothGeo, clothMat);
    // Hang from crossbar: offset right so left edge aligns with pole
    cloth.position.set(bannerW / 2, poleHeight - bannerH / 2 - 0.3, 0.1);

    // Store original positions for wave animation
    clothGeo.userData.origPositions = new Float32Array(clothGeo.attributes.position.array);
    group.add(cloth);
    group.userData.bannerCloth = cloth;

    scene.add(group);
  }
}

/**
 * Cloud provider icons on a far hilltop, with dashed lines to corporate LAN machines.
 * Each cloud is a 3D billboard with the provider logo drawn on a canvas.
 */
export function createCloudProviders(scene, machineMap) {
  const clouds = [
    { name: 'AWS',   color: '#FF9900', bgColor: '#232F3E', x: 15, z: -35, logo: 'image/aws.png' },
    { name: 'Azure', color: '#0078D4', bgColor: '#1a1a2e', x: 28, z: -38, logo: 'image/Azure.png' },
    { name: 'GCP',   color: '#4285F4', bgColor: '#1a1a2e', x: 41, z: -35, logo: 'image/google-cloud.png' },
  ];

  // Which corporate LAN machines connect to cloud
  const corpMachines = ['APP-SVR01', 'BACKUP-SVR', 'MGMT-SVR'];
  const hillY = 5; // elevated hilltop position

  const cloudPositions = [];

  for (const c of clouds) {
    const group = new THREE.Group();
    group.position.set(c.x, hillY, c.z);

    // Platform / pedestal
    const baseGeo = new THREE.CylinderGeometry(2.5, 3, 0.4, 16);
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x334455,
      roughness: 0.8,
      metalness: 0.3,
      transparent: true,
      opacity: 0.6,
    });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = -0.2;
    group.add(base);

    // Logo billboard — try loading real PNG, fall back to canvas-drawn logo
    const billboardSize = 5;
    const billboardGeo = new THREE.PlaneGeometry(billboardSize, billboardSize);
    const billboardMat = new THREE.MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const billboard = new THREE.Mesh(billboardGeo, billboardMat);
    billboard.position.set(0, billboardSize / 2 + 0.5, 0);
    group.add(billboard);

    // Try loading real logo PNG, fall back to canvas
    const img = new Image();
    img.onload = () => {
      const tex = new THREE.Texture(img);
      tex.needsUpdate = true;
      billboardMat.map = tex;
      billboardMat.needsUpdate = true;
    };
    img.onerror = () => {
      // Fallback: draw logo on canvas
      const tex = _drawCloudLogo(c);
      billboardMat.map = tex;
      billboardMat.needsUpdate = true;
    };
    img.src = c.logo;

    // Soft glow light
    const glow = new THREE.PointLight(new THREE.Color(c.color), 0.8, 25);
    glow.position.set(0, 3, 0);
    group.add(glow);

    scene.add(group);
    cloudPositions.push({ x: c.x, y: hillY, z: c.z });
  }

  // Dashed lines from corporate LAN machines to each cloud
  const dashMat = new THREE.LineDashedMaterial({
    color: 0xcccccc,
    dashSize: 1.5,
    gapSize: 1.0,
    transparent: true,
    opacity: 0.25,
    linewidth: 1,
  });

  for (const mName of corpMachines) {
    const m = machineMap[mName];
    if (!m) continue;
    const mPos = m.group.position;

    for (const cp of cloudPositions) {
      const points = [
        new THREE.Vector3(mPos.x, 0.3, mPos.z),
        // Arc up through a mid-point for a gentle curve feel
        new THREE.Vector3(
          (mPos.x + cp.x) / 2,
          (hillY + 2) / 2 + 3,
          (mPos.z + cp.z) / 2
        ),
        new THREE.Vector3(cp.x, cp.y + 1.5, cp.z),
      ];
      const curve = new THREE.QuadraticBezierCurve3(points[0], points[1], points[2]);
      const curvePoints = curve.getPoints(30);
      const geo = new THREE.BufferGeometry().setFromPoints(curvePoints);
      const line = new THREE.Line(geo, dashMat.clone());
      line.computeLineDistances(); // required for dashed lines
      scene.add(line);
    }
  }
}

/**
 * Canvas-drawn fallback logos when PNG files aren't available.
 * Draws a recognizable approximation of each cloud provider logo.
 */
function _drawCloudLogo(c) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Transparent background
  ctx.clearRect(0, 0, size, size);

  if (c.name === 'AWS') {
    // AWS: orange "smile" arrow on dark rounded rect
    _roundRect(ctx, 20, 40, 216, 176, 20, '#232F3E');
    // "aws" text
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 52px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('aws', 128, 130);
    // Orange smile/arrow
    ctx.strokeStyle = '#FF9900';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(55, 155);
    ctx.quadraticCurveTo(128, 190, 200, 155);
    ctx.stroke();
    // Arrow head
    ctx.fillStyle = '#FF9900';
    ctx.beginPath();
    ctx.moveTo(190, 145);
    ctx.lineTo(210, 155);
    ctx.lineTo(195, 165);
    ctx.fill();
  } else if (c.name === 'Azure') {
    // Azure: blue angular shape
    _roundRect(ctx, 20, 40, 216, 176, 20, '#1a1a2e');
    // Draw simplified Azure logo shape
    ctx.fillStyle = '#0078D4';
    ctx.beginPath();
    ctx.moveTo(60, 170);
    ctx.lineTo(100, 75);
    ctx.lineTo(140, 75);
    ctx.lineTo(110, 130);
    ctx.lineTo(195, 130);
    ctx.lineTo(145, 170);
    ctx.closePath();
    ctx.fill();
    // "Azure" text below
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 28px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Azure', 128, 200);
  } else if (c.name === 'GCP') {
    // GCP: colored hexagon/cloud
    _roundRect(ctx, 20, 40, 216, 176, 20, '#1a1a2e');
    // Simplified GCP cloud with 4 colors
    const colors = ['#4285F4', '#EA4335', '#FBBC04', '#34A853'];
    const cx = 128, cy = 115, r = 35;
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = colors[i];
      ctx.beginPath();
      const a1 = (i * Math.PI) / 2 - Math.PI / 4;
      const a2 = a1 + Math.PI / 2;
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, a1, a2);
      ctx.closePath();
      ctx.fill();
    }
    // Inner white circle
    ctx.fillStyle = '#1a1a2e';
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.45, 0, Math.PI * 2);
    ctx.fill();
    // "Google Cloud" text
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 24px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Google Cloud', 128, 185);
  }

  const tex = new THREE.CanvasTexture(canvas);
  return tex;
}

function _roundRect(ctx, x, y, w, h, r, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();
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
