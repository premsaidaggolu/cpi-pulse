/**
 * CPI Pulse - Background Service Worker (MV3)
 * Universal multi-tenant monitor for SAP Cloud Integration / Integration Suite.
 */

function isCpiUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return false;
  try {
    const u = new URL(urlStr);
    const host = u.hostname.toLowerCase();
    const path = u.pathname.toLowerCase();
    return (
      host.includes('hana.ondemand.com') ||
      host.includes('cloud.sap') ||
      host.includes('btp.sap') ||
      host.includes('sap.com') ||
      path.includes('/itspaces') ||
      path.includes('/shell')
    );
  } catch (e) {
    return false;
  }
}

function updateTenantFromUrl(urlStr) {
  if (!isCpiUrl(urlStr)) return;
  try {
    const origin = new URL(urlStr).origin;
    chrome.storage.local.set({
      lastKnownTenant: origin,
      cpi_tenant_origin: origin
    });
  } catch (e) {}
}

function scanOpenTabsForTenant() {
  try {
    if (chrome?.tabs?.query) {
      chrome.tabs.query({}, (tabs) => {
        if (Array.isArray(tabs)) {
          for (const t of tabs) {
            if (t && t.url && isCpiUrl(t.url)) {
              updateTenantFromUrl(t.url);
              break;
            }
          }
        }
      });
    }
  } catch (e) {}
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.local.set({
      cpiPulseSettings: {
        autoRefreshInterval: 60,
        bottleneckThresholdSec: 2.0
      }
    });
  }
  scanOpenTabsForTenant();
});

chrome.runtime.onStartup.addListener(() => {
  scanOpenTabsForTenant();
});

// Scan tabs immediately on worker start
scanOpenTabsForTenant();

// Monitor active tab changes to dynamically detect the active CPI tenant
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab && tab.url) {
    updateTenantFromUrl(tab.url);
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab && tab.url) {
      updateTenantFromUrl(tab.url);
    }
  } catch (e) {}
});

// Handle messages from content script, popup, or dashboard
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'openDashboard') {
    if (sender?.tab?.url) {
      updateTenantFromUrl(sender.tab.url);
    }
    const dashboardUrl = chrome.runtime.getURL('dashboard/dashboard.html' + (message.tab ? '#' + message.tab : ''));

    chrome.tabs.query({}, (tabs) => {
      const existingTab = tabs.find(t => t.url && t.url.startsWith(chrome.runtime.getURL('dashboard/dashboard.html')));
      if (existingTab) {
        chrome.tabs.update(existingTab.id, { active: true, url: dashboardUrl });
        if (existingTab.windowId) {
          chrome.windows.update(existingTab.windowId, { focused: true });
        }
      } else {
        chrome.tabs.create({ url: dashboardUrl });
      }
    });

    sendResponse({ status: 'ok' });
    return true;
  }

  if (message.action === 'getTenantInfo') {
    chrome.storage.local.get(['cpiPulseSettings', 'lastKnownTenant', 'cpi_tenant_origin', 'cpi_cached_summary'], (res) => {
      sendResponse({
        settings: res.cpiPulseSettings || {},
        tenant: res.cpi_tenant_origin || res.lastKnownTenant || null,
        summary: res.cpi_cached_summary || null
      });
    });
    return true;
  }

  if (message.action === 'updateBadge') {
    const count = parseInt(message.count, 10) || 0;
    if (count > 0) {
      chrome.action.setBadgeText({ text: String(count) });
      chrome.action.setBadgeBackgroundColor({ color: '#bb0000' });
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
    sendResponse({ status: 'ok' });
    return true;
  }
});
