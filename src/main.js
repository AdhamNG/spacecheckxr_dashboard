/**
 * Main orchestrator
 * Flow: Form → Auth → Init Dashboard + 3D viewer → Download mesh → Display
 */
import './styles/global.css';
import './styles/enterprise-theme.css';
import './styles/ar-enterprise-theme.css';
import './styles/media.css';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { renderForm } from './ui/form.js';
import { createStatusBar, createConfidenceBadge } from './ui/status.js';
import { getM2MToken } from './services/multiset-auth.js';
import { downloadMapMesh } from './services/multiset-mesh.js';
import {
  initScene,
  canCreateWebGLContext,
  addMesh,
  flyTo,
  frameCameraToMap,
  getMultisetAnchor,
  setMapDisplayMode,
  getMapDisplayMode,
  setOnPoiPickedFromCanvas,
  setSceneInteractionMode,
  setOnSceneMapClick,
  hidePlacementPreview,
  detachGizmo,
} from './ar/scene.js';
import { showGlobalHeatmap, clearGlobalHeatmap, clearUserHeatmap } from './ar/nav-heatmap.js';
import { fetchAllUsersNavnodesCombined, isSupabaseConfigured } from './services/supabase.js';
import { createSceneToolbar } from './ui/scene-toolbar.js';
import {
  hydratePoisFromSupabase,
  seedDummyPoisWhenEmpty,
  refreshPOIGroup,
  setPOIGroupVisible,
} from './ar/pois.js';
import { createPoiRoadmap } from './ui/poi-roadmap.js';
import { createDashboard } from './ui/dashboard.js';
import { createNavPanel } from './ui/nav.js';
import { createPOIPanel } from './ui/poi-panel.js';
import { createUserPanel } from './ui/user-panel.js';
import { createReviewsPanel } from './ui/reviews-panel.js';
import { createUserInsightsPanel } from './ui/user-insights-panel.js';
import { createSubmittedPanel } from './ui/submitted-panel.js';
import { createMediaPanel } from './ui/media-panel.js';
import { openMediaModal } from './ui/media-modal.js';
import {
  hydrateMediaFromSupabase,
  refreshMediaGroup,
  setMediaGroupVisible,
  setMediaGltfLoader,
  applySavedMediaRow,
  remountMediaItem,
  getMediaObjects,
  mediaData,
} from './ar/media.js';
import { MULTISET_MAP } from './config/spacecheck-access.js';
import { setOwnerSlug } from './config/owner-scope.js';
import { clearJourneyRegistry } from './services/journey-registry.js';
import {
  clearDashboardSession,
  isStoredTokenUsable,
  loadDashboardSession,
  saveDashboardSession,
} from './services/dashboard-session.js';

const app = document.getElementById('app');

/**
 * GLTF loader for map meshes: Draco (common on MultiSet), Meshopt when present,
 * and extra Draco workers so large multi-primitive maps decode in parallel.
 */
async function createMapGltfLoader() {
  await MeshoptDecoder.ready;
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath(`${import.meta.env.BASE_URL}draco/gltf/`);
  const workers = Math.min(8, typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4);
  dracoLoader.setWorkerLimit(Math.max(4, workers));
  const loader = new GLTFLoader();
  loader.setDRACOLoader(dracoLoader);
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}

const dashboard = createDashboard(app);
dashboard.onLogout(() => {
  clearDashboardSession();
  setOwnerSlug('');
  clearJourneyRegistry();
  window.location.reload();
});
const statusBar = createStatusBar(app);
const confidenceBadge = createConfidenceBadge(app);
const formUI = renderForm(app, onFormSubmit);

const navPanel = createNavPanel(dashboard.slots.nav, flyTo);
const poiPanel = createPOIPanel(dashboard.slots.pois, {
  onPoiListChange: () => roadmapUi?.refresh(),
});
setOnPoiPickedFromCanvas((index) => poiPanel.selectByIndex(index));

const mediaPanel = createMediaPanel(dashboard.slots.media, {
  onEditMedia: (saved, context) => handleMediaSaved(saved, context),
});

const viewportBody = dashboard.element.querySelector('#viewport-body');
const sceneToolbar = createSceneToolbar(viewportBody, {
  onToolActivate: (_mode, panelId) => {
    if (panelId) dashboard.openPanel(panelId);
  },
  onModeChange: (mode) => {
    if (mode === 'add-media' || mode === 'add-poi' || mode === 'walk') {
      detachGizmo();
      if (mode === 'add-media') mediaPanel.deselect?.();
    }
    setSceneInteractionMode(mode);
  },
  onCancel: () => {
    hidePlacementPreview();
    setSceneInteractionMode('default');
  },
});
window.addEventListener('spacecheck-scene-tool-cancel', () => {
  hidePlacementPreview();
  sceneToolbar.setMode('default');
});
setOnSceneMapClick((pt, mode) => {
  if (mode === 'walk') {
    flyTo(pt.x, pt.y, pt.z, { close: true });
    return;
  }
  if (mode === 'add-poi') {
    hidePlacementPreview();
    dashboard.openPanel('pois');
    poiPanel.openAddDialog({
      x: pt.x,
      y: pt.y,
      z: pt.z,
      name: '',
    });
    sceneToolbar.setMode('default');
    setSceneInteractionMode('default');
    return;
  }
  if (mode === 'add-media') {
    hidePlacementPreview();
    dashboard.openPanel('media');
    openMediaModal({
      placement: { x: pt.x, y: pt.y, z: pt.z },
      onSaved: (saved, context) => handleMediaSaved(saved, context),
    });
    sceneToolbar.setMode('default');
    setSceneInteractionMode('default');
  }
});

