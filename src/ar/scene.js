/**
 * AR Scene → Standard 3D Map Viewer
 *
 * No camera/AR — just a Three.js scene with OrbitControls
 * to display the downloaded map mesh in VPS coordinates.
 *
 * Hierarchy:
 *   Scene
 *   ├── AmbientLight
 *   ├── DirectionalLight
 *   └── multisetAnchor (Group — pose from VPS)
 *         └── Map Mesh (loaded GLB)
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { addPOIsToScene, getPOIObjects, poisData } from './pois.js';

let renderer, scene, camera, controls;
let transformControls;
let multisetAnchor;
let isInitialized = false;
let _container = null;

/** Index of POI last clicked on the 3D canvas or list; press F to fly the camera there. */
let lastPickedPoiIndex = -1;

/** @param {number} index */
export function setLastPickedPoiIndex(index) {
  if (typeof index === 'number' && index >= 0 && index < poisData.length) {
    lastPickedPoiIndex = index;
  }
}

export function getLastPickedPoiIndex() {
  return lastPickedPoiIndex;
}

/** @type {((index: number) => void) | null} */
let onPoiPickedFromCanvas = null;

/** @param {(index: number) => void} cb */
export function setOnPoiPickedFromCanvas(cb) {
  onPoiPickedFromCanvas = cb;
}
const poiPickRaycaster = new THREE.Raycaster();
const poiPickNdc = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

/** @typedef {'default' | 'walk' | 'add-poi' | 'add-media'} SceneInteractionMode */
let sceneInteractionMode = 'default';
/** @type {((point: THREE.Vector3, mode: SceneInteractionMode) => void) | null} */
let onSceneMapClick = null;
let placementPreview = null;

/** Callback fired whenever the gizmo moves the attached object */
let onGizmoDrag = null;
/** Fired once when the user releases the gizmo after dragging */
let onGizmoDragEnd = null;

/**
 * Register a callback for gizmo drag events.
 * @param {(position: {x:number, y:number, z:number}) => void} cb
 */
export function setGizmoDragCallback(cb) {
  onGizmoDrag = cb;
}

/** @param {() => void} cb */
export function setGizmoDragEndCallback(cb) {
  onGizmoDragEnd = cb;
}

/** Expose the scene so external modules can add/remove 3D objects. */
export function getScene() {
  return scene;
}

/** VPS / map root group — loaded GLB and POIs attach here. */
export function getMultisetAnchor() {
  return multisetAnchor;
}

/** Axis-aligned bounds of the loaded MapMesh in anchor-local space (for heat maps). */
export function getMapMeshBounds() {
  const root = multisetAnchor?.getObjectByName('MapMesh');
  if (!root) return null;
  const box = new THREE.Box3().setFromObject(root);
  return box.isEmpty() ? null : box;
}

export function getCamera() {
  return camera;
}

export function getCanvas() {
  return renderer ? renderer.domElement : null;
}

export function setOrbitEnabled(enabled) {
  if (controls) controls.enabled = enabled;
}

/**
 * Fast capability check before creating Three renderer.
 * @returns {boolean}
 */
export function canCreateWebGLContext() {
  try {
    const canvas = document.createElement('canvas');
    const gl =
      canvas.getContext('webgl2') ||
      canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl');
    return Boolean(gl);
  } catch {
    return false;
  }
}

/**
 * Create a best-effort WebGL context (prefer WebGL2, fallback WebGL1).
 * @returns {{ canvas: HTMLCanvasElement, context: WebGL2RenderingContext | WebGLRenderingContext } | null}
 */
function createBestEffortWebGLContext() {
  try {
    const canvas = document.createElement('canvas');
    const attrs = {
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    };
    const webgl2 = canvas.getContext('webgl2', attrs);
    if (webgl2) return { canvas, context: webgl2 };
    const webgl =
      canvas.getContext('webgl', attrs) ||
      canvas.getContext('experimental-webgl', attrs);
    if (webgl) return { canvas, context: webgl };
    return null;
  } catch {
    return null;
  }
}

/**
 * Initialize the 3D viewer scene.
 * @param {HTMLElement} container
 */
