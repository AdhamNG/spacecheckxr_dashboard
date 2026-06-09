/**
 * Dashboard Shell
 * SpaceCheck XR dashboard layout:
 *   top bar · sidebar · 3D viewport · right panel · bottom stats bar
 */
import { BRAND_NAME, brandLogoHtml } from '../config/brand.js';
import { fetchCounts } from '../services/supabase.js';
import { formatEasternClock, formatEasternDateHeader } from '../utils/journey-display.js';

const SIDEBAR_ITEMS = [
  { id: 'pois',      icon: svgPin,      label: 'POIs' },
  { id: 'media',     icon: svgMedia,    label: 'Media' },
  { id: 'journey',   icon: svgJourney,  label: 'Paths' },
  { id: 'tracking',  icon: svgRadar,    label: 'Live' },
  { id: 'reviews',   icon: svgReview,   label: 'Reviews' },
  { id: 'insights',  icon: svgUsers,    label: 'Stats' },
  { id: 'submitted', icon: svgChart,    label: 'Forms' },
];

let activePanel = 'pois';
let uptimeStart = null;
let clockTimer = null;
/** @type {((panelId: string) => void) | null} */
let onPanelChangeCallback = null;

export function createDashboard(container) {
  const el = document.createElement('div');
  el.className = 'dashboard hidden immersive-shell ar-enterprise-shell';
  el.id = 'dashboard';

  el.innerHTML = `
    <header class="topbar float-glass chrome-layer">
      <div class="topbar-left">
        <span class="topbar-logo-icon">${brandLogoHtml('brand-logo brand-logo--topbar', 44)}</span>
        <span class="topbar-logo-text">${BRAND_NAME}</span>
      </div>
      <div class="topbar-right">
        <span class="topbar-date" id="topbar-date"></span>
        <span class="topbar-time" id="topbar-time"></span>
        <button type="button" class="topbar-logout" id="topbar-logout" title="Sign out">Log out</button>
      </div>
    </header>

    <nav class="sidebar-nav-block float-glass chrome-layer" id="sidebar-nav" aria-label="Main menu"></nav>

    <main class="viewport scene-stage float-glass scene-float chrome-layer" id="viewport">
      <div class="viewport-tabs viewport-tabs--display-only" id="viewport-tabs">
        <div class="viewport-map-style" title="3D map appearance">
          <label for="map-display-mode">Display</label>
          <select id="map-display-mode" class="map-display-select">
            <option value="shaded" selected>Shaded</option>
            <option value="wireframe">Wireframe</option>
            <option value="heatmap">Heat map</option>
          </select>
        </div>
      </div>
      <div class="viewport-body" id="viewport-body">
        <div class="viewport-3d active" id="viewport-3d"></div>
      </div>
    </main>

    <aside class="float-nav-dock nav-dock-frost chrome-layer" id="float-nav-dock" aria-label="Navigation"></aside>

    <aside class="right-panel float-drawer drawer-frost chrome-layer" id="right-panel">
      <div class="panel-slot"        data-panel="3d-view"    id="slot-nav"></div>
      <div class="panel-slot"        data-panel="2d-map"     id="slot-2dmap"></div>
      <div class="panel-slot active" data-panel="pois"       id="slot-pois"></div>
      <div class="panel-slot"        data-panel="media"      id="slot-media"></div>
      <div class="panel-slot journey-panel" data-panel="journey" id="slot-journey"></div>
      <div class="panel-slot"        data-panel="tracking"   id="slot-tracking"></div>
      <div class="panel-slot"        data-panel="reviews"    id="slot-reviews"></div>
      <div class="panel-slot"        data-panel="insights"   id="slot-insights"></div>
      <div class="panel-slot"        data-panel="submitted"  id="slot-submitted"></div>
    </aside>

    <footer class="bottombar float-glass chrome-layer">
      <div class="stat-chip">
        <span class="stat-label">USERS</span>
        <span class="stat-value" id="stat-users">--</span>
      </div>
      <div class="stat-chip">
        <span class="stat-label">POIs</span>
        <span class="stat-value" id="stat-pois">--</span>
      </div>
      <div class="stat-chip">
        <span class="stat-label">UPTIME</span>
        <span class="stat-value" id="stat-uptime">00:00:00</span>
      </div>
    </footer>
  `;

  container.appendChild(el);

  const sidebarNavEl = el.querySelector('#sidebar-nav');
  SIDEBAR_ITEMS.forEach((item) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `sidebar-btn${item.id === activePanel ? ' active' : ''}`;
    btn.dataset.panel = item.id;
    btn.title = item.label;
    btn.setAttribute('aria-label', item.label);
    btn.innerHTML = `${item.icon()}<span class="sidebar-label">${item.label}</span>`;
    btn.addEventListener('click', () => setActivePanel(item.id, el));
    sidebarNavEl.appendChild(btn);
  });

  const viewport3d = el.querySelector('#viewport-3d');
  const viewport2d = el.querySelector('#viewport-2d');
  const logoutBtn = el.querySelector('#topbar-logout');
  let activeView = '3d';
  let onViewSwitch = null;
  let onLogoutCallback = null;

  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      if (onLogoutCallback) onLogoutCallback();
    });
  }


  function switchView(view) {
    activeView = view === '2d' ? '2d' : '3d';
    viewport3d.classList.toggle('active', activeView === '3d');
    if (activeView === '3d') setActivePanel(activePanel === 'reviews' || activePanel === 'insights' ? activePanel : 'pois', el);
    if (onViewSwitch) onViewSwitch(activeView);
  }

  const slots = {
    nav:        el.querySelector('#slot-nav'),
    map2d:      el.querySelector('#slot-2dmap'),
    pois:       el.querySelector('#slot-pois'),
    media:      el.querySelector('#slot-media'),
    journey:    el.querySelector('#slot-journey'),
    tracking:   el.querySelector('#slot-tracking'),
    reviews:    el.querySelector('#slot-reviews'),
    insights:   el.querySelector('#slot-insights'),
    submitted:  el.querySelector('#slot-submitted'),
  };

  function openPanel(panelId) {
    setActivePanel(panelId, el);
  }

  const floatNavDock = el.querySelector('#float-nav-dock');

  setActivePanel(activePanel, el);

  return {
    element: el,
    viewport: viewport3d,
    viewport2d,
    floatNavDock,
    openPanel,
    slots,
    show() {
      el.classList.remove('hidden');
      uptimeStart = Date.now();
      startClock(el);
      refreshBottomStats(el);
    },
    hide() {
      el.classList.add('hidden');
      if (clockTimer) clearInterval(clockTimer);
    },
    refreshStats() { refreshBottomStats(el); },
    onViewSwitch(cb) { onViewSwitch = cb; },
    /** Fired when the right-hand sidebar panel changes (Map, POIs, Track, …). */
    onPanelChange(cb) {
      onPanelChangeCallback = cb;
    },
    onLogout(cb) {
      onLogoutCallback = cb;
    },
    switchView,
  };
}

