/**
 * scene.js — Three.js scene, renderer, lighting, terrain with hills
 */
import * as THREE from 'three';

export function createScene(container) {
  // Renderer
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = false;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.4;
  container.appendChild(renderer.domElement);

  // Scene
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a2a1a);
  // fog removed for performance

  // Lights
  const ambient = new THREE.AmbientLight(0x889988, 1.6);
  scene.add(ambient);

  const hemi = new THREE.HemisphereLight(0x99aa88, 0x334422, 1.4);
  scene.add(hemi);

  const dirLight = new THREE.DirectionalLight(0xeeddbb, 1.8);
  dirLight.position.set(30, 50, 20);
  dirLight.castShadow = false;
  scene.add(dirLight);

  // --- Terrain with rolling hills ---
  const terrainSize = 200;
  const terrainSeg = 40;
  const terrainGeo = new THREE.PlaneGeometry(terrainSize, terrainSize, terrainSeg, terrainSeg);
  terrainGeo.rotateX(-Math.PI / 2);

  // Generate gentle rolling hills
  const pos = terrainGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    // Multiple octaves of sine hills
    let h = 0;
    h += Math.sin(x * 0.04) * Math.cos(z * 0.05) * 3.0;
    h += Math.sin(x * 0.08 + 1.3) * Math.cos(z * 0.06 + 0.7) * 1.5;
    h += Math.sin(x * 0.15 + 2.1) * Math.cos(z * 0.12 + 1.4) * 0.6;
    // Cloud hilltop — deliberate rise at (28, -37) for cloud provider icons
    const cdx = (x - 28) / 22;
    const cdz = (z - (-37)) / 22;
    const cloudHill = Math.exp(-(cdx * cdx + cdz * cdz) * 2.0) * 5.0;
    h += cloudHill;
    // Flatten the center area where machines are (-50..60, -40..40)
    const cx = Math.max(0, 1 - Math.max(0, (Math.abs(x - 5) - 40)) / 20);
    const cz = Math.max(0, 1 - Math.max(0, (Math.abs(z) - 30)) / 20);
    const flatten = cx * cz;
    h *= (1 - flatten * 0.8);
    // Keep minimum at 0 (no valleys below ground)
    pos.setY(i, Math.max(h, -0.5));
  }
  terrainGeo.computeVertexNormals();

  // Grassy terrain material
  const terrainMat = new THREE.MeshStandardMaterial({
    color: 0x3a5a2a,
    roughness: 0.95,
    metalness: 0.0,
  });
  const terrain = new THREE.Mesh(terrainGeo, terrainMat);
  terrain.receiveShadow = true;
  scene.add(terrain);

  // --- Paths/roads between zones ---
  createPaths(scene);

  // Handle resize
  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return { scene, renderer, dirLight };
}


/** Subtle ground paths connecting the zones */
function createPaths(scene) {
  const pathColor = 0x5a6a4a;
  const pathPoints = [
    // Entry → Corporate
    [[-40, 30], [-25, 20], [-10, 15]],
    // Corporate → Server
    [[-10, 15], [5, 5], [15, 0], [25, -5]],
    // Server → DC
    [[25, -5], [35, -15], [50, -30]],
  ];

  for (const path of pathPoints) {
    const curve = new THREE.CatmullRomCurve3(
      path.map(([x, z]) => new THREE.Vector3(x, 0.08, z))
    );
    const points = curve.getPoints(40);

    // Path as a thin ribbon (two parallel lines)
    for (const offset of [-0.4, 0.4]) {
      const offsetPoints = points.map(p => {
        const tangent = curve.getTangentAt(
          Math.min(1, Math.max(0, points.indexOf(p) / points.length))
        );
        const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
        return p.clone().add(normal.multiplyScalar(offset));
      });
      const geo = new THREE.BufferGeometry().setFromPoints(offsetPoints);
      const mat = new THREE.LineBasicMaterial({
        color: pathColor,
        transparent: true,
        opacity: 0.3,
      });
      scene.add(new THREE.Line(geo, mat));
    }
  }
}

/**
 * Create subnet zone ground planes
 */
export function createSubnetZones(scene, subnets) {
  const zones = {};
  for (const sub of subnets) {
    const geo = new THREE.PlaneGeometry(sub.size.w, sub.size.d);
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(sub.color),
      roughness: 0.95,
      transparent: true,
      opacity: 0.6,
      emissive: new THREE.Color(sub.color),
      emissiveIntensity: 0.2,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(sub.position.x, 0.15, sub.position.z);
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    scene.add(mesh);

    // Border
    const edges = new THREE.EdgesGeometry(geo);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x667766, transparent: true, opacity: 0.5 });
    const border = new THREE.LineSegments(edges, lineMat);
    border.rotation.x = -Math.PI / 2;
    border.position.copy(mesh.position);
    border.position.y = 0.16;
    scene.add(border);

    zones[sub.id] = mesh;
  }
  return zones;
}