export function initScene(container) {
  const ctxPack = createBestEffortWebGLContext();
  if (!ctxPack) {
    throw new Error(
      'WebGL is unavailable in this browser/session. Enable hardware acceleration or open in a non-sandboxed browser session.'
    );
  }
  _container = container;
  const w = container.clientWidth || window.innerWidth;
  const h = container.clientHeight || window.innerHeight;

  // Renderer
  try {
    renderer = new THREE.WebGLRenderer({
      canvas: ctxPack.canvas,
      context: ctxPack.context,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
  } catch {
    throw new Error(
      'WebGL renderer initialization failed. Check GPU access/hardware acceleration and browser sandbox restrictions.'
    );
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  /** Match CSS --bg-mesh / enterprise-theme viewport background */
  const SCENE_BG = 0xffffff;
  renderer.setClearColor(SCENE_BG, 1);
  container.appendChild(renderer.domElement);

  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(SCENE_BG);

  // Soft fog — same tone as app shell so mesh sits in the UI
  scene.fog = new THREE.FogExp2(SCENE_BG, 0.005);

  // Camera
  camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 1000);
  camera.position.set(5, 8, 12);
  camera.lookAt(0, 0, 0);

  // Orbit controls
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 1;
  controls.maxDistance = 200;
  controls.target.set(0, 0, 0);

  // TransformControls (gizmo) — zones / optional; POIs use drag-on-mesh
  transformControls = new TransformControls(camera, renderer.domElement);
  transformControls.setMode('translate');
  transformControls.setSize(1);
  scene.add(transformControls.getHelper());

  // Disable orbit while dragging the gizmo
  transformControls.addEventListener('dragging-changed', (event) => {
    controls.enabled = !event.value;
    if (!event.value && onGizmoDragEnd) onGizmoDragEnd();
  });

  // Fire callback on gizmo change (object-change fires per-frame while dragging)
  transformControls.addEventListener('objectChange', () => {
    const obj = transformControls.object;
    if (!obj) return;
    
    if (onGizmoDrag) {
      onGizmoDrag({
        position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
        rotation: { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z },
        scale: { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z }
      });
    }
  });

  // Lighting
  const ambient = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambient);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
  dirLight.position.set(10, 20, 10);
  dirLight.castShadow = false;
  scene.add(dirLight);

  const hemiLight = new THREE.HemisphereLight(0xcbd5e1, 0x334155, 0.48);
  scene.add(hemiLight);

  // MultiSet anchor group — mesh goes here
  multisetAnchor = new THREE.Group();
  multisetAnchor.name = 'MultiSetAnchor';
  scene.add(multisetAnchor);

  // Handle resize
  window.addEventListener('resize', onResize);

  installSceneInteractionHandlers();

  isInitialized = true;
  animate();
}

/**
 * @param {SceneInteractionMode} mode
 */
export function setSceneInteractionMode(mode) {
  sceneInteractionMode =
    mode === 'walk' || mode === 'add-poi' || mode === 'add-media' ? mode : 'default';
  updateSceneCursor();
  if (sceneInteractionMode !== 'add-poi' && sceneInteractionMode !== 'add-media') {
    hidePlacementPreview();
  }
}

/** @returns {SceneInteractionMode} */
export function getSceneInteractionMode() {
  return sceneInteractionMode;
}

/** @param {(point: THREE.Vector3, mode: SceneInteractionMode) => void} cb */
export function setOnSceneMapClick(cb) {
  onSceneMapClick = cb;
}

/**
 * Raycast the map mesh (or ground plane) from screen coordinates.
 * @param {number} clientX
 * @param {number} clientY
 * @returns {THREE.Vector3 | null}
 */
export function raycastMapPoint(clientX, clientY) {
  const canvas = renderer?.domElement;
  if (!canvas || !camera) return null;
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  poiPickNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  poiPickNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  poiPickRaycaster.setFromCamera(poiPickNdc, camera);

  const mapRoot =
    multisetAnchor?.getObjectByName('MapMesh') ?? scene?.getObjectByName('MapMesh');
  if (mapRoot) {
    const hits = poiPickRaycaster.intersectObject(mapRoot, true);
    const meshHit = hits.find((h) => h.object?.isMesh);
    if (meshHit) return meshHit.point.clone();
  }

  const hit = new THREE.Vector3();
  return poiPickRaycaster.ray.intersectPlane(groundPlane, hit) ? hit : null;
}

function ensurePlacementPreview() {
  if (placementPreview || !scene) return placementPreview;
  const g = new THREE.Group();
  g.name = 'PlacementPreview';

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.2, 0.42, 40),
    new THREE.MeshBasicMaterial({
      color: 0x2dd4bf,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  g.add(ring);

  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(0.1, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0x14b8a6, depthTest: false }),
  );
  dot.position.y = 0.12;
  g.add(dot);

  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.02, 0.35, 8),
    new THREE.MeshBasicMaterial({ color: 0x0d9488, depthTest: false }),
  );
  stem.position.y = 0.28;
  g.add(stem);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0x2dd4bf, depthTest: false }),
  );
  head.position.y = 0.5;
  g.add(head);

  g.visible = false;
  scene.add(g);
  placementPreview = g;
  return g;
}

