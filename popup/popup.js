document.addEventListener('DOMContentLoaded', async () => {
  const btn = document.getElementById('btnOpenDashboard');
  const popupTenantName = document.getElementById('popupTenantName');
  const popupTenantDot = document.getElementById('popupTenantDot');
  const popupLiveBadge = document.getElementById('popupLiveBadge');
  const popupKpiRunning = document.getElementById('popupKpiRunning');
  const popupKpiErrors = document.getElementById('popupKpiErrors');
  const popupKpiAvg = document.getElementById('popupKpiAvg');
  const popupFooterText = document.getElementById('popupFooterText');
  const popupAppVersion = document.getElementById('popupAppVersion');

  try {
    if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getManifest === 'function') {
      const manifest = chrome.runtime.getManifest();
      if (manifest && manifest.version && popupAppVersion) {
        popupAppVersion.textContent = `v${manifest.version}`;
        popupAppVersion.title = `${manifest.name || 'CPI Pulse'} v${manifest.version}`;
      }
    }
  } catch (e) { }

  function formatMs(ms) {
    if (ms == null || isNaN(ms)) return '--';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    const sec = ms / 1000;
    if (sec < 60) return `${sec.toFixed(1)}s`;
    const min = Math.floor(sec / 60);
    const remSec = Math.round(sec % 60);
    return `${min}m ${remSec}s`;
  }

  function renderSummary(summary, tenantUrl) {
    if (tenantUrl) {
      try {
        const u = new URL(tenantUrl);
        if (popupTenantName) popupTenantName.textContent = u.hostname;
        if (popupTenantDot) popupTenantDot.className = 'popup-tenant-dot green';
        if (popupFooterText) popupFooterText.textContent = 'Connected: ' + u.hostname;
      } catch (e) {
        if (popupTenantName) popupTenantName.textContent = tenantUrl;
      }
    }

    if (summary) {
      if (popupKpiRunning) popupKpiRunning.textContent = summary.startedCount != null ? summary.startedCount : '--';
      if (popupKpiErrors) popupKpiErrors.textContent = summary.errorCount != null ? summary.errorCount : '--';
      if (popupKpiAvg) popupKpiAvg.textContent = summary.avgDurationMs ? formatMs(summary.avgDurationMs) : '--';
      if (popupLiveBadge) {
        popupLiveBadge.textContent = 'Live';
        popupLiveBadge.style.background = '#107e3e';
      }
    }
  }

  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const data = await chrome.storage.local.get(['cpi_cached_summary', 'cpi_tenant_origin', 'lastKnownTenant']);
      const tenant = data.cpi_tenant_origin || data.lastKnownTenant || null;
      const summary = data.cpi_cached_summary || null;

      if (tenant || summary) {
        renderSummary(summary, tenant);
      } else if (chrome.tabs?.query) {
        // Query active tab to see if user is currently on an SAP tab
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (activeTab && activeTab.url) {
          const u = activeTab.url.toLowerCase();
          if (u.includes('hana.ondemand.com') || u.includes('cloud.sap') || u.includes('btp.sap') || u.includes('sap.com')) {
            try {
              const origin = new URL(activeTab.url).origin;
              renderSummary(null, origin);
              if (popupFooterText) popupFooterText.textContent = 'Open Cockpit to sync metrics';
            } catch (e) {}
          } else {
            if (popupTenantName) popupTenantName.textContent = 'No active CPI tenant';
            if (popupTenantDot) popupTenantDot.className = 'popup-tenant-dot amber';
            if (popupLiveBadge) {
              popupLiveBadge.textContent = 'Standby';
              popupLiveBadge.style.background = '#e9730c';
            }
          }
        }
      }
    }
  } catch (e) {}

  if (btn) {
    btn.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
      window.close();
    });
  }
});