/** Which right-hand drawer slot to show in the drawer. */
function drawerPanelFor(panelId) {
  return panelId;
}

function setActivePanel(panelId, dashEl) {
  activePanel = panelId;
  const drawerPanel = drawerPanelFor(panelId);
  dashEl.classList.toggle('nav-dock-open', false);
  dashEl.classList.toggle('drawer-open', true);
  dashEl.classList.toggle('reviews-focus', panelId === 'reviews');
  dashEl.classList.toggle('insights-focus', panelId === 'insights');
  dashEl.querySelectorAll('.sidebar-btn').forEach((b) =>
    b.classList.toggle('active', b.dataset.panel === panelId)
  );
  dashEl.querySelectorAll('.panel-slot').forEach((s) => {
    s.classList.toggle('active', s.dataset.panel === drawerPanel);
  });
  if (onPanelChangeCallback) onPanelChangeCallback(panelId, drawerPanel);
}

function startClock(dashEl) {
  const dateEl = dashEl.querySelector('#topbar-date');
  const timeEl = dashEl.querySelector('#topbar-time');
  const uptimeEl = dashEl.querySelector('#stat-uptime');

  function tick() {
    const now = new Date();
    dateEl.textContent = formatEasternDateHeader(now);
    timeEl.textContent = formatEasternClock(now);
    if (uptimeStart) {
      const s = Math.floor((Date.now() - uptimeStart) / 1000);
      const h = String(Math.floor(s / 3600)).padStart(2, '0');
      const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
      const sec = String(s % 60).padStart(2, '0');
      uptimeEl.textContent = `${h}:${m}:${sec}`;
    }
  }

  tick();
  clockTimer = setInterval(tick, 1000);
}

async function refreshBottomStats(dashEl) {
  try {
    const c = await fetchCounts();
    if (c.missingEnv) {
      dashEl.querySelector('#stat-users').textContent = '—';
      dashEl.querySelector('#stat-pois').textContent = '—';
      dashEl.querySelector('#stat-users').title = 'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env';
      dashEl.querySelector('#stat-pois').title = 'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env';
      return;
    }
    dashEl.querySelector('#stat-users').textContent = c.users;
    dashEl.querySelector('#stat-pois').textContent = c.pois;
    dashEl.querySelector('#stat-users').removeAttribute('title');
    dashEl.querySelector('#stat-pois').removeAttribute('title');
  } catch { /* silent */ }
}

/* ── Inline SVG icon factories ── */

function svgWrap(paths) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

function svgPin() {
  return svgWrap(
    '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>'
  );
}

function svgMedia() {
  return svgWrap(
    '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 16l-5.5-5.5L5 21"/>'
  );
}

function svgRadar() {
  return svgWrap(
    '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/><line x1="12" y1="2" x2="12" y2="6"/>'
  );
}

function svgReview() {
  return svgWrap(
    '<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/><path d="M8 10h8M8 14h5"/>'
  );
}

function svgUsers() {
  return svgWrap(
    '<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>'
  );
}

function svgChart() {
  return svgWrap(
    '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>'
  );
}

function svgMap2D() {
  return svgWrap(
    '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/>'
  );
}

/** Route / sequence — START → stops */
function svgJourney() {
  return svgWrap(
    '<circle cx="5" cy="19" r="2.5"/><circle cx="12" cy="12" r="2.5"/><circle cx="19" cy="5" r="2.5"/><path d="M7 17l4-5 5-6"/>'
  );
}

