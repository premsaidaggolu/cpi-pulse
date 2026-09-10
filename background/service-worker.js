/**
 * CPI Pulse - Background Service Worker (MV3)
 */

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[CPI Pulse] Extension installed successfully.');
    // Set initial mock or cached metrics
    chrome.storage.local.set({
      cpiPulseSettings: {
        theme: 'morning-horizon',
        autoRefreshInterval: 60,
        bottleneckThresholdMs: 3000
      }
    });
  }
});

// Handle messages from content script or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'openDashboard') {
    const dashboardUrl = chrome.runtime.getURL('dashboard/dashboard.html' + (message.tab ? '#' + message.tab : ''));
    
    // Check if dashboard tab already exists
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
    // Return detected tenant or settings
    chrome.storage.local.get(['cpiPulseSettings', 'lastKnownTenant'], (res) => {
      sendResponse({
        settings: res.cpiPulseSettings || {},
        tenant: res.lastKnownTenant || sender.tab?.url || null
      });
    });
    return true;
  }
});
