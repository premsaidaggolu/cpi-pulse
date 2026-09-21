/**
 * CPI Pulse - Content Script
 * Injects a clean "CPI Pulse" navigation item into the SAP Integration Suite sidebar (Image 1)
 * Without extra badges or floating buttons.
 */

(function () {
  'use strict';

  const PULSE_ID = 'cpi-pulse-nav-entry';
  let injectionAttempts = 0;
  const MAX_ATTEMPTS = 30;

  // Pulse Wave SVG Icon matching SAP iconography
  const PULSE_SVG_ICON = `
    <svg class="cpi-pulse-svg-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
      <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
    </svg>
  `;

  // Save current tenant origin to storage for dashboard tab
  try {
    const origin = window.location.origin;
    if (chrome?.storage?.local) {
      chrome.storage.local.set({
        lastKnownTenant: origin,
        cpi_tenant_origin: origin
      });
    }
  } catch (e) {}

  function openDashboard() {
    try {
      if (chrome?.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ action: 'openDashboard' });
      } else {
        window.open(chrome.runtime.getURL('dashboard/dashboard.html'), '_blank');
      }
    } catch (err) {
      window.open(chrome.runtime.getURL('dashboard/dashboard.html'), '_blank');
    }
  }

  function findNavigationContainer() {
    // 1. Native SAP TNT SideNavigation
    const tntList = document.querySelector('.sapTntSideNavigation ul.sapTntNavList, .sapTntNavList, .sapTntSideNavigationContent ul');
    if (tntList) return tntList;

    // 2. Parent list of known sidebar items
    const navItems = document.querySelectorAll('li, div[role="treeitem"], div[role="menuitem"], .fd-side-nav__item, a');
    for (const item of navItems) {
      const txt = (item.textContent || '').trim().toLowerCase();
      if (txt === 'settings' || txt === 'monitor' || txt === 'inspect' || txt === 'monetize') {
        const parentUl = item.closest('ul') || item.closest('nav') || item.parentElement;
        if (parentUl) return parentUl;
      }
    }

    // 3. General aside / nav list
    const aside = document.querySelector('aside ul, nav ul, [role="navigation"] ul');
    if (aside) return aside;

    return null;
  }

  
  // ==========================================================================
  // Browser Login Session User Detection
  // ==========================================================================
  async function detectAndStoreSessionUser() {
    let userName = null;
    let userEmail = null;
    let userRole = 'Integration Specialist';

    // 1. Try BTP / CPI currentUser APIs via active browser session cookies
    const endpoints = [
      '/api/1.0/user',
      '/services/userapi/currentUser',
      '/itspaces/api/1.0/user',
      '/itspaces/service/user',
      '/iam/Users/me'
    ];

    for (const ep of endpoints) {
      try {
        const res = await fetch(window.location.origin + ep, {
          credentials: 'include',
          headers: {
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
          }
        });
        if (res.ok) {
          const rawD = await res.json();
          const d = Array.isArray(rawD) ? rawD[0] : (rawD?.d?.results?.[0] || rawD?.d || rawD);
          if (d && typeof d === 'object') {
            const fName = (d.FirstName || d.firstName || '').trim();
            const lName = (d.LastName || d.lastName || '').trim();
            if (fName || lName) {
              userName = `${fName} ${lName}`.trim();
            }
            if (!userName) {
              userName = (d.displayName || d.DisplayName || '').trim();
            }
            const rawName = (d.Name || d.name || d.userName || d.id || '').trim();
            if (!userName && rawName && !rawName.includes('@')) {
              userName = rawName;
            }
            if (!userName && rawName && rawName.includes('@')) {
              const userPart = rawName.split('@')[0].replace(/[._-]/g, ' ');
              userName = userPart.split(' ').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
            }
            userEmail = (d.Email || d.email || d.mail || '').trim();
            if (!userEmail && rawName && rawName.includes('@')) {
              userEmail = rawName;
            }
            const roles = d.roles || d.Roles;
            if (Array.isArray(roles) && roles.length > 0) {
              const meaningful = roles.find(r => /admin|developer|specialist|provisioner|integration/i.test(r)) || roles[0];
              userRole = String(meaningful).replace(/^AuthGroup_/i, '').replace(/_/g, ' ');
            } else if (d.Role || d.role) {
              userRole = d.Role || d.role;
            }
            if (userName) break;
          }
        }
      } catch (e) {}
    }

    // 2. DOM Inspection from SAP Fiori Shell in active tab
    if (!userName) {
      const userBtn = document.querySelector('#userActionsMenuHeaderButton, [id*="userActionsMenu"], [aria-label*="User"], .sapUshellShellHeadItm[title*="User"]');
      if (userBtn) {
        const raw = userBtn.getAttribute('title') || userBtn.getAttribute('aria-label') || '';
        const match = raw.match(/User\s+(?:Settings|Profile)?\s*\(([^)]+)\)/i) || raw.match(/^([A-Za-z\s]+)$/);
        if (match) userName = match[1].trim();
        else if (raw && !raw.toLowerCase().startsWith('user')) userName = raw.trim();
      }
    }

    // 3. SAP UI5 Core / Ushell window state if exposed
    if (!userName && window.sap?.ushell?.Container) {
      try {
        const u = window.sap.ushell.Container.getUser();
        if (u) {
          userName = u.getFullName() || u.getId();
          userEmail = u.getEmail() || userEmail;
        }
      } catch (e) {}
    }

    if (userName && chrome?.storage?.local) {
      chrome.storage.local.set({
        cpi_session_user: {
          name: userName,
          email: userEmail || '',
          role: userRole,
          source: 'session',
          tenant: window.location.origin,
          detectedAt: Date.now()
        }
      });
    }

    return { name: userName, email: userEmail, role: userRole };
  }

  // Listen for messages from dashboard asking for user profile
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getUserProfile') {
      detectAndStoreSessionUser().then(profile => sendResponse(profile));
      return true;
    }
  });

  // Run detection after page settles
  setTimeout(detectAndStoreSessionUser, 2000);

  function injectSidebarEntry() {
    if (document.getElementById(PULSE_ID)) {
      return true;
    }

    const container = findNavigationContainer();
    if (!container) {
      return false;
    }

    const navItem = document.createElement('li');
    navItem.id = PULSE_ID;
    navItem.className = 'sapTntNavLI cpi-pulse-nav-item';
    navItem.setAttribute('role', 'none');

    // Clean structure matching native SAP TNT SideNavigation items exactly
    navItem.innerHTML = `
      <div class="sapTntNavLIGroupItem cpi-pulse-item-content" role="treeitem" tabindex="0" title="CPI Pulse - Integration Analytics & Health">
        <span class="sapUiIcon sapTntNavLIIcon cpi-pulse-icon-wrapper" aria-hidden="true">
          ${PULSE_SVG_ICON}
        </span>
        <span class="sapMText sapTntNavLIText cpi-pulse-label">CPI Pulse</span>
      </div>
    `;

    navItem.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openDashboard();
    });

    navItem.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openDashboard();
      }
    });

    // Place after Settings, or append
    const settingsItem = Array.from(container.children).find(child => {
      return (child.textContent || '').toLowerCase().includes('settings');
    });

    if (settingsItem && settingsItem.nextSibling) {
      container.insertBefore(navItem, settingsItem.nextSibling);
    } else {
      container.appendChild(navItem);
    }

    return true;
  }

  function tryInject() {
    injectionAttempts++;
    const success = injectSidebarEntry();
    if (!success && injectionAttempts < MAX_ATTEMPTS) {
      setTimeout(tryInject, 1000);
    }
  }

  const observer = new MutationObserver(() => {
    if (!document.getElementById(PULSE_ID)) {
      injectSidebarEntry();
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  // ==========================================================================
  // Design Workspace Endpoint & Artifact Auto-Discovery
  // ==========================================================================
  function scanPerformanceTimelineForDesignEndpoints() {
    try {
      if (typeof performance === 'undefined' || !performance.getEntriesByType) return;
      const resources = performance.getEntriesByType('resource');
      const candidates = [];
      for (const r of resources) {
        const name = r.name || '';
        if (/package|artifact|workspace|iflow|spc|contententities/i.test(name)) {
          if (!/(\.js|\.css|\.svg|\.png|\.woff2|\.json\.js)(\?|$)/i.test(name)) {
            candidates.push(name);
          }
        }
      }
      if (candidates.length > 0) {
        console.log('[CPI Pulse Content] Discovered Design API endpoints from Performance Timeline:', candidates);
        if (chrome?.storage?.local) {
          chrome.storage.local.set({
            cpi_discovered_design_endpoints: candidates,
            cpi_last_design_endpoint: candidates[candidates.length - 1]
          });
        }
      }
    } catch (e) { }
  }

  function injectDesignInspector() {
    try {
      const code = `
        (function() {
          function inspectUI5() {
            try {
              if (window.sap && window.sap.ui && window.sap.ui.core && window.sap.ui.core.Component && window.sap.ui.core.Component.registry) {
                var endpoints = [];
                window.sap.ui.core.Component.registry.forEach(function(comp, id) {
                  try {
                    var manifest = comp.getManifest ? comp.getManifest() : null;
                    var ds = manifest && manifest['sap.app'] && manifest['sap.app'].dataSources;
                    if (ds) {
                      for (var k in ds) {
                        if (ds[k] && ds[k].uri) {
                          endpoints.push({ id: id, key: k, uri: ds[k].uri, type: ds[k].type });
                        }
                      }
                    }
                    if (comp.oModels) {
                      for (var m in comp.oModels) {
                        var model = comp.oModels[m];
                        if (model && model.sServiceUrl) {
                          endpoints.push({ id: id, model: m, serviceUrl: model.sServiceUrl });
                        }
                      }
                    }
                  } catch(e) {}
                });
                if (endpoints.length > 0) {
                  window.postMessage({ type: 'CPI_PULSE_UI5_DISCOVERY', endpoints: endpoints }, '*');
                }
              }
            } catch(e) {}
          }

          var origFetch = window.fetch;
          if (origFetch) {
            window.fetch = function() {
              var args = arguments;
              var url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url);
              return origFetch.apply(this, args).then(function(res) {
                try {
                  if (url && /package|artifact|workspace|iflow|queue|\$batch|jms|messaging/i.test(url) && !/(\.js|\.css|\.svg|\.png|\.woff2)(\?|$)/i.test(url)) {
                    res.clone().text().then(function(text) {
                      window.postMessage({ type: 'CPI_PULSE_NETWORK_INTERCEPT', url: url, text: text }, '*');
                    }).catch(function() {});
                  }
                } catch(e) {}
                return res;
              });
            };
          }

          var origOpen = XMLHttpRequest.prototype.open;
          XMLHttpRequest.prototype.open = function(method, url) {
            this._cpiUrl = url;
            return origOpen.apply(this, arguments);
          };
          var origSend = XMLHttpRequest.prototype.send;
          XMLHttpRequest.prototype.send = function() {
            var xhr = this;
            this.addEventListener('load', function() {
              try {
                var url = xhr._cpiUrl;
                if (url && /package|artifact|workspace|iflow|queue|\$batch|jms|messaging/i.test(url) && !/(\.js|\.css|\.svg|\.png|\.woff2)(\?|$)/i.test(url)) {
                  window.postMessage({ type: 'CPI_PULSE_NETWORK_INTERCEPT', url: url, text: xhr.responseText }, '*');
                }
              } catch(e) {}
            });
            return origSend.apply(this, arguments);
          };

          setTimeout(inspectUI5, 3000);
          setTimeout(inspectUI5, 7000);
        })();
      `;
      const script = document.createElement('script');
      script.textContent = code;
      (document.head || document.documentElement).appendChild(script);
      script.remove();
    } catch (e) { }
  }

  function parseBatchOrJson(text) {
    if (!text || typeof text !== 'string') return [];
    const trimmed = text.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const parsed = JSON.parse(trimmed);
        const res = (parsed.d && (parsed.d.results || parsed.d)) || parsed.value || (Array.isArray(parsed) ? parsed : null);
        if (Array.isArray(res)) return res;
        if (res && typeof res === 'object') return [res];
      } catch (e) { }
    }

    const results = [];
    const boundaryMatch = text.match(/--batch_[a-zA-Z0-9_-]+/);
    if (boundaryMatch) {
      const boundary = boundaryMatch[0];
      const parts = text.split(boundary);
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

    // Balanced brace fallback
    let searchPos = 0;
    while (searchPos < text.length) {
      const startIdx = text.indexOf('{"', searchPos);
      if (startIdx === -1) break;
      let depth = 0;
      let inString = false;
      let escape = false;
      let endIdx = -1;
      for (let i = startIdx; i < text.length; i++) {
        const ch = text[i];
        if (escape) { escape = false; continue; }
        if (ch === '\\') { escape = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (!inString) {
          if (ch === '{') depth++;
          else if (ch === '}') {
            depth--;
            if (depth === 0) { endIdx = i + 1; break; }
          }
        }
      }
      if (endIdx !== -1) {
        try {
          const parsed = JSON.parse(text.substring(startIdx, endIdx));
          const items = (parsed.d && (parsed.d.results || parsed.d)) || parsed.value || (Array.isArray(parsed) ? parsed : null);
          if (Array.isArray(items)) results.push(...items);
          else if (items && typeof items === 'object') results.push(items);
        } catch (e) { }
        searchPos = endIdx;
      } else {
        searchPos = startIdx + 2;
      }
    }
    return results;
  }

  function processAndStoreInterceptedDesignData(url, data) {
    if (!data) return;
    const list = (data.d && (data.d.results || data.d)) || data.value || (Array.isArray(data) ? data : null);
    if (!list) return;
    const items = Array.isArray(list) ? list : [list];
    if (items.length === 0) return;

    console.log('[CPI Pulse Content] Captured ' + items.length + ' design items from:', url);
    if (chrome?.storage?.local) {
      chrome.storage.local.set({
        cpi_intercepted_design_url: url,
        cpi_intercepted_design_items: items,
        cpi_intercepted_design_time: Date.now()
      });
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) return;
    if (event.data.type === 'CPI_PULSE_UI5_DISCOVERY') {
      console.log('[CPI Pulse Content] UI5 DataSources Discovered:', event.data.endpoints);
      if (chrome?.storage?.local) {
        chrome.storage.local.set({ cpi_ui5_endpoints: event.data.endpoints });
      }
    } else if (event.data.type === 'CPI_PULSE_DATA_INTERCEPT') {
      console.log('[CPI Pulse Content] Intercepted Design Content from:', event.data.url);
      processAndStoreInterceptedDesignData(event.data.url, event.data.data);
    } else if (event.data.type === 'CPI_PULSE_NETWORK_INTERCEPT') {
      const url = event.data.url || '';
      const text = event.data.text || '';
      const items = parseBatchOrJson(text);
      if (!items || items.length === 0) return;

      const isQueue = items.some(item => (
        item.type === 'com.sap.hci.api.Queue' ||
        item.__metadata?.type === 'com.sap.hci.api.Queue' ||
        item.NumbOfMsgs !== undefined ||
        (/queue|jms|messaging/i.test(url) && (item.Name || item.QueueName))
      ));

      if (isQueue) {
        console.log('[CPI Pulse Content] Captured ' + items.length + ' JMS Queues from:', url);
        if (chrome?.storage?.local) {
          chrome.storage.local.set({
            cpi_intercepted_queues: items,
            cpi_intercepted_queues_time: Date.now()
          });
        }
        return;
      }

      if (/package|artifact|workspace|iflow/i.test(url)) {
        processAndStoreInterceptedDesignData(url, items);
      }
    }
  });

  setTimeout(scanPerformanceTimelineForDesignEndpoints, 2500);
  setTimeout(scanPerformanceTimelineForDesignEndpoints, 6000);
  injectDesignInspector();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryInject);
  } else {
    tryInject();
  }

})();