/**
 * @param {number} x
 * @param {number} y
 * @param {number} z
 */
export function showPlacementPreview(x, y, z) {
  const g = ensurePlacementPreview();
  if (!g) return;
  g.position.set(x, y, z);
  g.visible = true;
}

export function hidePlacementPreview() {
  if (placementPreview) placementPreview.visible = false;
}

const FOOTPRINT_CURSOR =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2'%3E%3Ccircle cx='12' cy='12' r='7'/%3E%3C/svg%3E\") 12 12, crosshair";

const ADD_POI_CURSOR =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%230d9488' stroke-width='2'%3E%3Cpath d='M12 21s7-4.5 7-11a7 7 0 1 0-14 0c0 6.5 7 11 7 11z'/%3E%3Cline x1='12' y1='7' x2='12' y2='13'/%3E%3Cline x1='9' y1='10' x2='15' y2='10'/%3E%3C/svg%3E\") 12 22, crosshair";

const ADD_MEDIA_CURSOR =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%237c3aed' stroke-width='2'%3E%3Crect x='3' y='5' width='18' height='14' rx='2'/%3E%3Cline x1='12' y1='3' x2='12' y2='7'/%3E%3Cline x1='10' y1='5' x2='14' y2='5'/%3E%3C/svg%3E\") 12 22, crosshair";

function updateSceneCursor() {
  const canvas = renderer?.domElement;
  if (!canvas) return;
  if (sceneInteractionMode === 'walk') {
    canvas.style.cursor = FOOTPRINT_CURSOR;
  } else if (sceneInteractionMode === 'add-poi') {
    canvas.style.cursor = ADD_POI_CURSOR;
  } else if (sceneInteractionMode === 'add-media') {
    canvas.style.cursor = ADD_MEDIA_CURSOR;
  } else {
    canvas.style.cursor = '';
  }
}

let pointerDownX = 0;
let pointerDownY = 0;

function pickPoiIndexAt(clientX, clientY) {
  const canvas = renderer?.domElement;
  if (!canvas || !camera) return -1;
  const rect = canvas.getBoundingClientRect();
  poiPickNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  poiPickNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  poiPickRaycaster.setFromCamera(poiPickNdc, camera);
  const meshes = getPOIObjects()
    .map((o) => o.mesh)
    .filter(Boolean);
  const hits = poiPickRaycaster.intersectObjects(meshes, false);
  if (!hits.length) return -1;
  const idx = hits[0].object.userData.poiIndex;
  return typeof idx === 'number' && idx >= 0 ? idx : -1;
}

