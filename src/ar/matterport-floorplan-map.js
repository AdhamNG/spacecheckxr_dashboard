/**
 * Matterport solid-color floorplan minimap (matterport_nav).
 * Ported from Mini3dGtaEmbed — GraphQL JSON, floor picker, sweep dots, SVG route overlay.
 */
import * as THREE from 'three';
import { matterportFloorFromMultiset, multisetFromMatterportFloor } from './mp-ms-deflection.js';

const DEFAULT_GLOBAL_DESTINATION = Object.freeze({
  x: 25.2262,
  y: -16.6722,
  z: -0.0038,
});

const NOTIFY_BASE_STYLE =
  'position:absolute;top:8px;left:8px;right:8px;z-index:2;max-width:calc(100% - 16px);padding:10px 12px;border-radius:10px;font:12px/1.4 system-ui,sans-serif;color:#e0f2fe;background:rgba(15,23,42,0.82);border:1px solid rgba(110,200,255,0.25);backdrop-filter:blur(8px);pointer-events:none;';

function toFiniteCoord(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function readActiveMini3dDestination(fallback = DEFAULT_GLOBAL_DESTINATION) {
  if (typeof window === 'undefined') {
    return { ...fallback, source: 'global', mpNavApplyApiAxisSwap: false };
  }
  const navWindow = window;
  const globalShopId = String(navWindow.globalShopId ?? '').trim().toLowerCase();
  const usePersonTarget = Boolean(navWindow.selectedUser) && globalShopId.startsWith('person-');

  const globalXRaw = navWindow.globalX;
  const globalYRaw = navWindow.globalY;
  const globalZRaw = navWindow.globalZ;
  const globalX = toFiniteCoord(globalXRaw);
  const globalY = toFiniteCoord(globalYRaw);
  const globalZ = toFiniteCoord(globalZRaw);
  const globalTargetMissing =
    (globalXRaw == null && globalYRaw == null && globalZRaw == null) ||
    (globalX === 0 && globalY === 0 && globalZ === 0);

  const mpNavApplyApiAxisSwap = !usePersonTarget && !globalTargetMissing;

  return {
    x: usePersonTarget
      ? toFiniteCoord(navWindow.selectedX)
      : globalTargetMissing
        ? fallback.x
        : globalX,
    y: usePersonTarget
      ? toFiniteCoord(navWindow.selectedY)
      : globalTargetMissing
        ? fallback.y
        : globalY,
    z: usePersonTarget
      ? toFiniteCoord(navWindow.selectedZ)
      : globalTargetMissing
        ? fallback.z
        : globalZ,
    source: usePersonTarget ? 'person' : 'global',
    mpNavApplyApiAxisSwap,
  };
}

function applyNotifyVisual(el, level) {
  el.classList.remove('mini3dgta--loading', 'mini3dgta--done', 'mini3dgta--err');
  if (level === 'loading') {
    el.classList.add('mini3dgta--loading');
    el.style.borderColor = 'rgba(251,191,36,0.5)';
  } else if (level === 'done') {
    el.classList.add('mini3dgta--done');
    el.style.borderColor = 'rgba(52,211,153,0.55)';
  } else {
    el.classList.add('mini3dgta--err');
    el.style.borderColor = 'rgba(251,113,133,0.6)';
  }
}

function resolveMpFloorplanProxyUrl(mpFloorplanProxyUrl) {
  const u = mpFloorplanProxyUrl?.trim();
  if (u) return u.replace(/\/$/, '');
  return '/api/mp-floorplan';
}

/** Matterport Model API space → horizontal floorplan plane (2D uses x,y). X′=X, Y′=Z, Z′=−Y. */
function mpApiToSdk(x, y, z) {
  return { x, y: z, z: -y };
}

function mattercraftGlobalsToMatterportApi(gx, gy, gz) {
  return { x: gx, y: -gz, z: gy };
}

function readMini3dRouteWaypointsFromWindow() {
  if (typeof window === 'undefined') return null;
  const arr = window.__mini3dRouteWaypoints;
  if (!Array.isArray(arr) || arr.length < 2) return null;
  const out = [];
  for (const p of arr) {
    if (p && typeof p.x === 'number' && typeof p.y === 'number' && typeof p.z === 'number') {
      out.push({ x: p.x, y: p.y, z: p.z });
    }
  }
  return out.length >= 2 ? out : null;
}

function getNavGlbHorizontalAxes() {
  const a = typeof window !== 'undefined' ? window.__mini3dRouteWaypointFloorplanAxes : undefined;
  if (a === 'xy' || a === 'xz') return a;
  return 'xz';
}

function extractGlbHorizontal(p, axes) {
  return axes === 'xz' ? { x: p.x, y: p.z } : { x: p.x, y: p.y };
}

function similarityGlbHorizontalToMatterportApi(h0, hN, destA, destB) {
  const dgx = hN.x - h0.x;
  const dgy = hN.y - h0.y;
  const dmx = destB.x - destA.x;
  const dmy = destB.y - destA.y;
  const lg = Math.hypot(dgx, dgy);
  const lm = Math.hypot(dmx, dmy);
  const s = lg > 1e-10 ? lm / lg : 1;
  const ag = Math.atan2(dgy, dgx);
  const am = Math.atan2(dmy, dmx);
  const delta = am - ag;
  const cos = Math.cos(delta);
  const sin = Math.sin(delta);
  return (p) => {
    const qx = p.x - h0.x;
    const qy = p.y - h0.y;
    const rx = s * (qx * cos - qy * sin);
    const ry = s * (qx * sin + qy * cos);
    return { x: rx + destA.x, y: ry + destA.y };
  };
}

function applyGlbRouteToMatterportHorizontal(waypoints, destApi, axes) {
  if (waypoints.length < 2) return [];
  const h0 = extractGlbHorizontal(waypoints[0], axes);
  const hN = extractGlbHorizontal(waypoints[waypoints.length - 1], axes);
  const lg = Math.hypot(hN.x - h0.x, hN.y - h0.y);
  if (lg < 1e-8) {
    return [{ x: destApi.x, y: destApi.y }];
  }
  const destA = { x: 0, y: 0 };
  const destB = { x: destApi.x, y: destApi.y };
  const T = similarityGlbHorizontalToMatterportApi(h0, hN, destA, destB);
  const out = waypoints.map((wp) => T(extractGlbHorizontal(wp, axes)));
  out[out.length - 1] = { x: destApi.x, y: destApi.y };
  return out;
}

function mpProjectToFloorplan(px, py, fp) {
  const ox = fp.origin?.x ?? 0;
  const oy = fp.origin?.y ?? 0;
  const res = fp.resolution;
  if (res == null || fp.width == null || fp.height == null) return null;
  const u = (px - ox) * res;
  const vFromBottom = (py - oy) * res;
  const vTop = fp.height - vFromBottom;
  return { u, v: vTop };
}

/** Inverse of {@link mpProjectToFloorplan}: SVG user coords (u, vTop) → floorplan world (px, py). */
function mpInverseToFloorplanWorld(u, vTop, fp) {
  const ox = fp.origin?.x ?? 0;
  const oy = fp.origin?.y ?? 0;
  const res = fp.resolution;
  const h = fp.height;
  if (res == null || fp.width == null || h == null) return null;
  const px = ox + u / res;
  const vFromBottom = h - vTop;
  const py = oy + vFromBottom / res;
  return { px, py };
}

/** Client pixel → SVG user-space coordinates (matches floorplan viewBox). */
function clientPointToSvgUser(svgEl, clientX, clientY) {
  if (svgEl.createSVGPoint) {
    const pt = svgEl.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svgEl.getScreenCTM();
    if (!ctm) return null;
    const r = pt.matrixTransform(ctm.inverse());
    return { x: r.x, y: r.y };
  }
  const rect = svgEl.getBoundingClientRect();
  const vb = svgEl.viewBox?.baseVal;
  const w = vb?.width || Number(svgEl.getAttribute('width')) || 1;
  const h = vb?.height || Number(svgEl.getAttribute('height')) || 1;
  const sx = w / rect.width;
  const sy = h / rect.height;
  return { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy };
}

function mpIsSolidColorFloorplan(fp) {
  const url = fp.url || '';
  const flags = fp.flags || [];
  return (
    !!fp.url &&
    flags.indexOf('photogramy') !== -1 &&
    fp.format === 'jpg' &&
    flags.indexOf('alpha') === -1 &&
    flags.indexOf('colored_rooms') === -1 &&
    url.indexOf('measureplan') === -1 &&
    url.indexOf('colorplan_room') === -1 &&
    url.indexOf('vr_colorplan') === -1
  );
}

function mpPickSolidColorFloorplanForFloor(floorId, floorplans) {
  const list = floorplans.filter((f) => f.floor?.id === floorId && mpIsSolidColorFloorplan(f));
  if (!list.length) return null;
  list.sort((a, b) => (b.width || 0) - (a.width || 0));
  return list[0] ?? null;
}

function disposeMatterportOffscreenScene() {
  /* Multiset offscreen GLB — not used in SpaceCheck XR matterport-only embed */
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * @param {HTMLElement} container
 * @param {object} [options]
 * @param {boolean} [options.matterportWithNav]
 * @param {string} [options.matterportInitialJson]
 * @param {string} [options.mpFloorplanProxyUrl]
 * @param {boolean} [options.updateDocumentTitle]
 * @param {boolean} [options.floatingCircle]
 * @param {number} [options.circleDiameterPx]
 * @param {{x:number,y:number,z:number}} [options.defaultRouteDestination]
 * @param {string} [options.baseTitle]
 * @param {object} [options.poiBridge] POIs in **MultiSet** VPS (Y up). MP→MS x=x,y=y,z=−z; floor (px,py) as MP.x/MP.z ↔ MS via `mp-ms-deflection.js`; MS.y unchanged on floor drag.
 * @param {() => Array<{ index:number, x:number, y:number, z:number, label?: string }>} [options.poiBridge.getPois] MultiSet `pos_*`
 * @param {(index:number, x:number, y:number, z:number) => void} [options.poiBridge.onPoiPositionChange] MultiSet VPS coords after 2D drag.
 * @param {(index:number) => void} [options.poiBridge.onPoiDragEnd]
 * @param {boolean} [options.showMatterportSweepDots] Matterport sweep circles (default false — cleaner for POI editing).
 * @param {boolean} [options.showNavigationRoute] Red destination route overlay (default false).
 */
export function mountMatterportFloorplanMinimap(container, options = {}) {
  const matterportTitle = options.baseTitle ?? '2D Floor Plan';
  const updateDocumentTitle = options.updateDocumentTitle === true;
  const useFloatingCircle = options.floatingCircle !== false;
  const circleDiameter = Math.max(120, Math.min(360, options.circleDiameterPx ?? 200));
  const floorplanProxyUrl = resolveMpFloorplanProxyUrl(options.mpFloorplanProxyUrl);
  const matterportWithNav = options.matterportWithNav === true;
  const showMatterportSweepDots = options.showMatterportSweepDots === true;
  const showNavigationRoute = options.showNavigationRoute === true;
  const routeDestFallback = options.defaultRouteDestination
    ? {
        x: options.defaultRouteDestination.x,
        y: options.defaultRouteDestination.y,
        z: options.defaultRouteDestination.z,
      }
    : DEFAULT_GLOBAL_DESTINATION;

  const poiBridge = options.poiBridge;

  let mountRoot;
  let viewport;
  let floatingShell = null;
  let floatingBackdrop = null;
  let floatingHint = null;
  let floatingCloseButton = null;
  let sidePanel = null;
  let isExpanded = false;

  const uiNotify = document.createElement('div');
  uiNotify.setAttribute('role', 'status');
  const uiPhase = document.createElement('div');
  const uiStatus = document.createElement('p');
  uiStatus.style.cssText = 'margin:0;font-size:12px;line-height:1.45;color:#e0f2fe;';
  uiNotify.append(uiPhase, uiStatus);

  const uiCoords = document.createElement('div');
  const uiCoordsMode = document.createElement('div');
  const uiCoordsValue = document.createElement('div');
  uiCoords.append(uiCoordsMode, uiCoordsValue);

  const mapWrap = document.createElement('div');
  mapWrap.style.cssText =
    'position:relative;display:inline-block;max-width:100%;max-height:100%;margin:0 auto;border-radius:8px;overflow:hidden;background:#fff;vertical-align:middle;user-select:none;-webkit-user-select:none;';
  const fpImg = document.createElement('img');
  fpImg.alt = 'Floorplan';
  fpImg.draggable = false;
  fpImg.setAttribute('referrerpolicy', 'no-referrer');
  fpImg.style.cssText =
    'display:block;max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;user-select:none;-webkit-user-select:none;pointer-events:none;-webkit-user-drag:none;';
  fpImg.addEventListener('dragstart', (e) => e.preventDefault());
  const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  overlay.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  overlay.style.cssText =
    'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:auto;touch-action:none;user-select:none;-webkit-user-select:none;';

  mapWrap.append(fpImg, overlay);

  const poiDragReadout = document.createElement('div');
  poiDragReadout.className = 'spacecheck-poi-drag-readout';
  poiDragReadout.setAttribute('aria-live', 'polite');
  poiDragReadout.style.cssText = [
    'display:none',
    'position:absolute',
    'left:50%',
    'bottom:10px',
    'transform:translateX(-50%)',
    'max-width:min(640px,calc(100% - 20px))',
    'z-index:6',
    'padding:10px 14px',
    'border-radius:12px',
    'background:rgba(15,23,42,0.92)',
    'border:1px solid rgba(147,197,253,0.35)',
    'box-shadow:0 8px 32px rgba(0,0,0,0.35)',
    'backdrop-filter:blur(8px)',
    'pointer-events:none',
    'text-align:left',
    'color:#e2e8f0',
  ].join(';');
  mapWrap.appendChild(poiDragReadout);

  function fmtCoord(n) {
    if (n == null) return '—';
    return typeof n === 'number' && Number.isFinite(n) ? n.toFixed(4) : '—';
  }

  function hidePoiDragReadout() {
    poiDragReadout.style.display = 'none';
    poiDragReadout.textContent = '';
  }

  const mapPlaceholder = document.createElement('p');
  mapPlaceholder.style.cssText =
    'margin:0;padding:12px;font:11px/1.45 system-ui,sans-serif;color:#94a3b8;text-align:center;';
  mapPlaceholder.textContent = 'Paste Model API GraphQL JSON (GraphiQL), then Load JSON.';

  const mapStage = document.createElement('div');
  mapStage.style.cssText =
    'flex:1;min-height:0;display:flex;align-items:center;justify-content:center;overflow:hidden;padding:4px;position:relative;user-select:none;-webkit-user-select:none;';
  mapStage.append(mapPlaceholder, mapWrap);
  mapWrap.style.display = 'none';

  const mapColumn = document.createElement('div');
  mapColumn.style.cssText = 'display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;height:100%;';

  const pasteJson = document.createElement('textarea');
  pasteJson.spellcheck = false;
  pasteJson.placeholder = 'Paste full GraphiQL result: { "data": { "model": … } }';
  pasteJson.style.cssText =
    'width:100%;min-height:72px;resize:vertical;font:11px/1.35 ui-monospace,monospace;border-radius:6px;border:1px solid #2a3142;background:#0f1218;color:#e8eaef;padding:6px 8px;box-sizing:border-box;';

  const btnLoadJson = document.createElement('button');
  btnLoadJson.type = 'button';
  btnLoadJson.textContent = 'Load JSON';
  btnLoadJson.style.cssText =
    'width:100%;margin-top:8px;padding:8px;border:none;border-radius:6px;background:#5b9fd4;color:#0a0c10;font:600 12px system-ui,sans-serif;cursor:pointer;';

  const floorSelect = document.createElement('select');
  floorSelect.style.cssText =
    'width:100%;margin-top:4px;padding:6px 8px;border-radius:6px;border:1px solid #2a3142;background:#0f1218;color:#e8eaef;font:inherit;';
  const floorOpt0 = document.createElement('option');
  floorOpt0.value = '';
  floorOpt0.textContent = '— Load JSON first —';
  floorSelect.appendChild(floorOpt0);
  floorSelect.disabled = true;

  const tabRow = document.createElement('div');
  tabRow.style.cssText = 'display:flex;gap:4px;margin-top:10px;flex-wrap:wrap;';
  const tabMap = document.createElement('button');
  tabMap.type = 'button';
  tabMap.textContent = 'Minimap';
  const tabJson = document.createElement('button');
  tabJson.type = 'button';
  tabJson.textContent = 'JSON';
  const tabBase =
    'flex:1;min-width:72px;margin:0;padding:6px 8px;border-radius:6px;font:500 11px system-ui,sans-serif;cursor:pointer;';
  tabMap.style.cssText = tabBase + 'background:#171b24;color:#e8eaef;border:1px solid #5b9fd4;';
  tabJson.style.cssText = tabBase + 'background:#171b24;color:#e8eaef;border:1px solid #2a3142;';

  const rawJson = document.createElement('pre');
  rawJson.style.cssText =
    'display:none;margin:8px 0 0;font:10px/1.35 ui-monospace,monospace;overflow:auto;max-height:36vh;padding:8px;background:#171b24;border:1px solid #2a3142;border-radius:8px;color:#cbd5e1;';
  rawJson.textContent = '{}';

  const lblModelId = document.createElement('label');
  lblModelId.textContent = 'Model / map ID';
  lblModelId.style.cssText =
    'display:block;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:#8b93a7;margin:10px 0 4px;';
  const modelIdInput = document.createElement('input');
  modelIdInput.type = 'text';
  modelIdInput.readOnly = true;
  modelIdInput.placeholder = 'Loads after “Load JSON”';
  modelIdInput.setAttribute('aria-label', 'Matterport model id from loaded JSON');
  modelIdInput.style.cssText =
    'box-sizing:border-box;width:100%;margin:0;padding:8px 10px;background:#0f1218;border-radius:6px;border:1px solid #5b9fd4;font:12px ui-monospace,monospace;color:#e8eaef;';
  modelIdInput.value = '';

  function formatProxyErrorForUser(raw) {
    const s = raw.trim();
    if (s.indexOf('<!DOCTYPE') !== -1 || s.indexOf('<HTML') !== -1 || s.indexOf('<html') !== -1) {
      if (/403|could not be satisfied|cloudfront|ERROR: The request could not be satisfied/i.test(s)) {
        return '403 / blocked (HTML from CDN or proxy). Use a working floorplan POST proxy and fresh signed URLs from GraphiQL.';
      }
      return 'Unexpected HTML instead of image — check proxy URL and URL expiry.';
    }
    return s.length > 220 ? s.slice(0, 220) + '…' : s;
  }

  function selectTab(which) {
    const isMap = which === 'map';
    tabMap.style.borderColor = isMap ? '#5b9fd4' : '#2a3142';
    tabMap.style.color = isMap ? '#5b9fd4' : '#e8eaef';
    tabJson.style.borderColor = !isMap ? '#5b9fd4' : '#2a3142';
    tabJson.style.color = !isMap ? '#5b9fd4' : '#e8eaef';
    mapStage.style.display = isMap ? 'flex' : 'none';
    rawJson.style.display = isMap ? 'none' : 'block';
  }
  tabMap.addEventListener('click', () => selectTab('map'));
  tabJson.addEventListener('click', () => selectTab('json'));

  const lblJson = document.createElement('label');
  lblJson.textContent = 'JSON';
  lblJson.style.cssText =
    'display:block;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:#8b93a7;margin:0 0 4px;';

  const lblFloor = document.createElement('label');
  lblFloor.textContent = 'Floor';
  lblFloor.style.cssText =
    'display:block;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:#8b93a7;margin-top:8px;';

  const hint = document.createElement('p');
  hint.style.cssText = 'margin:6px 0 0;font:10px/1.4 system-ui,sans-serif;color:#8b93a7;';
  hint.innerHTML =
    showNavigationRoute && matterportWithNav
      ? 'Solid-color <code style="font-size:10px">colorplan</code> JPG. Route uses globals / waypoints when enabled.'
      : 'Solid-color <code style="font-size:10px">colorplan</code> JPG. Drag POIs by the crosshair handles. Signed URLs expire — refresh JSON when needed.';

  let manualDestinationOverride = null;

  function getDestinationForRoute() {
    if (manualDestinationOverride) {
      return {
        ...manualDestinationOverride,
        source: 'global',
        mpNavApplyApiAxisSwap: true,
      };
    }
    return readActiveMini3dDestination(routeDestFallback);
  }

  function publishMpRoutePathToWindow(path, valid) {
    if (typeof window === 'undefined') return;
    if (valid && path && path.length >= 2) {
      window.__mini3dRoutePath = path.map((p) => ({ x: p.x, y: p.y, z: p.z }));
    } else {
      delete window.__mini3dRoutePath;
    }
  }

  function appendSvgDestinationPin(parent, u, v, floorW, title) {
    const scale = Math.max(0.85, Math.min(2.4, floorW / 380));
    const gPin = document.createElementNS(SVG_NS, 'g');
    gPin.setAttribute('data-navme', 'destination-pin');
    gPin.setAttribute('transform', `translate(${u}, ${v}) scale(${scale})`);
    gPin.style.pointerEvents = 'auto';
    const pathEl = document.createElementNS(SVG_NS, 'path');
    pathEl.setAttribute(
      'd',
      'M0 0 C-8.5 0-14-7-14-15.5 C-14-26-7.5-33 0-34 C7.5-33 14-26 14-15.5 C14-7 8.5 0 0 0 Z',
    );
    pathEl.setAttribute('fill', '#ff3355');
    pathEl.setAttribute('stroke', '#1a0508');
    pathEl.setAttribute('stroke-width', '1.35');
    pathEl.setAttribute('stroke-linejoin', 'round');
    const hole = document.createElementNS(SVG_NS, 'circle');
    hole.setAttribute('cx', '0');
    hole.setAttribute('cy', '-18');
    hole.setAttribute('r', '4');
    hole.setAttribute('fill', '#fff8f8');
    gPin.appendChild(pathEl);
    gPin.appendChild(hole);
    const tt = document.createElementNS(SVG_NS, 'title');
    tt.textContent = title;
    gPin.appendChild(tt);
    parent.appendChild(gPin);
  }

  function appendSvgOriginDot(parent, u, v, floorW, title) {
    const r = Math.max(5, floorW / 100);
    const g0 = document.createElementNS(SVG_NS, 'g');
    g0.setAttribute('data-navme', 'origin-marker');
    const ring = document.createElementNS(SVG_NS, 'circle');
    ring.setAttribute('cx', String(u));
    ring.setAttribute('cy', String(v));
    ring.setAttribute('r', String(r + 2));
    ring.setAttribute('fill', 'rgba(0,0,0,0.35)');
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('cx', String(u));
    c.setAttribute('cy', String(v));
    c.setAttribute('r', String(r));
    c.setAttribute('fill', '#22f396');
    c.setAttribute('stroke', '#0a0c10');
    c.setAttribute('stroke-width', String(Math.max(1, floorW / 500)));
    const tt = document.createElementNS(SVG_NS, 'title');
    tt.textContent = title;
    g0.appendChild(ring);
    g0.appendChild(c);
    g0.appendChild(tt);
    parent.appendChild(g0);
  }

  let lastMpPathState = {
    pathPoints: [],
    valid: false,
    error: null,
  };

  function appendMatterportStraightRouteOverlay(fp, _floorId, useSdk) {
    if (!matterportWithNav || !fpImg.naturalWidth) return;

    const w = fpImg.naturalWidth;
    const destState = getDestinationForRoute();
    const dest = new THREE.Vector3(destState.x, destState.y, destState.z);

    let destApi;
    if (destState.mpNavApplyApiAxisSwap === true) {
      destApi = mattercraftGlobalsToMatterportApi(dest.x, dest.y, dest.z);
    } else if (useSdk) {
      destApi = mpApiToSdk(dest.x, dest.y, dest.z);
    } else {
      destApi = { x: dest.x, y: dest.y, z: dest.z };
    }

    const uvD = mpProjectToFloorplan(destApi.x, destApi.y, fp);

    const destTitle =
      destState.mpNavApplyApiAxisSwap === true
        ? `Destination (globals): X ${dest.x.toFixed(4)} Y ${dest.y.toFixed(4)} Z ${dest.z.toFixed(4)} → MP (${destApi.x.toFixed(4)}, ${destApi.y.toFixed(4)}, ${destApi.z.toFixed(4)})`
        : `Destination (API): X ${dest.x.toFixed(4)} Y ${dest.y.toFixed(4)} Z ${dest.z.toFixed(4)}`;

    const gRoute = document.createElementNS(SVG_NS, 'g');

    if (!uvD) {
      lastMpPathState = {
        pathPoints: [],
        valid: false,
        error: 'Cannot project destination on floorplan (check map code / floor)',
      };
      publishMpRoutePathToWindow(null, false);
      gRoute.setAttribute('data-navme', 'route-error');
      overlay.appendChild(gRoute);
      return;
    }

    const waypoints = readMini3dRouteWaypointsFromWindow();
    const routeUvs = [];
    if (waypoints) {
      const axes = getNavGlbHorizontalAxes();
      const mpHoriz = applyGlbRouteToMatterportHorizontal(waypoints, destApi, axes);
      for (const mp of mpHoriz) {
        const uv = mpProjectToFloorplan(mp.x, mp.y, fp);
        if (uv) routeUvs.push(uv);
      }
      if (routeUvs.length >= 1) {
        routeUvs[routeUvs.length - 1] = { u: uvD.u, v: uvD.v };
      }
    }

    const usePolyline = routeUvs.length >= 2;

    if (usePolyline) {
      gRoute.setAttribute('data-navme', 'nav-route-polyline');
      const pts = routeUvs.map((p) => `${p.u},${p.v}`).join(' ');

      const polyShadow = document.createElementNS(SVG_NS, 'polyline');
      polyShadow.setAttribute('points', pts);
      polyShadow.setAttribute('fill', 'none');
      polyShadow.setAttribute('stroke', '#ffffff');
      polyShadow.setAttribute('stroke-width', String(Math.max(5, w / 55)));
      polyShadow.setAttribute('stroke-linecap', 'round');
      polyShadow.setAttribute('stroke-linejoin', 'round');
      polyShadow.setAttribute('opacity', '0.9');
      gRoute.appendChild(polyShadow);

      const poly = document.createElementNS(SVG_NS, 'polyline');
      poly.setAttribute('points', pts);
      poly.setAttribute('fill', 'none');
      poly.setAttribute('stroke', '#ff1744');
      poly.setAttribute('stroke-width', String(Math.max(3, w / 90)));
      poly.setAttribute('stroke-linecap', 'round');
      poly.setAttribute('stroke-linejoin', 'round');
      gRoute.appendChild(poly);

      appendSvgOriginDot(gRoute, routeUvs[0].u, routeUvs[0].v, w, 'Start: navigation route');
      appendSvgDestinationPin(gRoute, uvD.u, uvD.v, w, destTitle);

      const pathPoints = waypoints.map((p) => new THREE.Vector3(p.x, p.y, p.z));
      pathPoints[pathPoints.length - 1] = new THREE.Vector3(destApi.x, destApi.y, destApi.z);
      lastMpPathState = {
        pathPoints: pathPoints.map((p) => p.clone()),
        valid: true,
        error: null,
      };
      publishMpRoutePathToWindow(pathPoints, true);
      overlay.appendChild(gRoute);
      return;
    }

    gRoute.setAttribute('data-navme', 'straight-route');

    const uvO = mpProjectToFloorplan(0, 0, fp);
    if (!uvO) {
      lastMpPathState = {
        pathPoints: [],
        valid: false,
        error: 'Cannot project origin on floorplan (check map code / floor)',
      };
      publishMpRoutePathToWindow(null, false);
      overlay.appendChild(gRoute);
      return;
    }

    const lineShadow = document.createElementNS(SVG_NS, 'line');
    lineShadow.setAttribute('x1', String(uvO.u));
    lineShadow.setAttribute('y1', String(uvO.v));
    lineShadow.setAttribute('x2', String(uvD.u));
    lineShadow.setAttribute('y2', String(uvD.v));
    lineShadow.setAttribute('stroke', '#ffffff');
    lineShadow.setAttribute('stroke-width', String(Math.max(5, w / 55)));
    lineShadow.setAttribute('stroke-linecap', 'round');
    lineShadow.setAttribute('opacity', '0.9');
    gRoute.appendChild(lineShadow);

    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', String(uvO.u));
    line.setAttribute('y1', String(uvO.v));
    line.setAttribute('x2', String(uvD.u));
    line.setAttribute('y2', String(uvD.v));
    line.setAttribute('stroke', '#ff1744');
    line.setAttribute('stroke-width', String(Math.max(3, w / 90)));
    line.setAttribute('stroke-linecap', 'round');
    gRoute.appendChild(line);

    appendSvgOriginDot(gRoute, uvO.u, uvO.v, w, 'Start: world origin 0, 0, 0');
    appendSvgDestinationPin(gRoute, uvD.u, uvD.v, w, destTitle);

    const pathOrigin = new THREE.Vector3(0, 0, 0);
    const pathDest = new THREE.Vector3(destApi.x, destApi.y, destApi.z);
    lastMpPathState = {
      pathPoints: [pathOrigin.clone(), pathDest.clone()],
      valid: true,
      error: null,
    };
    publishMpRoutePathToWindow([pathOrigin, pathDest], true);
    overlay.appendChild(gRoute);
  }

  sidePanel = document.createElement('div');
  sidePanel.style.cssText =
    'display:none;flex:0 0 min(280px,36%);min-width:200px;max-width:320px;padding:10px 12px;overflow:auto;border-right:1px solid rgba(148,163,184,0.2);background:rgba(15,23,42,0.55);box-sizing:border-box;';
  tabRow.append(tabMap, tabJson);
  tabRow.style.display = 'none';
  rawJson.style.flex = '1';
  rawJson.style.minHeight = '0';
  rawJson.style.marginTop = '8px';
  mapColumn.append(tabRow, mapStage, rawJson);

  sidePanel.append(lblJson, pasteJson, btnLoadJson, lblModelId, modelIdInput, lblFloor, floorSelect, hint);

  let lastFloorplans = [];
  let lastLocations = [];
  let lastFloorplan = null;
  let floorplanBlobUrl = null;
  let lastModel = null;
  let disposed = false;

  /**
   * @param {string} [floorId]
   * @returns {{ sweepX: number|null, sweepY: number|null, sweepZ: number|null, sweepLabel: string }}
   */
  function matterportNearestSweepPosition(floorId, planX, planY) {
    if (planX == null || planY == null || !Number.isFinite(planX) || !Number.isFinite(planY)) {
      return { sweepX: null, sweepY: null, sweepZ: null, sweepLabel: '' };
    }
    const locs = lastLocations.filter((l) => !floorId || l.floor?.id === floorId);
    let best = null;
    let bestD = Infinity;
    for (const loc of locs) {
      const p = loc.position;
      if (!p || p.x == null || p.y == null) continue;
      const dx = Number(p.x) - planX;
      const dy = Number(p.y) - planY;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = loc;
      }
    }
    if (!best?.position) {
      return { sweepX: null, sweepY: null, sweepZ: null, sweepLabel: '' };
    }
    const p = best.position;
    const sx = Number(p.x);
    const sy = Number(p.y);
    const sz = p.z != null ? Number(p.z) : NaN;
    const sweepLabel = String(best.label ?? best.id ?? '').trim();
    return {
      sweepX: Number.isFinite(sx) ? sx : null,
      sweepY: Number.isFinite(sy) ? sy : null,
      sweepZ: Number.isFinite(sz) ? sz : null,
      sweepLabel,
    };
  }

  /**
   * Floor plan: horizontal (px, py) from colorplan (MP.x, MP.z). Nearest sweep: Matterport API (x,y,z).
   * POIs use MP→MS x=x, y=y, z=−z via floor bridge.
   */
  function showPoiDragReadoutDual(mpX, mpY, msX, msY, msZ, floorId) {
    const sw = matterportNearestSweepPosition(floorId, mpX, mpY);
    const sweepHint = sw.sweepLabel ? ` (sweep ${sw.sweepLabel})` : '';

    poiDragReadout.innerHTML = [
      '<div style="font:600 10px/1.2 system-ui,sans-serif;letter-spacing:0.06em;text-transform:uppercase;color:#93c5fd;margin-bottom:6px;">Live coordinates</div>',
      '<div style="font:11px/1.5 ui-monospace,monospace;margin-bottom:4px;">',
      '<span style="color:#a5b4fc;">Matterport</span> (floor plan) ',
      'x&nbsp;', fmtCoord(mpX),
      ' &nbsp; y&nbsp;', fmtCoord(mpY),
      '</div>',
      '<div style="font:11px/1.5 ui-monospace,monospace;margin-bottom:4px;">',
      '<span style="color:#a5b4fc;">Matterport</span> (nearest sweep 3D)',
      sweepHint,
      ' &nbsp; x&nbsp;', fmtCoord(sw.sweepX),
      ' &nbsp; y&nbsp;', fmtCoord(sw.sweepY),
      ' &nbsp; z&nbsp;', fmtCoord(sw.sweepZ),
      '</div>',
      '<div style="font:11px/1.5 ui-monospace,monospace;">',
      '<span style="color:#f9a8d4;">MultiSet</span> (VPS) ',
      'x&nbsp;', fmtCoord(msX),
      ' &nbsp; y&nbsp;', fmtCoord(msY),
      ' &nbsp; z&nbsp;', fmtCoord(msZ),
      '</div>',
      '<div style="font:10px/1.35 system-ui,sans-serif;color:#94a3b8;margin-top:6px;">',
      'Floor plan: MP.x / MP.z ↔ MS.x / MS.z (z=−z rule). Nearest sweep shows Matterport model x,y,z (API). ',
      '2D drag updates MS.x/MS.z; MS.y fixed for that drag.',
      '</div>',
    ].join('');
    poiDragReadout.style.display = 'block';
  }

  function revokeFloorplanBlob() {
    if (floorplanBlobUrl) {
      URL.revokeObjectURL(floorplanBlobUrl);
      floorplanBlobUrl = null;
    }
  }

  function setNotify(phase, message, level = 'loading') {
    uiPhase.textContent = phase;
    uiStatus.textContent = message;
    applyNotifyVisual(uiNotify, level);
    if (level === 'loading') uiPhase.style.color = '#fbbf24';
    else if (level === 'done') uiPhase.style.color = '#34d399';
    else uiPhase.style.color = '#fb7185';
    if (updateDocumentTitle) {
      const title = matterportTitle;
      if (level === 'loading') document.title = `${phase} — ${title}`;
      else if (level === 'done') document.title = `${title} — ready`;
      else document.title = `${title} — error`;
    }
  }

  function renderCoordsLine(model, fp) {
    uiCoordsMode.textContent = 'Matterport';
    if (!model?.id) {
      uiCoordsValue.textContent = 'Paste JSON to load model.';
      return;
    }
    const vu = fp?.validUntil ? ` · url valid until ${fp.validUntil}` : '';
    uiCoordsValue.textContent = `${model.name || model.id}${fp ? ` · ${fp.width}×${fp.height}px` : ''}${vu}`;
  }

  function drawOverlay(fp, floorId, useSdk) {
    while (overlay.firstChild) overlay.removeChild(overlay.firstChild);
    if (!fp?.url || !fpImg.naturalWidth) {
      return;
    }

    const w = fpImg.naturalWidth;
    const h = fpImg.naturalHeight;
    overlay.setAttribute('viewBox', `0 0 ${w} ${h}`);
    overlay.setAttribute('width', '100%');
    overlay.setAttribute('height', '100%');
    overlay.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    const hitBlock = document.createElementNS(SVG_NS, 'rect');
    hitBlock.setAttribute('width', String(w));
    hitBlock.setAttribute('height', String(h));
    hitBlock.setAttribute('fill', 'transparent');
    hitBlock.setAttribute('pointer-events', 'all');
    hitBlock.style.cursor = 'default';
    overlay.appendChild(hitBlock);

    if (showMatterportSweepDots) {
    const locs = lastLocations.filter((l) => !floorId || l.floor?.id === floorId);
    for (const loc of locs) {
      const p = loc.position;
      if (!p || p.x == null || p.y == null || p.z == null) continue;
      let px = p.x;
      let py = p.y;
      if (useSdk) {
        const s = mpApiToSdk(p.x, p.y, p.z);
        px = s.x;
        py = s.y;
      }
      const uv = mpProjectToFloorplan(px, py, fp);
      if (!uv) continue;
      const labelStr = String(loc.label ?? '').trim();
      const isZeroSweep = labelStr === '0' || labelStr === '000';
      const c = document.createElementNS(SVG_NS, 'circle');
      c.setAttribute('cx', String(uv.u));
      c.setAttribute('cy', String(uv.v));
      c.setAttribute('r', String(Math.max(3, w / 200)));
      c.setAttribute('fill', isZeroSweep ? 'rgba(220, 65, 65, 0.95)' : 'rgba(91, 159, 212, 0.85)');
      c.setAttribute('stroke', isZeroSweep ? '#3b1010' : '#0a0c10');
      c.setAttribute('stroke-width', String(Math.max(1, w / 500)));
      c.style.cursor = 'help';
      c.style.pointerEvents = 'auto';
      const title = document.createElementNS(SVG_NS, 'title');
      const xf = (n) => (typeof n === 'number' && Number.isFinite(n) ? n.toFixed(4) : '?');
      title.textContent = `x=${xf(p.x)} y=${xf(p.y)} z=${xf(p.z)}`;
      c.appendChild(title);
      overlay.appendChild(c);
    }
    }
    if (matterportWithNav && showNavigationRoute) {
      appendMatterportStraightRouteOverlay(fp, floorId, useSdk);
    }
    appendPoiMarkersLayer(fp, floorId);
  }

  /**
   * POIs: MultiSet Y-up. Colorplan (px,py) as MP.x/MP.z ↔ MS (x,z) via {@link matterportFloorFromMultiset} /
   * {@link multisetFromMatterportFloor} (MP→MS: x=x, y=y, z=−z on horizontal). MS.y unchanged during floor drag.
   */
  function appendPoiMarkersLayer(fp, floorId) {
    if (!poiBridge?.getPois || !poiBridge?.onPoiPositionChange) return;
    const floorIdForPoi = floorId != null ? String(floorId) : '';
    let list;
    try {
      list = poiBridge.getPois();
    } catch {
      return;
    }
    if (!Array.isArray(list) || list.length === 0) return;

    const w = fpImg.naturalWidth;
    const h = fpImg.naturalHeight;
    const groupWrap = document.createElementNS(SVG_NS, 'g');
    groupWrap.setAttribute('data-spacecheck-poi-layer', '1');

    for (const poi of list) {
      const ix = poi.index;
      if (typeof ix !== 'number' || ix < 0) continue;
      const sx = Number(poi.x);
      const sy = Number(poi.y);
      const sz = Number(poi.z);
      if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(sz)) continue;
      const mpH = matterportFloorFromMultiset(sx, sz);
      const uv = mpProjectToFloorplan(mpH.px, mpH.py, fp);
      if (!uv) continue;

      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('data-poi-index', String(ix));
      g.setAttribute('data-spacecheck-poi-handle', '1');
      g.style.pointerEvents = 'auto';
      g.style.cursor = 'grab';

      const rad = Math.max(6, w / 140);
      const rayLen = Math.max(28, Math.min(w / 16, h / 16));
      const strokeW = Math.max(2, w / 450);

      const lineH = document.createElementNS(SVG_NS, 'line');
      lineH.setAttribute('stroke', 'rgba(255, 255, 255, 0.95)');
      lineH.setAttribute('stroke-width', String(strokeW));
      lineH.setAttribute('stroke-linecap', 'round');
      lineH.setAttribute('pointer-events', 'stroke');

      const lineV = document.createElementNS(SVG_NS, 'line');
      lineV.setAttribute('stroke', 'rgba(255, 0, 170, 0.95)');
      lineV.setAttribute('stroke-width', String(strokeW));
      lineV.setAttribute('stroke-linecap', 'round');
      lineV.setAttribute('pointer-events', 'stroke');

      const circle = document.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('cx', String(uv.u));
      circle.setAttribute('cy', String(uv.v));
      circle.setAttribute('r', String(rad));
      circle.setAttribute('fill', 'rgba(255, 0, 170, 0.92)');
      circle.setAttribute('stroke', '#ffffff');
      circle.setAttribute('stroke-width', String(Math.max(1.5, w / 380)));

      const poiNameLabel = document.createElementNS(SVG_NS, 'text');
      const nameFs = Math.max(11, w / 52);
      poiNameLabel.setAttribute('fill', 'rgba(255, 255, 255, 0.98)');
      poiNameLabel.setAttribute('font-size', String(nameFs));
      poiNameLabel.setAttribute('font-family', 'system-ui, -apple-system, Segoe UI, sans-serif');
      poiNameLabel.setAttribute('font-weight', '600');
      poiNameLabel.setAttribute('text-anchor', 'middle');
      poiNameLabel.setAttribute('pointer-events', 'none');
      poiNameLabel.textContent = String(poi.label ?? '').trim() || 'POI';

      const msLabel = document.createElementNS(SVG_NS, 'text');
      msLabel.setAttribute('fill', 'rgba(255, 255, 255, 0.92)');
      msLabel.setAttribute('font-size', String(Math.max(9, w / 65)));
      msLabel.setAttribute('font-family', 'ui-monospace, monospace');
      msLabel.setAttribute('text-anchor', 'middle');
      msLabel.setAttribute('pointer-events', 'none');

      function formatMsTriple(x, y, z) {
        const fx = typeof x === 'number' && Number.isFinite(x) ? x.toFixed(2) : '?';
        const fy = typeof y === 'number' && Number.isFinite(y) ? y.toFixed(2) : '?';
        const fz = typeof z === 'number' && Number.isFinite(z) ? z.toFixed(2) : '?';
        return `MS x ${fx}  y ${fy}  z ${fz}`;
      }

      function applyPoiHandleAt(u0, v0, lx, ly, lz) {
        lineH.setAttribute('x1', String(u0 - rayLen));
        lineH.setAttribute('y1', String(v0));
        lineH.setAttribute('x2', String(u0 + rayLen));
        lineH.setAttribute('y2', String(v0));
        lineV.setAttribute('x1', String(u0));
        lineV.setAttribute('y1', String(v0 - rayLen));
        lineV.setAttribute('x2', String(u0));
        lineV.setAttribute('y2', String(v0 + rayLen));
        circle.setAttribute('cx', String(u0));
        circle.setAttribute('cy', String(v0));
        const fs = Math.max(9, w / 65);
        const dy = rad + fs + 6;
        poiNameLabel.setAttribute('x', String(u0));
        poiNameLabel.setAttribute('y', String(v0 - rad - nameFs * 0.35));
        msLabel.setAttribute('x', String(u0));
        msLabel.setAttribute('y', String(v0 + dy));
        msLabel.textContent = formatMsTriple(lx, ly, lz);
      }
      applyPoiHandleAt(uv.u, uv.v, sx, sy, sz);

      const hitPad = document.createElementNS(SVG_NS, 'circle');
      hitPad.setAttribute('cx', String(uv.u));
      hitPad.setAttribute('cy', String(uv.v));
      hitPad.setAttribute('r', String(rad * 3.2));
      hitPad.setAttribute('fill', 'transparent');
      hitPad.setAttribute('pointer-events', 'all');

      const title = document.createElementNS(SVG_NS, 'title');
      title.textContent = `${poi.label || 'POI'} — MultiSet (${sx.toFixed(2)}, ${sy.toFixed(2)}, ${sz.toFixed(2)}) · MP→MS x=x,y=y,z=−z; drag updates MS.x/MS.z, MS.y fixed`;
      g.appendChild(lineH);
      g.appendChild(lineV);
      g.appendChild(hitPad);
      g.appendChild(circle);
      g.appendChild(poiNameLabel);
      g.appendChild(msLabel);
      g.appendChild(title);

      g.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        g.setPointerCapture(e.pointerId);
        const invStart = mpInverseToFloorplanWorld(uv.u, uv.v, fp);
        const yDragLocked = sy;
        showPoiDragReadoutDual(
          invStart ? invStart.px : null,
          invStart ? invStart.py : null,
          sx,
          sy,
          sz,
          floorIdForPoi,
        );

        const onMove = (ev) => {
          const pt = clientPointToSvgUser(overlay, ev.clientX, ev.clientY);
          if (!pt) return;
          const u = Math.max(0, Math.min(w, pt.x));
          const vTop = Math.max(0, Math.min(h, pt.y));
          const inv = mpInverseToFloorplanWorld(u, vTop, fp);
          if (!inv) return;
          const newMs = multisetFromMatterportFloor(inv.px, inv.py, yDragLocked);
          poiBridge.onPoiPositionChange(ix, newMs.x, newMs.y, newMs.z);
          showPoiDragReadoutDual(inv.px, inv.py, newMs.x, newMs.y, newMs.z, floorIdForPoi);
          const mpN = matterportFloorFromMultiset(newMs.x, newMs.z);
          const nuv = mpProjectToFloorplan(mpN.px, mpN.py, fp);
          if (nuv) {
            applyPoiHandleAt(nuv.u, nuv.v, newMs.x, newMs.y, newMs.z);
            hitPad.setAttribute('cx', String(nuv.u));
            hitPad.setAttribute('cy', String(nuv.v));
          }
        };

        const onUp = (ev) => {
          g.removeEventListener('pointermove', onMove);
          g.removeEventListener('pointerup', onUp);
          g.removeEventListener('pointercancel', onUp);
          try {
            g.releasePointerCapture(ev.pointerId);
          } catch {
            /* */
          }
          hidePoiDragReadout();
          poiBridge.onPoiDragEnd?.(ix);
        };

        g.addEventListener('pointermove', onMove);
        g.addEventListener('pointerup', onUp);
        g.addEventListener('pointercancel', onUp);
      });

      groupWrap.appendChild(g);
    }

    overlay.appendChild(groupWrap);
  }

  function rebuildFloorSelect(floors, floorplans) {
    floorSelect.innerHTML = '';
    const idsWithFp = new Set(floorplans.map((f) => f.floor?.id).filter(Boolean));
    const opts = [];
    for (const f of floors || []) {
      if (!f.id) continue;
      const o = document.createElement('option');
      o.value = f.id;
      o.textContent = (f.label || f.id) + (idsWithFp.has(f.id) ? '' : ' (no floorplan)');
      opts.push(o);
    }
    if (!opts.length) {
      const o = document.createElement('option');
      o.value = '';
      o.textContent = '— No floors —';
      floorSelect.appendChild(o);
      floorSelect.disabled = true;
      return;
    }
    opts.forEach((o) => floorSelect.appendChild(o));
    floorSelect.disabled = false;
    const firstWith = opts.find((o) => idsWithFp.has(o.value));
    floorSelect.value = (firstWith || opts[0]).value;
  }

  function showFloorplanForSelection() {
    const floorId = floorSelect.value;
    const fp = floorId ? mpPickSolidColorFloorplanForFloor(floorId, lastFloorplans) : null;
    lastFloorplan = fp;
    if (!fp || !fp.url) {
      mapWrap.style.display = 'none';
      mapPlaceholder.style.display = 'block';
      mapPlaceholder.textContent =
        'No solid-color floorplan for this floor — check photogrammetry add-on or pick another floor.';
      renderCoordsLine(lastModel, null);
      return;
    }
    mapPlaceholder.style.display = 'none';
    mapWrap.style.display = 'inline-block';
    revokeFloorplanBlob();
    fpImg.removeAttribute('crossorigin');
    fpImg.referrerPolicy = 'no-referrer';

    if (fp.validUntil) {
      const exp = Date.parse(fp.validUntil);
      if (!Number.isNaN(exp) && Date.now() > exp) {
        setNotify(
          'Expired URL',
          `Floorplan url expired (${fp.validUntil}). Run the query again in GraphiQL and paste fresh JSON.`,
          'error',
        );
      }
    }

    const fpUrl = fp.url;
    const useSdk = false;
    const afterPaint = () => drawOverlay(fp, floorId, useSdk);

    fpImg.onload = () => {
      setNotify('', '', 'done');
      afterPaint();
      renderCoordsLine(lastModel, fp);
    };
    fpImg.onerror = async () => {
      if (window.location.protocol === 'file:') {
        setNotify(
          'file://',
          'Open via http(s) so the floorplan proxy can run; file:// blocks fetches.',
          'error',
        );
        return;
      }
      try {
        const r = await fetch(floorplanProxyUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: fpUrl }),
        });
        const ct = (r.headers.get('content-type') || '').toLowerCase();
        if (!r.ok || ct.indexOf('application/json') !== -1) {
          const t = await r.text();
          let detail = t.slice(0, 280);
          try {
            const j = JSON.parse(t);
            if (j.error) detail = j.error;
          } catch {
            /* keep */
          }
          throw new Error(detail);
        }
        const blob = await r.blob();
        revokeFloorplanBlob();
        floorplanBlobUrl = URL.createObjectURL(blob);
        fpImg.onload = () => {
          setNotify('Proxy', 'Loaded floorplan via proxy.', 'done');
          afterPaint();
          renderCoordsLine(lastModel, fp);
        };
        fpImg.onerror = () => {
          setNotify('Error', 'Blob URL failed. Paste fresh JSON if validUntil passed.', 'error');
        };
        fpImg.src = floorplanBlobUrl;
      } catch (e) {
        const net = String(e instanceof Error ? e.message : e);
        const short = formatProxyErrorForUser(net);
        let msg =
          net.indexOf('Failed to fetch') !== -1 ? `Cannot reach ${floorplanProxyUrl}. ` : `Proxy: ${short} `;
        msg += 'Use your deployed proxy or paste fresh signed URLs from GraphiQL.';
        setNotify('Floorplan', msg, 'error');
      }
    };
    fpImg.src = fpUrl;
  }

  function applyModelFromGraphQLResponse(json) {
    rawJson.textContent = JSON.stringify(json, null, 2);

    if (json.errors?.length) {
      setNotify('GraphQL', json.errors.map((e) => e.message).join(' · '), 'error');
    }

    const model = json.data?.model;
    if (!model) {
      lastModel = null;
      modelIdInput.value = '';
      mapWrap.style.display = 'none';
      mapPlaceholder.style.display = 'block';
      if (!json.errors?.length) {
        setNotify('JSON', 'No data.model in JSON — paste the full GraphQL response.', 'error');
      }
      return;
    }

    lastModel = model;
    modelIdInput.value = model.id || '';
    lastFloorplans = model.assets?.floorplans || [];
    lastLocations = model.locations || [];
    rebuildFloorSelect(model.floors, lastFloorplans);
    showFloorplanForSelection();
    if (!json.errors?.length) {
      setNotify(
        'Ready',
        matterportWithNav
          ? 'Matterport loaded. Route: line from 0,0,0 to destination (globalXYZ or default), or waypoints.'
          : 'Matterport minimap loaded.',
        'done',
      );
    }
  }

  floorSelect.addEventListener('change', showFloorplanForSelection);

  btnLoadJson.addEventListener('click', () => {
    const raw = pasteJson.value.trim();
    if (!raw) {
      setNotify('JSON', 'Paste JSON from GraphiQL first.', 'error');
      return;
    }
    try {
      const json = JSON.parse(raw);
      applyModelFromGraphQLResponse(json);
    } catch (e) {
      setNotify('JSON', 'Invalid JSON: ' + (e instanceof Error ? e.message : String(e)), 'error');
    }
  });

  if (useFloatingCircle) {
    mountRoot = document.createElement('div');
    mountRoot.className = 'mini-3dgta-floating-layer';
    mountRoot.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:2147483000',
      'pointer-events:none',
    ].join(';');

    floatingBackdrop = document.createElement('div');
    floatingBackdrop.className = 'mini-3dgta-backdrop';
    floatingBackdrop.style.cssText = [
      'position:absolute',
      'inset:0',
      'background:rgba(2,6,23,0.52)',
      'backdrop-filter:blur(6px)',
      'opacity:0',
      'transition:opacity 220ms ease',
      'pointer-events:none',
    ].join(';');

    floatingShell = document.createElement('div');
    floatingShell.className = 'mini-3dgta-float-shell';
    floatingShell.style.cssText = [
      'position:absolute',
      'left:max(16px,env(safe-area-inset-left,0px))',
      'bottom:max(16px,env(safe-area-inset-bottom,0px))',
      `width:${circleDiameter}px`,
      `height:${circleDiameter}px`,
      'border-radius:50%',
      'overflow:hidden',
      'background:#09111f',
      'pointer-events:auto',
      'cursor:pointer',
      'box-shadow:0 18px 48px rgba(2,6,23,0.52), inset 0 0 0 2px rgba(255,255,255,0.14)',
      'transition:left 320ms cubic-bezier(0.22,1,0.36,1), bottom 320ms cubic-bezier(0.22,1,0.36,1), width 320ms cubic-bezier(0.22,1,0.36,1), height 320ms cubic-bezier(0.22,1,0.36,1), border-radius 320ms cubic-bezier(0.22,1,0.36,1), transform 320ms cubic-bezier(0.22,1,0.36,1), box-shadow 320ms ease',
    ].join(';');
    floatingShell.setAttribute('aria-expanded', 'false');

    viewport = document.createElement('div');
    viewport.className = 'mini-3dgta-viewport';
    viewport.style.cssText = [
      'position:absolute',
      'inset:0',
      'overflow:hidden',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'background:radial-gradient(circle at top, rgba(59,130,246,0.12), rgba(9,17,31,0.96) 66%)',
    ].join(';');
    viewport.appendChild(mapColumn);

    uiNotify.style.cssText = [
      'position:absolute',
      'top:10px',
      'left:10px',
      'right:10px',
      'padding:8px 10px',
      'border-radius:12px',
      'font:10px/1.35 system-ui,sans-serif',
      'color:#e0f2fe',
      'background:linear-gradient(180deg, rgba(15,23,42,0.94), rgba(15,23,42,0.72))',
      'border:1px solid rgba(110,200,255,0.22)',
      'backdrop-filter:blur(10px)',
      'pointer-events:none',
      'transition:right 220ms ease, opacity 220ms ease, transform 220ms ease',
    ].join(';');
    uiPhase.style.cssText =
      'font-size:9px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#fbbf24;margin-bottom:3px;';
    uiStatus.style.fontSize = '10px';

    uiCoords.style.cssText = [
      'position:absolute',
      'left:12px',
      'right:76px',
      'bottom:12px',
      'padding:8px 10px',
      'border-radius:12px',
      'background:rgba(15,23,42,0.72)',
      'border:1px solid rgba(148,163,184,0.24)',
      'backdrop-filter:blur(8px)',
      'color:#f8fafc',
      'pointer-events:none',
      'transition:right 220ms ease, opacity 220ms ease',
    ].join(';');
    uiCoordsMode.style.cssText =
      'font-size:9px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#93c5fd;margin-bottom:2px;';
    uiCoordsValue.style.cssText =
      'font-size:10px;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';

    floatingHint = document.createElement('div');
    floatingHint.className = 'mini-3dgta-expand-hint';
    floatingHint.style.cssText = [
      'position:absolute',
      'right:12px',
      'bottom:12px',
      'display:flex',
      'align-items:center',
      'gap:6px',
      'padding:7px 10px',
      'border-radius:999px',
      'font:600 10px/1 system-ui,sans-serif',
      'letter-spacing:0.06em',
      'text-transform:uppercase',
      'color:#e2e8f0',
      'background:rgba(15,23,42,0.78)',
      'border:1px solid rgba(148,163,184,0.22)',
      'backdrop-filter:blur(10px)',
      'pointer-events:none',
      'transition:opacity 220ms ease, transform 220ms ease',
    ].join(';');
    floatingHint.innerHTML =
      '<span style="display:inline-flex;width:18px;height:18px;align-items:center;justify-content:center;border-radius:999px;background:rgba(96,165,250,0.16);border:1px solid rgba(148,163,184,0.24);"><svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="M2 8L8 2M4 2H8V6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span>Expand</span>';

    floatingCloseButton = document.createElement('button');
    floatingCloseButton.type = 'button';
    floatingCloseButton.textContent = 'Close';
    floatingCloseButton.style.cssText = [
      'position:absolute',
      'top:12px',
      'right:12px',
      'height:34px',
      'padding:0 14px',
      'border:1px solid rgba(248,250,252,0.18)',
      'border-radius:999px',
      'background:rgba(15,23,42,0.88)',
      'color:#f8fafc',
      'font:600 12px/1 system-ui,sans-serif',
      'cursor:pointer',
      'opacity:0',
      'pointer-events:none',
      'transform:translateY(-8px)',
      'transition:opacity 220ms ease, transform 220ms ease',
    ].join(';');

    floatingShell.append(sidePanel, viewport, uiNotify, uiCoords, floatingHint, floatingCloseButton);
    mountRoot.append(floatingBackdrop, floatingShell);
    const floatHost = typeof document !== 'undefined' && document.body ? document.body : container;
    floatHost.appendChild(mountRoot);
  } else {
    mountRoot = document.createElement('div');
    mountRoot.className = 'mini-3dgta-root spacecheck-matterport-root';
    mountRoot.style.cssText =
      'position:relative;width:100%;height:100%;min-height:220px;overflow:hidden;border-radius:12px;background:#0a0a12;display:flex;flex-direction:row;';
    viewport = document.createElement('div');
    viewport.style.cssText = 'position:relative;flex:1;min-width:0;overflow:hidden;display:flex;flex-direction:column;';
    viewport.appendChild(mapColumn);
    tabRow.style.display = 'flex';
    sidePanel.style.display = 'flex';
    sidePanel.style.flexDirection = 'column';
    sidePanel.style.borderRight = '1px solid rgba(148,163,184,0.2)';
    sidePanel.style.borderBottom = 'none';
    sidePanel.style.maxWidth = 'min(320px, 40%)';
    mountRoot.append(sidePanel, viewport);
    uiNotify.style.cssText = NOTIFY_BASE_STYLE;
    uiPhase.style.cssText =
      'font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#fbbf24;margin-bottom:4px;';
    uiCoords.style.cssText = [
      'position:absolute',
      'left:12px',
      'bottom:12px',
      'max-width:calc(100% - 24px)',
      'padding:8px 10px',
      'border-radius:10px',
      'font:11px/1.4 system-ui,sans-serif',
      'color:#f8fafc',
      'background:rgba(15,23,42,0.82)',
      'border:1px solid rgba(148,163,184,0.24)',
      'backdrop-filter:blur(8px)',
      'pointer-events:none',
    ].join(';');
    uiCoordsMode.style.cssText =
      'font-size:9px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#93c5fd;margin-bottom:2px;';
    uiCoordsValue.style.cssText = 'font-size:11px;line-height:1.35;';
    viewport.append(uiNotify, uiCoords);
    container.appendChild(mountRoot);
  }

  renderCoordsLine(null, null);
  selectTab('map');

  function syncFloatingExpandedState() {
    if (!useFloatingCircle || !floatingShell || !floatingBackdrop || !floatingHint || !floatingCloseButton || !sidePanel) {
      return;
    }

    floatingShell.setAttribute('aria-expanded', String(isExpanded));
    floatingShell.setAttribute(
      'aria-label',
      isExpanded ? 'Expanded Matterport minimap' : 'Matterport minimap. Click to expand.',
    );

    if (isExpanded) {
      floatingShell.style.left = '50%';
      floatingShell.style.bottom = '50%';
      floatingShell.style.width = 'min(92vw, 1024px)';
      floatingShell.style.height = 'min(78vh, 720px)';
      floatingShell.style.borderRadius = '20px';
      floatingShell.style.transform = 'translate(-50%, 50%)';
      floatingShell.style.boxShadow =
        '0 40px 120px rgba(2,6,23,0.62), inset 0 0 0 1px rgba(248,250,252,0.08)';
      floatingShell.style.cursor = 'default';
      floatingShell.style.display = 'flex';
      floatingShell.style.flexDirection = 'row';
      floatingBackdrop.style.opacity = '1';
      floatingBackdrop.style.pointerEvents = 'auto';
      floatingHint.style.opacity = '0';
      floatingHint.style.transform = 'translateY(8px)';
      floatingCloseButton.style.opacity = '1';
      floatingCloseButton.style.pointerEvents = 'auto';
      floatingCloseButton.style.transform = 'translateY(0)';
      viewport.style.position = 'relative';
      viewport.style.flex = '1';
      viewport.style.minWidth = '0';
      viewport.style.inset = '';
      viewport.style.width = '';
      viewport.style.height = '100%';
      viewport.style.display = 'flex';
      viewport.style.flexDirection = 'column';
      sidePanel.style.display = 'flex';
      sidePanel.style.flexDirection = 'column';
      tabRow.style.display = 'flex';
      selectTab('map');
      uiNotify.style.right = '58px';
      uiCoords.style.right = '12px';
    } else {
      floatingShell.style.display = 'block';
      floatingShell.style.left = 'max(16px,env(safe-area-inset-left,0px))';
      floatingShell.style.bottom = 'max(16px,env(safe-area-inset-bottom,0px))';
      floatingShell.style.width = `${circleDiameter}px`;
      floatingShell.style.height = `${circleDiameter}px`;
      floatingShell.style.borderRadius = '50%';
      floatingShell.style.transform = 'translate3d(0,0,0)';
      floatingShell.style.boxShadow =
        '0 18px 48px rgba(2,6,23,0.52), inset 0 0 0 2px rgba(255,255,255,0.14)';
      floatingShell.style.cursor = 'pointer';
      floatingBackdrop.style.opacity = '0';
      floatingBackdrop.style.pointerEvents = 'none';
      floatingHint.style.opacity = '1';
      floatingHint.style.transform = 'translateY(0)';
      floatingCloseButton.style.opacity = '0';
      floatingCloseButton.style.pointerEvents = 'none';
      floatingCloseButton.style.transform = 'translateY(-8px)';
      viewport.style.position = 'absolute';
      viewport.style.inset = '0';
      viewport.style.flex = '';
      viewport.style.minWidth = '';
      viewport.style.width = '';
      viewport.style.height = '';
      viewport.style.display = 'flex';
      viewport.style.flexDirection = 'column';
      sidePanel.style.display = 'none';
      tabRow.style.display = 'none';
      mapStage.style.display = 'flex';
      rawJson.style.display = 'none';
      uiNotify.style.right = '10px';
      uiCoords.style.right = '76px';
    }
  }

  function setExpanded(nextExpanded) {
    if (!useFloatingCircle || isExpanded === nextExpanded) return;
    isExpanded = nextExpanded;
    syncFloatingExpandedState();
  }

  syncFloatingExpandedState();

  if (floatingShell) {
    floatingShell.tabIndex = 0;
    floatingShell.addEventListener('click', (ev) => {
      if (!isExpanded && ev.target !== floatingCloseButton) setExpanded(true);
    });
    floatingShell.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (!isExpanded) setExpanded(true);
      }
    });
  }

  floatingBackdrop?.addEventListener('click', () => setExpanded(false));
  floatingCloseButton?.addEventListener('click', (event) => {
    event.stopPropagation();
    setExpanded(false);
  });

  const onWindowKeyDown = (event) => {
    if (event.key === 'Escape' && isExpanded) setExpanded(false);
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', onWindowKeyDown);
  }

  const ro = new ResizeObserver(() => {
    if (lastFloorplan && fpImg.naturalWidth) {
      drawOverlay(lastFloorplan, floorSelect.value, false);
    }
  });
  ro.observe(viewport);

  const mpNavEvents = [
    'global-coords-changed',
    'shop-navigation-changed',
    'selected-user-changed',
    'mini3d-route-update',
  ];
  function onMpNavSync() {
    if (!lastFloorplan || !fpImg.naturalWidth) return;
    drawOverlay(lastFloorplan, floorSelect.value, false);
  }
  function onPoiMovedFrom3D() {
    onMpNavSync();
  }
  let mpNavPoll = 0;
  if (typeof window !== 'undefined' && matterportWithNav) {
    for (const ev of mpNavEvents) {
      window.addEventListener(ev, onMpNavSync);
    }
    mpNavPoll = window.setInterval(() => {
      if (!matterportWithNav || !lastFloorplan || disposed) return;
      drawOverlay(lastFloorplan, floorSelect.value, false);
    }, 450);
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('spacecheck-poi-moved-xy', onPoiMovedFrom3D);
  }

  const initial = options.matterportInitialJson?.trim();
  const ready = (async () => {
    if (initial) {
      pasteJson.value = initial;
      try {
        applyModelFromGraphQLResponse(JSON.parse(initial));
      } catch (e) {
        setNotify('JSON', 'matterportInitialJson parse error: ' + (e instanceof Error ? e.message : String(e)), 'error');
      }
    } else if (!matterportWithNav) {
      setNotify('Matterport', 'Expand → paste GraphQL JSON → Load JSON.', 'done');
    } else {
      setNotify('Matterport', 'Paste GraphQL JSON from Matterport Model API → Load JSON.', 'done');
    }
  })();

  function dispose() {
    if (disposed) return;
    disposed = true;
    ro.disconnect();
    if (mpNavPoll) {
      clearInterval(mpNavPoll);
      mpNavPoll = 0;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', onWindowKeyDown);
      window.removeEventListener('spacecheck-poi-moved-xy', onPoiMovedFrom3D);
      if (matterportWithNav) {
        for (const ev of mpNavEvents) {
          window.removeEventListener(ev, onMpNavSync);
        }
        delete window.__mini3dRoutePath;
      }
    }
    revokeFloorplanBlob();
    if (matterportWithNav) {
      disposeMatterportOffscreenScene();
    }
    mountRoot.remove();
  }

  return {
    rootElement: mountRoot,
    ready,
    setDestination(x, y, z) {
      if (!matterportWithNav) return;
      manualDestinationOverride = { x, y, z };
      if (lastFloorplan && fpImg.naturalWidth) {
        drawOverlay(lastFloorplan, floorSelect.value, false);
      }
    },
    rebuildRoute() {
      if (lastFloorplan && fpImg.naturalWidth) {
        drawOverlay(lastFloorplan, floorSelect.value, false);
      }
    },
    getRouteState() {
      return matterportWithNav ? lastMpPathState : null;
    },
    dispose,
  };
}