const userPanel = createUserPanel(dashboard.slots.tracking);
const reviewsPanel = createReviewsPanel(dashboard.slots.reviews);
const userInsightsPanel = createUserInsightsPanel(dashboard.slots.insights);
const submittedPanel = createSubmittedPanel(dashboard.slots.submitted);

/** Set after auth + POI roadmap is created (used to refresh route strip when POIs change). */
let roadmapUi = null;
/** POI list / 3D markers are populated only after the map mesh finishes loading. */
let poisReady = false;

function applySceneLayers(panelId) {
  setPOIGroupVisible(poisReady && (panelId === 'pois' || panelId === 'journey'));
  setMediaGroupVisible(poisReady && panelId === 'media');
}

async function handleMediaSaved(saved, context = {}) {
  const anchor = getMultisetAnchor();
  const previewUrl = context.previewUrl;
  let index = -1;
  try {
    dashboard.openPanel('media');
    applySceneLayers('media');
    index = await applySavedMediaRow(saved, anchor, { previewUrl });
    mediaPanel.refresh();
    if (index >= 0) {
      mediaPanel.selectByIndex(index);
      if (!getMediaObjects()[index]?.root) {
        if (previewUrl) mediaData[index]._previewUrl = previewUrl;
        await remountMediaItem(index, anchor);
        mediaPanel.selectByIndex(index);
      }
    }
  } catch (err) {
    console.error('[media] scene refresh failed:', err);
    statusBar.show('Media saved — reloading 3D preview…', 'loading');
    try {
      await hydrateMediaFromSupabase();
      const anchorRetry = getMultisetAnchor();
      if (anchorRetry) {
        setMediaGroupVisible(true);
        await refreshMediaGroup(anchorRetry);
      }
      mediaPanel.refresh();
      statusBar.show('Media preview updated', 'success');
      setTimeout(() => statusBar.hide(), 2200);
    } catch (retryErr) {
      console.error(retryErr);
      statusBar.show('Media saved to database; refresh page if 3D preview is missing', 'error');
    }
  } finally {
    if (index >= 0 && mediaData[index]) {
      delete mediaData[index]._previewUrl;
    }
    if (previewUrl && saved?.media_type !== 'video') {
      URL.revokeObjectURL(previewUrl);
    }
  }
}

dashboard.onPanelChange((panelId) => {
  applySceneLayers(panelId);

  if (poisReady) {
    requestAnimationFrame(() => frameCameraToMap({ animate: true }));
  }

  poiPanel.hide();
  mediaPanel.hide();
  navPanel.hide();
  userPanel.hide();
  userInsightsPanel.hide();
  reviewsPanel.hide();
  submittedPanel.hide();

  if (panelId === 'pois') {
    poiPanel.show();
    if (poisReady) poiPanel.refresh();
  } else if (panelId === 'media') {
    mediaPanel.show();
    if (poisReady) mediaPanel.refresh();
    mediaPanel.wireGizmoHandlers?.();
  } else if (panelId === 'tracking') {
    userPanel.show();
  } else if (panelId === 'insights') {
    userInsightsPanel.show();
  } else if (panelId === 'reviews') {
    reviewsPanel.show();
    reviewsPanel.load();
  } else if (panelId === 'submitted') {
    submittedPanel.show();
  }
});

const mapDisplaySelect = dashboard.element.querySelector('#map-display-mode');
if (mapDisplaySelect) {
  mapDisplaySelect.addEventListener('change', async (e) => {
    const v = e.target.value;
    if (v === 'heatmap') {
      setMapDisplayMode('heatmap');
      if (!isSupabaseConfigured()) {
        statusBar.show('Configure Supabase to load the heat map', 'error');
        mapDisplaySelect.value = getMapDisplayMode() === 'wireframe' ? 'wireframe' : 'shaded';
        setMapDisplayMode(mapDisplaySelect.value);
        return;
      }
      statusBar.show('Loading combined heat map (all users)…', 'loading');
      try {
        clearUserHeatmap();
        const points = await fetchAllUsersNavnodesCombined();
        if (!points.length) {
          statusBar.show('No navnode data for heat map', 'error');
          mapDisplaySelect.value = 'shaded';
          setMapDisplayMode('shaded');
          return;
        }
        showGlobalHeatmap(points);
        frameCameraToMap({ animate: true });
        statusBar.show(`Heat map — ${points.length} points (all users combined)`, 'success');
        setTimeout(() => statusBar.hide(), 2500);
      } catch (err) {
        console.error(err);
        clearGlobalHeatmap();
        statusBar.show(err.message || 'Heat map failed to load', 'error');
        mapDisplaySelect.value = 'shaded';
        setMapDisplayMode('shaded');
      }
      return;
    }
    clearGlobalHeatmap();
    setMapDisplayMode(v === 'wireframe' ? 'wireframe' : 'shaded');
    if (poisReady) frameCameraToMap({ animate: true });
  });
}