function installSceneInteractionHandlers() {
  const canvas = renderer.domElement;

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    pointerDownX = e.clientX;
    pointerDownY = e.clientY;
  });

  canvas.addEventListener('pointermove', (e) => {
    if (sceneInteractionMode !== 'add-poi' && sceneInteractionMode !== 'add-media') return;
    const pt = raycastMapPoint(e.clientX, e.clientY);
    if (pt) showPlacementPreview(pt.x, pt.y, pt.z);
    else hidePlacementPreview();
  });

  canvas.addEventListener('pointerleave', () => {
    if (sceneInteractionMode === 'add-poi' || sceneInteractionMode === 'add-media') {
      hidePlacementPreview();
    }
  });

  canvas.addEventListener('pointerup', (e) => {
    if (e.button !== 0) return;

    if (transformControls?.dragging) return;
    const distSq = (e.clientX - pointerDownX) ** 2 + (e.clientY - pointerDownY) ** 2;
    if (distSq > 64) return;

    if (
      sceneInteractionMode === 'walk' ||
      sceneInteractionMode === 'add-poi' ||
      sceneInteractionMode === 'add-media'
    ) {
      const pt = raycastMapPoint(e.clientX, e.clientY);
      if (pt && onSceneMapClick) onSceneMapClick(pt, sceneInteractionMode);
      return;
    }

    const idx = pickPoiIndexAt(e.clientX, e.clientY);
    if (idx >= 0) {
      lastPickedPoiIndex = idx;
      if (onPoiPickedFromCanvas) onPoiPickedFromCanvas(idx);
    }
  });

  window.addEventListener('keydown', onFlyToPickedPoiKeydown);
  window.addEventListener('keydown', onSceneToolEscapeKeydown);
}

function onSceneToolEscapeKeydown(e) {
  if (e.key !== 'Escape') return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  if (sceneInteractionMode === 'default') return;
  setSceneInteractionMode('default');
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('spacecheck-scene-tool-cancel'));
  }
}

function onFlyToPickedPoiKeydown(e) {
  if (e.key?.toLowerCase?.() !== 'f') return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  if (lastPickedPoiIndex < 0) return;
  const p = poisData[lastPickedPoiIndex];
  if (!p) return;
  e.preventDefault();
  flyTo(p.pos_x, p.pos_y, p.pos_z);
}

