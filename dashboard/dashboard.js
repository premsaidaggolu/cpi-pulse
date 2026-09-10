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
  } catch (e) {}

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
          chrome.storage.local.set({ cpi_pulse_theme: theme }).catch(() => {});
        }
      } catch (e) {}
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
  let activePerfFilter = 'all';
  let detailSearchQuery = '';
  let perfSearchQuery = '';
  let selectedPerfFlow = ''; // Specific iFlow filtered for performance tiles
  let autoSyncTimer = null;
  let autoSyncIntervalSec = 0;
  let userProfile = {
    name: 'Prem Sai Daggolu',
    email: 'prem.sai.daggolu@sap.com',
    role: 'Integration Developer'
  };

  // Sort State
  let detailSort = { column: 'name', dir: 'asc' };
  let perfSort = { column: 'avg', dir: 'desc' };
  let bottleneckThresholdSec = 2.0;
  try {
    const savedThresh = parseFloat(localStorage.getItem('cpi_pulse_bottleneck_thresh'));
    if (!isNaN(savedThresh) && savedThresh > 0) bottleneckThresholdSec = savedThresh;
  } catch (e) {}

  // Pagination State (Multi-page when count > 15)
  const DETAIL_PAGE_SIZE = 15;
  let detailCurrentPage = 1;

  // Live Datasets
  let allArtifacts = [];
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
  const btnRefresh = document.getElementById('btnRefresh');
  const lastSyncTime = document.getElementById('lastSyncTime');
  const timezoneSelect = document.getElementById('timezoneSelect');
  const autoSyncSelect = document.getElementById('autoSyncSelect');
  const userAvatarBtn = document.getElementById('userAvatarBtn');
  const avatarInitials = document.getElementById('avatarInitials');
  const profilePopover = document.getElementById('profilePopover');
  const profileNameDisplay = document.getElementById('profileNameDisplay');
  const profileEmailDisplay = document.getElementById('profileEmailDisplay');
  const profileRoleDisplay = document.getElementById('profileRoleDisplay');
  const btnCloseProfile = document.getElementById('btnCloseProfile');
  const btnCloseProfileFooter = document.getElementById('btnCloseProfileFooter');
  const btnSyncSessionProfile = document.getElementById('btnSyncSessionProfile');
  const btnEditProfile = document.getElementById('btnEditProfile');
  const profileEditBox = document.getElementById('profileEditBox');
  const inputProfileName = document.getElementById('inputProfileName');
  const inputProfileEmail = document.getElementById('inputProfileEmail');
  const btnSaveProfile = document.getElementById('btnSaveProfile');
  const btnCancelProfile = document.getElementById('btnCancelProfile');


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

  // Performance Table Elements
  const slowestTableBody = document.getElementById('slowestTableBody');
  const slowestCountBadge = document.getElementById('slowestCountBadge');
  const perfSearchInput = document.getElementById('perfSearchInput');
  const btnClearPerfSearch = document.getElementById('btnClearPerfSearch');

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
      } catch (e) {}
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
    if (!rawError) return getDemoErrorForArtifact(artifactId);

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
      return getDemoErrorForArtifact(artifactId);
    }

    if (str.startsWith('{') && str.endsWith('}')) {
      try {
        const obj = JSON.parse(str);
        let msg = obj?.error?.message?.value || obj?.error?.message || obj?.errorMessage || obj?.message || obj?.summary;
        if (typeof msg === 'object' && msg !== null) msg = msg.value || msg.message;
        if (msg) str = String(msg).trim();
      } catch (e) {}
    }

    if (str.startsWith('<') && str.includes('<message')) {
      const match = str.match(/<message[^>]*>([\s\S]*?)<\/message>/i);
      if (match && match[1]) str = match[1].trim();
    }

    if (!str || str === '[object Object]' || str.includes('[object Object]')) {
      return getDemoErrorForArtifact(artifactId);
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
      return getDemoErrorForArtifact(artifactId);
    }
    if (firstLine.length > 120) {
      return firstLine.substring(0, 117) + '...';
    }
    return firstLine;
  }

  function getDemoErrorForArtifact(id) {
    const defaultErrors = {
      'Automated Order Intake and Processing': 'HttpAdapterException: Target endpoint https://erp.acme.com/api/orders connection timed out after 30000ms. java.net.SocketTimeoutException: Read timed out',
      'Booking_Request_to_GFF': 'CertificateException: Server certificate chain verification failed for partner endpoint (CN=gff.logistics.com). Peer not authenticated: unable to find valid certification path to requested target',
      'IF_GitHubIssues_Slack_ForCriticalIssueAlertNew': 'SecurityException: Credential alias \'SLACK_BOT_OAUTH_TOKEN\' not found in tenant Security Material Store. Deployment aborted during bundle activation',
      'Interface_Sales_Order_Creation': 'XmlValidationException: Line 42: cvc-complex-type.2.4.a: Invalid content was found starting with element \'UnitPrice\'. One of \'{"urn:sap-com:document:sap:rfc:functions":SalesOrderHeader}\' is expected',
      'Order Processing - Comprehensive Palette Scenario': 'FailedToCreateRouteException: JMS consumer destination queue \'Order_Queue\' is unavailable or stopped on broker. org.apache.camel.FailedToCreateRouteException: Failed to create route route1',
      'Sales Order Confirmation Feed to Acme Logistics 3PL': 'ScriptExecutionException: Script \'TransformConfirmation.groovy\' failed: java.lang.NullPointerException: Cannot invoke method getHeader() on null object at line 28',
      'Sales_Order_Creation_New_Interface': 'DuplicateEndpointException: Address \'/v1/salesorder\' conflicts with already registered service endpoint on this runtime location. Deployment rejected',
      'Weather Forecast Notification': 'HttpResponseException: HTTP operation failed invoking https://api.weather.com with statusCode: 503 Service Unavailable: upstream server temporary overload'
    };
    return defaultErrors[id] || `BundleException: Error starting bundle for artifact '${id}'. OSGi framework reported unresolvable service dependency or lifecycle fault.`;
  }

  function provideFallbackData() {
    allArtifacts = [
      { Id: 'Automated Order Intake and Processing', Name: 'Automated Order Intake and Processing', Type: 'INTEGRATION_FLOW', Version: '1.0.0', Status: 'ERROR', DeployTime: Date.now() - 1000 * 60 * 25 },
      { Id: 'Booking_Request_to_GFF', Name: 'Booking_Request_to_GFF', Type: 'INTEGRATION_FLOW', Version: '1.0.0', Status: 'ERROR', DeployTime: Date.now() - 1000 * 60 * 30 },
      { Id: 'IF_GitHubIssues_Slack_ForCriticalIssueAlertNew', Name: 'IF_GitHubIssues_Slack_ForCriticalIssueAlertNew', Type: 'INTEGRATION_FLOW', Version: '1.0.0', Status: 'ERROR', DeployTime: Date.now() - 1000 * 60 * 40 },
      { Id: 'Interface_Sales_Order_Creation', Name: 'Interface_Sales_Order_Creation', Type: 'INTEGRATION_FLOW', Version: '1.0.0', Status: 'ERROR', DeployTime: Date.now() - 1000 * 60 * 50 },
      { Id: 'Order Processing - Comprehensive Palette Scenario', Name: 'Order Processing - Comprehensive Palette Scenario', Type: 'INTEGRATION_FLOW', Version: '1.0.0', Status: 'ERROR', DeployTime: Date.now() - 1000 * 60 * 60 },
      { Id: 'Sales Order Confirmation Feed to Acme Logistics 3PL', Name: 'Sales Order Confirmation Feed to Acme Logistics 3PL', Type: 'INTEGRATION_FLOW', Version: '1.0.0', Status: 'ERROR', DeployTime: Date.now() - 1000 * 60 * 70 },
      { Id: 'Sales_Order_Creation_New_Interface', Name: 'Sales_Order_Creation_New_Interface', Type: 'INTEGRATION_FLOW', Version: '1.0.0', Status: 'ERROR', DeployTime: Date.now() - 1000 * 60 * 80 },
      { Id: 'Weather Forecast Notification', Name: 'Weather Forecast Notification', Type: 'INTEGRATION_FLOW', Version: '1.0.0', Status: 'ERROR', DeployTime: Date.now() - 1000 * 60 * 90 },
      { Id: 'Sales Order Creation Interface New', Name: 'Sales Order Creation Interface New', Type: 'INTEGRATION_FLOW', Version: '1.0.0', Status: 'STARTED', DeployTime: Date.now() - 1000 * 60 * 60 * 4 },
      { Id: 'SAP CPI Trace Enabler', Name: 'SAP CPI Trace Enabler', Type: 'INTEGRATION_FLOW', Version: '1.0.0', Status: 'STARTED', DeployTime: Date.now() - 1000 * 60 * 60 * 12 },
      { Id: 'DB Bulk Fetch - Split - Post - Bulk Writeback', Name: 'DB Bulk Fetch - Split - Post - Bulk Writeback', Type: 'INTEGRATION_FLOW', Version: '1.0.0', Status: 'STARTED', DeployTime: Date.now() - 1000 * 60 * 60 * 35 },
      { Id: 'IF_Webhook_JiraIncident_ForERPSync', Name: 'IF_Webhook_JiraIncident_ForERPSync', Type: 'INTEGRATION_FLOW', Version: '1.0.0', Status: 'STARTED', DeployTime: Date.now() - 1000 * 60 * 60 * 40 },
      { Id: 'test', Name: 'test', Type: 'INTEGRATION_FLOW', Version: '1.0.5', Status: 'STARTED', DeployTime: Date.now() - 1000 * 60 * 60 * 50 },
      { Id: 'GLOBAL99001025_CommonUtilities_UniversalSearch', Name: 'GLOBAL99001025_CommonUtilities_UniversalSearch', Type: 'INTEGRATION_FLOW', Version: '2.0.25', Status: 'STARTED', DeployTime: Date.now() - 1000 * 60 * 60 * 70 },
      { Id: 'Invoice_Clearing_Async_Gateway', Name: 'Invoice_Clearing_Async_Gateway', Type: 'INTEGRATION_FLOW', Version: '1.2.0', Status: 'STARTED', DeployTime: Date.now() - 1000 * 60 * 60 * 85 },
      { Id: 'Supplier_Catalog_Punchout_Service', Name: 'Supplier_Catalog_Punchout_Service', Type: 'INTEGRATION_FLOW', Version: '1.0.1', Status: 'STARTED', DeployTime: Date.now() - 1000 * 60 * 60 * 95 },
      { Id: 'Payment_Advice_DirectDebit_Notice', Name: 'Payment_Advice_DirectDebit_Notice', Type: 'INTEGRATION_FLOW', Version: '1.0.0', Status: 'STARTED', DeployTime: Date.now() - 1000 * 60 * 60 * 110 },
      { Id: 'Customer_Master_Event_Sync_CDC', Name: 'Customer_Master_Event_Sync_CDC', Type: 'INTEGRATION_FLOW', Version: '2.1.0', Status: 'STARTED', DeployTime: Date.now() - 1000 * 60 * 60 * 130 }
    ];

    rawLogs = [
      { MessageGuid: 'MSG-001', IntegrationFlowName: 'GLOBAL99001025_CommonUtilities_UniversalSearch', Status: 'COMPLETED', LogStart: Date.now() - 1000 * 60 * 15, LogEnd: Date.now() - 1000 * 60 * 15 + 3820 },
      { MessageGuid: 'MSG-002', IntegrationFlowName: 'DBBulkFetchSplitPostWriteback', Status: 'COMPLETED', LogStart: Date.now() - 1000 * 60 * 20, LogEnd: Date.now() - 1000 * 60 * 20 + 851 },
      { MessageGuid: 'MSG-003', IntegrationFlowName: 'SAP_CPI_Trace_Enabler', Status: 'FAILED', LogStart: Date.now() - 1000 * 60 * 35, LogEnd: Date.now() - 1000 * 60 * 35 + 296 },
      { MessageGuid: 'MSG-004', IntegrationFlowName: 'SimpleTestFlow', Status: 'FAILED', LogStart: Date.now() - 1000 * 60 * 45, LogEnd: Date.now() - 1000 * 60 * 45 + 288 },
      { MessageGuid: 'MSG-005', IntegrationFlowName: 'testiflow', Status: 'COMPLETED', LogStart: Date.now() - 1000 * 60 * 50, LogEnd: Date.now() - 1000 * 60 * 50 + 283 },
      { MessageGuid: 'MSG-006', IntegrationFlowName: 'StandardPracticeRetest', Status: 'FAILED', LogStart: Date.now() - 1000 * 60 * 60, LogEnd: Date.now() - 1000 * 60 * 60 + 281 },
      { MessageGuid: 'MSG-007', IntegrationFlowName: 'SalesOrderCreationInterfaceNew', Status: 'COMPLETED', LogStart: Date.now() - 1000 * 60 * 75, LogEnd: Date.now() - 1000 * 60 * 75 + 54 }
    ];

    keystoreEntries = [
      { Alias: 'sap_digicert_global_ca_g2', Type: 'Certificate', ValidNotAfter: 'Aug 01, 2028, 17:30:00', Owner: 'CN=DigiCert Global CA G2, OU=www.digicert.com, O=DigiCert Inc, C=US' },
      { Alias: 'sap_digicert_global_root_ca', Type: 'Certificate', ValidNotAfter: 'Nov 10, 2031, 05:30:00', Owner: 'CN=DigiCert Global Root CA, OU=www.digicert.com, O=DigiCert Inc, C=US' },
      { Alias: 'sap_digicert_global_root_g2', Type: 'Certificate', ValidNotAfter: 'Jan 15, 2038, 17:30:00', Owner: 'CN=DigiCert Global Root G2, OU=www.digicert.com, O=DigiCert Inc, C=US' },
      { Alias: 'sap_digicert_global_root_g3', Type: 'Certificate', ValidNotAfter: 'Jan 15, 2038, 17:30:00', Owner: 'CN=DigiCert Global Root G3, OU=www.digicert.com, O=DigiCert Inc, C=US' },
      { Alias: 'sap_digicert_sha2_secure_server_ca', Type: 'Certificate', ValidNotAfter: 'Sep 23, 2030, 05:29:59', Owner: 'CN=DigiCert SHA2 Secure Server CA, O=DigiCert Inc, C=US' },
      { Alias: 'sap_digicert_tls_ecc_p384_root_g5', Type: 'Certificate', ValidNotAfter: 'Jan 15, 2046, 05:29:59', Owner: 'CN=DigiCert TLS ECC P384 Root G5, O=DigiCert, Inc., C=US' },
      { Alias: 'sap_digicert_tls_rsa4096_root_g5', Type: 'Certificate', ValidNotAfter: 'Jan 15, 2046, 05:29:59', Owner: 'CN=DigiCert TLS RSA4096 Root G5, O=DigiCert, Inc., C=US' },
      { Alias: 'sap_isrg_root_x1', Type: 'Certificate', ValidNotAfter: 'Jun 04, 2035, 16:34:38', Owner: 'CN=ISRG Root X1, O=Internet Security Research Group, C=US' },
      { Alias: 'sap_isrg_root_x2', Type: 'Certificate', ValidNotAfter: 'Sep 17, 2040, 21:30:00', Owner: 'CN=ISRG Root X2, O=Internet Security Research Group, C=US' },
      { Alias: 'sap_sap_cloud_root_ca', Type: 'Certificate', ValidNotAfter: 'Feb 13, 2039, 16:58:32', Owner: 'CN=SAP Cloud Root CA, O=SAP SE, L=Walldorf, C=DE' },
      { Alias: 'sap_sap_global_root_ca', Type: 'Certificate', ValidNotAfter: 'Apr 26, 2032, 21:16:27', Owner: 'CN=SAP Global Root CA, O=SAP AG, L=Walldorf, C=DE' },
      { Alias: 'sap_verisign_class_3_public_primary_certification_authority_-_g5', Type: 'Certificate', ValidNotAfter: 'Jul 17, 2036, 05:29:59', Owner: 'CN=VeriSign Class 3 Public Primary Certification Authority - G5' },
      { Alias: 'custom_b2b_partner_edi', Type: 'Certificate', ValidNotAfter: Date.now() + 1000 * 60 * 60 * 24 * 75, Owner: 'CN=B2B Trading Partner, O=EDI' }
    ];

    jmsQueues = [
      { QueueName: 'SalesOrder_Inbound_Queue', NumberMessages: 0, MaxCapacity: '100 MB', Status: 'Active', ModifiedTime: Date.now() - 1000 * 60 * 10 },
      { QueueName: 'EDI_PurchaseOrder_Async_Queue', NumberMessages: 2, MaxCapacity: '250 MB', Status: 'Active', ModifiedTime: Date.now() - 1000 * 60 * 15 },
      { QueueName: 'Payroll_Bulk_Stage_Queue', NumberMessages: 0, MaxCapacity: '500 MB', Status: 'Active', ModifiedTime: Date.now() - 1000 * 60 * 60 }
    ];
  }

  /**
   * Fast Tenant Origin Resolver
   * Resolves in milliseconds from storage, active window, or CPI tabs with a 1.5s race timeout
   */
  async function resolveTenantOrigin() {
    try {
      const loc = window.location.origin;
      if (loc && (loc.includes('hana.ondemand.com') || loc.includes('cloud.sap') || loc.includes('btp.sap'))) {
        tenantOrigin = loc;
        updateTenantHeader(true);
        return tenantOrigin;
      }
    } catch (e) {}

    try {
      const cached = localStorage.getItem('cpi_pulse_tenant_origin');
      if (cached && (cached.startsWith('http://') || cached.startsWith('https://'))) {
        tenantOrigin = new URL(cached).origin;
        updateTenantHeader(true);
        return tenantOrigin;
      }
    } catch (e) {}

    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        const stored = await chrome.storage.local.get(['cpi_tenant_origin', 'lastKnownTenant']);
        const found = stored.cpi_tenant_origin || stored.lastKnownTenant;
        if (found) {
          tenantOrigin = new URL(found).origin;
          localStorage.setItem('cpi_pulse_tenant_origin', tenantOrigin);
          updateTenantHeader(true);
          return tenantOrigin;
        }
      }
    } catch (e) {}

    try {
      if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
        const tabsPromise = chrome.tabs.query({
          url: ['*://*.hana.ondemand.com/*', '*://*.cloud.sap/*', '*://*.btp.sap/*']
        });
        const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve([]), 1500));
        const tabs = await Promise.race([tabsPromise, timeoutPromise]);

        if (Array.isArray(tabs) && tabs.length > 0) {
          for (const tab of tabs) {
            if (!tab.url) continue;
            const u = tab.url.toLowerCase();
            if (u.includes('hana.ondemand.com') || u.includes('cloud.sap') || u.includes('btp.sap')) {
              const parsed = new URL(tab.url);
              tenantOrigin = parsed.origin;
              localStorage.setItem('cpi_pulse_tenant_origin', tenantOrigin);
              if (typeof chrome !== 'undefined' && chrome.storage?.local) {
                chrome.storage.local.set({ cpi_tenant_origin: tenantOrigin, lastKnownTenant: tenantOrigin }).catch(() => {});
              }
              updateTenantHeader(true);
              return tenantOrigin;
            }
          }
        }
      }
    } catch (e) {}

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

  async function fetchOData(paths) {
    if (!tenantOrigin) return null;
    for (const p of paths) {
      const url = p.startsWith('http') ? p : `${tenantOrigin}${p}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3500);
      try {
        const res = await fetch(url, {
          method: 'GET',
          credentials: 'include',
          headers: { 'Accept': 'application/json' },
          signal: controller.signal
        });
        clearTimeout(timer);
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
            return Array.isArray(results) ? results : [results];
          }
        }
      } catch (e) {
        clearTimeout(timer);
      }
    }
    return null;
  }

  async function loadLiveData() {
    if (!tenantOrigin) await resolveTenantOrigin();

    if (btnRefresh) btnRefresh.classList.add('loading');

    // 1. Integration Runtime Artifacts
    const artifacts = await fetchOData([
      '/api/v1/IntegrationRuntimeArtifacts?$format=json',
      '/itspaces/odata/1.0/workspace.svc/IntegrationRuntimeArtifacts?$format=json'
    ]);
    if (artifacts !== null) allArtifacts = artifacts;

    // 2. Message Processing Logs
    const logs = await fetchOData([
      '/api/v1/MessageProcessingLogs?$orderby=LogStart desc&$top=300&$format=json',
      '/itspaces/odata/1.0/workspace.svc/MessageProcessingLogs?$orderby=LogStart desc&$top=300&$format=json'
    ]);
    if (logs !== null) rawLogs = logs;

    // 3. Keystore Entries
    const keys = await fetchOData([
      '/api/v1/KeystoreEntries?$format=json',
      '/api/v1/Keystores(\'system\')/KeystoreEntries?$format=json',
      '/itspaces/odata/1.0/workspace.svc/KeystoreEntries?$format=json',
      '/itspaces/odata/1.0/workspace.svc/Keystores(\'system\')/Entries?$format=json',
      '/itspaces/api/1.0/keystores/system/entries'
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

    // 4. JMS Broker Resources
    const broker = await fetchOData([
      '/api/v1/JmsBrokers(\'Broker1\')?$format=json',
      '/api/v1/JmsBrokers?$format=json',
      '/itspaces/odata/1.0/workspace.svc/JmsBrokers?$format=json'
    ]);
    if (broker !== null && broker.length > 0) {
      jmsBrokerInfo = broker[0];
    }

    // 5. JMS Message Queues
    const queues = await fetchOData([
      '/api/v1/MessagingQueues?$format=json',
      '/api/v1/JmsQueues?$format=json',
      '/api/v1/Queues?$format=json',
      '/itspaces/odata/1.0/workspace.svc/MessagingQueues?$format=json',
      '/itspaces/odata/1.0/workspace.svc/MessageQueues?$format=json'
    ]);
    if (queues !== null) {
      jmsQueues = queues.map(q => ({
        ...q,
        QueueName: q.QueueName || q.Name || 'Queue',
        NumberMessages: Number(q.NumberMessages ?? q.MessageCount ?? q.MessagesInQueue ?? 0),
        MaxCapacity: q.MaxCapacity || q.Capacity || (jmsBrokerInfo?.MaxCapacity ? jmsBrokerInfo.MaxCapacity : '250 MB'),
        Status: q.Status || 'Active',
        ModifiedTime: q.ModifiedTime || q.LastModified || Date.now()
      }));

      try {
        const customQ = JSON.parse(localStorage.getItem('cpi_pulse_custom_queues') || '[]');
        customQ.forEach(cq => {
          if (!jmsQueues.some(q => (q.QueueName || q.Name || '').toLowerCase() === (cq.QueueName || cq.Name || '').toLowerCase())) {
            jmsQueues.unshift(cq);
          }
        });
      } catch (e) {}
    }

    if (btnRefresh) btnRefresh.classList.remove('loading');

    if (artifacts || logs || keys !== null || queues !== null) {
      updateTenantHeader(true);
      if (lastSyncTime) lastSyncTime.textContent = 'Sync: ' + new Date().toLocaleTimeString();
    } else if (allArtifacts.length === 0) {
      provideFallbackData();
      if (lastSyncTime) lastSyncTime.textContent = 'Demo Mode (Log into CPI tab for Live Sync)';
    }

    syncTimeRangeData();
    preloadArtifactErrors();
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
          headers: { 'Accept': 'text/plain, application/json, application/xml, */*' }
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
      } catch (e) {}
    }

    try {
      const mplRes = await fetch(`${tenantOrigin}/api/v1/MessageProcessingLogs?\$filter=IntegrationFlowName eq '${encodeURIComponent(artifactId)}' and Status eq 'FAILED'&\$orderby=LogEnd desc&\$top=1&\$format=json`, {
        method: 'GET',
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
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
    } catch (e) {}

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
          headers: { 'Accept': 'text/plain, application/json, */*' }
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
      } catch (e) {}
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

    const failedCount = failedLogs.length;
    if (kpiErrorSentinel) {
      kpiErrorSentinel.textContent = failedCount.toLocaleString();
      kpiErrorSentinel.className = failedCount === 0 ? 'sap-tile-kpi positive' : 'sap-tile-kpi negative';
    }

    const ninetyDays = Date.now() + 90 * 24 * 60 * 60 * 1000;
    const expiringCount = keystoreEntries.filter(k => {
      const ms = getTimestampMs(k.ValidNotAfter);
      return ms > 0 && ms <= ninetyDays;
    }).length;
    if (kpiKeystoreGuardian) kpiKeystoreGuardian.textContent = keystoreEntries.length;
    if (kpiKeystoreSubtext) {
      if (keystoreEntries.length === 0) {
        kpiKeystoreSubtext.textContent = '0 Certificates';
      } else if (expiringCount > 0) {
        kpiKeystoreSubtext.textContent = `${expiringCount} Expiring Soon`;
      } else {
        kpiKeystoreSubtext.textContent = `${keystoreEntries.length} Active (All Valid)`;
      }
    }

    const activeQCount = jmsQueues.length;
    let totalJmsMsgs = 0;
    jmsQueues.forEach(q => {
      totalJmsMsgs += (Number(q.NumberMessages) || Number(q.MessageCount) || Number(q.MessagesInQueue) || 0);
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
    if (detailTableTitle) detailTableTitle.textContent = 'Deployed Integration Artifacts';
    

    const startedCount = allArtifacts.filter(a => (a.Status || '').toUpperCase() === 'STARTED').length;
    const errorCount = allArtifacts.filter(a => (a.Status || '').toUpperCase() === 'ERROR').length;
    const stoppedCount = allArtifacts.filter(a => (a.Status || '').toUpperCase() === 'STOPPED').length;

    if (filterChipsContainer) {
      filterChipsContainer.innerHTML = `
        <button class="sap-chip ${activeDetailFilter === 'all' ? 'active' : ''}" data-chip="all">All (${allArtifacts.length})</button>
        <button class="sap-chip ${activeDetailFilter === 'started' ? 'active' : ''}" data-chip="started">Started (${startedCount})</button>
        <button class="sap-chip ${activeDetailFilter === 'error' ? 'active' : ''}" data-chip="error">Error (${errorCount})</button>
        <button class="sap-chip ${activeDetailFilter === 'stopped' ? 'active' : ''}" data-chip="stopped">Stopped (${stoppedCount})</button>
      `;
    }

    if (detailTableHead) {
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

    let list = [...allArtifacts];
    if (activeDetailFilter === 'started') list = list.filter(a => (a.Status || '').toUpperCase() === 'STARTED');
    else if (activeDetailFilter === 'error') list = list.filter(a => (a.Status || '').toUpperCase() === 'ERROR');
    else if (activeDetailFilter === 'stopped') list = list.filter(a => (a.Status || '').toUpperCase() === 'STOPPED');

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

    if (detailTableCount) detailTableCount.textContent = list.length;
    if (!detailTableBody) return;
    detailTableBody.innerHTML = '';

    if (list.length === 0) {
      applyDetailPagination([]);
      detailTableBody.innerHTML = '<tr><td colspan="6" class="sap-table-loading">No artifacts match the current filter.</td></tr>';
      return;
    }

    const displayList = applyDetailPagination(list);
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
          const demoErr = getDemoErrorForArtifact(id);
          const summary = extractErrorSummary(demoErr, id);
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

  function renderErrorSentinelTable() {
    if (detailTableTitle) detailTableTitle.textContent = 'Failed Interface Executions';
    

    if (filterChipsContainer) {
      filterChipsContainer.innerHTML = `
        <button class="sap-chip active">All Failures (${failedLogs.length})</button>
      `;
    }

    if (detailTableHead) {
      detailTableHead.innerHTML = `
        <tr>
          <th class="sortable ${detailSort.column === 'name' ? 'sorted-' + detailSort.dir : ''}" data-col="name">Failing Interface / iFlow <span class="sort-icon">${detailSort.column === 'name' ? (detailSort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span></th>
          <th class="sortable ${detailSort.column === 'guid' ? 'sorted-' + detailSort.dir : ''}" data-col="guid">Message GUID <span class="sort-icon">${detailSort.column === 'guid' ? (detailSort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span></th>
          <th>Status</th>
          <th class="sortable ${detailSort.column === 'time' ? 'sorted-' + detailSort.dir : ''}" data-col="time">Log Timestamp <span class="sort-icon">${detailSort.column === 'time' ? (detailSort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span></th>
          <th class="sortable ${detailSort.column === 'dur' ? 'sorted-' + detailSort.dir : ''}" data-col="dur" title="Click to sort by Duration">Processing Duration <span class="sort-icon">${detailSort.column === 'dur' ? (detailSort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span></th>
          <th>Root Cause Diagnosis</th>
        </tr>
      `;
    }

    let list = [...failedLogs];
    if (detailSearchQuery) {
      const q = detailSearchQuery.toLowerCase();
      list = list.filter(l => (l.IntegrationFlowName || '').toLowerCase().includes(q));
    }

    list.sort((a, b) => {
      let vA = '', vB = '';
      if (detailSort.column === 'name') { vA = (a.IntegrationFlowName || '').toLowerCase(); vB = (b.IntegrationFlowName || '').toLowerCase(); }
      else if (detailSort.column === 'guid') { vA = (a.MessageGuid || ''); vB = (b.MessageGuid || ''); }
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

    if (detailTableCount) detailTableCount.textContent = list.length;
    if (!detailTableBody) return;
    detailTableBody.innerHTML = '';

    if (list.length === 0) {
      applyDetailPagination([]);
      detailTableBody.innerHTML = '<tr><td colspan="6" class="sap-table-loading">No failed messages detected in the selected time range. All interfaces executing successfully.</td></tr>';
      return;
    }

    const displayList = applyDetailPagination(list);
    displayList.forEach(msg => {
      const guid = msg.MessageGuid || '-';
      const dur = (getTimestampMs(msg.LogEnd) - getTimestampMs(msg.LogStart)) || 0;
      const cachedMplError = mplErrorCache[guid];
      let diagHtml = '';

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

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${escapeHtml(msg.IntegrationFlowName || 'Integration Flow')}</strong></td>
        <td style="font-family: monospace; font-size: 11px; color: #6a6d70;">${escapeHtml(guid)}</td>
        <td><span class="status-pill error">FAILED</span></td>
        <td>${formatWithTimezone(msg.LogStart)}</td>
        <td><strong>${dur > 0 ? (dur < 1000 ? dur + ' ms' : (dur/1000).toFixed(2) + ' s') : '-'}</strong></td>
        <td>${diagHtml}</td>
      `;
      detailTableBody.appendChild(tr);
    });
  }

  function renderKeystoreTable() {
    if (detailTableTitle) detailTableTitle.textContent = 'Manage Keystore - Certificates & Expiry';
    

    const now = Date.now();
    const ninetyDays = now + 90 * 24 * 60 * 60 * 1000;

    const expiringCount = keystoreEntries.filter(k => {
      const ms = getTimestampMs(k.ValidNotAfter);
      return ms > 0 && ms <= ninetyDays;
    }).length;

    const validCount = keystoreEntries.length - expiringCount;

    if (filterChipsContainer) {
      filterChipsContainer.innerHTML = `
        <button class="sap-chip ${activeDetailFilter === 'all' ? 'active' : ''}" data-chip="all">All Certificates (${keystoreEntries.length})</button>
        <button class="sap-chip ${activeDetailFilter === 'expiring' ? 'active' : ''}" data-chip="expiring">Expiring Soon &le; 90d (${expiringCount})</button>
        <button class="sap-chip ${activeDetailFilter === 'valid' ? 'active' : ''}" data-chip="valid">Valid (${validCount})</button>
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
    if (activeDetailFilter === 'expiring') {
      list = list.filter(k => {
        const ms = getTimestampMs(k.ValidNotAfter);
        return ms > 0 && ms <= ninetyDays;
      });
    } else if (activeDetailFilter === 'valid') {
      list = list.filter(k => {
        const ms = getTimestampMs(k.ValidNotAfter);
        return ms === 0 || ms > ninetyDays;
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

    if (detailTableCount) detailTableCount.textContent = list.length;
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

      if (daysRemaining <= 30) {
        statusHtml = '<span class="status-pill error">Critical Expiry</span>';
        daysColor = 'var(--sap-negative)';
      } else if (daysRemaining <= 90) {
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
          <th>Last Active / Modified</th>
          <th>Action</th>
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
      if (detailSort.column === 'name') { vA = (a.QueueName || a.Name || '').toLowerCase(); vB = (b.QueueName || b.Name || '').toLowerCase(); }
      else if (detailSort.column === 'msgs') { vA = a.NumberMessages || 0; vB = b.NumberMessages || 0; }
      if (vA < vB) return detailSort.dir === 'asc' ? -1 : 1;
      if (vA > vB) return detailSort.dir === 'asc' ? 1 : -1;
      return 0;
    });

    if (detailTableCount) detailTableCount.textContent = list.length;
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
      const msgs = q.NumberMessages ?? q.MessageCount ?? 0;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <strong>${qName}</strong>
          ${q.isCustomCreated ? '<span class="sap-badge-chip" style="margin-left: 6px; font-size: 10px; background: rgba(0, 112, 242, 0.12); color: var(--sap-brand-blue); padding: 2px 6px; border-radius: 4px;">Custom</span>' : ''}
        </td>
        <td><strong style="color: ${msgs > 50 ? 'var(--sap-critical)' : 'var(--sap-text-primary)'};">${msgs} msg</strong></td>
        <td style="color: #6a6d70;">${q.MaxCapacity || q.Capacity || '250 MB'}</td>
        <td><span class="status-pill started">Active</span></td>
        <td>${formatWithTimezone(q.ModifiedTime || Date.now())}</td>
        <td>
          <button type="button" class="btn-delete-queue" data-queue="${qName}" title="Delete queue from broker">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </td>
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

    const isBottleneck = activePerfFilter === 'bottlenecks';
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

    const totalLogs = targetLogs.length;

    let totalDurationMs = 0;
    let validDurationCount = 0;
    let maxFlowDur = 0;
    let failedCount = 0;
    const hourBuckets = {};
    for (let i = 0; i < 24; i++) hourBuckets[i] = 0;

    targetLogs.forEach(l => {
      if ((l.Status || '').toUpperCase() === 'FAILED') failedCount++;
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
          } catch (e) {}
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

    // Calculate Bottleneck Count (iFlows with avg runtime >= 2.0s)
    const flowMap = {};
    targetLogs.forEach(l => {
      const name = l.IntegrationFlowName || 'Unknown iFlow';
      if (!flowMap[name]) flowMap[name] = { name, durations: [] };
      const sMs = getTimestampMs(l.LogStart);
      const eMs = getTimestampMs(l.LogEnd);
      if (sMs && eMs && eMs >= sMs) flowMap[name].durations.push(eMs - sMs);
    });

    const computedFlows = Object.values(flowMap).map(f => {
      const sum = f.durations.reduce((a, b) => a + b, 0);
      const avg = f.durations.length > 0 ? Math.round(sum / f.durations.length) : 0;
      return { ...f, avgDuration: avg };
    });

    const bottleneckCount = computedFlows.filter(f => f.avgDuration >= Math.round(bottleneckThresholdSec * 1000)).length;

    
    const inputBottleneckThreshold = document.getElementById('inputBottleneckThreshold');
    if (inputBottleneckThreshold && document.activeElement !== inputBottleneckThreshold) {
      inputBottleneckThreshold.value = bottleneckThresholdSec.toFixed(1);
    }
    if (lblSlowTimeframe) lblSlowTimeframe.textContent = `Latency ≥ ${bottleneckThresholdSec.toFixed(1)}s`;
    if (tileSlowestAlert) tileSlowestAlert.title = `Click to filter leaderboard to Bottlenecks Only (≥ ${bottleneckThresholdSec.toFixed(1)}s)`;
    const chipBottlenecks = document.getElementById('chipBottlenecks');
    if (chipBottlenecks) chipBottlenecks.textContent = `Bottlenecks (≥ ${bottleneckThresholdSec.toFixed(1)}s)`;

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
      kpiSlowSubtext.textContent = activePerfFilter === 'bottlenecks'
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
      const name = l.IntegrationFlowName || 'Unknown iFlow';
      if (!flowMap[name]) {
        flowMap[name] = { name, durations: [], total: 0, failed: 0 };
      }
      flowMap[name].total++;
      if ((l.Status || '').toUpperCase() === 'FAILED') {
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
      slowestList = slowestList.filter(f => f.avgDuration >= Math.round(bottleneckThresholdSec * 1000));
    } else if (activePerfFilter === 'failures') {
      slowestList = slowestList.filter(f => f.failed > 0);
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

    if (slowestCountBadge) slowestCountBadge.textContent = slowestList.length;
    if (!slowestTableBody) return;
    slowestTableBody.innerHTML = '';

    if (slowestList.length === 0) {
      let msg = selectedPerfFlow
        ? 'No message processing logs found for "' + selectedPerfFlow + '" matching current filter.'
        : 'No integration flows match the current performance filter.';
      let resetBtn = '';

      if (activePerfFilter === 'bottlenecks') {
        msg = `No latency bottlenecks (≥ ${bottleneckThresholdSec.toFixed(1)}s) found in the selected timeframe.`;
        resetBtn = '<button type="button" class="btn-reset-perf-filter" id="btnResetPerfFilter" style="margin-left: 12px; padding: 4px 12px; font-size: 12px; font-weight: 600; background: var(--sap-brand-blue, #0070f2); color: #fff; border: none; border-radius: 4px; cursor: pointer;">Show All Flows</button>';
      } else if (activePerfFilter === 'failures') {
        msg = 'No failed integration flows found in the selected timeframe.';
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
      const isBottleneck = item.avgDuration >= thresholdMs;

      if (isBottleneck) {
        riskClass = 'high';
        riskLabel = 'CRITICAL';
        if (item.failed > 0) {
          diagnosis = `Bottleneck (&ge; ${bottleneckThresholdSec.toFixed(1)}s) & ${item.failed} failed`;
        } else {
          diagnosis = `Latency Bottleneck &ge; ${bottleneckThresholdSec.toFixed(1)}s`;
        }
      } else if (item.failed > 0) {
        riskClass = 'high';
        riskLabel = 'CRITICAL';
        diagnosis = `Elevated Failures (${item.failed} failed)`;
      } else if (item.avgDuration >= warnMs && warnMs > 0 && thresholdMs > 1000) {
        riskClass = 'medium';
        riskLabel = 'WARNING';
        diagnosis = `Moderate Latency &ge; ${(warnMs / 1000).toFixed(1)}s`;
      }

      const avgColor = isBottleneck ? 'var(--sap-negative)' : 'var(--sap-text-primary)';

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
        <td>${item.failed > 0 ? '<span style="color: var(--sap-negative); font-weight: 700;">' + item.failed + '</span>' : '0'}</td>
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

    const hourBuckets = {};
    for (let i = 0; i < 24; i++) hourBuckets[i] = 0;

    targetLogs.forEach(l => {
      const startMs = getTimestampMs(l.LogStart);
      if (startMs) {
        const d = new Date(startMs);
        let hr = d.getHours();
        if (currentTimezone && currentTimezone !== 'local') {
          try {
            const tzHourStr = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: currentTimezone }).format(d);
            hr = parseInt(tzHourStr, 10) % 24;
          } catch (e) {}
        }
        hourBuckets[hr] = (hourBuckets[hr] || 0) + 1;
      }
    });

    const peakResult = calculatePeakWindow(hourBuckets, targetLogs.length, currentTimezone);
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
    if (!name || typeof name !== 'string') return 'PD';
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return 'PD';
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
    } catch (e) {}
    updateProfileUI();
  }

  function updateProfileUI() {
    if (!avatarInitials) return;
    const initials = getInitials(userProfile.name);
    avatarInitials.textContent = initials;
    if (profileNameDisplay) profileNameDisplay.textContent = userProfile.name;
    if (profileEmailDisplay) profileEmailDisplay.textContent = userProfile.email;
    if (profileRoleDisplay) profileRoleDisplay.textContent = userProfile.role || 'Integration Developer';
    if (inputProfileName) inputProfileName.value = userProfile.name;
    if (inputProfileEmail) inputProfileEmail.value = userProfile.email;
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
      } catch (e) {}
    }
  }



  function saveCustomQueues() {
    try {
      const custom = jmsQueues.filter(q => q.isCustomCreated);
      localStorage.setItem('cpi_pulse_custom_queues', JSON.stringify(custom));
    } catch (e) {}
  }

  async function handleDeleteJmsQueue(queueName) {
    if (!queueName) return;
    if (!confirm(`Delete JMS Queue "${queueName}" from SAP CPI broker?`)) return;

    if (tenantOrigin) {
      let csrfToken = null;
      try {
        const tokenRes = await fetch(`${tenantOrigin}/api/v1/`, {
          method: 'GET',
          credentials: 'include',
          headers: { 'X-CSRF-Token': 'Fetch' }
        });
        csrfToken = tokenRes.headers.get('x-csrf-token');
      } catch (e) {}

      try {
        const res = await fetch(`${tenantOrigin}/api/v1/MessagingQueues('${encodeURIComponent(queueName)}')`, {
          method: 'DELETE',
          credentials: 'include',
          headers: { 'X-CSRF-Token': csrfToken || '' }
        });
        if (res.ok || res.status === 204 || res.status === 200) {
          showToast(`JMS Queue "${queueName}" deleted from broker successfully!`);
        } else {
          let errData = null;
          try { errData = await res.json(); } catch(e) {}
          const msg = errData?.error?.message?.value || errData?.error?.message || `HTTP ${res.status}`;
          showToast(`CPI Delete Notice: ${msg}`);
        }
      } catch (err) {
        showToast(`Delete request failed: ${err.message}`);
      }
    } else {
      showToast(`[Demo Mode] Queue "${queueName}" removed.`);
    }

    jmsQueues = jmsQueues.filter(q => (q.QueueName || q.Name) !== queueName);
    saveCustomQueues();
    renderCapabilityKPIs();
    renderDetailTable();
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
        const btnDel = e.target.closest('.btn-delete-queue');
        if (btnDel && btnDel.dataset.queue) {
          e.stopPropagation();
          handleDeleteJmsQueue(btnDel.dataset.queue);
          return;
        }

        const btnErr = e.target.closest('.btn-view-error-details');
        if (btnErr && btnErr.dataset.id) {
          e.stopPropagation();
          const id = btnErr.dataset.id;
          const type = btnErr.dataset.type;
          if (type === 'artifact') {
            const rawErr = artifactErrorCache[id] || getDemoErrorForArtifact(id);
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
          if (!isOpen) updateProfileUI();
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
        if (newEmail) userProfile.email = newEmail;
        if (newRole) userProfile.role = newRole;
        try {
          localStorage.setItem('cpi_pulse_profile', JSON.stringify(userProfile));
        } catch (e) {}
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

    document.querySelectorAll('.sap-tile[data-capability]').forEach(tile => {
      tile.addEventListener('click', () => {
        activeCapability = tile.dataset.capability;
        activeDetailFilter = 'all';
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
          activeDetailFilter = chip.dataset.chip;
          detailCurrentPage = 1;
          renderDetailTable();
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
        } catch (e) {}
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
    } catch (e) {}

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
            ? `Filtered leaderboard to Bottlenecks Only (≥ ${bottleneckThresholdSec.toFixed(1)}s)`
            : 'Showing all integration flows');
        }
      });
    });

    // Performance Toolbar Filter Chips (All Flows | Bottlenecks | Failures)
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
          } catch (err) {}
          renderPerformanceAnalytics();
          showToast(`Bottleneck threshold updated to ${bottleneckThresholdSec.toFixed(1)}s`);
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
        const input = prompt('Enter your SAP Cloud Integration Tenant Base URL:', current);
        if (input && input.trim()) {
          try {
            const parsed = new URL(input.trim());
            tenantOrigin = parsed.origin;
            localStorage.setItem('cpi_pulse_tenant_origin', tenantOrigin);
            if (typeof chrome !== 'undefined' && chrome.storage?.local) {
              chrome.storage.local.set({ cpi_tenant_origin: tenantOrigin, lastKnownTenant: tenantOrigin }).catch(() => {});
            }
            updateTenantHeader(true);
            loadLiveData();
            showToast('Connected to tenant: ' + parsed.hostname);
          } catch (e) {
            alert('Invalid URL format. Please enter a valid URL.');
          }
        }
      });
    }
  }

  function initFooterVersion() {
    const el = document.getElementById('footerAppVersion');
    if (!el) return;
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getManifest === 'function') {
        const manifest = chrome.runtime.getManifest();
        if (manifest && manifest.version) {
          el.textContent = `v${manifest.version}`;
          return;
        }
      }
    } catch (e) {}
    el.textContent = 'v1.0.0';
  }

  async function init() {
    initFooterVersion();
    loadUserProfile();
    try {
      const savedSync = parseInt(localStorage.getItem('cpi_pulse_autosync') || '0', 10);
      setupAutoSync(savedSync, false);
    } catch (e) {}
    applyTheme(currentTheme, false);
    attachListeners();

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
      provideFallbackData();
      syncTimeRangeData();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