dashboard.onViewSwitch((view) => {
  if (view === '3d' && poisReady) {
    requestAnimationFrame(() => frameCameraToMap({ animate: true }));
  }
});

const savedSession = loadDashboardSession();
if (savedSession) {
  onFormSubmit({
    clientId: MULTISET_MAP.clientId,
    clientSecret: MULTISET_MAP.clientSecret,
    mapCode: savedSession.mapCode,
    ownerSlug: savedSession.ownerSlug,
    token: savedSession.token,
    tokenExpiresAt: savedSession.tokenExpiresAt,
    sessionExpiresAt: savedSession.sessionExpiresAt,
    restoredSession: true,
  });
}

async function onFormSubmit(creds) {
  formUI.disable();
  statusBar.show(creds.restoredSession ? 'Restoring session…' : 'Authenticating…', 'loading');

  try {
    if (!canCreateWebGLContext()) {
      throw new Error(
        'WebGL is disabled in this browser/session. Enable hardware acceleration or open in a regular (non-sandboxed) browser.'
      );
    }
    setOwnerSlug(creds.ownerSlug);
    const authResult =
      creds.token && isStoredTokenUsable(creds.tokenExpiresAt)
        ? { token: creds.token, expiresAt: creds.tokenExpiresAt }
        : await getM2MToken(creds.clientId, creds.clientSecret);
    const token = authResult.token;
    saveDashboardSession({
      ownerSlug: creds.ownerSlug,
      mapCode: creds.mapCode,
      token,
      tokenExpiresAt: authResult.expiresAt,
      sessionExpiresAt: creds.sessionExpiresAt,
    });

    statusBar.show('Loading 3D viewer…', 'loading');

    formUI.hide();
    dashboard.show();
    initScene(dashboard.viewport);
    statusBar.mount(dashboard.viewport);

    statusBar.show('Loading map…', 'loading');
    const meshPromise = downloadMapMesh(token, creds.mapCode);
    const loaderPromise = createMapGltfLoader();

    function syncRoadmapAndPois3d() {
      const anchor = getMultisetAnchor();
      if (anchor) refreshPOIGroup(anchor);
      if (poisReady) poiPanel.refresh();
      roadmapUi?.refresh();
    }

    async function loadPoisAfterMap() {
      await hydratePoisFromSupabase();
      await seedDummyPoisWhenEmpty();
      await hydratePoisFromSupabase();
      if (isSupabaseConfigured()) {
        try {
          await hydrateMediaFromSupabase();
        } catch (err) {
          console.warn('[media] hydrate failed:', err);
        }
      }
      poisReady = true;
      syncRoadmapAndPois3d();
      const anchor = getMultisetAnchor();
      if (anchor) {
        setMediaGltfLoader(loader);
        await refreshMediaGroup(anchor);
      }
      applySceneLayers('pois');
      dashboard.openPanel('pois');
      dashboard.refreshStats();
    }

    roadmapUi = createPoiRoadmap(dashboard.slots.journey, {
      onAddNew: () => {
        dashboard.switchView('3d');
        sceneToolbar.setMode('add-poi');
        setSceneInteractionMode('add-poi');
      },
      onReordered: syncRoadmapAndPois3d,
    });
    roadmapUi.render();

    statusBar.show('Finishing map download…', 'loading');
    const [glbBuffer, loader] = await Promise.all([meshPromise, loaderPromise]);

    if (!glbBuffer) {
      statusBar.show('No GLB file found — loading POIs…', 'loading');
      await loadPoisAfterMap();
      statusBar.show('No GLB file found — but you can navigate the coordinate system', 'success');
      setTimeout(() => statusBar.hide(), 3000);
      return;
    }

    statusBar.show('Decoding map geometry…', 'loading');
    const gltf = await new Promise((resolve, reject) => {
      loader.parse(glbBuffer, '', resolve, reject);
    });

    addMesh(gltf.scene);

    statusBar.show('Loading POIs…', 'loading');
    await loadPoisAfterMap();

    statusBar.show('Map loaded ✓', 'success');
    setTimeout(() => statusBar.hide(), 3000);
  } catch (err) {
    console.error(err);
    if (creds.restoredSession) clearDashboardSession();
    statusBar.show(err.message, 'error');
    const msg = String(err?.message ?? '');
    if (/webgl|hardware acceleration|sandbox/i.test(msg)) {
      formUI.setError(
        'Cannot start 3D scene: WebGL is disabled. Enable browser hardware acceleration and relaunch, or use a non-sandboxed browser session.'
      );
    }
    formUI.enable();
    dashboard.hide();
    formUI.show();
  }
}