function onResize() {
  if (!camera || !renderer) return;
  const w = _container ? _container.clientWidth : window.innerWidth;
  const h = _container ? _container.clientHeight : window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

let flyAnimation = null;

function animate() {
  requestAnimationFrame(animate);
  if (!isInitialized) return;

  // Handle fly-to animation
  if (flyAnimation) {
    flyAnimation.t += flyAnimation.speed;
    if (flyAnimation.t >= 1) {
      flyAnimation.t = 1;
      camera.position.copy(flyAnimation.endPos);
      controls.target.copy(flyAnimation.endTarget);
      flyAnimation = null;
    } else {
      const t = easeInOutCubic(flyAnimation.t);
      camera.position.lerpVectors(flyAnimation.startPos, flyAnimation.endPos, t);
      controls.target.lerpVectors(flyAnimation.startTarget, flyAnimation.endTarget, t);
    }
  }

  controls.update();
  renderer.render(scene, camera);
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Smoothly fly the camera to look at a point (x, y, z).
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {{ close?: boolean }} [options] — close: zoom in near the point (walk mode)
 */
export function flyTo(x, y, z, options = {}) {
  if (!camera || !controls) return;

  const target = new THREE.Vector3(x, y, z);
  let endPos;

  if (options.close) {
    const toTarget = target.clone().sub(camera.position);
    const dist = toTarget.length();
    if (dist > 0.15) {
      toTarget.normalize();
      const step = Math.min(dist * 0.55, Math.max(dist - 1.8, 0));
      endPos = camera.position.clone().add(toTarget.multiplyScalar(step));
    } else {
      endPos = camera.position.clone();
    }
    endPos.y = Math.max(endPos.y, target.y + 1.35);
  } else {
    endPos = target.clone().add(new THREE.Vector3(3, 5, 8));
  }

  flyAnimation = {
    t: 0,
    speed: options.close ? 0.022 : 0.018,
    startPos: camera.position.clone(),
    endPos,
    startTarget: controls.target.clone(),
    endTarget: target.clone(),
  };
}

/**
 * Apply a VPS pose to the MultiSet anchor group.
 * @param {{x: number, y: number, z: number}} position
 * @param {{x: number, y: number, z: number, w: number}} quaternion
 */
export function applyVPSPose(position, quaternion) {
  if (!multisetAnchor) return;
  multisetAnchor.position.set(position.x, position.y, position.z);
  multisetAnchor.quaternion.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
}

/** 'shaded' | 'wireframe' | 'heatmap' */
let mapDisplayMode = 'shaded';

function applyMapMeshWireframe(wireframe) {
  const root = multisetAnchor?.getObjectByName('MapMesh');
  if (!root) return;
  root.traverse((child) => {
    if (child.isMesh && child.material) {
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const mat of mats) {
        if (mat && 'wireframe' in mat) {
          mat.wireframe = wireframe;
          mat.needsUpdate = true;
        }
      }
    }
  });
}

/**
 * @param {'shaded' | 'wireframe' | 'heatmap'} mode
 */
export function setMapDisplayMode(mode) {
  if (mode === 'heatmap') {
    mapDisplayMode = 'heatmap';
    applyMapMeshWireframe(false);
    return;
  }
  mapDisplayMode = mode === 'wireframe' ? 'wireframe' : 'shaded';
  applyMapMeshWireframe(mapDisplayMode === 'wireframe');
}

export function getMapDisplayMode() {
  return mapDisplayMode;
}

/** True while the translate gizmo is being dragged (POI move). */
export function isTransformDragging() {
  return Boolean(transformControls?.dragging);
}

/**
 * Add a loaded GLTF scene to the MultiSet anchor group.
 * Auto-frames the camera to fit the model.
 * @param {THREE.Object3D} gltfScene
 */
export function addMesh(gltfScene) {
  if (!multisetAnchor) return;

  // Remove previously-added meshes
  const existing = multisetAnchor.getObjectByName('MapMesh');
  if (existing) multisetAnchor.remove(existing);

  // Default solid; wireframe applied below if mode is active
  gltfScene.traverse((child) => {
    if (child.isMesh && child.material) {
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const mat of mats) {
        if (mat) mat.wireframe = false;
      }
    }
  });

  gltfScene.name = 'MapMesh';
  multisetAnchor.add(gltfScene);

  applyMapMeshWireframe(mapDisplayMode === 'wireframe');

  // Add POIs to the anchor
  addPOIsToScene(multisetAnchor);

  frameCameraToMap({ animate: false });
}

/**
 * Frame toward world origin (0,0,0); distance from map size so the scan fills the view.
 * @returns {{ endPos: THREE.Vector3, endTarget: THREE.Vector3, distance: number, span: number } | null}
 */
function computeMapFrame() {
  if (!camera) return null;

  const endTarget = new THREE.Vector3(0, 0, 0);
  let horiz = 14;
  let span = 16;

  const mapMesh = multisetAnchor?.getObjectByName('MapMesh');
  if (mapMesh) {
    const box = new THREE.Box3().setFromObject(mapMesh);
    if (!box.isEmpty()) {
      const size = box.getSize(new THREE.Vector3());
      horiz = Math.max(size.x, size.z, 1);
      span = Math.max(size.x, size.y, size.z, 1);
    }
  }

  const fov = camera.fov * (Math.PI / 180);
  const aspect = Math.max(camera.aspect, 0.25);
  const distV = horiz / (2 * Math.tan(fov / 2));
  const distH = horiz / (2 * Math.tan(fov / 2) * aspect);
  const distance = Math.max(distV, distH) * 0.72;

  const dir = new THREE.Vector3(0.42, 0.78, 0.46).normalize();
  const endPos = endTarget.clone().add(dir.multiplyScalar(distance));

  return { endPos, endTarget, distance, span };
}

/**
 * Zoom the camera in on origin (0,0,0) with dollhouse-style orbit. Call after load or when returning to the scene.
 * @param {{ animate?: boolean }} [options]
 * @returns {boolean}
 */
