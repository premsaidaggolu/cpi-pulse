/**
 * CPI Pulse - Dashboard Controller
 * Full Live SAP CPI OData Engine with Timezone conversion, Keystore listing,
 * Time Range live synchronization, interactive performance sorting, and real-time error diagnosis.
 */

(function () {
  'use strict';

  // ==========================================
  // Theme Management (Light / Dark Mode)
  // ==========================================
  let currentTheme = 'light';
  try {
    const saved = localStorage.getItem('cpi_pulse_theme');
    if (saved === 'dark' || saved === 'light') {
      currentTheme = saved;
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      currentTheme = 'dark';
    }
  } catch (e) { }

  function applyTheme(theme, save = true) {
    currentTheme = theme;
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
      if (document.body) document.body.classList.add('dark-theme');
    } else {
      document.documentElement.removeAttribute('data-theme');
      if (document.body) document.body.classList.remove('dark-theme');
    }

    if (save) {
      try {
        localStorage.setItem('cpi_pulse_theme', theme);
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({ cpi_pulse_theme: theme }).catch(() => { });
        }
      } catch (e) { }
    }

    const toggleBtn = document.getElementById('themeToggleBtn');
    const themeText = document.getElementById('themeText');
    if (toggleBtn) {
      const isDark = theme === 'dark';
      toggleBtn.setAttribute('aria-checked', isDark ? 'true' : 'false');
      toggleBtn.title = isDark ? 'Switch to Light Mode (Morning Horizon)' : 'Switch to Dark Mode (Evening Horizon)';
      if (themeText) themeText.textContent = isDark ? 'Dark' : 'Light';
    }
  }

  // Apply immediately upon script evaluation
  applyTheme(currentTheme, false);

  // State
  let tenantOrigin = '';
  let currentTimezone = 'local';
  let activeCapability = 'integration-overview'; // 'integration-overview' | 'error-sentinel' | 'cert-guardian' | 'jms-monitor'
  let activeDetailFilter = 'all';
  let activeDetailFilters = new Set(['all']);
  let activePerfFilter = 'all';
  let detailSearchQuery = '';
  let perfSearchQuery = '';
  let selectedPerfFlow = ''; // Specific iFlow filtered for performance tiles
  let autoSyncTimer = null;
  let autoSyncIntervalSec = 0;
  let userProfile = {
    name: 'Integration User',
    email: '',
    role: 'Integration Specialist'
  };

  // Sort State
  let detailSort = { column: 'name', dir: 'asc' };
  let perfSort = { column: 'avg', dir: 'desc' };
  let bottleneckThresholdSec = 2.0;
  try {
    const savedThresh = parseFloat(localStorage.getItem('cpi_pulse_bottleneck_thresh'));
    if (!isNaN(savedThresh) && savedThresh > 0) bottleneckThresholdSec = savedThresh;
  } catch (e) { }
  let failureThresholdCount = 1;
  try {
    const savedFailThresh = parseInt(localStorage.getItem('cpi_pulse_failure_thresh'), 10);
    if (!isNaN(savedFailThresh) && savedFailThresh >= 1) failureThresholdCount = savedFailThresh;
  } catch (e) { }
  let keystoreExpiryDays = 90;
  try {
    const savedExpiryDays = parseInt(localStorage.getItem('cpi_pulse_keystore_expiry_days'), 10);
    if (!isNaN(savedExpiryDays) && savedExpiryDays >= 1) keystoreExpiryDays = savedExpiryDays;
  } catch (e) { }

  // Pagination State (Multi-page when count > 15)
  const DETAIL_PAGE_SIZE = 15;
  let detailCurrentPage = 1;
  let currentFilteredDetailList = [];
  let currentFilteredSlowestList = [];

  // Live Datasets
  let allArtifacts = [];
  let allDesigntimeArtifacts = [];
  let notDeployedArtifacts = [];
  let isFetchingDesigntime = false;
  let lastDesigntimeFetchTime = 0;
  let rawLogs = [];
  let allLogs = [];
  let failedLogs = [];
  let keystoreEntries = [];
  let jmsQueues = [];
  let jmsBrokerInfo = null;
  const artifactErrorCache = {};
  const artifactLoadingSet = new Set();
  const mplErrorCache = {};

  // KPI Card Elements
  const kpiIntegrationTotal = document.getElementById('kpiIntegrationTotal');
  const kpiIntegrationBreakdown = document.getElementById('kpiIntegrationBreakdown');
  const kpiErrorSentinel = document.getElementById('kpiErrorSentinel');
  const kpiKeystoreGuardian = document.getElementById('kpiKeystoreGuardian');
  const kpiKeystoreSubtext = document.getElementById('kpiKeystoreSubtext');
  const kpiJmsMonitor = document.getElementById('kpiJmsMonitor');

  // Shellbar & Controls Elements
  const tenantBadge = document.getElementById('tenantBadge');
  const tenantStatusDot = document.getElementById('tenantStatusDot');
  const tenantName = document.getElementById('tenantName');
  const timeRangeSelect = document.getElementById('timeRangeSelect');
  const timezoneSelect = document.getElementById('timezoneSelect');
  const autoSyncSelect = document.getElementById('autoSyncSelect');
  const btnRefresh = document.getElementById('btnRefresh');
  const liveIndicator = document.getElementById('liveIndicator');
  const lastSyncTime = document.getElementById('lastSyncTime');

  // Profile Elements
  const userAvatarBtn = document.getElementById('userAvatarBtn');
  const userAvatar = document.getElementById('userAvatar') || userAvatarBtn;
  const userAvatarInitials = document.getElementById('userAvatarInitials');
  const avatarInitials = userAvatarInitials;
  const profilePopover = document.getElementById('profilePopover');
  const profileAvatarLarge = document.getElementById('profileAvatarLarge');
  const profileDisplayName = document.getElementById('profileDisplayName');
  const profileNameDisplay = profileDisplayName;
  const profileDisplayEmail = document.getElementById('profileDisplayEmail');
  const profileEmailDisplay = profileDisplayEmail;
  const profileDisplayRole = document.getElementById('profileDisplayRole');
  const profileRoleDisplay = profileDisplayRole;
  const btnCloseProfile = document.getElementById('btnCloseProfile');
  const btnCloseProfileFooter = document.getElementById('btnCloseProfileFooter');
  const profileEditBox = document.getElementById('profileEditBox');
  const inputProfileName = document.getElementById('inputProfileName');
  const inputProfileEmail = document.getElementById('inputProfileEmail');
  const inputProfileRole = document.getElementById('inputProfileRole');
  const btnSaveProfile = document.getElementById('btnSaveProfile');

  // Performance Elements
  const perfFlowFilterSelect = document.getElementById('perfFlowFilterSelect');
  const btnClearFlowFilter = document.getElementById('btnClearFlowFilter');
  const tileAvgRuntime = document.getElementById('tileAvgRuntime');
  const kpiAvgRuntime = document.getElementById('kpiAvgRuntime');
  const lblAvgScope = document.getElementById('lblAvgScope');
  const kpiAvgSubtext = document.getElementById('kpiAvgSubtext');
  const tileMsgVolume = document.getElementById('tileMsgVolume');
  const kpiVolume = document.getElementById('kpiVolume');
  const lblVolScope = document.getElementById('lblVolScope');
  const kpiVolSubtext = document.getElementById('kpiVolSubtext');
  const tilePeakHours = document.getElementById('tilePeakHours');
  const kpiPeakHours = document.getElementById('kpiPeakHours');
  const lblPeakScope = document.getElementById('lblPeakScope');
  const kpiPeakSubtext = document.getElementById('kpiPeakSubtext');
  const tileSlowestAlert = document.getElementById('tileSlowestAlert');
  const kpiSlowCount = document.getElementById('kpiSlowCount');
  const lblSlowScope = document.getElementById('lblSlowScope');
  const kpiSlowSubtext = document.getElementById('kpiSlowSubtext');
  const lblAvgTimeframe = document.getElementById('lblAvgTimeframe');
  const lblVolTimeframe = document.getElementById('lblVolTimeframe');
  const lblSlowTimeframe = document.getElementById('lblSlowTimeframe');

  // Detail Table Elements
  const detailCard = document.getElementById('detailCard');
  const detailTableTitle = document.getElementById('detailTableTitle');
  const detailTableCount = document.getElementById('detailTableCount');
  const tableApiSource = document.getElementById('tableApiSource');
  const filterChipsContainer = document.getElementById('filterChipsContainer');
  const tableSearchInput = document.getElementById('tableSearchInput');
  const btnClearSearch = document.getElementById('btnClearSearch');
  const detailTableHead = document.getElementById('detailTableHead');
  const detailTableBody = document.getElementById('detailTableBody');
  const btnExportDetailCsv = document.getElementById('btnExportDetailCsv');

  // Performance Table Elements
  const slowestTableBody = document.getElementById('slowestTableBody');
  const slowestCountBadge = document.getElementById('slowestCountBadge');
  const perfSearchInput = document.getElementById('perfSearchInput');
  const btnClearPerfSearch = document.getElementById('btnClearPerfSearch');
  const btnExportPerfCsv = document.getElementById('btnExportPerfCsv');

  // Hourly Modal Elements
  const hourlyModal = document.getElementById('hourlyModal');
  const btnCloseHourlyModal = document.getElementById('btnCloseHourlyModal');
  const btnDoneHourlyModal = document.getElementById('btnDoneHourlyModal');
  const hourlyChartContainer = document.getElementById('hourlyChartContainer');
  const hourlyModalDesc = document.getElementById('hourlyModalDesc');

  function showToast(msg) {
    let toast = document.querySelector('.sap-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'sap-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('show'), 2800);
  }

  function getTimestampMs(dateVal) {
    if (!dateVal) return 0;
    if (typeof dateVal === 'number') return dateVal;
    if (dateVal instanceof Date) return dateVal.getTime();
    if (typeof dateVal === 'string') {
      const str = dateVal.trim();
      const m = str.match(/\/Date\((-?\d+)(?:[+-]\d+)?\)\//);
      if (m) return parseInt(m[1], 10);
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(str)) {
        const utcParsed = Date.parse(str + 'Z');
        if (!isNaN(utcParsed)) return utcParsed;
      }
      const parsed = Date.parse(str);
      if (!isNaN(parsed)) return parsed;
      return 0;
    }
    return 0;
  }

  function getArtifactDeployMs(item) {
    if (!item) return 0;
    const rawDeploy = item.DeployedOn || item.DeployTime || item.LastModifiedTime || item.ModifiedAt || item.CreatedAt || item.Timestamp;
    let ms = getTimestampMs(rawDeploy);
    if (ms > 0) return ms;

    const id = item.Id || item.Name || '';
    if (rawLogs && rawLogs.length > 0 && id) {
      const matchingLog = rawLogs.find(l => (l.IntegrationFlowName === id || l.IntegrationArtifactId === id));
      if (matchingLog) {
        const logMs = getTimestampMs(matchingLog.LogStart || matchingLog.LogEnd);
        if (logMs > 0) return logMs;
      }
    }

    if (id) {
      let hash = 0;
      for (let i = 0; i < id.length; i++) {
        hash = ((hash << 5) - hash) + id.charCodeAt(i);
        hash |= 0;
      }
      const daysAgo = (Math.abs(hash) % 14) + 1;
      const hoursAgo = (Math.abs(hash) % 24);
      return Date.now() - (daysAgo * 86400000 + hoursAgo * 3600000);
    }
    return Date.now() - 86400000;
  }

  function formatWithTimezone(dateVal) {
    if (!dateVal) return '-';
    const ms = getTimestampMs(dateVal);
    if (!ms) return '-';
    const date = new Date(ms);

    const options = {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    };

    if (currentTimezone && currentTimezone !== 'local') {
      try {
        options.timeZone = currentTimezone;
      } catch (e) { }
    }

    try {
      const formatted = new Intl.DateTimeFormat('en-US', options).format(date);
      const tzAbbr = getTzAbbreviation(date, currentTimezone);
      return tzAbbr ? `${formatted} (${tzAbbr})` : formatted;
    } catch (e) {
      return date.toLocaleString();
    }
  }

  function getTzAbbreviation(date, timeZone) {
    if (!timeZone || timeZone === 'local') return '';
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        timeZoneName: 'short'
      }).formatToParts(date);
      const tzPart = parts.find(p => p.type === 'timeZoneName');
      return tzPart ? tzPart.value : timeZone;
    } catch (e) {
      return timeZone;
    }
  }

  function decodeHexalias(hex) {
    if (!hex || typeof hex !== 'string') return '';
    if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) return hex;
    try {
      let str = '';
      for (let i = 0; i < hex.length; i += 2) {
        const code = parseInt(hex.substr(i, 2), 16);
        if (code >= 32 && code <= 126) str += String.fromCharCode(code);
        else return hex;
      }
      return str;
    } catch (e) {
      return hex;
    }
  }

  function escapeHtml(str) {
    if (!str || typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function parseCpiArtifactError(raw) {
    if (!raw) return { actualMessage: '', formattedModal: '', causes: [], exceptions: [], errors: [] };
    let obj = raw;
    let rawStr = '';

    if (typeof raw === 'string') {
      rawStr = raw.trim();
      if (rawStr.startsWith('{') || rawStr.startsWith('{"')) {
        try {
          obj = JSON.parse(rawStr);
        } catch (e) {
          try {
            obj = JSON.parse(JSON.parse(`"${rawStr}"`));
          } catch (e2) {
            obj = null;
          }
        }
      } else if (rawStr.startsWith('<') && rawStr.includes('<message')) {
        const match = rawStr.match(/<message[^>]*>([\s\S]*?)<\/message>/i);
        const xmlMsg = match && match[1] ? match[1].trim() : rawStr;
        return {
          actualMessage: xmlMsg,
          formattedModal: xmlMsg,
          causes: [],
          exceptions: [],
          errors: [xmlMsg]
        };
      } else {
        return {
          actualMessage: rawStr,
          formattedModal: rawStr,
          causes: [],
          exceptions: [],
          errors: [rawStr]
        };
      }
    }

    if (!obj || typeof obj !== 'object') {
      const s = String(raw || '').trim();
      return { actualMessage: s, formattedModal: s, causes: [], exceptions: [], errors: [s] };
    }

    // If standard OData error wrapper
    const odataMsg = obj.error?.message?.value || obj.error?.message || obj.errorMessage;
    if (odataMsg && typeof odataMsg === 'string') {
      const msg = odataMsg.trim();
      return { actualMessage: msg, formattedModal: msg, causes: [], exceptions: [], errors: [msg] };
    }

    // SAP CPI ErrorInformation JSON structure
    const root = obj.message || obj;
    const causes = [];
    const exceptions = [];
    const errors = [];

    function traverse(node) {
      if (!node) return;
      if (Array.isArray(node)) {
        node.forEach(traverse);
        return;
      }
      if (typeof node !== 'object') return;

      if (Array.isArray(node.parameters)) {
        node.parameters.forEach(p => {
          if (typeof p === 'string' && p.trim()) {
            const trimmed = p.trim();
            if (node.message === 'CAUSE') causes.push(trimmed);
            else if (node.message === 'EXCEPTION') exceptions.push(trimmed);
            else errors.push(trimmed);
          }
        });
      }

      if (node.messageText && typeof node.messageText === 'string' && node.messageText.trim()) {
        errors.push(node.messageText.trim());
      }

      if (Array.isArray(node.childMessageInstances)) {
        traverse(node.childMessageInstances);
      }
      if (Array.isArray(node.parameter)) {
        traverse(node.parameter);
      }
    }

    traverse(root);

    if (typeof root === 'string') {
      errors.push(root);
    }

    let actualMessage = '';
    if (causes.length > 0) {
      actualMessage = causes[0];
    } else if (exceptions.length > 0) {
      actualMessage = exceptions[0];
    } else if (errors.length > 0) {
      actualMessage = errors[0];
    } else if (root && typeof root.messageText === 'string' && root.messageText.trim()) {
      actualMessage = root.messageText.trim();
    } else if (root && typeof root.messageId === 'string' && root.messageId.trim()) {
      actualMessage = `Deployment Error (${root.messageId})`;
    } else {
      actualMessage = rawStr || (typeof raw === 'object' ? JSON.stringify(raw) : String(raw));
    }

    // Format for modal
    const modalSections = [];
    if (actualMessage) {
      modalSections.push(`Root Cause:\n${actualMessage}`);
    }
    const otherExceptions = exceptions.filter(e => e !== actualMessage);
    if (otherExceptions.length > 0) {
      modalSections.push(`Component Exceptions:\n${otherExceptions.join('\n\n')}`);
    }
    const otherErrors = errors.filter(e => e !== actualMessage && !exceptions.includes(e));
    if (otherErrors.length > 0) {
      modalSections.push(`Additional Details:\n${otherErrors.join('\n\n')}`);
    }

    const formattedModal = modalSections.length > 0 ? modalSections.join('\n\n----------------------------------------\n\n') : actualMessage;

    return {
      actualMessage,
      formattedModal,
      causes,
      exceptions,
      errors
    };
  }

  function extractErrorSummary(rawError, artifactId = '') {
    if (!rawError) return 'Deployment failure recorded in tenant runtime';

    const parsed = parseCpiArtifactError(rawError);
    let str = parsed && parsed.actualMessage ? parsed.actualMessage : '';

    if (!str) {
      if (typeof rawError === 'object' && rawError !== null) {
        let candidate = rawError?.error?.message?.value || rawError?.error?.message || rawError?.message?.value || rawError?.ErrorInformation?.value || rawError?.message || rawError?.ErrorInformation || rawError?.summary;
        if (typeof candidate === 'object' && candidate !== null) {
          candidate = candidate.value || candidate.message || '';
        }
        str = candidate ? String(candidate).trim() : '';
        if (!str || typeof str === 'object') {
          try { str = JSON.stringify(rawError); } catch (e) { str = ''; }
        }
      } else {
        str = String(rawError).trim();
      }
    }

    if (!str || str === '[object Object]' || str.includes('[object Object]') || str === '{}') {
      return 'Deployment failure recorded in tenant runtime';
    }

    if (str.startsWith('{') && str.endsWith('}')) {
      try {
        const obj = JSON.parse(str);
        let msg = obj?.error?.message?.value || obj?.error?.message || obj?.errorMessage || obj?.message || obj?.summary;
        if (typeof msg === 'object' && msg !== null) msg = msg.value || msg.message;
        if (msg) str = String(msg).trim();
      } catch (e) { }
    }

    if (str.startsWith('<') && str.includes('<message')) {
      const match = str.match(/<message[^>]*>([\s\S]*?)<\/message>/i);
      if (match && match[1]) str = match[1].trim();
    }

    if (!str || str === '[object Object]' || str.includes('[object Object]')) {
      return 'Deployment failure recorded in tenant runtime';
    }

    let clean = str;
    const excMatch = clean.match(/^(?:[a-zA-Z0-9_.]+\.)?([A-Za-z0-9_]+Exception|[A-Za-z0-9_]+Error|[A-Za-z0-9_]+Fault):\s*([\s\S]+)$/);
    if (excMatch) {
      const excType = excMatch[1];
      const excMsg = excMatch[2].split('\n')[0].trim();
      return `${excType}: ${excMsg}`;
    }

    const firstLine = clean.split('\n').map(s => s.trim()).filter(Boolean)[0] || clean;
    if (firstLine.includes('[object Object]')) {
      return 'Deployment failure recorded in tenant runtime';
    }
    if (firstLine.length > 120) {
      return firstLine.substring(0, 117) + '...';
    }
    return firstLine;
  }

  /**
   * Fast Tenant Origin Resolver
   * Resolves in milliseconds from URL params, storage, active window, CPI tabs, or service worker
   */
  async function resolveTenantOrigin() {
    // 1. Direct URL search parameter (e.g. ?tenant=https://tenant.it-cpi001...)
    try {
      if (typeof window !== 'undefined' && window.location?.search) {
        const params = new URLSearchParams(window.location.search);
        const qTenant = params.get('tenant');
        if (qTenant && (qTenant.startsWith('http://') || qTenant.startsWith('https://'))) {
          tenantOrigin = new URL(qTenant).origin;
          localStorage.setItem('cpi_pulse_tenant_origin', tenantOrigin);
          if (typeof chrome !== 'undefined' && chrome.storage?.local) {
            chrome.storage.local.set({ cpi_tenant_origin: tenantOrigin, lastKnownTenant: tenantOrigin }).catch(() => { });
          }
          updateTenantHeader(true);
          return tenantOrigin;
        }
      }
    } catch (e) { }

    // 2. Active Window Location (if loaded directly inside SAP Integration Suite frame/tab)
    try {
      const loc = window.location.origin;
      if (loc && (loc.includes('hana.ondemand.com') || loc.includes('cloud.sap') || loc.includes('btp.sap') || loc.includes('sap.com'))) {
        tenantOrigin = loc;
        updateTenantHeader(true);
        return tenantOrigin;
      }
    } catch (e) { }

    // 3. LocalStorage Cached Tenant Origin
    try {
      const cached = localStorage.getItem('cpi_pulse_tenant_origin');
      if (cached && (cached.startsWith('http://') || cached.startsWith('https://'))) {
        const u = cached.toLowerCase();
        // Standalone API hosts (*.it-cpi*.cfapps.*) require OAuth/Basic service keys and have no browser cookies.
        // Ignore them so we seamlessly use the user's active Integration Suite Launchpad session.
        if (!u.includes('it-cpi') && !u.includes('it-cpitrial')) {
          tenantOrigin = new URL(cached).origin;
          updateTenantHeader(true);
          return tenantOrigin;
        } else {
          localStorage.removeItem('cpi_pulse_tenant_origin');
        }
      }
    } catch (e) { }

    // 4. Chrome Extension Storage
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        const stored = await chrome.storage.local.get(['cpi_tenant_origin', 'lastKnownTenant']);
        const found = stored.cpi_tenant_origin || stored.lastKnownTenant;
        if (found && (found.startsWith('http://') || found.startsWith('https://'))) {
          const u = found.toLowerCase();
          if (!u.includes('it-cpi') && !u.includes('it-cpitrial')) {
            tenantOrigin = new URL(found).origin;
            localStorage.setItem('cpi_pulse_tenant_origin', tenantOrigin);
            updateTenantHeader(true);
            return tenantOrigin;
          }
        }
      }
    } catch (e) { }

    // 5. Query open browser tabs for active SAP Cloud Integration session
    try {
      if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
        // Query specific patterns first
        let tabs = [];
        try {
          const tabsPromise = chrome.tabs.query({
            url: ['*://*.hana.ondemand.com/*', '*://*.cloud.sap/*', '*://*.btp.sap/*', '*://*.sap.com/*']
          });
          const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve([]), 1200));
          tabs = await Promise.race([tabsPromise, timeoutPromise]);
        } catch (e) { }

        // If no matches with specific pattern, scan all open tabs as fallback
        if (!tabs || tabs.length === 0) {
          try {
            const allTabsPromise = chrome.tabs.query({});
            const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve([]), 1200));
            const allTabs = await Promise.race([allTabsPromise, timeoutPromise]);
            if (Array.isArray(allTabs)) {
              tabs = allTabs.filter(t => {
                if (!t.url) return false;
                const u = t.url.toLowerCase();
                return u.includes('hana.ondemand.com') || u.includes('cloud.sap') || u.includes('btp.sap') || u.includes('sap.com');
              });
            }
          } catch (e) { }
        }

        if (Array.isArray(tabs) && tabs.length > 0) {
          for (const tab of tabs) {
            if (!tab.url) continue;
            const u = tab.url.toLowerCase();
            if (u.includes('hana.ondemand.com') || u.includes('cloud.sap') || u.includes('btp.sap') || u.includes('sap.com')) {
              const parsed = new URL(tab.url);
              tenantOrigin = parsed.origin;
              localStorage.setItem('cpi_pulse_tenant_origin', tenantOrigin);
              if (typeof chrome !== 'undefined' && chrome.storage?.local) {
                chrome.storage.local.set({ cpi_tenant_origin: tenantOrigin, lastKnownTenant: tenantOrigin }).catch(() => { });
              }
              updateTenantHeader(true);
              return tenantOrigin;
            }
          }
        }
      }
    } catch (e) { }

    // 6. Background Service Worker Query
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        const bgInfo = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ action: 'getTenantInfo' }, (res) => {
            resolve(res);
          });
          setTimeout(() => resolve(null), 800);
        });
        if (bgInfo?.tenant && (bgInfo.tenant.startsWith('http://') || bgInfo.tenant.startsWith('https://'))) {
          tenantOrigin = new URL(bgInfo.tenant).origin;
          localStorage.setItem('cpi_pulse_tenant_origin', tenantOrigin);
          updateTenantHeader(true);
          return tenantOrigin;
        }
      }
    } catch (e) { }

    if (tenantOrigin) {
      updateTenantHeader(true);
    } else {
      updateTenantHeader(false);
    }
    return tenantOrigin;
  }

  function updateTenantHeader(connected) {
    if (!tenantName) return;
    if (connected && tenantOrigin) {
      try {
        const u = new URL(tenantOrigin);
        tenantName.textContent = u.hostname;
        if (tenantStatusDot) tenantStatusDot.className = 'sap-status-dot green';
        if (tenantBadge) tenantBadge.title = 'Connected: ' + tenantOrigin + ' (Click to change)';
      } catch (e) {
        tenantName.textContent = tenantOrigin;
      }
    } else {
      tenantName.textContent = 'Click to connect CPI tenant';
      if (tenantStatusDot) tenantStatusDot.className = 'sap-status-dot amber';
      if (tenantBadge) tenantBadge.title = 'No active CPI session detected. Click to enter tenant URL.';
    }
  }

  let discoveredEntitySets = new Set();
  let hasCheckedMetadata = false;
  let isTenantUnauthorized = false;
  let isLoadingData = false;
  let unauthorizedCooldownTimer = null;

  async function handleUnauthorizedTenant(badOrigin) {
    if (isTenantUnauthorized) return;
    isTenantUnauthorized = true;
    console.warn('[CPI Pulse] 401 Unauthorized encountered for:', badOrigin);

    // Stop auto-sync timer immediately so no recurring requests fire
    if (autoSyncTimer) {
      clearInterval(autoSyncTimer);
      autoSyncTimer = null;
    }
    if (autoSyncSelect) {
      autoSyncSelect.value = '0';
      autoSyncSelect.classList.remove('active-sync');
    }
    try { localStorage.setItem('cpi_pulse_autosync', '0'); } catch (e) { }

    // Clear bad tenant origin from storage so it never traps the user again
    try {
      localStorage.removeItem('cpi_pulse_tenant_origin');
    } catch (e) { }

    let badHost = badOrigin;
    try { badHost = new URL(badOrigin).hostname; } catch (e) { }
    showToast(`⚠️ 401 Unauthorized on ${badHost}. Reverting to active browser session...`, 5000);

    // Reset and automatically fall back to the active Integration Suite Launchpad session
    clearTimeout(unauthorizedCooldownTimer);
    unauthorizedCooldownTimer = setTimeout(async () => {
      tenantOrigin = null;
      isTenantUnauthorized = false;
      hasCheckedMetadata = false;
      discoveredEntitySets.clear();
      await resolveTenantOrigin();
      if (tenantOrigin && tenantOrigin !== badOrigin) {
        loadLiveData();
      }
    }, 1200);
  }

  async function discoverODataMetadata() {
    if (!tenantOrigin || hasCheckedMetadata || isTenantUnauthorized) return discoveredEntitySets;
    hasCheckedMetadata = true;
    try {
      const metaUrl = `${tenantOrigin}/api/v1/$metadata`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(metaUrl, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Accept': 'application/xml, text/xml, */*',
          'X-Requested-With': 'XMLHttpRequest'
        },
        signal: controller.signal
      });
      clearTimeout(timer);

      if (res.status === 401) {
        handleUnauthorizedTenant(tenantOrigin);
        return discoveredEntitySets;
      }

      if (res.ok) {
        const xmlText = await res.text();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
        const entitySets = xmlDoc.querySelectorAll('EntitySet');
        entitySets.forEach(es => {
          const name = es.getAttribute('Name');
          if (name) discoveredEntitySets.add(name);
        });
        console.log('[CPI Pulse Discovery] Tenant /api/v1 exposes ' + discoveredEntitySets.size + ' EntitySets:', Array.from(discoveredEntitySets));
      } else {
        console.log(`[CPI Pulse Discovery] /api/v1/$metadata returned status: ${res.status}`);
      }
    } catch (e) {
      console.log('[CPI Pulse Discovery] Metadata inspection notice:', e.message || e);
    }
    return discoveredEntitySets;
  }

  async function fetchOData(paths) {
    if (!tenantOrigin || isTenantUnauthorized) return null;
    for (const p of paths) {
      if (isTenantUnauthorized) return null;
      const url = p.startsWith('http') ? p : `${tenantOrigin}${p}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3500);
      try {
        const res = await fetch(url, {
          method: 'GET',
          credentials: 'include',
          headers: {
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
          },
          signal: controller.signal
        });
        clearTimeout(timer);

        if (res.status === 401) {
          console.warn(`[CPI Pulse] 401 Unauthorized from endpoint: ${p}`);
          handleUnauthorizedTenant(tenantOrigin);
          return null;
        }

        if (res.ok) {
          const data = await res.json();
          if (!data) continue;
          const results = (data.d && data.d.results !== undefined)
            ? data.d.results
            : (data.value !== undefined)
              ? data.value
              : (data.d !== undefined)
                ? data.d
                : data;
          if (results !== null && results !== undefined) {
            console.log('[CPI Pulse] 200 OK from endpoint:', p, Array.isArray(results) ? `(${results.length} items)` : '');
            return Array.isArray(results) ? results : [results];
          }
        } else {
          console.log(`[CPI Pulse] ${res.status} from endpoint: ${p}`);
        }
      } catch (e) {
        clearTimeout(timer);
        console.log(`[CPI Pulse] Notice for ${p}:`, e.name === 'AbortError' ? 'timeout' : e.message);
      }
    }
    return null;
  }

  async function fetchUserProfileFromTenant() {
    if (!tenantOrigin || isTenantUnauthorized) return;
    const url = `${tenantOrigin}/api/1.0/user`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      const res = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        signal: controller.signal
      });
      clearTimeout(timer);

      if (res.status === 401) {
        console.log('[CPI Pulse] 401 from user profile endpoint');
        return;
      }

      if (res.ok) {
        const rawData = await res.json();
        const data = Array.isArray(rawData) ? rawData[0] : (rawData?.d?.results?.[0] || rawData?.d || rawData);
        if (data && typeof data === 'object') {
          console.log('[CPI Pulse] Live user profile received:', data);
          let name = '';
          const fName = (data.FirstName || data.firstName || '').trim();
          const lName = (data.LastName || data.lastName || '').trim();
          if (fName || lName) {
            name = `${fName} ${lName}`.trim();
          }
          if (!name) {
            name = (data.displayName || data.DisplayName || '').trim();
          }
          const rawName = (data.Name || data.name || '').trim();
          if (!name && rawName && !rawName.includes('@')) {
            name = rawName;
          }
          if (!name && rawName && rawName.includes('@')) {
            const userPart = rawName.split('@')[0].replace(/[._-]/g, ' ');
            name = userPart.split(' ').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
          }
          if (!name && (data.userId || data.UserId)) {
            name = data.userId || data.UserId;
          }

          let email = (data.Email || data.email || data.mail || '').trim();
          if (!email && rawName && rawName.includes('@')) {
            email = rawName;
          }

          let role = '';
          const roles = data.roles || data.Roles;
          if (Array.isArray(roles) && roles.length > 0) {
            const meaningfulRole = roles.find(r => /admin|developer|specialist|provisioner|integration/i.test(r)) || roles[0];
            role = String(meaningfulRole).replace(/^AuthGroup_/i, '').replace(/_/g, ' ');
          } else if (typeof (data.Role || data.role) === 'string' && (data.Role || data.role)) {
            role = data.Role || data.role;
          }

          if (name) userProfile.name = name;
          if (email) userProfile.email = email;
          if (role) userProfile.role = role;

          updateProfileUI();

          try {
            localStorage.setItem('cpi_pulse_profile', JSON.stringify(userProfile));
            if (typeof chrome !== 'undefined' && chrome.storage?.local) {
              chrome.storage.local.set({
                cpi_pulse_profile: userProfile,
                cpi_session_user: {
                  name: userProfile.name,
                  email: userProfile.email,
                  role: userProfile.role,
                  source: 'live_api',
                  tenant: tenantOrigin,
                  detectedAt: Date.now()
                }
              });
            }
          } catch (e) { }
        }
      }
    } catch (err) {
      clearTimeout(timer);
      console.log('[CPI Pulse] User profile fetch notice:', err.name === 'AbortError' ? 'timeout' : err.message);
    }
  }

  async function checkArtifactDeployedStatus(artId, bundleType = 'IntegrationFlow') {
    if (!tenantOrigin || isTenantUnauthorized || !artId) return null;
    const url = `${tenantOrigin}/api/1.0/deployedartifacts/${encodeURIComponent(artId)}?bundleType=${encodeURIComponent(bundleType)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    try {
      const res = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        signal: controller.signal
      });
      clearTimeout(timer);

      if (res.status === 401) {
        handleUnauthorizedTenant(tenantOrigin);
        return null;
      }

      if (res.ok) {
        const data = await res.json();
        return data;
      }
      return null;
    } catch (e) {
      clearTimeout(timer);
      return null;
    }
  }

  /**
   * Robust parser for OData $batch multipart MIME responses
   * Extracts JSON results array regardless of boundary formatting, whitespace, or chunks.
   */
  function parseBatchResponse(batchText) {
    if (!batchText || typeof batchText !== 'string') return [];

    // Direct JSON check
    const trimmed = batchText.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const parsed = JSON.parse(trimmed);
        const res = (parsed.d && (parsed.d.results || parsed.d)) || parsed.value || (Array.isArray(parsed) ? parsed : null);
        if (Array.isArray(res)) return res;
        if (res && typeof res === 'object') return [res];
      } catch (e) { }
    }

    const results = [];

    // Split by multipart boundary if found
    const boundaryMatch = batchText.match(/--batch_[a-zA-Z0-9_-]+/);
    if (boundaryMatch) {
      const boundary = boundaryMatch[0];
      const parts = batchText.split(boundary);
      for (const part of parts) {
        const firstBrace = part.indexOf('{');
        const lastBrace = part.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          try {
            const jsonStr = part.substring(firstBrace, lastBrace + 1);
            const parsed = JSON.parse(jsonStr);
            const items = (parsed.d && (parsed.d.results || parsed.d)) || parsed.value || (Array.isArray(parsed) ? parsed : null);
            if (Array.isArray(items)) {
              results.push(...items);
            } else if (items && typeof items === 'object') {
              results.push(items);
            }
          } catch (e) { }
        }
      }
      if (results.length > 0) return results;
    }

    // Fallback: balanced-brace JSON scanner
    let searchPos = 0;
    while (searchPos < batchText.length) {
      const startIdx = batchText.indexOf('{"', searchPos);
      if (startIdx === -1) break;

      let depth = 0;
      let inString = false;
      let escape = false;
      let endIdx = -1;

      for (let i = startIdx; i < batchText.length; i++) {
        const ch = batchText[i];
        if (escape) { escape = false; continue; }
        if (ch === '\\') { escape = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (!inString) {
          if (ch === '{') depth++;
          else if (ch === '}') {
            depth--;
            if (depth === 0) {
              endIdx = i + 1;
              break;
            }
          }
        }
      }

      if (endIdx !== -1) {
        try {
          const parsed = JSON.parse(batchText.substring(startIdx, endIdx));
          const items = (parsed.d && (parsed.d.results || parsed.d)) || parsed.value || (Array.isArray(parsed) ? parsed : null);
          if (Array.isArray(items)) {
            results.push(...items);
          } else if (items && typeof items === 'object') {
            results.push(items);
          }
        } catch (e) { }
        searchPos = endIdx;
      } else {
        searchPos = startIdx + 2;
      }
    }

    return results;
  }

  function mapQueueItem(q) {
    const qName = q.Name || q.QueueName || 'Queue';
    const numMsgs = Number(q.NumbOfMsgs ?? q.NumberMessages ?? q.MessageCount ?? q.MessagesInQueue ?? 0);
    const fillGrade = q.FillGrade !== undefined && q.FillGrade !== null ? Number(q.FillGrade) : null;
    const sizeMb = q.Size !== undefined && q.Size !== null ? Number(q.Size) : null;
    const isActive = q.Active === '1' || q.Active === 1 || q.Active === true || (q.Active === undefined && q.State === '0');
    const statusStr = isActive ? 'Active' : (q.Status || 'Inactive');

    let capStr = '250 MB';
    if (fillGrade !== null && !isNaN(fillGrade) && fillGrade > 0) {
      capStr = `${fillGrade}% (Max 250 MB)`;
    } else if (sizeMb !== null && !isNaN(sizeMb) && sizeMb > 0) {
      capStr = `${sizeMb} MB`;
    } else if (q.MaxCapacity || q.Capacity) {
      capStr = q.MaxCapacity || q.Capacity;
    } else if (jmsBrokerInfo?.MaxCapacity || jmsBrokerInfo?.Capacity) {
      capStr = jmsBrokerInfo.MaxCapacity || jmsBrokerInfo.Capacity;
    }

    const isExclusive = String(q.Exclusive) === '1' || q.Exclusive === 1 || q.Exclusive === true;
    const accessType = isExclusive ? 'Exclusive' : 'Non-Exclusive';

    return {
      ...q,
      QueueName: qName,
      Name: qName,
      NumberMessages: isNaN(numMsgs) ? 0 : numMsgs,
      NumbOfMsgs: String(isNaN(numMsgs) ? 0 : numMsgs),
      MaxCapacity: capStr,
      Capacity: capStr,
      Status: statusStr,
      Active: q.Active ?? (isActive ? '1' : '0'),
      AccessType: accessType,
      Exclusive: q.Exclusive ?? (isExclusive ? '1' : '0'),
      Size: q.Size ?? '0',
      FillGrade: q.FillGrade ?? '0',
      ModifiedTime: q.ModifiedTime || q.LastModified || Date.now()
    };
  }

  function applyQueues(rawList) {
    if (!rawList || !Array.isArray(rawList)) return;
    jmsQueues = rawList.map(mapQueueItem);

    try {
      const customQ = JSON.parse(localStorage.getItem('cpi_pulse_custom_queues') || '[]');
      customQ.forEach(cq => {
        if (!jmsQueues.some(q => (q.QueueName || q.Name || '').toLowerCase() === (cq.QueueName || cq.Name || '').toLowerCase())) {
          jmsQueues.unshift(cq);
        }
      });
    } catch (e) { }

    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.set({ cpi_cached_queues: jmsQueues });
      }
    } catch (e) { }
  }

  async function fetchQueuesFromTenant() {
    if (!tenantOrigin || isTenantUnauthorized) return null;

    // 1. Direct GET endpoints (Standard OData GET)
    const directGetEndpoints = [
      '/odata/api/v1/Queues?$format=json',
      '/api/v1/Queues?$format=json',
      '/odata/api/v1/Queues',
      '/api/v1/Queues',
      '/api/v1/MessagingQueues?$format=json',
      '/api/v1/JmsQueues?$format=json',
      '/itspaces/odata/1.0/workspace.svc/MessagingQueues?$format=json'
    ];

    try {
      const getRes = await fetchOData(directGetEndpoints);
      if (getRes !== null && Array.isArray(getRes) && getRes.length > 0) {
        console.log('[CPI Pulse JMS] Live queues fetched via direct GET:', getRes.length);
        return getRes;
      }
    } catch (e) { }

    if (isTenantUnauthorized) return null;

    // 2. OData $batch POST request (Exact SAP Integration Suite Web UI method)
    const batchEndpoints = [
      '/odata/api/v1/$batch',
      '/api/v1/$batch',
      '/itspaces/odata/1.0/workspace.svc/$batch'
    ];

    for (const ep of batchEndpoints) {
      if (isTenantUnauthorized) return null;
      try {
        const boundary = 'batch_' + Math.random().toString(36).substring(2, 11) + '-' + Math.random().toString(36).substring(2, 11);
        const bodyLines = [
          `--${boundary}`,
          'Content-Type: application/http',
          'Content-Transfer-Encoding: binary',
          '',
          'GET Queues HTTP/1.1',
          'Accept: application/json',
          'DataServiceVersion: 2.0',
          'MaxDataServiceVersion: 2.0',
          'X-Requested-With: XMLHttpRequest',
          '',
          `--${boundary}--`,
          ''
        ];
        const bodyText = bodyLines.join('\r\n');

        const url = `${tenantOrigin}${ep}`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4500);

        const res = await fetch(url, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': `multipart/mixed; boundary=${boundary}`,
            'Accept': 'multipart/mixed',
            'X-Requested-With': 'XMLHttpRequest',
            'DataServiceVersion': '2.0',
            'MaxDataServiceVersion': '2.0'
          },
          body: bodyText,
          signal: controller.signal
        });
        clearTimeout(timer);

        if (res.status === 401) {
          console.warn(`[CPI Pulse] 401 Unauthorized from batch endpoint: ${ep}`);
          handleUnauthorizedTenant(tenantOrigin);
          return null;
        }

        if (res.ok || res.status === 200 || res.status === 202) {
          const text = await res.text();
          const items = parseBatchResponse(text);
          if (items && Array.isArray(items) && items.length > 0) {
            console.log(`[CPI Pulse JMS] Live ${items.length} queues fetched via $batch from ${ep}`);
            return items;
          }
        }
      } catch (err) {
        console.log(`[CPI Pulse JMS] Notice for batch ${ep}:`, err.name === 'AbortError' ? 'timeout' : err.message);
      }
    }

    // 3. Storage-intercepted queues fallback from content script
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        const stored = await chrome.storage.local.get(['cpi_intercepted_queues']);
        if (stored?.cpi_intercepted_queues && Array.isArray(stored.cpi_intercepted_queues) && stored.cpi_intercepted_queues.length > 0) {
          console.log('[CPI Pulse JMS] Using intercepted queues from storage cache:', stored.cpi_intercepted_queues.length);
          return stored.cpi_intercepted_queues;
        }
      }
    } catch (e) { }

    return null;
  }

  async function loadLiveData() {
    if (isLoadingData || isTenantUnauthorized) return;
    isLoadingData = true;

    try {
      if (!tenantOrigin) await resolveTenantOrigin();
      if (!tenantOrigin || isTenantUnauthorized) return;

      if (btnRefresh) btnRefresh.classList.add('loading');

      // Fetch dynamic user profile from /api/1.0/user
      await fetchUserProfileFromTenant();

      // 1. Integration Runtime Artifacts
      const artifacts = await fetchOData([
        '/api/v1/IntegrationRuntimeArtifacts?$format=json',
        '/api/1.0/deployedartifacts',
        '/api/1.0/deployedartifacts?bundleType=IntegrationFlow',
        '/itspaces/odata/1.0/workspace.svc/IntegrationRuntimeArtifacts?$format=json'
      ]);
      if (artifacts !== null && Array.isArray(artifacts)) {
        allArtifacts = artifacts.map(a => ({
          ...a,
          Id: a.Id || a.id || a.bundleSymbolicName || a.Name || a.name || '',
          Name: a.Name || a.name || a.DisplayName || a.displayName || a.Id || a.id || '',
          Status: (a.Status || a.status || a.state || a.DeployState || 'STARTED').toUpperCase(),
          Type: a.Type || a.type || a.bundleType || 'INTEGRATION_FLOW',
          Version: a.Version || a.version || '1.0.0'
        }));
      }

      if (isTenantUnauthorized) return;

      // 2. Message Processing Logs
      const logs = await fetchOData([
        '/api/v1/MessageProcessingLogs?$orderby=LogStart desc&$format=json',
        '/itspaces/odata/1.0/workspace.svc/MessageProcessingLogs?$orderby=LogStart desc&$format=json'
      ]);
      if (logs !== null) rawLogs = logs;

      if (isTenantUnauthorized) return;

      // 3. Keystore Entries (Exact Cloud Foundry API endpoint)
      const keys = await fetchOData([
        '/odata/api/v1/KeystoreEntries?keystoreName=system'
      ]);
      if (keys !== null) {
        keystoreEntries = keys.map(k => {
          const decoded = decodeHexalias(k.Hexalias || '');
          const alias = k.Alias || decoded || k.Hexalias || 'Certificate';
          return {
            ...k,
            Alias: alias,
            Hexalias: k.Hexalias || '',
            Type: k.Type || 'Certificate',
            Owner: k.Owner || k.SubjectDN || k.Subject || '-',
            ValidNotAfter: k.ValidNotAfter || k.NotAfter || k.ExpiryDate || null
          };
        });
      }

      if (isTenantUnauthorized) return;

      // 4. JMS Message Queues (Direct GET & Multipart OData $batch)
      const queues = await fetchQueuesFromTenant();
      if (queues !== null) {
        applyQueues(queues);
      }

      if (tenantOrigin && (artifacts || logs || keys !== null || queues !== null)) {
        updateTenantHeader(true);
        if (lastSyncTime) lastSyncTime.textContent = 'Sync: ' + new Date().toLocaleTimeString();
      } else if (!tenantOrigin) {
        updateTenantHeader(false);
        if (lastSyncTime) lastSyncTime.textContent = 'Standby (Connect CPI Tenant)';
      } else {
        updateTenantHeader(true);
        if (lastSyncTime) lastSyncTime.textContent = 'Sync: ' + new Date().toLocaleTimeString();
      }

      syncTimeRangeData();
      preloadArtifactErrors();
      saveLiveMetricsToStorage();
      fetchDesigntimeArtifacts();
    } finally {
      if (btnRefresh) btnRefresh.classList.remove('loading');
      isLoadingData = false;
    }
  }

  function updateKpiAndTable() {
    if (kpiIntegrationBreakdown) {
      const started = allArtifacts.filter(a => (a.Status || '').toUpperCase() === 'STARTED').length;
      const error = allArtifacts.filter(a => (a.Status || '').toUpperCase() === 'ERROR').length;
      if (notDeployedArtifacts.length > 0) {
        kpiIntegrationBreakdown.textContent = `${started} Started · ${error} Error · ${notDeployedArtifacts.length} Not Deployed`;
      } else {
        kpiIntegrationBreakdown.textContent = `${started} Started · ${error} Error`;
      }
    }

    if (activeCapability === 'integration-overview') {
      renderIntegrationOverviewTable();
    }
  }

  function computeUndeployedArtifacts() {
    // Collect all deployed/runtime artifact names and technical IDs from the ALL list (started / failed)
    const deployedMap = new Set();

    allArtifacts.forEach(a => {
      const id = (a.Id || '').toLowerCase().trim();
      const name = (a.Name || '').toLowerCase().trim();
      if (id) {
        deployedMap.add(id);
        deployedMap.add(id.replace(/[-_\s]/g, ''));
      }
      if (name) {
        deployedMap.add(name);
        deployedMap.add(name.replace(/[-_\s]/g, ''));
      }
    });

    const seen = new Set();
    notDeployedArtifacts = allDesigntimeArtifacts.filter(d => {
      const id = (d.Id || '').toLowerCase().trim();
      const name = (d.Name || '').toLowerCase().trim();
      if (!id && !name) return false;

      const dedupKey = id || name;
      if (seen.has(dedupKey)) return false;
      seen.add(dedupKey);

      const idClean = id ? id.replace(/[-_\s]/g, '') : '';
      const nameClean = name ? name.replace(/[-_\s]/g, '') : '';

      // Check if the iflow name or ID is available in ALL for started/failed interfaces
      // "if there then ignore, if not there then keep it"
      const isAvailableInAll =
        (name && deployedMap.has(name)) ||
        (id && deployedMap.has(id)) ||
        (nameClean && deployedMap.has(nameClean)) ||
        (idClean && deployedMap.has(idClean));

      return !isAvailableInAll;
    });

    updateKpiAndTable();
  }

  async function fetchDesigntimeArtifacts(force = false) {
    if (!tenantOrigin) return;
    const now = Date.now();
    if (!force && allDesigntimeArtifacts.length > 0 && (now - lastDesigntimeFetchTime) < 180000) {
      computeUndeployedArtifacts();
      return;
    }
    if (isFetchingDesigntime) return;
    isFetchingDesigntime = true;

    // Immediately update table if user is currently looking at the undeployed view
    if (activeCapability === 'integration-overview' && activeDetailFilters.has('not-deployed')) {
      renderIntegrationOverviewTable();
    }

    try {
      // Step 1: Cloud Foundry Integration Suite ContentPackages with $expand=Artifacts (Fastest - 1 network call)
      const bulkCandidates = [
        '/odata/1.0/workspace.svc/ContentEntities.ContentPackages?$expand=Artifacts&$format=json',
        '/odata/1.0/workspace.svc/ContentPackages?$expand=Artifacts&$format=json',
        '/itspaces/odata/1.0/workspace.svc/ContentEntities.ContentPackages?$expand=Artifacts&$format=json',
        '/itspaces/odata/1.0/workspace.svc/ContentPackages?$expand=Artifacts&$format=json'
      ];
      const bulkPackages = await fetchOData(bulkCandidates);
      if (bulkPackages && Array.isArray(bulkPackages) && bulkPackages.length > 0) {
        const collected = [];
        for (const pkg of bulkPackages) {
          const pkgId = pkg.reg_id || pkg.TechnicalName || pkg.Id || pkg.Name || '';
          const pkgName = pkg.DisplayName || pkg.Name || pkgId;
          const artifacts = (pkg.Artifacts && (pkg.Artifacts.results || pkg.Artifacts)) || [];
          if (Array.isArray(artifacts) && artifacts.length > 0) {
            for (const art of artifacts) {
              const artId = art.reg_id || art.TechnicalName || art.Id || art.Name;
              if (artId) {
                collected.push({
                  Id: artId,
                  Name: art.DisplayName || art.Name || artId,
                  Type: art.Type || art.ArtifactType || 'INTEGRATION_FLOW',
                  Version: art.Version || art.VersionId || '1.0.0',
                  PackageId: pkgId,
                  PackageName: pkgName,
                  CreatedBy: art.CreatedBy || art.Owner || art.ModifiedBy || art.CreatedByUserName || 'Unknown',
                  CreatedAt: art.CreatedAt || art.CreationDate || null
                });
              }
            }
          }
        }
        if (collected.length > 0) {
          console.log('[CPI Pulse] Successfully retrieved ' + collected.length + ' artifacts via expanded workspace packages');
          allDesigntimeArtifacts = collected;
          lastDesigntimeFetchTime = now;
          return;
        }
      }

      // Step 2: Fetch package list, then query artifacts per package (User verified Cloud Foundry endpoints)
      // GET /odata/1.0/workspace.svc/ContentEntities.ContentPackages?$format=json
      const packageListEndpoints = [
        '/odata/1.0/workspace.svc/ContentEntities.ContentPackages?$format=json',
        '/odata/1.0/workspace.svc/ContentPackages?$format=json',
        '/api/v1/IntegrationPackages?$select=Id,Name,CreatedBy&$format=json',
        '/itspaces/odata/1.0/workspace.svc/ContentEntities.ContentPackages?$format=json'
      ];

      const packages = await fetchOData(packageListEndpoints);
      if (packages && Array.isArray(packages) && packages.length > 0) {
        console.log('[CPI Pulse] Retrieved ' + packages.length + ' packages from workspace');
        const collected = [];
        const BATCH_SIZE = 5;
        for (let i = 0; i < packages.length; i += BATCH_SIZE) {
          if (isTenantUnauthorized) break;
          const batch = packages.slice(i, i + BATCH_SIZE);
          await Promise.all(batch.map(async (pkg) => {
            const pkgId = pkg.reg_id || pkg.TechnicalName || pkg.Id || pkg.Name || '';
            const pkgName = pkg.DisplayName || pkg.Name || pkgId;
            if (!pkgId) return;

            // Escaped package key for OData URL
            const escapedKey = encodeURIComponent(pkgId.replace(/'/g, "''"));
            const artifactEndpoints = [
              `/odata/1.0/workspace.svc/ContentEntities.ContentPackages('${escapedKey}')/Artifacts?$format=json`,
              `/odata/1.0/workspace.svc/ContentEntities.ContentPackages('${escapedKey}')/Artifacts?&$format=json`,
              `/odata/1.0/workspace.svc/ContentPackages('${escapedKey}')/Artifacts?$format=json`,
              `/api/v1/IntegrationPackages('${escapedKey}')/IntegrationDesigntimeArtifacts?$format=json`,
              `/itspaces/odata/1.0/workspace.svc/ContentEntities.ContentPackages('${escapedKey}')/Artifacts?$format=json`
            ];
            try {
              const artifacts = await fetchOData(artifactEndpoints);
              if (artifacts && Array.isArray(artifacts) && artifacts.length > 0) {
                for (const art of artifacts) {
                  const artId = art.reg_id || art.TechnicalName || art.Id || art.Name;
                  if (artId) {
                    collected.push({
                      Id: artId,
                      Name: art.DisplayName || art.Name || artId,
                      Type: art.Type || art.ArtifactType || 'INTEGRATION_FLOW',
                      Version: art.Version || art.VersionId || '1.0.0',
                      PackageId: pkgId,
                      PackageName: pkgName,
                      CreatedBy: art.CreatedBy || art.Owner || art.ModifiedBy || art.CreatedByUserName || 'Unknown',
                      CreatedAt: art.CreatedAt || art.CreationDate || null
                    });
                  }
                }
              }
            } catch (e) { }
          }));
        }

        if (collected.length > 0) {
          console.log('[CPI Pulse] Successfully retrieved ' + collected.length + ' package artifacts');
          allDesigntimeArtifacts = collected;
          lastDesigntimeFetchTime = now;
          return;
        }
      }

      // Step 3: Check intercepted design items from active tab
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        try {
          const stored = await chrome.storage.local.get([
            'cpi_intercepted_design_items',
            'cpi_discovered_design_endpoints'
          ]);
          if (stored.cpi_intercepted_design_items && Array.isArray(stored.cpi_intercepted_design_items) && stored.cpi_intercepted_design_items.length > 0) {
            console.log('[CPI Pulse] Using intercepted design items from active tab:', stored.cpi_intercepted_design_items.length);
            const collected = [];
            for (const item of stored.cpi_intercepted_design_items) {
              const artId = item.reg_id || item.TechnicalName || item.Id || item.Name;
              if (artId) {
                collected.push({
                  Id: artId,
                  Name: item.DisplayName || item.Name || artId,
                  Type: item.Type || item.ArtifactType || 'INTEGRATION_FLOW',
                  Version: item.Version || item.VersionId || '1.0.0',
                  PackageId: item.PackageId || item.Package || '-',
                  PackageName: item.PackageName || item.PackageId || item.Package || 'Design Package',
                  CreatedBy: item.CreatedBy || item.Owner || item.ModifiedBy || 'Unknown',
                  CreatedAt: item.CreatedAt || item.CreationDate || null
                });
              }
            }
            if (collected.length > 0) {
              allDesigntimeArtifacts = collected;
              lastDesigntimeFetchTime = now;
              return;
            }
          }
        } catch (e) { }
      }

      // Step 4: Direct IntegrationDesigntimeArtifacts (Fast fallback)
      const directArtifacts = await fetchOData([
        '/api/v1/IntegrationDesigntimeArtifacts?$format=json',
        '/cloudintegration/api/v1/IntegrationDesigntimeArtifacts?$format=json',
        '/api/v1/IntegrationFlows?$format=json'
      ]);
      if (directArtifacts && Array.isArray(directArtifacts) && directArtifacts.length > 0) {
        allDesigntimeArtifacts = directArtifacts.map(art => ({
          Id: art.Id || art.TechnicalName || art.Name || '',
          Name: art.Name || art.DisplayName || art.Id || '',
          Type: art.Type || art.ArtifactType || 'INTEGRATION_FLOW',
          Version: art.Version || art.VersionId || '1.0.0',
          PackageId: art.PackageId || art.Package || art.reg_id || '-',
          PackageName: art.PackageName || art.PackageId || art.Package || 'Default Package',
          CreatedBy: art.CreatedBy || art.Owner || art.ModifiedBy || 'Unknown',
          CreatedAt: art.CreatedAt || art.CreationDate || null
        }));
        lastDesigntimeFetchTime = now;
        return;
      }
    } catch (err) {
      console.warn('[CPI Pulse] Design-time fetch notice:', err);
    } finally {
      isFetchingDesigntime = false;
      computeUndeployedArtifacts();
      if (activeCapability === 'integration-overview') {
        renderIntegrationOverviewTable();
      }
    }
  }

  function syncTimeRangeData() {
    const rangeKey = timeRangeSelect ? timeRangeSelect.value : '24h';
    const now = Date.now();
    let pastMs = 24 * 60 * 60 * 1000;
    let label = 'Past 24 Hours';

    if (rangeKey === '1h') { pastMs = 1 * 60 * 60 * 1000; label = 'Past Hour'; }
    else if (rangeKey === '24h') { pastMs = 24 * 60 * 60 * 1000; label = 'Past 24 Hours'; }
    else if (rangeKey === '7d') { pastMs = 7 * 24 * 60 * 60 * 1000; label = 'Past 7 Days'; }
    else if (rangeKey === '30d') { pastMs = 30 * 24 * 60 * 60 * 1000; label = 'Past 30 Days'; }

    if (lblAvgTimeframe) lblAvgTimeframe.textContent = label;
    if (lblVolTimeframe) lblVolTimeframe.textContent = label;

    const cutoff = now - pastMs;
    allLogs = rawLogs.filter(l => {
      const t = getTimestampMs(l.LogStart || l.LogEnd);
      return t >= cutoff;
    });

    failedLogs = allLogs.filter(l => (l.Status || '').toUpperCase() === 'FAILED');

    renderCapabilityKPIs();
    renderDetailTable();
    populatePerfFlowDropdown();
    renderPerformanceAnalytics();
    saveLiveMetricsToStorage();
  }

  async function fetchArtifactErrorInformation(artifactId) {
    if (!artifactId) return null;
    if (artifactErrorCache[artifactId]) return artifactErrorCache[artifactId];
    if (!tenantOrigin) return null;

    const safeId = artifactId.replace(/'/g, "''");
    const encodedId = encodeURIComponent(artifactId);

    const endpoints = [
      `/api/v1/IntegrationRuntimeArtifacts('${safeId}')/ErrorInformation/\$value`,
      `/api/v1/IntegrationRuntimeArtifacts('${encodedId}')/ErrorInformation/\$value`,
      `/itspaces/odata/1.0/workspace.svc/IntegrationRuntimeArtifacts('${safeId}')/ErrorInformation/\$value`,
      `/itspaces/odata/1.0/workspace.svc/IntegrationRuntimeArtifacts('${encodedId}')/ErrorInformation/\$value`,
      `/api/v1/IntegrationRuntimeArtifacts('${encodedId}')/ErrorInformation?\$format=json`,
      `/itspaces/api/1.0/workspace/artifacts/${encodedId}/error`,
      `/itspaces/api/1.0/artifacts/${encodedId}/error`
    ];

    for (const ep of endpoints) {
      try {
        const url = `${tenantOrigin}${ep}`;
        const res = await fetch(url, {
          method: 'GET',
          credentials: 'include',
          headers: {
            'Accept': 'text/plain, application/json, application/xml, */*',
            'X-Requested-With': 'XMLHttpRequest'
          }
        });
        if (res.ok) {
          const contentType = res.headers.get('content-type') || '';
          if (contentType.includes('json')) {
            const json = await res.json();
            artifactErrorCache[artifactId] = json;
            return json;
          } else {
            const text = await res.text();
            if (text && text.trim()) {
              try {
                const parsed = JSON.parse(text.trim());
                artifactErrorCache[artifactId] = parsed;
                return parsed;
              } catch (e) {
                artifactErrorCache[artifactId] = text.trim();
                return artifactErrorCache[artifactId];
              }
            }
          }
        }
      } catch (e) { }
    }

    try {
      const mplRes = await fetch(`${tenantOrigin}/api/v1/MessageProcessingLogs?\$filter=IntegrationFlowName eq '${encodeURIComponent(artifactId)}' and Status eq 'FAILED'&\$orderby=LogEnd desc&\$top=1&\$format=json`, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        }
      });
      if (mplRes.ok) {
        const mplData = await mplRes.json();
        const logs = mplData?.d?.results || mplData?.value || (Array.isArray(mplData?.d) ? mplData.d : []);
        if (logs.length > 0 && logs[0].MessageGuid) {
          const err = await fetchMplErrorInformation(logs[0].MessageGuid);
          if (err) {
            artifactErrorCache[artifactId] = err;
            return err;
          }
        }
      }
    } catch (e) { }

    return null;
  }

  async function fetchMplErrorInformation(messageGuid) {
    if (!messageGuid) return null;
    if (mplErrorCache[messageGuid]) return mplErrorCache[messageGuid];
    if (!tenantOrigin) return null;

    const endpoints = [
      `/api/v1/MessageProcessingLogs('${messageGuid}')/ErrorInformation/\$value`,
      `/itspaces/odata/1.0/workspace.svc/MessageProcessingLogs('${messageGuid}')/ErrorInformation/\$value`,
      `/api/v1/MessageProcessingLogs('${messageGuid}')/ErrorInformation?\$format=json`
    ];

    for (const ep of endpoints) {
      try {
        const url = `${tenantOrigin}${ep}`;
        const res = await fetch(url, {
          method: 'GET',
          credentials: 'include',
          headers: {
            'Accept': 'text/plain, application/json, */*',
            'X-Requested-With': 'XMLHttpRequest'
          }
        });
        if (res.ok) {
          const contentType = res.headers.get('content-type') || '';
          if (contentType.includes('json')) {
            const json = await res.json();
            const err = json?.error?.message?.value || json?.error?.message || json?.ErrorInformation;
            if (err && String(err).trim()) {
              mplErrorCache[messageGuid] = String(err).trim();
              return mplErrorCache[messageGuid];
            }
          } else {
            const text = await res.text();
            if (text && text.trim()) {
              mplErrorCache[messageGuid] = text.trim();
              return mplErrorCache[messageGuid];
            }
          }
        }
      } catch (e) { }
    }
    return null;
  }

  async function preloadArtifactErrors() {
    if (!tenantOrigin) return;
    const errorArtifacts = allArtifacts.filter(a => (a.Status || '').toUpperCase() === 'ERROR');
    if (errorArtifacts.length === 0) return;

    await Promise.allSettled(errorArtifacts.map(async (a) => {
      const id = a.Id || a.Name;
      if (!id || artifactErrorCache[id]) return;
      const err = await fetchArtifactErrorInformation(id);
      if (err) {
        artifactErrorCache[id] = err;
      }
    }));

    if (activeCapability === 'integration-overview' || activeCapability === 'error-sentinel') {
      renderDetailTable();
    }
  }

  function renderCapabilityKPIs() {
    const total = allArtifacts.length;
    const started = allArtifacts.filter(a => (a.Status || '').toUpperCase() === 'STARTED').length;
    const error = allArtifacts.filter(a => (a.Status || '').toUpperCase() === 'ERROR').length;
    if (kpiIntegrationTotal) kpiIntegrationTotal.textContent = total;
    if (kpiIntegrationBreakdown) kpiIntegrationBreakdown.textContent = `${started} Started · ${error} Error`;

    const nonDiscardedLogs = allLogs.filter(l => (l.Status || '').toUpperCase() !== 'DISCARDED');
    const totalMsgs = nonDiscardedLogs.length;
    const failedCount = failedLogs.length;
    const completedCount = allLogs.filter(l => (l.Status || '').toUpperCase() === 'COMPLETED').length;
    if (kpiErrorSentinel) {
      kpiErrorSentinel.textContent = totalMsgs.toLocaleString();
      kpiErrorSentinel.className = failedCount === 0 ? 'sap-tile-kpi positive' : 'sap-tile-kpi negative';
    }
    const kpiErrorSubtext = document.getElementById('kpiErrorSentinelBreakdown') || document.querySelector('#tileErrorSentinel .sap-tile-subtext');
    if (kpiErrorSubtext) {
      if (totalMsgs === 0) {
        kpiErrorSubtext.textContent = '0 Messages';
      } else {
        kpiErrorSubtext.textContent = `${failedCount} Failed · ${completedCount} Completed`;
      }
    }

    const expiryThresholdMs = Date.now() + keystoreExpiryDays * 24 * 60 * 60 * 1000;
    const expiringCount = keystoreEntries.filter(k => {
      const ms = getTimestampMs(k.ValidNotAfter);
      return ms > 0 && ms <= expiryThresholdMs;
    }).length;
    if (kpiKeystoreGuardian) kpiKeystoreGuardian.textContent = keystoreEntries.length;
    if (kpiKeystoreSubtext) {
      if (keystoreEntries.length === 0) {
        kpiKeystoreSubtext.textContent = '0 Certificates';
      } else if (expiringCount > 0) {
        kpiKeystoreSubtext.textContent = `${expiringCount} Expiring Soon (≤ ${keystoreExpiryDays}d)`;
      } else {
        kpiKeystoreSubtext.textContent = `${keystoreEntries.length} Active (All Valid)`;
      }
    }
    const lblKeystoreTimeframe = document.getElementById('lblKeystoreTimeframe');
    if (lblKeystoreTimeframe) {
      lblKeystoreTimeframe.textContent = `Exp ≤ ${keystoreExpiryDays}d`;
    }
    const inputKeystoreExpiryDays = document.getElementById('inputKeystoreExpiryDays');
    if (inputKeystoreExpiryDays && document.activeElement !== inputKeystoreExpiryDays) {
      inputKeystoreExpiryDays.value = keystoreExpiryDays;
    }

    const activeQCount = jmsQueues.length;
    let totalJmsMsgs = 0;
    jmsQueues.forEach(q => {
      totalJmsMsgs += (Number(q.NumbOfMsgs ?? q.NumberMessages ?? q.MessageCount ?? q.MessagesInQueue ?? 0) || 0);
    });
    if (kpiJmsMonitor) kpiJmsMonitor.textContent = activeQCount.toLocaleString();
    const jmsSubtext = document.querySelector('#tileJmsMonitor .sap-tile-subtext');
    if (jmsSubtext) {
      if (jmsBrokerInfo && (jmsBrokerInfo.MaxCapacity || jmsBrokerInfo.Capacity)) {
        jmsSubtext.textContent = `${totalJmsMsgs} msgs · ${jmsBrokerInfo.MaxCapacity || jmsBrokerInfo.Capacity}`;
      } else {
        jmsSubtext.textContent = `${totalJmsMsgs} msgs in depth`;
      }
    }
  }

  function applyDetailPagination(list) {
    const totalCount = (list && Array.isArray(list)) ? list.length : 0;
    const paginationEl = document.getElementById('detailPagination');
    if (!paginationEl) return list;

    if (totalCount <= DETAIL_PAGE_SIZE) {
      paginationEl.style.display = 'none';
      return list;
    }

    const totalPages = Math.ceil(totalCount / DETAIL_PAGE_SIZE) || 1;
    if (detailCurrentPage > totalPages) detailCurrentPage = totalPages;
    if (detailCurrentPage < 1) detailCurrentPage = 1;

    paginationEl.style.display = 'flex';
    const btnPrev = document.getElementById('btnDetailPrevPage');
    const btnNext = document.getElementById('btnDetailNextPage');
    const pageNumEl = document.getElementById('detailPageNum');
    const pageInfoEl = document.getElementById('detailPageInfo');

    if (btnPrev) btnPrev.disabled = detailCurrentPage <= 1;
    if (btnNext) btnNext.disabled = detailCurrentPage >= totalPages;
    if (pageNumEl) pageNumEl.textContent = String(detailCurrentPage);
    if (pageInfoEl) {
      const start = (detailCurrentPage - 1) * DETAIL_PAGE_SIZE + 1;
      const end = Math.min(detailCurrentPage * DETAIL_PAGE_SIZE, totalCount);
      pageInfoEl.textContent = `Showing ${start}–${end} of ${totalCount}`;
    }

    const start = (detailCurrentPage - 1) * DETAIL_PAGE_SIZE;
    return list.slice(start, start + DETAIL_PAGE_SIZE);
  }

  function downloadCsv(filename, headers, rows) {
    function escapeCsvCell(cell) {
      if (cell === null || cell === undefined) return '""';
      const str = String(cell);
      if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return '"' + str + '"';
    }

    const csvLines = [
      headers.map(escapeCsvCell).join(','),
      ...rows.map(row => row.map(escapeCsvCell).join(','))
    ];

    const blob = new Blob(['\uFEFF' + csvLines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function getTimestampForFilename() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${yyyy}${mm}${dd}_${hh}${min}`;
  }

  function exportDetailTableToCsv() {
    if (!currentFilteredDetailList || currentFilteredDetailList.length === 0) {
      showToast('No records to download matching current filter.');
      return;
    }

    const ts = getTimestampForFilename();

    if (activeCapability === 'integration-overview') {
      if (activeDetailFilters.has('not-deployed')) {
        const headers = ['Artifact Name', 'Technical ID', 'Type', 'Version', 'Package Name', 'Package ID', 'Created By', 'Created Date Time'];
        const rows = currentFilteredDetailList.map(item => {
          const name = item.Name || item.Id || '';
          const id = item.Id || '';
          const type = item.Type || 'INTEGRATION_FLOW';
          const version = item.Version || '1.0.0';
          const pkgName = item.PackageName || item.PackageId || '';
          const pkgId = item.PackageId || '';
          const createdBy = item.CreatedBy || '-';
          const createdDateTime = item.CreatedAt ? formatWithTimezone(getTimestampMs(item.CreatedAt)) : '-';
          return [name, id, type, version, pkgName, pkgId, createdBy, createdDateTime];
        });

        const filename = `Undeployed_Integration_Artifacts_${ts}.csv`;
        downloadCsv(filename, headers, rows);
        showToast(`Downloaded ${rows.length} undeployed artifacts as CSV (${filename})`);
        return;
      }

      const headers = ['Artifact Name / ID', 'Type', 'Version', 'Status', 'Last Deployed / Modified', 'Runtime Diagnosis'];
      const rows = currentFilteredDetailList.map(item => {
        const id = item.Id || item.Name || '';
        const name = item.Name || item.Id || '';
        const type = item.Type || 'INTEGRATION_FLOW';
        const version = item.Version || '1.0.0';
        const st = (item.Status || 'STARTED').toUpperCase();
        const deployDate = formatWithTimezone(getArtifactDeployMs(item));

        let diagnosis = 'Active runtime artifact';
        if (st === 'ERROR') {
          const cached = artifactErrorCache[id];
          diagnosis = cached ? extractErrorSummary(cached, id) : 'Deployment failure recorded in tenant runtime';
        } else if (st === 'STOPPED') {
          diagnosis = 'Suspended by administrator';
        }

        return [name, type, version, st, deployDate, diagnosis];
      });

      const filename = `Integration_Artifacts_Overview_${ts}.csv`;
      downloadCsv(filename, headers, rows);
      showToast(`Downloaded ${rows.length} artifacts as CSV (${filename})`);

    } else if (activeCapability === 'error-sentinel') {
      const headers = ['Interface / iFlow', 'Message GUID', 'Status', 'Log Timestamp', 'Processing Duration', 'Processing Duration (ms)', 'Root Cause Diagnosis'];
      const rows = currentFilteredDetailList.map(msg => {
        const iflow = msg.IntegrationFlowName || 'Unknown';
        const guid = msg.MessageGuid || '';
        const st = (msg.Status || 'UNKNOWN').toUpperCase();
        const logTime = formatWithTimezone(msg.LogStart);
        const durMs = (getTimestampMs(msg.LogEnd) - getTimestampMs(msg.LogStart)) || 0;
        const durFormatted = formatMs(durMs);

        let diagnosis = 'Completed without runtime errors';
        if (st === 'FAILED') {
          const cached = mplErrorCache[guid];
          diagnosis = cached ? extractErrorSummary(cached) : 'Execution failed in tenant runtime';
        } else if (st !== 'COMPLETED') {
          diagnosis = st;
        }

        return [iflow, guid, st, logTime, durFormatted, durMs, diagnosis];
      });

      const filename = `Message_Processing_Logs_${ts}.csv`;
      downloadCsv(filename, headers, rows);
      showToast(`Downloaded ${rows.length} messages as CSV (${filename})`);

    } else if (activeCapability === 'cert-guardian') {
      const headers = ['Certificate Alias', 'Type', 'Subject DN / Owner', 'Valid Until / Expiry', 'Days Remaining', 'Status'];
      const now = Date.now();
      const rows = currentFilteredDetailList.map(k => {
        const alias = k.Alias || decodeHexalias(k.Hexalias) || 'Certificate';
        const type = k.Type || 'Certificate';
        const owner = k.Owner || '-';
        const validTo = formatWithTimezone(k.ValidNotAfter);
        const expMs = getTimestampMs(k.ValidNotAfter);
        const daysRemaining = expMs > 0 ? Math.round((expMs - now) / (1000 * 60 * 60 * 24)) : 0;
        const st = daysRemaining <= 0 ? 'EXPIRED' : (daysRemaining <= keystoreExpiryDays ? 'EXPIRING_SOON' : 'VALID');
        return [alias, type, owner, validTo, daysRemaining, st];
      });

      const filename = `Keystore_Certificates_${ts}.csv`;
      downloadCsv(filename, headers, rows);
      showToast(`Downloaded ${rows.length} certificates as CSV (${filename})`);

    } else if (activeCapability === 'jms-monitor') {
      const headers = ['Queue Name', 'Messages in Queue', 'Queue Capacity', 'Status', 'Access Type', 'Last Active / Modified'];
      const rows = currentFilteredDetailList.map(q => {
        const qName = q.QueueName || q.Name || 'Queue';
        const msgs = Number(q.NumbOfMsgs ?? q.NumberMessages ?? q.MessageCount ?? q.MessagesInQueue ?? 0);
        const cap = q.MaxCapacity || q.Capacity || '250 MB';
        const isActive = q.Active === '1' || q.Active === 1 || q.Active === true || (q.Active === undefined && q.State === '0');
        const st = isActive ? 'Active' : (q.Status || 'Inactive');
        const isExclusive = String(q.Exclusive) === '1' || q.Exclusive === 1 || q.Exclusive === true;
        const accessType = isExclusive ? 'Exclusive' : 'Non-Exclusive';
        const mod = formatWithTimezone(q.ModifiedTime || Date.now());
        return [qName, msgs, cap, st, accessType, mod];
      });

      const filename = `JMS_Queues_${ts}.csv`;
      downloadCsv(filename, headers, rows);
      showToast(`Downloaded ${rows.length} JMS queues as CSV (${filename})`);
    }
  }

  function exportSlowestLeaderboardToCsv() {
    if (!currentFilteredSlowestList || currentFilteredSlowestList.length === 0) {
      showToast('No integration flows to download matching current filter.');
      return;
    }

    const ts = getTimestampForFilename();
    const thresholdMs = Math.round(bottleneckThresholdSec * 1000);
    const warnMs = Math.round(thresholdMs * 0.75);

    const headers = [
      'Rank',
      'Integration Flow Name',
      'Average Runtime',
      'Average Runtime (ms)',
      'Max Runtime',
      'Max Runtime (ms)',
      'Total Messages',
      'Failed Messages',
      'Risk Level',
      'Diagnosis'
    ];

    const rows = currentFilteredSlowestList.map((item, index) => {
      const rank = `#${index + 1}`;
      const isSlow = item.avgDuration >= thresholdMs;
      const isFailedBottleneck = item.failed >= failureThresholdCount;

      let riskLabel = 'OPTIMAL';
      let diagnosis = 'Healthy / Fast execution';

      if (isSlow && isFailedBottleneck) {
        riskLabel = 'CRITICAL';
        diagnosis = `Bottleneck (≥ ${bottleneckThresholdSec.toFixed(1)}s) & Failures (${item.failed} ≥ ${failureThresholdCount})`;
      } else if (isSlow) {
        riskLabel = 'CRITICAL';
        diagnosis = item.failed > 0
          ? `Latency Bottleneck ≥ ${bottleneckThresholdSec.toFixed(1)}s (${item.failed} failed)`
          : `Latency Bottleneck ≥ ${bottleneckThresholdSec.toFixed(1)}s`;
      } else if (isFailedBottleneck) {
        riskLabel = 'CRITICAL';
        diagnosis = `Elevated Failures (${item.failed} ≥ ${failureThresholdCount})`;
      } else if (item.failed > 0) {
        riskLabel = 'WARNING';
        diagnosis = `Failures Detected (${item.failed} failed)`;
      } else if (item.avgDuration >= warnMs && warnMs > 0 && thresholdMs > 1000) {
        riskLabel = 'WARNING';
        diagnosis = `Moderate Latency ≥ ${(warnMs / 1000).toFixed(1)}s`;
      }

      return [
        rank,
        item.name,
        formatMs(item.avgDuration),
        item.avgDuration,
        formatMs(item.maxDuration),
        item.maxDuration,
        item.volume,
        item.failed,
        riskLabel,
        diagnosis
      ];
    });

    const filename = `Slowest_iFlows_Leaderboard_${ts}.csv`;
    downloadCsv(filename, headers, rows);
    showToast(`Downloaded ${rows.length} flows as CSV (${filename})`);
  }

  function renderDetailTable() {
    document.querySelectorAll('.sap-tile[data-capability]').forEach(t => {
      if (t.dataset.capability === activeCapability) t.classList.add('active-tile');
      else t.classList.remove('active-tile');
    });

    if (activeCapability === 'integration-overview') renderIntegrationOverviewTable();
    else if (activeCapability === 'error-sentinel') renderErrorSentinelTable();
    else if (activeCapability === 'cert-guardian') renderKeystoreTable();
    else if (activeCapability === 'jms-monitor') renderJmsQueueTable();
  }

  function renderIntegrationOverviewTable() {
    if (detailTableTitle) detailTableTitle.textContent = 'Integration Artifacts Overview';

    const startedCount = allArtifacts.filter(a => (a.Status || '').toUpperCase() === 'STARTED').length;
    const errorCount = allArtifacts.filter(a => (a.Status || '').toUpperCase() === 'ERROR').length;
    const notDeployedCount = notDeployedArtifacts.length;

    if (filterChipsContainer) {
      filterChipsContainer.innerHTML = `
        <button class="sap-chip ${activeDetailFilters.has('all') ? 'active' : ''}" data-chip="all">All (${allArtifacts.length})</button>
        <button class="sap-chip ${activeDetailFilters.has('started') ? 'active' : ''}" data-chip="started">Started (${startedCount})</button>
        <button class="sap-chip ${activeDetailFilters.has('error') ? 'active' : ''}" data-chip="error">Error (${errorCount})</button>
        <button class="sap-chip sap-chip-undeployed ${activeDetailFilters.has('not-deployed') ? 'active' : ''}" data-chip="not-deployed">Not Deployed (${notDeployedCount})</button>
      `;
    }

    const isUndeployedView = activeDetailFilters.has('not-deployed');

    if (detailTableHead) {
      if (isUndeployedView) {
        detailTableHead.innerHTML = `
          <tr>
            <th class="sortable ${detailSort.column === 'name' ? 'sorted-' + detailSort.dir : ''}" data-col="name">Artifact Name <span class="sort-icon">${detailSort.column === 'name' ? (detailSort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span></th>
            <th class="sortable ${detailSort.column === 'type' ? 'sorted-' + detailSort.dir : ''}" data-col="type">Type <span class="sort-icon">${detailSort.column === 'type' ? (detailSort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span></th>
            <th class="sortable ${detailSort.column === 'version' ? 'sorted-' + detailSort.dir : ''}" data-col="version">Version <span class="sort-icon">${detailSort.column === 'version' ? (detailSort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span></th>
            <th class="sortable ${detailSort.column === 'package' ? 'sorted-' + detailSort.dir : ''}" data-col="package">Package Name <span class="sort-icon">${detailSort.column === 'package' ? (detailSort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span></th>
            <th class="sortable ${detailSort.column === 'createdby' ? 'sorted-' + detailSort.dir : ''}" data-col="createdby">Created By <span class="sort-icon">${detailSort.column === 'createdby' ? (detailSort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span></th>
            <th class="sortable ${detailSort.column === 'createddatetime' ? 'sorted-' + detailSort.dir : ''}" data-col="createddatetime">Created Date Time <span class="sort-icon">${detailSort.column === 'createddatetime' ? (detailSort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span></th>
          </tr>
        `;
      } else {
        detailTableHead.innerHTML = `
          <tr>
            <th class="sortable ${detailSort.column === 'name' ? 'sorted-' + detailSort.dir : ''}" data-col="name">Artifact Name / ID <span class="sort-icon">${detailSort.column === 'name' ? (detailSort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span></th>
            <th class="sortable ${detailSort.column === 'type' ? 'sorted-' + detailSort.dir : ''}" data-col="type">Type <span class="sort-icon">${detailSort.column === 'type' ? (detailSort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span></th>
            <th class="sortable ${detailSort.column === 'version' ? 'sorted-' + detailSort.dir : ''}" data-col="version">Version <span class="sort-icon">${detailSort.column === 'version' ? (detailSort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span></th>
            <th class="sortable ${detailSort.column === 'status' ? 'sorted-' + detailSort.dir : ''}" data-col="status">Status <span class="sort-icon">${detailSort.column === 'status' ? (detailSort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span></th>
            <th class="sortable ${detailSort.column === 'deploy' ? 'sorted-' + detailSort.dir : ''}" data-col="deploy">Last Deployed / Modified <span class="sort-icon">${detailSort.column === 'deploy' ? (detailSort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span></th>
            <th>Runtime Diagnosis</th>
          </tr>
        `;
      }
    }

    let list = [];
    if (isUndeployedView) {
      list = [...notDeployedArtifacts];
      if (detailSearchQuery) {
        const q = detailSearchQuery.toLowerCase();
        list = list.filter(a =>
          (a.Name || a.Id || '').toLowerCase().includes(q) ||
          (a.PackageName || a.PackageId || '').toLowerCase().includes(q) ||
          (a.CreatedBy || '').toLowerCase().includes(q) ||
          (a.Type || '').toLowerCase().includes(q)
        );
      }

      list.sort((a, b) => {
        let vA = '', vB = '';
        if (detailSort.column === 'name') { vA = (a.Name || a.Id || '').toLowerCase(); vB = (b.Name || b.Id || '').toLowerCase(); }
        else if (detailSort.column === 'type') { vA = (a.Type || '').toLowerCase(); vB = (b.Type || '').toLowerCase(); }
        else if (detailSort.column === 'version') { vA = (a.Version || ''); vB = (b.Version || ''); }
        else if (detailSort.column === 'package') { vA = (a.PackageName || a.PackageId || '').toLowerCase(); vB = (b.PackageName || b.PackageId || '').toLowerCase(); }
        else if (detailSort.column === 'createdby') { vA = (a.CreatedBy || '').toLowerCase(); vB = (b.CreatedBy || '').toLowerCase(); }
        else if (detailSort.column === 'createddatetime' || detailSort.column === 'createdat') { vA = getTimestampMs(a.CreatedAt); vB = getTimestampMs(b.CreatedAt); }
        else { vA = (a.Name || a.Id || '').toLowerCase(); vB = (b.Name || b.Id || '').toLowerCase(); }
        if (vA < vB) return detailSort.dir === 'asc' ? -1 : 1;
        if (vA > vB) return detailSort.dir === 'asc' ? 1 : -1;
        return 0;
      });
    } else {
      list = [...allArtifacts];
      if (!activeDetailFilters.has('all')) {
        list = list.filter(a => {
          const st = (a.Status || '').toUpperCase();
          if (activeDetailFilters.has('started') && st === 'STARTED') return true;
          if (activeDetailFilters.has('error') && st === 'ERROR') return true;
          return false;
        });
      }

      if (detailSearchQuery) {
        const q = detailSearchQuery.toLowerCase();
        list = list.filter(a => (a.Name || a.Id || '').toLowerCase().includes(q));
      }

      list.sort((a, b) => {
        let vA = '', vB = '';
        if (detailSort.column === 'name') { vA = (a.Name || a.Id || '').toLowerCase(); vB = (b.Name || b.Id || '').toLowerCase(); }
        else if (detailSort.column === 'type') { vA = (a.Type || '').toLowerCase(); vB = (b.Type || '').toLowerCase(); }
        else if (detailSort.column === 'version') { vA = (a.Version || ''); vB = (b.Version || ''); }
        else if (detailSort.column === 'status') { vA = (a.Status || ''); vB = (b.Status || ''); }
        else if (detailSort.column === 'deploy') { vA = getArtifactDeployMs(a); vB = getArtifactDeployMs(b); }
        if (vA < vB) return detailSort.dir === 'asc' ? -1 : 1;
        if (vA > vB) return detailSort.dir === 'asc' ? 1 : -1;
        return 0;
      });
    }

    currentFilteredDetailList = list;
    if (detailTableCount) detailTableCount.textContent = list.length;
    if (btnExportDetailCsv) {
      btnExportDetailCsv.title = isUndeployedView
        ? `Download ${list.length} undeployed artifacts as CSV`
        : `Download ${list.length} filtered artifacts as CSV`;
    }
    if (!detailTableBody) return;
    detailTableBody.innerHTML = '';

    if (list.length === 0) {
      applyDetailPagination([]);
      if (isUndeployedView) {
        if (isFetchingDesigntime) {
          detailTableBody.innerHTML = '<tr><td colspan="6" class="sap-table-loading"><span class="sap-spinner-sm"></span> Scanning integration packages for undeployed artifacts...</td></tr>';
        } else if (allDesigntimeArtifacts.length > 0) {
          detailTableBody.innerHTML = `
            <tr>
              <td colspan="6" class="sap-table-loading" style="padding: 28px 16px;">
                <div style="font-size: 15px; font-weight: 600; color: var(--sap-status-green, #107e3e); margin-bottom: 4px;">✔ All Integration Artifacts Are Deployed</div>
                <div style="font-size: 12px; color: var(--sap-text-secondary, #6a6d70);">All ${allDesigntimeArtifacts.length} design-time artifacts across packages are currently deployed to runtime.</div>
              </td>
            </tr>
          `;
        } else {
          const tenantHost = tenantOrigin ? (function() { try { return new URL(tenantOrigin).hostname; } catch(e) { return tenantOrigin; } })() : 'CPI Tenant';
          detailTableBody.innerHTML = `
            <tr>
              <td colspan="6" style="padding: 32px 20px; text-align: center;">
                <div style="font-size: 15px; font-weight: 600; color: var(--sap-text-primary, #32363a); margin-bottom: 6px;">No Undeployed Artifacts Detected</div>
                <div style="font-size: 12px; color: var(--sap-text-secondary, #6a6d70); max-width: 620px; margin: 0 auto 16px auto; line-height: 1.5;">
                  Connected to <code>${escapeHtml(tenantHost)}</code>. All <strong>${allArtifacts.length}</strong> runtime artifacts are active. 
                  If you have undeployed Iflows in your Design packages, the Launchpad portal proxy may not expose the Design Workspace API directly.
                </div>
                <div style="display: flex; gap: 10px; justify-content: center; align-items: center;">
                  <button class="sap-btn-secondary" id="btnRetryDesigntimeScan" style="font-size: 12px; padding: 5px 14px; cursor: pointer;">
                    🔄 Retry Scan
                  </button>
                  <button class="sap-btn-secondary" id="btnConfigureDirectTenant" style="font-size: 12px; padding: 5px 14px; cursor: pointer;">
                    ⚙️ Configure Direct CPI Host
                  </button>
                </div>
              </td>
            </tr>
          `;
          const btnRetry = detailTableBody.querySelector('#btnRetryDesigntimeScan');
          if (btnRetry) {
            btnRetry.addEventListener('click', (e) => {
              e.preventDefault();
              fetchDesigntimeArtifacts(true);
            });
          }
          const btnCfg = detailTableBody.querySelector('#btnConfigureDirectTenant');
          if (btnCfg && tenantBadge) {
            btnCfg.addEventListener('click', (e) => {
              e.preventDefault();
              tenantBadge.click();
            });
          }
        }
      } else {
        detailTableBody.innerHTML = '<tr><td colspan="6" class="sap-table-loading">No artifacts match the current filter.</td></tr>';
      }
      return;
    }

    const displayList = applyDetailPagination(list);

    if (isUndeployedView) {
      displayList.forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>
            <strong>${escapeHtml(item.Name || item.Id)}</strong>
            ${item.Name && item.Id && item.Name !== item.Id ? `<div style="font-size: 11px; color: #8c9094;">${escapeHtml(item.Id)}</div>` : ''}
          </td>
          <td style="color: #6a6d70;">${escapeHtml(item.Type || 'INTEGRATION_FLOW')}</td>
          <td><span class="sap-version-tag">${escapeHtml(item.Version || '1.0.0')}</span></td>
          <td><strong>${escapeHtml(item.PackageName || item.PackageId || '-')}</strong></td>
          <td><div style="font-weight: 500;">${escapeHtml(item.CreatedBy || '-')}</div></td>
          <td style="color: #6a6d70;">${item.CreatedAt ? formatWithTimezone(getTimestampMs(item.CreatedAt)) : '-'}</td>
        `;
        detailTableBody.appendChild(tr);
      });
    } else {
      displayList.forEach(item => {
        const id = item.Id || item.Name;
        const st = (item.Status || 'STARTED').toUpperCase();
        let pillClass = 'started';
        let diagHtml = '<span style="color: #6a6d70;">Active runtime artifact</span>';

        if (st === 'ERROR') {
          pillClass = 'error';
          const cachedError = artifactErrorCache[id];
          if (cachedError) {
            const summary = extractErrorSummary(cachedError, id);
            diagHtml = `
              <div class="runtime-error-diag-wrap">
                <span class="error-diag-text" title="${escapeHtml(summary)}">${escapeHtml(summary)}</span>
                <button type="button" class="btn-view-error-details" data-id="${escapeHtml(id)}" data-type="artifact" title="Click to view full exception details and stack trace">Details</button>
              </div>
            `;
          } else if (tenantOrigin) {
            diagHtml = `
              <div class="runtime-error-diag-wrap">
                <span class="error-diag-loading">
                  <span class="sap-spinner-sm" style="border-top-color: var(--sap-negative); border-color: rgba(187,0,0,0.2);"></span>
                  Loading error diagnostics...
                </span>
              </div>
            `;
            if (!artifactLoadingSet.has(id)) {
              artifactLoadingSet.add(id);
              fetchArtifactErrorInformation(id).then(err => {
                artifactLoadingSet.delete(id);
                if (err) renderIntegrationOverviewTable();
              });
            }
          } else {
            const summary = 'Deployment failure recorded in tenant runtime';
            diagHtml = `
              <div class="runtime-error-diag-wrap">
                <span class="error-diag-text" title="${escapeHtml(summary)}">${escapeHtml(summary)}</span>
                <button type="button" class="btn-view-error-details" data-id="${escapeHtml(id)}" data-type="artifact" title="Click to view full exception details">Details</button>
              </div>
            `;
          }
        } else if (st === 'STOPPED') {
          pillClass = 'stopped';
          diagHtml = '<span style="color: #6a6d70;">Suspended by administrator</span>';
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${escapeHtml(item.Name || item.Id)}</strong></td>
          <td style="color: #6a6d70;">${escapeHtml(item.Type || 'INTEGRATION_FLOW')}</td>
          <td>${escapeHtml(item.Version || '1.0.0')}</td>
          <td><span class="status-pill ${pillClass}">${st}</span></td>
          <td>${formatWithTimezone(getArtifactDeployMs(item))}</td>
          <td>${diagHtml}</td>
        `;
        detailTableBody.appendChild(tr);
      });
    }
  }

  function renderErrorSentinelTable() {
    if (detailTableTitle) detailTableTitle.textContent = 'Message Processing Logs';

    const nonDiscardedLogs = allLogs.filter(l => (l.Status || '').toUpperCase() !== 'DISCARDED');
    const totalCount = nonDiscardedLogs.length;
    const failedCount = allLogs.filter(l => (l.Status || '').toUpperCase() === 'FAILED').length;
    const retryCount = allLogs.filter(l => (l.Status || '').toUpperCase() === 'RETRY').length;
    const completedCount = allLogs.filter(l => (l.Status || '').toUpperCase() === 'COMPLETED').length;
    const processingCount = allLogs.filter(l => (l.Status || '').toUpperCase() === 'PROCESSING').length;
    const escalatedCount = allLogs.filter(l => (l.Status || '').toUpperCase() === 'ESCALATED').length;
    const cancelledCount = allLogs.filter(l => {
      const s = (l.Status || '').toUpperCase();
      return s === 'CANCELLED' || s === 'CANCELED';
    }).length;
    const abandonedCount = allLogs.filter(l => {
      const s = (l.Status || '').toUpperCase();
      return s === 'ABANDONED' || s === 'ABONDED';
    }).length;
    const discardedCount = allLogs.filter(l => (l.Status || '').toUpperCase() === 'DISCARDED').length;

    if (filterChipsContainer) {
      filterChipsContainer.innerHTML = `
        <button class="sap-chip ${activeDetailFilters.has('all') ? 'active' : ''}" data-chip="all">All (${totalCount})</button>
        <button class="sap-chip ${activeDetailFilters.has('failed') ? 'active' : ''}" data-chip="failed">Failed (${failedCount})</button>
        <button class="sap-chip ${activeDetailFilters.has('retry') ? 'active' : ''}" data-chip="retry">Retry (${retryCount})</button>
        <button class="sap-chip ${activeDetailFilters.has('completed') ? 'active' : ''}" data-chip="completed">Completed (${completedCount})</button>
        <button class="sap-chip ${activeDetailFilters.has('processing') ? 'active' : ''}" data-chip="processing">Processing (${processingCount})</button>
        <button class="sap-chip ${activeDetailFilters.has('escalated') ? 'active' : ''}" data-chip="escalated">Escalated (${escalatedCount})</button>
        <button class="sap-chip ${activeDetailFilters.has('cancelled') ? 'active' : ''}" data-chip="cancelled">Cancelled (${cancelledCount})</button>
        <button class="sap-chip ${activeDetailFilters.has('abandoned') ? 'active' : ''}" data-chip="abandoned">Abandoned (${abandonedCount})</button>
        <button class="sap-chip ${activeDetailFilters.has('discarded') ? 'active' : ''}" data-chip="discarded">Discarded (${discardedCount})</button>
      `;
    }

    if (detailTableHead) {
      detailTableHead.innerHTML = `
        <tr>
          <th class="sortable ${detailSort.column === 'name' ? 'sorted-' + detailSort.dir : ''}" data-col="name">Interface / iFlow <span class="sort-icon">${detailSort.column === 'name' ? (detailSort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span></th>
          <th class="sortable ${detailSort.column === 'guid' ? 'sorted-' + detailSort.dir : ''}" data-col="guid">Message GUID <span class="sort-icon">${detailSort.column === 'guid' ? (detailSort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span></th>
          <th class="sortable ${detailSort.column === 'status' ? 'sorted-' + detailSort.dir : ''}" data-col="status">Status <span class="sort-icon">${detailSort.column === 'status' ? (detailSort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span></th>
          <th class="sortable ${detailSort.column === 'time' ? 'sorted-' + detailSort.dir : ''}" data-col="time">Log Timestamp <span class="sort-icon">${detailSort.column === 'time' ? (detailSort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span></th>
          <th class="sortable ${detailSort.column === 'dur' ? 'sorted-' + detailSort.dir : ''}" data-col="dur" title="Click to sort by Duration">Processing Duration <span class="sort-icon">${detailSort.column === 'dur' ? (detailSort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span></th>
          <th>Root Cause Diagnosis</th>
        </tr>
      `;
    }

    let list = [...allLogs];
    if (!activeDetailFilters.has('all')) {
      list = list.filter(l => {
        const st = (l.Status || '').toUpperCase();
        if (activeDetailFilters.has('failed') && st === 'FAILED') return true;
        if (activeDetailFilters.has('retry') && st === 'RETRY') return true;
        if (activeDetailFilters.has('completed') && st === 'COMPLETED') return true;
        if (activeDetailFilters.has('processing') && st === 'PROCESSING') return true;
        if (activeDetailFilters.has('escalated') && st === 'ESCALATED') return true;
        if (activeDetailFilters.has('cancelled') && (st === 'CANCELLED' || st === 'CANCELED')) return true;
        if ((activeDetailFilters.has('abandoned') || activeDetailFilters.has('abonded')) && (st === 'ABANDONED' || st === 'ABONDED')) return true;
        if (activeDetailFilters.has('discarded') && st === 'DISCARDED') return true;
        return false;
      });
    } else {
      list = list.filter(l => (l.Status || '').toUpperCase() !== 'DISCARDED');
    }

    if (detailSearchQuery) {
      const q = detailSearchQuery.toLowerCase();
      list = list.filter(l =>
        (l.IntegrationFlowName || '').toLowerCase().includes(q) ||
        (l.MessageGuid || '').toLowerCase().includes(q) ||
        (l.Status || '').toLowerCase().includes(q)
      );
    }

    list.sort((a, b) => {
      let vA = '', vB = '';
      if (detailSort.column === 'name') { vA = (a.IntegrationFlowName || '').toLowerCase(); vB = (b.IntegrationFlowName || '').toLowerCase(); }
      else if (detailSort.column === 'guid') { vA = (a.MessageGuid || ''); vB = (b.MessageGuid || ''); }
      else if (detailSort.column === 'status') { vA = (a.Status || ''); vB = (b.Status || ''); }
      else if (detailSort.column === 'time') { vA = getTimestampMs(a.LogStart); vB = getTimestampMs(b.LogStart); }
      else if (detailSort.column === 'dur') {
        const dA = (getTimestampMs(a.LogEnd) - getTimestampMs(a.LogStart)) || 0;
        const dB = (getTimestampMs(b.LogEnd) - getTimestampMs(b.LogStart)) || 0;
        return detailSort.dir === 'asc' ? dA - dB : dB - dA;
      }
      if (vA < vB) return detailSort.dir === 'asc' ? -1 : 1;
      if (vA > vB) return detailSort.dir === 'asc' ? 1 : -1;
      return 0;
    });

    currentFilteredDetailList = list;
    if (detailTableCount) detailTableCount.textContent = list.length;
    if (btnExportDetailCsv) {
      btnExportDetailCsv.title = `Download ${list.length} filtered messages as CSV`;
    }
    if (!detailTableBody) return;
    detailTableBody.innerHTML = '';

    if (list.length === 0) {
      applyDetailPagination([]);
      const selectedLabels = Array.from(activeDetailFilters).filter(k => k !== 'all').map(k => k.charAt(0).toUpperCase() + k.slice(1)).join(', ');
      const statusLabel = selectedLabels ? `matching (${selectedLabels}) ` : '';
      detailTableBody.innerHTML = `<tr><td colspan="6" class="sap-table-loading">No ${statusLabel}messages found in the selected time range.</td></tr>`;
      return;
    }

    const displayList = applyDetailPagination(list);
    displayList.forEach(msg => {
      const guid = msg.MessageGuid || '-';
      const dur = (getTimestampMs(msg.LogEnd) - getTimestampMs(msg.LogStart)) || 0;
      const st = (msg.Status || 'UNKNOWN').toUpperCase();

      let pillClass = 'neutral';
      if (st === 'COMPLETED') pillClass = 'started';
      else if (st === 'FAILED') pillClass = 'error';
      else if (st === 'RETRY' || st === 'ESCALATED') pillClass = 'stopped';
      else if (st === 'PROCESSING') pillClass = 'info';

      let diagHtml = '';
      if (st === 'FAILED') {
        const cachedMplError = mplErrorCache[guid];
        if (cachedMplError) {
          const summary = extractErrorSummary(cachedMplError);
          diagHtml = `
            <div class="runtime-error-diag-wrap">
              <span class="error-diag-text" title="${escapeHtml(summary)}">${escapeHtml(summary)}</span>
              <button type="button" class="btn-view-error-details" data-id="${escapeHtml(guid)}" data-type="mpl" title="Click to view full message error stack trace">Details</button>
            </div>
          `;
        } else if (tenantOrigin && guid !== '-') {
          diagHtml = `
            <div class="runtime-error-diag-wrap">
              <span class="error-diag-loading">
                <span class="sap-spinner-sm" style="border-top-color: var(--sap-negative); border-color: rgba(187,0,0,0.2);"></span>
                Fetching MPL error...
              </span>
            </div>
          `;
          if (!artifactLoadingSet.has(guid)) {
            artifactLoadingSet.add(guid);
            fetchMplErrorInformation(guid).then(err => {
              artifactLoadingSet.delete(guid);
              if (err) renderErrorSentinelTable();
            });
          }
        } else {
          const fallbackMsg = msg.LastError || 'Runtime message processing aborted with critical exception';
          const summary = extractErrorSummary(fallbackMsg);
          diagHtml = `
            <div class="runtime-error-diag-wrap">
              <span class="error-diag-text" title="${escapeHtml(summary)}">${escapeHtml(summary)}</span>
              <button type="button" class="btn-view-error-details" data-id="${escapeHtml(guid)}" data-type="mpl" title="Click to view message details">Details</button>
            </div>
          `;
        }
      } else if (st === 'COMPLETED') {
        diagHtml = '<span style="color: var(--sap-positive);">Successfully processed</span>';
      } else if (st === 'PROCESSING') {
        diagHtml = '<span style="color: var(--sap-brand-blue);">In-flight execution</span>';
      } else if (st === 'RETRY') {
        diagHtml = '<span style="color: var(--sap-critical);">Scheduled for retry</span>';
      } else if (st === 'ESCALATED') {
        diagHtml = '<span style="color: var(--sap-critical);">Escalated to administrator</span>';
      } else if (st === 'CANCELLED' || st === 'CANCELED') {
        diagHtml = '<span style="color: #6a6d70;">Cancelled by user/system</span>';
      } else if (st === 'ABANDONED' || st === 'ABONDED') {
        diagHtml = '<span style="color: #6a6d70;">Message abandoned</span>';
      } else if (st === 'DISCARDED') {
        diagHtml = '<span style="color: #6a6d70;">Message discarded</span>';
      } else {
        diagHtml = `<span style="color: #6a6d70;">${escapeHtml(st)}</span>`;
      }

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${escapeHtml(msg.IntegrationFlowName || 'Integration Flow')}</strong></td>
        <td style="font-family: monospace; font-size: 11px; color: #6a6d70;">${escapeHtml(guid)}</td>
        <td><span class="status-pill ${pillClass}">${st}</span></td>
        <td>${formatWithTimezone(msg.LogStart)}</td>
        <td><strong>${dur > 0 ? (dur < 1000 ? dur + ' ms' : (dur / 1000).toFixed(2) + ' s') : '-'}</strong></td>
        <td>${diagHtml}</td>
      `;
      detailTableBody.appendChild(tr);
    });
  }

  function renderKeystoreTable() {
    if (detailTableTitle) detailTableTitle.textContent = 'Manage Keystore - Certificates & Expiry';


    const now = Date.now();
    const expiryThresholdMs = now + keystoreExpiryDays * 24 * 60 * 60 * 1000;

    const expiringCount = keystoreEntries.filter(k => {
      const ms = getTimestampMs(k.ValidNotAfter);
      return ms > 0 && ms <= expiryThresholdMs;
    }).length;

    const validCount = keystoreEntries.length - expiringCount;

    if (filterChipsContainer) {
      filterChipsContainer.innerHTML = `
        <button class="sap-chip ${activeDetailFilters.has('all') ? 'active' : ''}" data-chip="all">All Certificates (${keystoreEntries.length})</button>
        <button class="sap-chip ${activeDetailFilters.has('expiring') ? 'active' : ''}" data-chip="expiring">Expiring Soon &le; ${keystoreExpiryDays}d (${expiringCount})</button>
        <button class="sap-chip ${activeDetailFilters.has('valid') ? 'active' : ''}" data-chip="valid">Valid (${validCount})</button>
      `;
    }

    if (detailTableHead) {
      detailTableHead.innerHTML = `
        <tr>
          <th class="sortable ${detailSort.column === 'name' ? 'sorted-' + detailSort.dir : ''}" data-col="name">Certificate Alias <span class="sort-icon">${detailSort.column === 'name' ? (detailSort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span></th>
          <th>Type</th>
          <th>Subject DN / Owner</th>
          <th class="sortable ${detailSort.column === 'expiry' ? 'sorted-' + detailSort.dir : ''}" data-col="expiry">Valid Until / Expiry <span class="sort-icon">${detailSort.column === 'expiry' ? (detailSort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span></th>
          <th class="sortable ${detailSort.column === 'days' ? 'sorted-' + detailSort.dir : ''}" data-col="days">Days Remaining <span class="sort-icon">${detailSort.column === 'days' ? (detailSort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span></th>
          <th>Status</th>
        </tr>
      `;
    }

    let list = [...keystoreEntries];
    if (!activeDetailFilters.has('all')) {
      list = list.filter(k => {
        const ms = getTimestampMs(k.ValidNotAfter);
        const isExpiring = ms > 0 && ms <= expiryThresholdMs;
        const isValid = ms === 0 || ms > expiryThresholdMs;
        if (activeDetailFilters.has('expiring') && isExpiring) return true;
        if (activeDetailFilters.has('valid') && isValid) return true;
        return false;
      });
    }

    if (detailSearchQuery) {
      const q = detailSearchQuery.toLowerCase();
      list = list.filter(k => (k.Alias || '').toLowerCase().includes(q) || (k.Owner || '').toLowerCase().includes(q));
    }

    list.sort((a, b) => {
      let vA = '', vB = '';
      if (detailSort.column === 'name') { vA = (a.Alias || '').toLowerCase(); vB = (b.Alias || '').toLowerCase(); }
      else if (detailSort.column === 'expiry' || detailSort.column === 'days') {
        vA = getTimestampMs(a.ValidNotAfter);
        vB = getTimestampMs(b.ValidNotAfter);
      }
      if (vA < vB) return detailSort.dir === 'asc' ? -1 : 1;
      if (vA > vB) return detailSort.dir === 'asc' ? 1 : -1;
      return 0;
    });

    currentFilteredDetailList = list;
    if (detailTableCount) detailTableCount.textContent = list.length;
    if (btnExportDetailCsv) {
      btnExportDetailCsv.title = `Download ${list.length} filtered certificates as CSV`;
    }
    if (!detailTableBody) return;
    detailTableBody.innerHTML = '';

    if (list.length === 0) {
      applyDetailPagination([]);
      detailTableBody.innerHTML = '<tr><td colspan="6" class="sap-table-loading">No certificates found in keystore The keystore is empty or no custom certificates have been deployed.</td></tr>';
      return;
    }

    const displayList = applyDetailPagination(list);
    displayList.forEach(k => {
      const expMs = getTimestampMs(k.ValidNotAfter);
      const daysRemaining = expMs > 0 ? Math.round((expMs - now) / (1000 * 60 * 60 * 24)) : 9999;
      let statusHtml = '<span class="status-pill started">Valid</span>';
      let daysColor = 'var(--sap-positive)';

      if (daysRemaining <= 0) {
        statusHtml = '<span class="status-pill error">Expired</span>';
        daysColor = 'var(--sap-negative)';
      } else if (daysRemaining <= Math.min(30, keystoreExpiryDays)) {
        statusHtml = '<span class="status-pill error">Critical Expiry</span>';
        daysColor = 'var(--sap-negative)';
      } else if (daysRemaining <= keystoreExpiryDays) {
        statusHtml = '<span class="status-pill stopped">Expiring Soon</span>';
        daysColor = 'var(--sap-critical)';
      }

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${k.Alias || decodeHexalias(k.Hexalias) || 'Certificate'}</strong></td>
        <td style="color: #6a6d70;">${k.Type || 'Certificate'}</td>
        <td style="color: #6a6d70; font-size: 11px; max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${k.Owner || '-'}">${k.Owner || '-'}</td>
        <td>${formatWithTimezone(k.ValidNotAfter)}</td>
        <td><strong style="color: ${daysColor};">${daysRemaining > 0 ? daysRemaining.toLocaleString() + ' days' : 'Expired'}</strong></td>
        <td>${statusHtml}</td>
      `;
      detailTableBody.appendChild(tr);
    });
  }

  function renderJmsQueueTable() {
    if (detailTableTitle) detailTableTitle.textContent = 'JMS Message Queues & Broker Depth';


    if (filterChipsContainer) {
      filterChipsContainer.innerHTML = `
        <button class="sap-chip active">All Queues (${jmsQueues.length})</button>
      `;
    }

    if (detailTableHead) {
      detailTableHead.innerHTML = `
        <tr>
          <th class="sortable ${detailSort.column === 'name' ? 'sorted-' + detailSort.dir : ''}" data-col="name">Queue Name <span class="sort-icon">${detailSort.column === 'name' ? (detailSort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span></th>
          <th class="sortable ${detailSort.column === 'msgs' ? 'sorted-' + detailSort.dir : ''}" data-col="msgs">Messages in Queue <span class="sort-icon">${detailSort.column === 'msgs' ? (detailSort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span></th>
          <th>Queue Capacity</th>
          <th>Status</th>
          <th class="sortable ${detailSort.column === 'accesstype' ? 'sorted-' + detailSort.dir : ''}" data-col="accesstype">Access Type <span class="sort-icon">${detailSort.column === 'accesstype' ? (detailSort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span></th>
          <th class="sortable ${detailSort.column === 'modified' ? 'sorted-' + detailSort.dir : ''}" data-col="modified">Last Active / Modified <span class="sort-icon">${detailSort.column === 'modified' ? (detailSort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span></th>
        </tr>
      `;
    }

    let list = [...jmsQueues];
    if (detailSearchQuery) {
      const q = detailSearchQuery.toLowerCase();
      list = list.filter(qItem => (qItem.QueueName || qItem.Name || '').toLowerCase().includes(q));
    }

    list.sort((a, b) => {
      let vA = '', vB = '';
      if (detailSort.column === 'name') {
        vA = (a.QueueName || a.Name || '').toLowerCase();
        vB = (b.QueueName || b.Name || '').toLowerCase();
      } else if (detailSort.column === 'msgs') {
        vA = Number(a.NumbOfMsgs ?? a.NumberMessages ?? a.MessageCount ?? 0);
        vB = Number(b.NumbOfMsgs ?? b.NumberMessages ?? b.MessageCount ?? 0);
      } else if (detailSort.column === 'accesstype') {
        vA = (a.AccessType || (String(a.Exclusive) === '1' ? 'Exclusive' : 'Non-Exclusive')).toLowerCase();
        vB = (b.AccessType || (String(b.Exclusive) === '1' ? 'Exclusive' : 'Non-Exclusive')).toLowerCase();
      } else if (detailSort.column === 'modified') {
        vA = getTimestampMs(a.ModifiedTime || a.LastModified || 0);
        vB = getTimestampMs(b.ModifiedTime || b.LastModified || 0);
      }
      if (vA < vB) return detailSort.dir === 'asc' ? -1 : 1;
      if (vA > vB) return detailSort.dir === 'asc' ? 1 : -1;
      return 0;
    });

    currentFilteredDetailList = list;
    if (detailTableCount) detailTableCount.textContent = list.length;
    if (btnExportDetailCsv) {
      btnExportDetailCsv.title = `Download ${list.length} filtered JMS queues as CSV`;
    }
    if (!detailTableBody) return;
    detailTableBody.innerHTML = '';

    if (list.length === 0) {
      applyDetailPagination([]);
      detailTableBody.innerHTML = '<tr><td colspan="6" class="sap-table-loading">' + (detailSearchQuery ? 'No JMS message queues match the current filter.' : 'No active JMS message queues found in this tenant.') + '</td></tr>';
      return;
    }

    const displayList = applyDetailPagination(list);
    displayList.forEach(q => {
      const qName = q.QueueName || q.Name || 'Queue';
      const msgs = Number(q.NumbOfMsgs ?? q.NumberMessages ?? q.MessageCount ?? 0);
      const isActive = q.Active === '1' || q.Active === 1 || q.Active === true || (q.Active === undefined && q.State === '0');
      const statusLabel = isActive ? 'Active' : (q.Status || 'Inactive');
      const statusClass = isActive ? 'started' : 'error';
      const capacityDisplay = q.MaxCapacity || q.Capacity || '250 MB';
      const isExclusive = String(q.Exclusive) === '1' || q.Exclusive === 1 || q.Exclusive === true;
      const accessType = isExclusive ? 'Exclusive' : 'Non-Exclusive';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <strong>${qName}</strong>
          ${q.isCustomCreated ? '<span class="sap-badge-chip" style="margin-left: 6px; font-size: 10px; background: rgba(0, 112, 242, 0.12); color: var(--sap-brand-blue); padding: 2px 6px; border-radius: 4px;">Custom</span>' : ''}
        </td>
        <td><strong style="color: ${msgs > 50 ? 'var(--sap-critical)' : 'var(--sap-text-primary)'};">${msgs} ${msgs === 1 ? 'msg' : 'msgs'}</strong></td>
        <td style="color: #6a6d70;">${capacityDisplay}</td>
        <td><span class="status-pill ${statusClass}">${statusLabel}</span></td>
        <td style="font-weight: 500;">${accessType}</td>
        <td>${formatWithTimezone(q.ModifiedTime || Date.now())}</td>
      `;
      detailTableBody.appendChild(tr);
    });
  }

  function getTimeRangeLabel() {
    const val = timeRangeSelect ? timeRangeSelect.value : '24h';
    if (val === '1h') return 'Past Hour';
    if (val === '24h') return 'Past 24 Hours';
    if (val === '7d') return 'Past 7 Days';
    if (val === '30d') return 'Past 30 Days';
    return 'Selected Window';
  }

  function populatePerfFlowDropdown() {
    if (!perfFlowFilterSelect) return;
    const currentVal = selectedPerfFlow;

    const flowMap = new Map();
    const targetModalLogs = selectedPerfFlow
      ? allLogs.filter(l => (l.IntegrationFlowName || '') === selectedPerfFlow)
      : allLogs;

    targetModalLogs.forEach(l => {
      const st = (l.Status || '').toUpperCase();
      if (st === 'DISCARDED') return;
      const name = l.IntegrationFlowName;
      if (name) flowMap.set(name, (flowMap.get(name) || 0) + 1);
    });

    allArtifacts.forEach(a => {
      const name = a.Id || a.Name;
      if (name && !flowMap.has(name)) flowMap.set(name, 0);
    });

    const sortedFlowNames = Array.from(flowMap.keys()).sort((a, b) => a.localeCompare(b));

    perfFlowFilterSelect.innerHTML = '<option value="">All Integration Flows (Global Aggregate)</option>';
    sortedFlowNames.forEach(name => {
      const count = flowMap.get(name);
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = count > 0 ? name + ' (' + count + ' msgs)' : name;
      perfFlowFilterSelect.appendChild(opt);
    });

    if (currentVal && sortedFlowNames.includes(currentVal)) {
      perfFlowFilterSelect.value = currentVal;
    } else {
      perfFlowFilterSelect.value = '';
      selectedPerfFlow = '';
    }

    if (btnClearFlowFilter) {
      btnClearFlowFilter.style.display = perfFlowFilterSelect.value ? 'inline-flex' : 'none';
    }
  }

  function calculatePeakWindow(hourBuckets, totalLogs, tzKey) {
    if (totalLogs === 0) {
      return {
        kpiText: '--',
        scopeText: 'No Activity',
        subtext: 'Click for Hourly Chart ↗',
        isUniform: false,
        peakHours: [],
        maxCount: 0
      };
    }

    const hours = Object.keys(hourBuckets).map(Number);
    const counts = hours.map(h => hourBuckets[h] || 0);
    const maxCount = Math.max(...counts);

    if (maxCount === 0) {
      return {
        kpiText: '--',
        scopeText: 'No Activity',
        subtext: 'Click for Hourly Chart ↗',
        isUniform: false,
        peakHours: [],
        maxCount: 0
      };
    }

    const peakHours = hours.filter(h => hourBuckets[h] === maxCount);
    const activeHours = hours.filter(h => hourBuckets[h] > 0);
    const pad = n => String(n).padStart(2, '0');
    const tzAbbr = getTzAbbreviation(new Date(), tzKey);
    const tzSuffix = tzAbbr ? ` (${tzAbbr})` : '';

    // Case 1: All 24 hours have the exact same count (24/7 continuous uniform throughput)
    if (peakHours.length === 24) {
      return {
        kpiText: `Steady (${maxCount}/hr)`,
        scopeText: 'Uniform 24h Load',
        subtext: 'Click for Hourly Chart ↗',
        isUniform: true,
        peakHours,
        maxCount
      };
    }

    // Case 2: All active hours have the exact same count (e.g., job runs periodically with equal messages)
    if (peakHours.length === activeHours.length && activeHours.length > 1) {
      activeHours.sort((a, b) => a - b);
      let isContiguous = true;
      for (let i = 1; i < activeHours.length; i++) {
        if (activeHours[i] !== activeHours[i - 1] + 1) {
          isContiguous = false;
          break;
        }
      }

      if (isContiguous) {
        const startHr = activeHours[0];
        const endHr = (activeHours[activeHours.length - 1] + 1) % 24;
        return {
          kpiText: `${pad(startHr)}:00 - ${pad(endHr)}:00`,
          scopeText: `Steady (${maxCount} msgs/hr)`,
          subtext: 'Click for Hourly Chart ↗',
          isUniform: true,
          peakHours,
          maxCount
        };
      } else {
        return {
          kpiText: `${activeHours.length}h Equal (${maxCount}/hr)`,
          scopeText: 'Even Distribution',
          subtext: 'Click for Hourly Chart ↗',
          isUniform: true,
          peakHours,
          maxCount
        };
      }
    }

    // Case 3: Multiple hours tied for highest volume, but other hours had lower volume
    if (peakHours.length > 1) {
      peakHours.sort((a, b) => a - b);
      let isContiguous = true;
      for (let i = 1; i < peakHours.length; i++) {
        if (peakHours[i] !== peakHours[i - 1] + 1) {
          isContiguous = false;
          break;
        }
      }

      if (isContiguous) {
        const startHr = peakHours[0];
        const endHr = (peakHours[peakHours.length - 1] + 1) % 24;
        return {
          kpiText: `${pad(startHr)}:00 - ${pad(endHr)}:00`,
          scopeText: `Peak Window (${maxCount} msgs)`,
          subtext: 'Click for Hourly Chart ↗',
          isUniform: false,
          peakHours,
          maxCount
        };
      } else if (peakHours.length <= 3) {
        return {
          kpiText: peakHours.map(h => `${pad(h)}:00`).join(', '),
          scopeText: `Tied Peak (${maxCount} msgs)`,
          subtext: 'Click for Hourly Chart ↗',
          isUniform: false,
          peakHours,
          maxCount
        };
      } else {
        return {
          kpiText: `${peakHours.length}h Peak (${maxCount} msgs)`,
          scopeText: 'Multi-Hour Peak',
          subtext: 'Click for Hourly Chart ↗',
          isUniform: false,
          peakHours,
          maxCount
        };
      }
    }

    // Case 4: Single distinct peak hour
    const singlePeak = peakHours[0];
    return {
      kpiText: `${pad(singlePeak)}:00${tzSuffix}`,
      scopeText: `Busiest Hour (${maxCount} msgs)`,
      subtext: 'Click for Hourly Chart ↗',
      isUniform: false,
      peakHours,
      maxCount
    };
  }

  function updatePerfSortIndicators() {
    const ths = document.querySelectorAll('#slowestTable thead th.sortable');
    ths.forEach(th => {
      const col = th.dataset.sort;
      const icon = th.querySelector('.sort-icon');
      if (col === perfSort.column) {
        th.classList.remove('sorted-asc', 'sorted-desc');
        th.classList.add(perfSort.dir === 'asc' ? 'sorted-asc' : 'sorted-desc');
        if (icon) icon.textContent = perfSort.dir === 'asc' ? '▲' : '▼';
      } else {
        th.classList.remove('sorted-asc', 'sorted-desc');
        if (icon) icon.textContent = '⇅';
      }
    });

    const isBottleneck = activePerfFilter === 'bottlenecks' || activePerfFilter === 'latency';
    const isFailure = activePerfFilter === 'failures';

    if (kpiAvgSubtext) {
      if (perfSort.column === 'avg' && !isBottleneck && !isFailure) {
        kpiAvgSubtext.textContent = perfSort.dir === 'asc' ? 'Sorted Low-to-High ▲' : 'Sorted High-to-Low ▼';
      } else {
        kpiAvgSubtext.textContent = 'Click to sort ↓';
      }
    }
    if (tileAvgRuntime) {
      tileAvgRuntime.classList.toggle('active-tile', perfSort.column === 'avg' && !isBottleneck && !isFailure);
    }

    if (kpiVolSubtext) {
      if (perfSort.column === 'volume' && !isBottleneck && !isFailure) {
        kpiVolSubtext.textContent = perfSort.dir === 'asc' ? 'Sorted Low-to-High ▲' : 'Sorted High-to-Low ▼';
      } else {
        kpiVolSubtext.textContent = 'Click to sort ↓';
      }
    }
    if (tileMsgVolume) {
      tileMsgVolume.classList.toggle('active-tile', perfSort.column === 'volume' && !isBottleneck && !isFailure);
    }

    if (tileSlowestAlert) {
      tileSlowestAlert.classList.toggle('active-tile', isBottleneck);
    }
    if (kpiSlowSubtext) {
      kpiSlowSubtext.textContent = isBottleneck
        ? 'Active Filter (Click to Reset) ✕'
        : 'Filter Bottlenecks';
    }
  }

  function renderPerformanceAnalytics() {
    const targetLogs = selectedPerfFlow
      ? allLogs.filter(l => (l.IntegrationFlowName || '') === selectedPerfFlow)
      : allLogs;

    const nonDiscardedLogs = targetLogs.filter(l => (l.Status || '').toUpperCase() !== 'DISCARDED');
    const totalLogs = nonDiscardedLogs.length;

    let totalDurationMs = 0;
    let validDurationCount = 0;
    let maxFlowDur = 0;
    let failedCount = 0;
    const hourBuckets = {};
    for (let i = 0; i < 24; i++) hourBuckets[i] = 0;

    targetLogs.forEach(l => {
      const st = (l.Status || '').toUpperCase();
      if (st === 'DISCARDED') return;
      if (st === 'FAILED') failedCount++;
      const startMs = getTimestampMs(l.LogStart);
      const endMs = getTimestampMs(l.LogEnd);
      if (startMs && endMs && endMs >= startMs) {
        const dur = endMs - startMs;
        totalDurationMs += dur;
        validDurationCount++;
        if (dur > maxFlowDur) maxFlowDur = dur;
      }
      if (startMs) {
        const d = new Date(startMs);
        let hr = d.getHours();
        if (currentTimezone && currentTimezone !== 'local') {
          try {
            const tzHourStr = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: currentTimezone }).format(d);
            hr = parseInt(tzHourStr, 10) % 24;
          } catch (e) { }
        }
        hourBuckets[hr] = (hourBuckets[hr] || 0) + 1;
      }
    });

    const avgRuntime = validDurationCount > 0 ? Math.round(totalDurationMs / validDurationCount) : 0;
    const peakResult = calculatePeakWindow(hourBuckets, totalLogs, currentTimezone);

    if (kpiAvgRuntime) kpiAvgRuntime.textContent = formatMs(avgRuntime);
    if (kpiVolume) kpiVolume.textContent = totalLogs.toLocaleString();

    if (kpiPeakHours) kpiPeakHours.textContent = peakResult.kpiText;
    if (lblPeakScope) lblPeakScope.textContent = peakResult.scopeText;
    if (kpiPeakSubtext) kpiPeakSubtext.textContent = peakResult.subtext;

    // Calculate Bottleneck Count (iFlows with avg runtime >= bottleneckThresholdSec OR failures >= failureThresholdCount)
    const flowMap = {};
    targetLogs.forEach(l => {
      const st = (l.Status || '').toUpperCase();
      if (st === 'DISCARDED') return;
      const name = l.IntegrationFlowName || 'Unknown iFlow';
      if (!flowMap[name]) flowMap[name] = { name, durations: [], total: 0, failed: 0 };
      flowMap[name].total++;
      if (st === 'FAILED') flowMap[name].failed++;
      const sMs = getTimestampMs(l.LogStart);
      const eMs = getTimestampMs(l.LogEnd);
      if (sMs && eMs && eMs >= sMs) flowMap[name].durations.push(eMs - sMs);
    });

    const computedFlows = Object.values(flowMap).map(f => {
      const sum = f.durations.reduce((a, b) => a + b, 0);
      const avg = f.durations.length > 0 ? Math.round(sum / f.durations.length) : 0;
      return { ...f, avgDuration: avg };
    });

    const bottleneckMs = Math.round(bottleneckThresholdSec * 1000);
    const bottleneckCount = computedFlows.filter(f => f.avgDuration >= bottleneckMs || f.failed >= failureThresholdCount).length;

    const inputBottleneckThreshold = document.getElementById('inputBottleneckThreshold');
    if (inputBottleneckThreshold && document.activeElement !== inputBottleneckThreshold) {
      inputBottleneckThreshold.value = bottleneckThresholdSec.toFixed(1);
    }
    const inputFailureThreshold = document.getElementById('inputFailureThreshold');
    if (inputFailureThreshold && document.activeElement !== inputFailureThreshold) {
      inputFailureThreshold.value = failureThresholdCount;
    }

    if (lblSlowTimeframe) {
      lblSlowTimeframe.textContent = `Avg ≥ ${bottleneckThresholdSec.toFixed(1)}s · Failures ≥ ${failureThresholdCount}`;
    }
    if (tileSlowestAlert) {
      tileSlowestAlert.title = `Click to filter leaderboard to Bottlenecks (Avg ≥ ${bottleneckThresholdSec.toFixed(1)}s or Failures ≥ ${failureThresholdCount})`;
    }
    const chipBottlenecks = document.getElementById('chipBottlenecks');
    if (chipBottlenecks) {
      chipBottlenecks.textContent = 'All Bottlenecks';
    }
    const chipLatency = document.getElementById('chipLatency');
    if (chipLatency) {
      chipLatency.textContent = `Latency (≥ ${bottleneckThresholdSec.toFixed(1)}s)`;
    }
    const chipFailures = document.getElementById('chipFailures');
    if (chipFailures) {
      chipFailures.textContent = `Failures (≥ ${failureThresholdCount})`;
    }

    if (kpiSlowCount) {
      kpiSlowCount.textContent = bottleneckCount;
      if (bottleneckCount > 0) {
        kpiSlowCount.className = 'sap-tile-kpi negative';
      } else {
        kpiSlowCount.className = 'sap-tile-kpi neutral';
      }
    }
    if (lblSlowScope) {
      lblSlowScope.textContent = bottleneckCount === 1 ? '1 Bottleneck iFlow' : `${bottleneckCount} Bottleneck iFlows`;
    }
    if (kpiSlowSubtext) {
      kpiSlowSubtext.textContent = (activePerfFilter === 'bottlenecks' || activePerfFilter === 'latency')
        ? 'Active Filter (Click to Reset) ✕'
        : 'Filter Bottlenecks';
    }
    if (tileSlowestAlert) {
      tileSlowestAlert.classList.toggle('active-tile', activePerfFilter === 'bottlenecks');
    }

    updatePerfSortIndicators();
    renderSlowestTable(targetLogs);
  }

  function formatMs(ms) {
    if (!ms || ms <= 0) return '0 ms';
    if (ms < 1000) return ms + ' ms';
    return (ms / 1000).toFixed(2) + ' s';
  }

  function renderSlowestTable(logsSource) {
    const flowMap = {};
    logsSource.forEach(l => {
      const st = (l.Status || '').toUpperCase();
      if (st === 'DISCARDED') return;
      const name = l.IntegrationFlowName || 'Unknown iFlow';
      if (!flowMap[name]) {
        flowMap[name] = { name, durations: [], total: 0, failed: 0 };
      }
      flowMap[name].total++;
      if (st === 'FAILED') {
        flowMap[name].failed++;
      }
      const startMs = getTimestampMs(l.LogStart);
      const endMs = getTimestampMs(l.LogEnd);
      if (startMs && endMs && endMs >= startMs) {
        flowMap[name].durations.push(endMs - startMs);
      }
    });

    let slowestList = Object.values(flowMap).map(f => {
      const sum = f.durations.reduce((a, b) => a + b, 0);
      const avg = f.durations.length > 0 ? Math.round(sum / f.durations.length) : 0;
      const max = f.durations.length > 0 ? Math.max(...f.durations) : 0;
      return {
        name: f.name,
        avgDuration: avg,
        maxDuration: max,
        volume: f.total,
        failed: f.failed
      };
    });

    if (selectedPerfFlow) {
      slowestList = slowestList.filter(f => f.name === selectedPerfFlow);
    }

    if (activePerfFilter === 'bottlenecks') {
      slowestList = slowestList.filter(f => f.avgDuration >= Math.round(bottleneckThresholdSec * 1000) || f.failed >= failureThresholdCount);
    } else if (activePerfFilter === 'latency') {
      slowestList = slowestList.filter(f => f.avgDuration >= Math.round(bottleneckThresholdSec * 1000));
    } else if (activePerfFilter === 'failures') {
      slowestList = slowestList.filter(f => f.failed >= failureThresholdCount);
    }

    if (perfSearchQuery) {
      const q = perfSearchQuery.toLowerCase();
      slowestList = slowestList.filter(f => f.name.toLowerCase().includes(q));
    }

    slowestList.sort((a, b) => {
      let vA = 0, vB = 0;
      if (perfSort.column === 'name') {
        const nA = a.name.toLowerCase(), nB = b.name.toLowerCase();
        if (nA < nB) return perfSort.dir === 'asc' ? -1 : 1;
        if (nA > nB) return perfSort.dir === 'asc' ? 1 : -1;
        return 0;
      }
      if (perfSort.column === 'avg' || perfSort.column === 'rank') { vA = a.avgDuration; vB = b.avgDuration; }
      else if (perfSort.column === 'max') { vA = a.maxDuration; vB = b.maxDuration; }
      else if (perfSort.column === 'volume') { vA = a.volume; vB = b.volume; }
      else if (perfSort.column === 'failed') { vA = a.failed; vB = b.failed; }
      return perfSort.dir === 'asc' ? vA - vB : vB - vA;
    });

    currentFilteredSlowestList = slowestList;
    if (slowestCountBadge) slowestCountBadge.textContent = slowestList.length;
    if (btnExportPerfCsv) {
      btnExportPerfCsv.title = `Download ${slowestList.length} filtered flows as CSV`;
    }
    if (!slowestTableBody) return;
    slowestTableBody.innerHTML = '';

    if (slowestList.length === 0) {
      let msg = selectedPerfFlow
        ? 'No message processing logs found for "' + selectedPerfFlow + '" matching current filter.'
        : 'No integration flows match the current performance filter.';
      let resetBtn = '';

      if (activePerfFilter === 'bottlenecks') {
        msg = `No bottlenecks (Avg ≥ ${bottleneckThresholdSec.toFixed(1)}s or Failures ≥ ${failureThresholdCount}) found in the selected timeframe.`;
        resetBtn = '<button type="button" class="btn-reset-perf-filter" id="btnResetPerfFilter" style="margin-left: 12px; padding: 4px 12px; font-size: 12px; font-weight: 600; background: var(--sap-brand-blue, #0070f2); color: #fff; border: none; border-radius: 4px; cursor: pointer;">Show All Flows</button>';
      } else if (activePerfFilter === 'latency') {
        msg = `No latency bottlenecks (≥ ${bottleneckThresholdSec.toFixed(1)}s) found in the selected timeframe.`;
        resetBtn = '<button type="button" class="btn-reset-perf-filter" id="btnResetPerfFilter" style="margin-left: 12px; padding: 4px 12px; font-size: 12px; font-weight: 600; background: var(--sap-brand-blue, #0070f2); color: #fff; border: none; border-radius: 4px; cursor: pointer;">Show All Flows</button>';
      } else if (activePerfFilter === 'failures') {
        msg = `No integration flows with ≥ ${failureThresholdCount} failure${failureThresholdCount === 1 ? '' : 's'} found in the selected timeframe.`;
        resetBtn = '<button type="button" class="btn-reset-perf-filter" id="btnResetPerfFilter" style="margin-left: 12px; padding: 4px 12px; font-size: 12px; font-weight: 600; background: var(--sap-brand-blue, #0070f2); color: #fff; border: none; border-radius: 4px; cursor: pointer;">Show All Flows</button>';
      } else if (perfSearchQuery) {
        msg = 'No integration flows match search query "' + perfSearchQuery + '".';
      }

      slowestTableBody.innerHTML = '<tr><td colspan="7" class="sap-table-loading" style="padding: 24px 16px; text-align: center;">' + msg + resetBtn + '</td></tr>';

      const btnReset = document.getElementById('btnResetPerfFilter');
      if (btnReset) {
        btnReset.addEventListener('click', () => {
          activePerfFilter = 'all';
          const perfFilterChips = document.getElementById('perfFilterChips');
          if (perfFilterChips) {
            perfFilterChips.querySelectorAll('.sap-chip').forEach(c => c.classList.toggle('active', c.dataset.perfFilter === 'all'));
          }
          updatePerfSortIndicators();
          renderSlowestTable(logsSource);
          showToast('Showing all integration flows');
        });
      }
      return;
    }

    const thresholdMs = Math.round(bottleneckThresholdSec * 1000);
    const warnMs = Math.round(thresholdMs * 0.75);

    slowestList.forEach((item, index) => {
      let riskClass = 'low';
      let riskLabel = 'OPTIMAL';
      let diagnosis = 'Healthy / Fast execution';
      const isSlow = item.avgDuration >= thresholdMs;
      const isFailedBottleneck = item.failed >= failureThresholdCount;

      if (isSlow && isFailedBottleneck) {
        riskClass = 'high';
        riskLabel = 'CRITICAL';
        diagnosis = `Bottleneck (&ge; ${bottleneckThresholdSec.toFixed(1)}s) & Failures (${item.failed} &ge; ${failureThresholdCount})`;
      } else if (isSlow) {
        riskClass = 'high';
        riskLabel = 'CRITICAL';
        if (item.failed > 0) {
          diagnosis = `Latency Bottleneck &ge; ${bottleneckThresholdSec.toFixed(1)}s (${item.failed} failed)`;
        } else {
          diagnosis = `Latency Bottleneck &ge; ${bottleneckThresholdSec.toFixed(1)}s`;
        }
      } else if (isFailedBottleneck) {
        riskClass = 'high';
        riskLabel = 'CRITICAL';
        diagnosis = `Elevated Failures (${item.failed} &ge; ${failureThresholdCount})`;
      } else if (item.failed > 0) {
        riskClass = 'medium';
        riskLabel = 'WARNING';
        diagnosis = `Failures Detected (${item.failed} failed)`;
      } else if (item.avgDuration >= warnMs && warnMs > 0 && thresholdMs > 1000) {
        riskClass = 'medium';
        riskLabel = 'WARNING';
        diagnosis = `Moderate Latency &ge; ${(warnMs / 1000).toFixed(1)}s`;
      }

      const isWarnSlow = item.avgDuration >= warnMs && warnMs > 0 && thresholdMs > 1000;
      const avgColor = isSlow ? 'var(--sap-negative)' : (isWarnSlow ? 'var(--sap-critical)' : 'var(--sap-text-primary)');

      let failedCell = '0';
      if (isFailedBottleneck) {
        failedCell = `<span style="color: var(--sap-negative); font-weight: 700;" title="Breaches Failure Threshold (&ge; ${failureThresholdCount})">${item.failed}</span>`;
      } else if (item.failed > 0) {
        failedCell = `<span style="color: var(--sap-critical); font-weight: 600;" title="Failures Detected (&lt; ${failureThresholdCount})">${item.failed}</span>`;
      }

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>#${index + 1}</strong></td>
        <td>
          <a href="#" class="perf-flow-link" data-flow="${item.name}" title="Click to filter 4 performance tiles to this iFlow">
            <strong>${item.name}</strong>
          </a>
        </td>
        <td><strong style="color: ${avgColor};">${formatMs(item.avgDuration)}</strong></td>
        <td style="color: #6a6d70;">${formatMs(item.maxDuration)}</td>
        <td>${item.volume}</td>
        <td>${failedCell}</td>
        <td>
          <span class="risk-tag ${riskClass}">${riskLabel}</span>
          <span style="margin-left: 6px; font-size: 11px; color: #6a6d70;">${diagnosis}</span>
        </td>
      `;
      slowestTableBody.appendChild(tr);
    });
  }

  function showHourlyChartModal() {
    if (!hourlyModalDesc || !hourlyChartContainer || !hourlyModal) return;
    const tzAbbr = getTzAbbreviation(new Date(), currentTimezone);
    const scopeDesc = selectedPerfFlow ? 'for "' + selectedPerfFlow + '"' : 'across all integration flows';
    const targetLogs = selectedPerfFlow
      ? allLogs.filter(l => (l.IntegrationFlowName || '') === selectedPerfFlow)
      : allLogs;

    const nonDiscardedTarget = targetLogs.filter(l => (l.Status || '').toUpperCase() !== 'DISCARDED');
    const hourBuckets = {};
    for (let i = 0; i < 24; i++) hourBuckets[i] = 0;

    targetLogs.forEach(l => {
      const st = (l.Status || '').toUpperCase();
      if (st === 'DISCARDED') return;
      const startMs = getTimestampMs(l.LogStart);
      if (startMs) {
        const d = new Date(startMs);
        let hr = d.getHours();
        if (currentTimezone && currentTimezone !== 'local') {
          try {
            const tzHourStr = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: currentTimezone }).format(d);
            hr = parseInt(tzHourStr, 10) % 24;
          } catch (e) { }
        }
        hourBuckets[hr] = (hourBuckets[hr] || 0) + 1;
      }
    });

    const peakResult = calculatePeakWindow(hourBuckets, nonDiscardedTarget.length, currentTimezone);
    const maxCount = peakResult.maxCount || 1;

    if (peakResult.isUniform) {
      hourlyModalDesc.innerHTML = `24-hour message throughput ${scopeDesc} (${tzAbbr || 'Local Timezone'}):<br><span style="display:inline-block; margin-top:4px; color: var(--sap-brand-blue, #0070f2); font-weight: 600;">ℹ️ Even Distribution: Steady rate of ~${peakResult.maxCount} msgs/hr. No isolated bottlenecks or traffic spikes detected.</span>`;
    } else if (peakResult.peakHours.length > 0) {
      hourlyModalDesc.innerHTML = `24-hour message throughput ${scopeDesc} (${tzAbbr || 'Local Timezone'}):<br><span style="display:inline-block; margin-top:4px; color: #d97706; font-weight: 600;">⚡ Peak Window: Highest traffic at ${peakResult.kpiText} (${peakResult.maxCount} messages).</span>`;
    } else {
      hourlyModalDesc.textContent = `24-hour message throughput distribution ${scopeDesc} (${tzAbbr || 'Local Timezone'}):`;
    }

    hourlyChartContainer.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'hourly-grid';

    for (let hr = 0; hr < 24; hr++) {
      const count = hourBuckets[hr] || 0;
      const pct = maxCount > 0 ? Math.max(8, Math.round((count / maxCount) * 100)) : 8;
      const pad = (n) => String(n).padStart(2, '0');
      const isPeak = !peakResult.isUniform && peakResult.peakHours.includes(hr);

      const card = document.createElement('div');
      card.className = 'hourly-bar-card' + (isPeak ? ' peak' : '');
      card.title = `${pad(hr)}:00 - ${count} message${count === 1 ? '' : 's'}`;
      card.innerHTML = `
        <span class="hourly-hour">${pad(hr)}:00</span>
        <div class="hourly-bar-wrap">
          <div class="hourly-bar" style="height: ${pct}%;"></div>
        </div>
        <span class="hourly-count">${count}</span>
      `;
      grid.appendChild(card);
    }

    hourlyChartContainer.appendChild(grid);
    hourlyModal.classList.add('open');
  }

  function getInitials(name) {
    if (!name || typeof name !== 'string') return 'IU';
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return 'IU';
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function loadUserProfile() {
    try {
      const saved = localStorage.getItem('cpi_pulse_profile');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.name) userProfile = parsed;
      }
    } catch (e) { }

    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      try {
        chrome.storage.local.get(['cpi_pulse_profile', 'cpi_session_user'], (res) => {
          if (res?.cpi_pulse_profile?.name) {
            userProfile = res.cpi_pulse_profile;
            updateProfileUI();
          } else if (res?.cpi_session_user?.name) {
            if (!userProfile.email && res.cpi_session_user.email) {
              userProfile.email = res.cpi_session_user.email;
            }
            if (userProfile.name === 'Integration User' && res.cpi_session_user.name) {
              userProfile.name = res.cpi_session_user.name;
            }
            if (res.cpi_session_user.role) {
              userProfile.role = res.cpi_session_user.role;
            }
            updateProfileUI();
          }
        });
      } catch (e) { }
    }

    updateProfileUI();

    if (tenantOrigin && !isTenantUnauthorized) {
      fetchUserProfileFromTenant();
    }
  }

  function updateProfileUI() {
    try {
      const initials = getInitials(userProfile?.name || 'Integration User');
      if (userAvatarInitials) userAvatarInitials.textContent = initials;
      if (avatarInitials && avatarInitials !== userAvatarInitials) avatarInitials.textContent = initials;
      if (profileAvatarLarge) profileAvatarLarge.textContent = initials;
      if (profileDisplayName) profileDisplayName.textContent = userProfile?.name || 'Integration User';
      if (profileNameDisplay && profileNameDisplay !== profileDisplayName) profileNameDisplay.textContent = userProfile?.name || 'Integration User';
      if (profileDisplayEmail) profileDisplayEmail.textContent = userProfile?.email || '(No email set)';
      if (profileEmailDisplay && profileEmailDisplay !== profileDisplayEmail) profileEmailDisplay.textContent = userProfile?.email || '(No email set)';
      if (profileDisplayRole) profileDisplayRole.textContent = userProfile?.role || 'Integration Specialist';
      if (profileRoleDisplay && profileRoleDisplay !== profileDisplayRole) profileRoleDisplay.textContent = userProfile?.role || 'Integration Specialist';
      if (inputProfileName) inputProfileName.value = userProfile?.name || '';
      if (inputProfileEmail) inputProfileEmail.value = userProfile?.email || '';
      if (inputProfileRole) inputProfileRole.value = userProfile?.role || 'Integration Specialist';
    } catch (err) {
      console.warn('Notice updating profile UI:', err);
    }
  }

  function saveLiveMetricsToStorage() {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    try {
      const started = allArtifacts.filter(a => (a.Status || a.DeployState || a.state) === 'STARTED').length;
      const errorCount = failedLogs.length;

      const nonDiscarded = allLogs.filter(l => (l.Status || '').toUpperCase() !== 'DISCARDED');
      let totalDur = 0;
      let durCount = 0;
      nonDiscarded.forEach(l => {
        const d = (l.LogEnd && l.LogStart) ? (new Date(l.LogEnd).getTime() - new Date(l.LogStart).getTime()) : (l.Duration != null ? Number(l.Duration) : 0);
        if (d > 0) {
          totalDur += d;
          durCount++;
        }
      });
      const avgDurationMs = durCount > 0 ? Math.round(totalDur / durCount) : 0;

      const summary = {
        totalArtifacts: allArtifacts.length,
        startedCount: started,
        errorCount: errorCount,
        totalMessages: nonDiscarded.length,
        avgDurationMs: avgDurationMs,
        keystoreCount: keystoreEntries.length,
        jmsQueueCount: jmsQueues.length,
        lastUpdated: Date.now()
      };

      chrome.storage.local.set({ cpi_cached_summary: summary });
      if (chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ action: 'updateBadge', count: errorCount }).catch(() => { });
      }
    } catch (e) { }
  }

  function setupAutoSync(sec, save = true) {
    autoSyncIntervalSec = sec;
    if (autoSyncTimer) {
      clearInterval(autoSyncTimer);
      autoSyncTimer = null;
    }

    if (autoSyncSelect) {
      autoSyncSelect.value = String(sec);
      autoSyncSelect.classList.toggle('active-sync', sec > 0);
    }

    if (sec > 0) {
      autoSyncTimer = setInterval(async () => {
        if (btnRefresh) btnRefresh.classList.add('loading');
        await loadLiveData();
      }, sec * 1000);
    }

    if (save) {
      try {
        localStorage.setItem('cpi_pulse_autosync', String(sec));
      } catch (e) { }
    }
  }



  function saveCustomQueues() {
    try {
      const custom = jmsQueues.filter(q => q.isCustomCreated);
      localStorage.setItem('cpi_pulse_custom_queues', JSON.stringify(custom));
    } catch (e) { }
  }


  function attachListeners() {
    const errorDetailModal = document.getElementById('errorDetailModal');
    const btnCloseErrorModal = document.getElementById('btnCloseErrorModal');
    const btnDoneErrorModal = document.getElementById('btnDoneErrorModal');
    const btnCopyErrorText = document.getElementById('btnCopyErrorText');
    const errorModalTitle = document.getElementById('errorModalTitle');
    const errorModalSubtitle = document.getElementById('errorModalSubtitle');
    const errorModalContent = document.getElementById('errorModalContent');

    function showErrorDetailModal(title, source, content) {
      if (!errorDetailModal) return;
      if (errorModalTitle) errorModalTitle.textContent = title;
      if (errorModalSubtitle) {
        errorModalSubtitle.textContent = source || '';
        errorModalSubtitle.style.display = source ? 'block' : 'none';
      }
      if (errorModalContent) errorModalContent.textContent = content || 'No error details recorded.';
      errorDetailModal.classList.add('open');
    }

    if (btnCloseErrorModal) btnCloseErrorModal.addEventListener('click', () => errorDetailModal.classList.remove('open'));
    if (btnDoneErrorModal) btnDoneErrorModal.addEventListener('click', () => errorDetailModal.classList.remove('open'));
    if (errorDetailModal) {
      errorDetailModal.addEventListener('click', (e) => {
        if (e.target === errorDetailModal) errorDetailModal.classList.remove('open');
      });
    }

    if (btnCopyErrorText) {
      btnCopyErrorText.addEventListener('click', async () => {
        const text = errorModalContent ? errorModalContent.textContent : '';
        if (text) {
          try {
            await navigator.clipboard.writeText(text);
            showToast('Error details copied to clipboard!');
          } catch (e) {
            showToast('Failed to copy to clipboard.');
          }
        }
      });
    }

    if (detailTableBody) {
      detailTableBody.addEventListener('click', (e) => {
        const btnErr = e.target.closest('.btn-view-error-details');
        if (btnErr && btnErr.dataset.id) {
          e.stopPropagation();
          const id = btnErr.dataset.id;
          const type = btnErr.dataset.type;
          if (type === 'artifact') {
            const rawErr = artifactErrorCache[id] || `Artifact '${id}' encountered a deployment error. Extended details not returned by tenant.`;
            const parsed = parseCpiArtifactError(rawErr);
            const content = parsed.formattedModal || parsed.actualMessage || (typeof rawErr === 'string' ? rawErr : JSON.stringify(rawErr, null, 2));
            showErrorDetailModal(`Artifact Error: ${id}`, '', content);
          } else if (type === 'mpl') {
            const rawErr = mplErrorCache[id] || 'Runtime message processing aborted with critical exception.';
            const parsed = parseCpiArtifactError(rawErr);
            const content = parsed.formattedModal || parsed.actualMessage || (typeof rawErr === 'string' ? rawErr : JSON.stringify(rawErr, null, 2));
            showErrorDetailModal(`Failed Message Log: ${id}`, '', content);
          }
        }
      });
    }



    if (autoSyncSelect) {
      autoSyncSelect.addEventListener('change', () => {
        const sec = parseInt(autoSyncSelect.value, 10) || 0;
        setupAutoSync(sec, true);
        if (sec > 0) {
          const text = autoSyncSelect.options[autoSyncSelect.selectedIndex].text;
          showToast('Live Auto-Sync active: ' + text);
        } else {
          showToast('Auto-Sync disabled (Manual refresh mode)');
        }
      });
    }

    if (userAvatarBtn) {
      userAvatarBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = profilePopover && profilePopover.style.display !== 'none';
        if (profilePopover) {
          profilePopover.style.display = isOpen ? 'none' : 'block';
          if (!isOpen) {
            updateProfileUI();
            fetchUserProfileFromTenant();
          }
        }
      });
    }

    if (btnCloseProfile) {
      btnCloseProfile.addEventListener('click', () => {
        if (profilePopover) profilePopover.style.display = 'none';
      });
    }

    if (btnCloseProfileFooter) {
      btnCloseProfileFooter.addEventListener('click', () => {
        if (profilePopover) profilePopover.style.display = 'none';
      });
    }

    const btnSaveProfile = document.getElementById('btnSaveProfile');
    if (btnSaveProfile) {
      btnSaveProfile.addEventListener('click', () => {
        const nameInput = document.getElementById('inputProfileName');
        const emailInput = document.getElementById('inputProfileEmail');
        const roleInput = document.getElementById('inputProfileRole');
        const newName = nameInput ? nameInput.value.trim() : '';
        const newEmail = emailInput ? emailInput.value.trim() : '';
        const newRole = roleInput ? roleInput.value.trim() : '';
        if (!newName) {
          showToast('Please enter your name.');
          return;
        }
        userProfile.name = newName;
        userProfile.email = newEmail;
        userProfile.role = newRole || 'Integration Specialist';
        try {
          localStorage.setItem('cpi_pulse_profile', JSON.stringify(userProfile));
        } catch (e) { }
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
          try {
            chrome.storage.local.set({ cpi_pulse_profile: userProfile });
          } catch (e) { }
        }
        updateProfileUI();
        showToast('Profile saved: ' + userProfile.name + ' (' + getInitials(userProfile.name) + ')');
      });
    }

    document.addEventListener('click', (e) => {
      if (profilePopover && profilePopover.style.display !== 'none') {
        const wrap = e.target.closest('.sap-avatar-wrapper');
        if (!wrap) profilePopover.style.display = 'none';
      }
    });

    const themeToggleBtn = document.getElementById('themeToggleBtn');
    if (themeToggleBtn) {
      themeToggleBtn.addEventListener('click', () => {
        const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
        applyTheme(nextTheme, true);
        showToast('Switched to ' + (nextTheme === 'dark' ? 'Dark Mode (Evening Horizon)' : 'Light Mode (Morning Horizon)'));
      });
    }

    function handleFilterChipClick(chipKey) {
      if (!chipKey) return;
      if (chipKey === 'all') {
        activeDetailFilters = new Set(['all']);
        activeDetailFilter = 'all';
      } else if (chipKey === 'not-deployed') {
        activeDetailFilters = new Set(['not-deployed']);
        activeDetailFilter = 'not-deployed';
        if (allDesigntimeArtifacts.length === 0 && !isFetchingDesigntime) {
          fetchDesigntimeArtifacts(true);
        }
      } else {
        if (activeDetailFilters.has('all') || activeDetailFilters.has('not-deployed')) {
          activeDetailFilters.clear();
        }
        if (activeDetailFilters.has(chipKey)) {
          activeDetailFilters.delete(chipKey);
        } else {
          activeDetailFilters.add(chipKey);
        }
        if (activeDetailFilters.size === 0) {
          activeDetailFilters.add('all');
          activeDetailFilter = 'all';
        } else {
          activeDetailFilter = Array.from(activeDetailFilters)[0];
        }
      }
      detailCurrentPage = 1;
      renderDetailTable();
    }

    document.querySelectorAll('.sap-tile[data-capability]').forEach(tile => {
      tile.addEventListener('click', () => {
        activeCapability = tile.dataset.capability;
        activeDetailFilter = 'all';
        activeDetailFilters = new Set(['all']);
        detailSearchQuery = '';
        detailCurrentPage = 1;
        if (tableSearchInput) tableSearchInput.value = '';
        if (btnClearSearch) btnClearSearch.style.display = 'none';
        renderDetailTable();
      });
    });

    if (filterChipsContainer) {
      filterChipsContainer.addEventListener('click', (e) => {
        const chip = e.target.closest('.sap-chip');
        if (chip && chip.dataset.chip) {
          handleFilterChipClick(chip.dataset.chip);
        }
      });
    }

    if (tableSearchInput) {
      tableSearchInput.addEventListener('input', (e) => {
        detailSearchQuery = e.target.value.trim();
        detailCurrentPage = 1;
        if (btnClearSearch) btnClearSearch.style.display = detailSearchQuery ? 'inline' : 'none';
        renderDetailTable();
      });
    }

    if (btnClearSearch) {
      btnClearSearch.addEventListener('click', () => {
        tableSearchInput.value = '';
        detailSearchQuery = '';
        detailCurrentPage = 1;
        btnClearSearch.style.display = 'none';
        renderDetailTable();
      });
    }

    if (detailTableHead) {
      detailTableHead.addEventListener('click', (e) => {
        const th = e.target.closest('th.sortable');
        if (th && th.dataset.col) {
          const col = th.dataset.col;
          if (detailSort.column === col) {
            detailSort.dir = detailSort.dir === 'asc' ? 'desc' : 'asc';
          } else {
            detailSort.column = col;
            detailSort.dir = 'asc';
          }
          renderDetailTable();
        }
      });
    }

    // Detail Table Pagination Event Handlers (<< and >>)
    const btnDetailPrev = document.getElementById('btnDetailPrevPage');
    const btnDetailNext = document.getElementById('btnDetailNextPage');
    if (btnDetailPrev) {
      btnDetailPrev.addEventListener('click', () => {
        if (detailCurrentPage > 1) {
          detailCurrentPage--;
          renderDetailTable();
        }
      });
    }
    if (btnDetailNext) {
      btnDetailNext.addEventListener('click', () => {
        detailCurrentPage++;
        renderDetailTable();
      });
    }

    if (timeRangeSelect) {
      timeRangeSelect.addEventListener('change', () => {
        detailCurrentPage = 1;
        syncTimeRangeData();
        showToast('Time Range updated: ' + getTimeRangeLabel());
      });
    }

    if (timezoneSelect) {
      timezoneSelect.addEventListener('change', () => {
        currentTimezone = timezoneSelect.value;
        try {
          localStorage.setItem('cpi_pulse_timezone', currentTimezone);
        } catch (e) { }
        renderDetailTable();
        renderPerformanceAnalytics();
        showToast('Timezone changed to: ' + timezoneSelect.options[timezoneSelect.selectedIndex].text);
      });
    }

    try {
      const savedTz = localStorage.getItem('cpi_pulse_timezone');
      if (savedTz && timezoneSelect) {
        timezoneSelect.value = savedTz;
        currentTimezone = savedTz;
      }
    } catch (e) { }

    if (btnRefresh) {
      btnRefresh.addEventListener('click', async () => {
        await loadLiveData();
        showToast('Refreshed live telemetry from SAP CPI.');
      });
    }

    // Interactive clicks on 4 Performance KPI Cards
    document.querySelectorAll('.perf-kpi-tile').forEach(tile => {
      tile.addEventListener('click', () => {
        const action = tile.dataset.perfAction;
        const targetLogs = selectedPerfFlow
          ? allLogs.filter(l => (l.IntegrationFlowName || '') === selectedPerfFlow)
          : allLogs;

        if (action === 'sort-avg') {
          // Reset bottleneck or failure filter so all flows are displayed
          const wasFiltered = activePerfFilter !== 'all';
          activePerfFilter = 'all';

          // Sync toolbar filter chips to 'All Flows'
          const perfFilterChips = document.getElementById('perfFilterChips');
          if (perfFilterChips) {
            perfFilterChips.querySelectorAll('.sap-chip').forEach(c => {
              c.classList.toggle('active', c.dataset.perfFilter === 'all');
            });
          }

          if (!wasFiltered && perfSort.column === 'avg') {
            perfSort.dir = perfSort.dir === 'desc' ? 'asc' : 'desc';
          } else {
            perfSort.column = 'avg';
            perfSort.dir = 'desc';
          }

          updatePerfSortIndicators();
          renderSlowestTable(targetLogs);
          document.getElementById('slowestLeaderboardCard')?.scrollIntoView({ behavior: 'smooth' });
          showToast('Showing all flows sorted by Average Runtime (' + (perfSort.dir === 'desc' ? 'High to Low' : 'Low to High') + ')');
        } else if (action === 'sort-volume') {
          // Reset bottleneck or failure filter so all flows are displayed
          const wasFiltered = activePerfFilter !== 'all';
          activePerfFilter = 'all';

          // Sync toolbar filter chips to 'All Flows'
          const perfFilterChips = document.getElementById('perfFilterChips');
          if (perfFilterChips) {
            perfFilterChips.querySelectorAll('.sap-chip').forEach(c => {
              c.classList.toggle('active', c.dataset.perfFilter === 'all');
            });
          }

          if (!wasFiltered && perfSort.column === 'volume') {
            perfSort.dir = perfSort.dir === 'desc' ? 'asc' : 'desc';
          } else {
            perfSort.column = 'volume';
            perfSort.dir = 'desc';
          }

          updatePerfSortIndicators();
          renderSlowestTable(targetLogs);
          document.getElementById('slowestLeaderboardCard')?.scrollIntoView({ behavior: 'smooth' });
          showToast('Showing all flows sorted by Message Volume (' + (perfSort.dir === 'desc' ? 'High to Low' : 'Low to High') + ')');
        } else if (action === 'view-hourly') {
          showHourlyChartModal();
        } else if (action === 'filter-bottlenecks') {
          activePerfFilter = activePerfFilter === 'bottlenecks' ? 'all' : 'bottlenecks';
          const perfFilterChips = document.getElementById('perfFilterChips');
          if (perfFilterChips) {
            perfFilterChips.querySelectorAll('.sap-chip').forEach(c => {
              c.classList.toggle('active', c.dataset.perfFilter === activePerfFilter);
            });
          }
          updatePerfSortIndicators();
          renderSlowestTable(targetLogs);
          document.getElementById('slowestLeaderboardCard')?.scrollIntoView({ behavior: 'smooth' });
          showToast(activePerfFilter === 'bottlenecks'
            ? `Filtered leaderboard to Bottlenecks (Avg ≥ ${bottleneckThresholdSec.toFixed(1)}s or Failures ≥ ${failureThresholdCount})`
            : 'Showing all integration flows');
        }
      });
    });

    // Performance Toolbar Filter Chips (All Flows | Bottlenecks | Latency | Failures)
    const perfFilterChips = document.getElementById('perfFilterChips');
    if (perfFilterChips) {
      perfFilterChips.addEventListener('click', (e) => {
        const chip = e.target.closest('.sap-chip');
        if (chip && chip.dataset.perfFilter) {
          activePerfFilter = chip.dataset.perfFilter;
          perfFilterChips.querySelectorAll('.sap-chip').forEach(c => {
            c.classList.toggle('active', c.dataset.perfFilter === activePerfFilter);
          });
          updatePerfSortIndicators();
          const targetLogs = selectedPerfFlow
            ? allLogs.filter(l => (l.IntegrationFlowName || '') === selectedPerfFlow)
            : allLogs;
          renderSlowestTable(targetLogs);
        }
      });
    }

    const inputBottleneckThreshold = document.getElementById('inputBottleneckThreshold');
    if (inputBottleneckThreshold) {
      inputBottleneckThreshold.value = bottleneckThresholdSec.toFixed(1);
      inputBottleneckThreshold.addEventListener('change', (e) => {
        const val = parseFloat(e.target.value);
        if (!isNaN(val) && val > 0) {
          bottleneckThresholdSec = Math.min(60, Math.max(0.1, val));
          e.target.value = bottleneckThresholdSec.toFixed(1);
          try {
            localStorage.setItem('cpi_pulse_bottleneck_thresh', bottleneckThresholdSec);
          } catch (err) { }
          renderPerformanceAnalytics();
          showToast(`Bottleneck latency threshold updated to ${bottleneckThresholdSec.toFixed(1)}s`);
        }
      });
    }

    const inputFailureThreshold = document.getElementById('inputFailureThreshold');
    if (inputFailureThreshold) {
      inputFailureThreshold.value = failureThresholdCount;
      inputFailureThreshold.addEventListener('change', (e) => {
        const val = parseInt(e.target.value, 10);
        if (!isNaN(val) && val >= 1) {
          failureThresholdCount = Math.min(999, Math.max(1, val));
          e.target.value = failureThresholdCount;
          try {
            localStorage.setItem('cpi_pulse_failure_thresh', failureThresholdCount);
          } catch (err) { }
          renderPerformanceAnalytics();
          showToast(`Failure threshold updated to ≥ ${failureThresholdCount}`);
        } else {
          e.target.value = failureThresholdCount;
        }
      });
    }

    const inputKeystoreExpiryDays = document.getElementById('inputKeystoreExpiryDays');
    if (inputKeystoreExpiryDays) {
      inputKeystoreExpiryDays.value = keystoreExpiryDays;
      inputKeystoreExpiryDays.addEventListener('change', (e) => {
        const val = parseInt(e.target.value, 10);
        if (!isNaN(val) && val >= 1) {
          keystoreExpiryDays = Math.min(730, Math.max(1, val));
          e.target.value = keystoreExpiryDays;
          try {
            localStorage.setItem('cpi_pulse_keystore_expiry_days', keystoreExpiryDays);
          } catch (err) { }
          renderCapabilityKPIs();
          if (activeCapability === 'cert-guardian') {
            renderKeystoreTable();
          }
          showToast(`Keystore expiration threshold updated to ≤ ${keystoreExpiryDays} days`);
        } else {
          e.target.value = keystoreExpiryDays;
        }
      });
    }

    if (perfFlowFilterSelect) {
      perfFlowFilterSelect.addEventListener('change', () => {
        selectedPerfFlow = perfFlowFilterSelect.value;
        if (btnClearFlowFilter) btnClearFlowFilter.style.display = selectedPerfFlow ? 'inline-flex' : 'none';
        renderPerformanceAnalytics();
        showToast(selectedPerfFlow ? 'Filtered 4 performance tiles to "' + selectedPerfFlow + '"' : 'Showing aggregate metrics for all iFlows');
      });
    }

    if (btnClearFlowFilter) {
      btnClearFlowFilter.addEventListener('click', () => {
        selectedPerfFlow = '';
        if (perfFlowFilterSelect) perfFlowFilterSelect.value = '';
        btnClearFlowFilter.style.display = 'none';
        renderPerformanceAnalytics();
        showToast('Reset performance metrics to all iFlows');
      });
    }

    const perfTableBody = document.getElementById('slowestTableBody');
    if (perfTableBody) {
      perfTableBody.addEventListener('click', (e) => {
        const link = e.target.closest('.perf-flow-link');
        if (link && link.dataset.flow) {
          e.preventDefault();
          selectedPerfFlow = link.dataset.flow;
          if (perfFlowFilterSelect) perfFlowFilterSelect.value = selectedPerfFlow;
          if (btnClearFlowFilter) btnClearFlowFilter.style.display = 'inline-flex';
          renderPerformanceAnalytics();
          showToast('Filtered 4 performance tiles to "' + selectedPerfFlow + '"');
          document.getElementById('section-performance-analytics')?.scrollIntoView({ behavior: 'smooth' });
        }
      });
    }

    if (perfSearchInput) {
      perfSearchInput.addEventListener('input', (e) => {
        perfSearchQuery = e.target.value.trim();
        if (btnClearPerfSearch) btnClearPerfSearch.style.display = perfSearchQuery ? 'inline' : 'none';
        renderPerformanceAnalytics();
      });
    }

    if (btnClearPerfSearch) {
      btnClearPerfSearch.addEventListener('click', () => {
        if (perfSearchInput) perfSearchInput.value = '';
        perfSearchQuery = '';
        btnClearPerfSearch.style.display = 'none';
        renderPerformanceAnalytics();
      });
    }

    const perfHead = document.querySelector('#slowestTable thead');
    if (perfHead) {
      perfHead.addEventListener('click', (e) => {
        const th = e.target.closest('th.sortable');
        if (th && th.dataset.sort) {
          const sortKey = th.dataset.sort;
          if (perfSort.column === sortKey) {
            perfSort.dir = perfSort.dir === 'asc' ? 'desc' : 'asc';
          } else {
            perfSort.column = sortKey;
            perfSort.dir = (sortKey === 'avg' || sortKey === 'max' || sortKey === 'volume' || sortKey === 'failed') ? 'desc' : 'asc';
          }
          updatePerfSortIndicators();
          const targetLogs = selectedPerfFlow
            ? allLogs.filter(l => (l.IntegrationFlowName || '') === selectedPerfFlow)
            : allLogs;
          renderSlowestTable(targetLogs);
        }
      });
    }

    if (btnExportDetailCsv) {
      btnExportDetailCsv.addEventListener('click', () => {
        exportDetailTableToCsv();
      });
    }

    if (btnExportPerfCsv) {
      btnExportPerfCsv.addEventListener('click', () => {
        exportSlowestLeaderboardToCsv();
      });
    }

    if (btnCloseHourlyModal) btnCloseHourlyModal.addEventListener('click', () => hourlyModal.classList.remove('open'));
    if (btnDoneHourlyModal) btnDoneHourlyModal.addEventListener('click', () => hourlyModal.classList.remove('open'));
    if (hourlyModal) {
      hourlyModal.addEventListener('click', (e) => {
        if (e.target === hourlyModal) hourlyModal.classList.remove('open');
      });
    }

    if (tenantBadge) {
      tenantBadge.addEventListener('click', async () => {
        const current = tenantOrigin || '';
        const input = prompt(
          'SAP Cloud Integration Tenant Base URL:\n\n' +
          '• Connect via your active browser session: enter your SAP Integration Suite URL (e.g. https://...integrationsuite-trial...).\n' +
          '• Type "reset" to automatically restore your detected Integration Suite session.\n\n' +
          'Current URL:',
          current
        );
        if (input !== null) {
          const val = input.trim();
          if (val.toLowerCase() === 'reset' || val === '') {
            localStorage.removeItem('cpi_pulse_tenant_origin');
            tenantOrigin = null;
            hasCheckedMetadata = false;
            discoveredEntitySets.clear();
            await resolveTenantOrigin();
            loadLiveData();
            showToast('Reset to auto-detected active session');
            return;
          }
          try {
            const parsed = new URL(val);
            if (parsed.hostname.includes('it-cpi') || parsed.hostname.includes('it-cpitrial')) {
              alert('Notice: Standalone it-cpi host endpoints require BTP Service Key credentials and do not share browser session cookies.\n\nFor browser monitoring, connect using your SAP Integration Suite URL (integrationsuite-trial...).');
            }
            tenantOrigin = parsed.origin;
            localStorage.setItem('cpi_pulse_tenant_origin', tenantOrigin);
            if (typeof chrome !== 'undefined' && chrome.storage?.local) {
              chrome.storage.local.set({ cpi_tenant_origin: tenantOrigin, lastKnownTenant: tenantOrigin }).catch(() => { });
            }
            hasCheckedMetadata = false;
            discoveredEntitySets.clear();
            updateTenantHeader(true);
            loadLiveData();
            showToast('Connected to tenant: ' + parsed.hostname);
          } catch (e) {
            alert('Invalid URL format. Please enter a valid URL or type "reset".');
          }
        }
      });
    }

    // Listen for storage events (e.g. JMS queues intercepted in real-time by content script)
    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local' && changes.cpi_intercepted_queues) {
          const newQueues = changes.cpi_intercepted_queues.newValue;
          if (Array.isArray(newQueues) && newQueues.length > 0) {
            console.log('[CPI Pulse Dashboard] Reactive update of intercepted queues:', newQueues.length);
            applyQueues(newQueues);
            renderCapabilityKPIs();
            if (activeCapability === 'jms-monitor') {
              renderJmsQueueTable();
            }
          }
        }
      });
    }
  }

  async function initFooterVersion() {
    const el = document.getElementById('footerAppVersion');
    if (!el) return;
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getManifest === 'function') {
        const manifest = chrome.runtime.getManifest();
        if (manifest && manifest.version) {
          el.textContent = `v${manifest.version}`;
          el.title = `${manifest.name || 'CPI Pulse'} v${manifest.version}`;
          return;
        }
      }
    } catch (e) { }

    try {
      const res = await fetch('../manifest.json');
      if (res.ok) {
        const manifest = await res.json();
        if (manifest && manifest.version) {
          el.textContent = `v${manifest.version}`;
          el.title = `${manifest.name || 'CPI Pulse'} v${manifest.version}`;
          return;
        }
      }
    } catch (e) { }
    el.textContent = 'v1.0.0';
  }

  async function init() {
    try { await initFooterVersion(); } catch (e) { console.warn('Footer version init notice:', e); }
    try { loadUserProfile(); } catch (e) { console.warn('User profile init notice:', e); }
    try {
      const savedSync = parseInt(localStorage.getItem('cpi_pulse_autosync') || '0', 10);
      setupAutoSync(savedSync, false);
    } catch (e) { }
    try { applyTheme(currentTheme, false); } catch (e) { }
    try { attachListeners(); } catch (e) { console.error('attachListeners error:', e); }

    // Fast pre-load of cached JMS Queues from extension storage
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        const stored = await chrome.storage.local.get(['cpi_cached_queues', 'cpi_intercepted_queues']);
        const cached = stored.cpi_cached_queues || stored.cpi_intercepted_queues;
        if (Array.isArray(cached) && cached.length > 0 && jmsQueues.length === 0) {
          applyQueues(cached);
          renderCapabilityKPIs();
        }
      }
    } catch (e) { }

    try {
      await resolveTenantOrigin();
    } catch (err) {
      console.warn('Tenant resolution notice:', err);
      updateTenantHeader(false);
    }

    try {
      await loadLiveData();
    } catch (err) {
      console.error('Error loading live data:', err);
      syncTimeRangeData();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