export function frameCameraToMap(options = {}) {
  if (!camera || !controls) return false;
  const frame = computeMapFrame();
  if (!frame) return false;

  const { endPos, endTarget, distance, span } = frame;

  controls.minDistance = Math.max(0.5, distance * 0.06);
  controls.maxDistance = Math.max(distance * 3.5, span * 8);
  camera.near = Math.max(0.05, distance * 0.002);
  camera.far = Math.max(500, distance * 40);
  camera.updateProjectionMatrix();

  if (options.animate) {
    flyAnimation = {
      t: 0,
      speed: 0.024,
      startPos: camera.position.clone(),
      endPos,
      startTarget: controls.target.clone(),
      endTarget,
    };
  } else {
    flyAnimation = null;
    camera.position.copy(endPos);
    controls.target.copy(endTarget);
    camera.lookAt(endTarget);
    controls.update();
  }
  return true;
}

/**
 * Attach the TransformControls gizmo to a 3D mesh.
 * @param {THREE.Object3D} mesh
 */
export function attachGizmo(mesh) {
  if (!transformControls || !mesh) return;
  detachGizmo();
  transformControls.attach(mesh);
  transformControls.setMode('translate');
  transformControls.showX = true;
  transformControls.showY = true;
  transformControls.showZ = true;
  transformControls.enabled = true;
}

/**
 * Switch the TransformControls mode (translate, rotate, scale).
 * @param {'translate'|'rotate'|'scale'} mode
 */
export function setGizmoMode(mode) {
  if (!transformControls) return;
  transformControls.setMode(mode);
}

/**
 * Detach the TransformControls gizmo.
 */
export function detachGizmo() {
  if (!transformControls) return;
  transformControls.detach();
}

// ── Floor Markers ──────────────────────────────────────

const FLOOR_COLORS = [0x60a5fa, 0x818cf8, 0x34d399, 0x94a3b8, 0xf87171, 0x38bdf8];

/**
 * Create a floor marker grid at a given Y position.
 * @param {number} y — initial Y position
 * @param {number} colorIndex — index into color palette
 * @returns {THREE.Group}
 */
export function addFloorMarker(y = 0, colorIndex = 0) {
  if (!scene) return null;

  const color = FLOOR_COLORS[colorIndex % FLOOR_COLORS.length];
  const group = new THREE.Group();
  group.name = 'FloorMarker';

  // Grid plane (semi-transparent)
  const gridSize = 60;
  const gridDivs = 30;
  const grid = new THREE.GridHelper(gridSize, gridDivs, color, color);
  grid.material.opacity = 0.4;
  grid.material.transparent = true;
  grid.material.depthWrite = false;
  group.add(grid);

  // Solid plane behind the grid for visibility
  const planeGeo = new THREE.PlaneGeometry(gridSize, gridSize);
  const planeMat = new THREE.MeshBasicMaterial({
    color: color,
    transparent: true,
    opacity: 0.08,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const plane = new THREE.Mesh(planeGeo, planeMat);
  plane.rotation.x = -Math.PI / 2;
  group.add(plane);

  group.position.set(0, y, 0);
  scene.add(group);
  return group;
}

/**
 * Attach the gizmo to a floor marker, locked to Y-axis translate only.
 * @param {THREE.Group} marker
 */
export function attachFloorGizmo(marker) {
  if (!transformControls || !marker) return;
  transformControls.setMode('translate');
  transformControls.showX = false;
  transformControls.showZ = false;
  transformControls.showY = true;
  transformControls.attach(marker);
}

/**
 * Detach the gizmo and restore all axes.
 */
export function detachFloorGizmo() {
  if (!transformControls) return;
  transformControls.detach();
  transformControls.showX = true;
  transformControls.showZ = true;
  transformControls.showY = true;
}

/**
 * Remove a floor marker from the scene.
 * @param {THREE.Group} marker
 */
export function removeFloorMarker(marker) {
  if (!scene || !marker) return;
  detachFloorGizmo();
  scene.remove(marker);
  marker.traverse((c) => {
    if (c.geometry) c.geometry.dispose();
    if (c.material) {
      if (Array.isArray(c.material)) c.material.forEach(m => m.dispose());
      else c.material.dispose();
    }
  });
}

/**
 * Get the current Y position of a floor marker.
 * @param {THREE.Group} marker
 * @returns {number}
 */
export function getFloorMarkerY(marker) {
  return marker ? marker.position.y : 0;
}
