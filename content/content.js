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

  // Subtle launch arrow SVG
  const LAUNCH_ARROW_SVG = `
    <svg class="cpi-pulse-arrow-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
      <polyline points="15 3 21 3 21 9"/>
      <line x1="10" y1="14" x2="21" y2="3"/>
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

    // 1. Try BTP / CPI currentUser APIs via active browser session cookies
    const endpoints = [
      '/services/userapi/currentUser',
      '/itspaces/api/1.0/user',
      '/itspaces/service/user',
      '/iam/Users/me'
    ];

    for (const ep of endpoints) {
      try {
        const res = await fetch(window.location.origin + ep, {
          credentials: 'include',
          headers: { 'Accept': 'application/json' }
        });
        if (res.ok) {
          const d = await res.json();
          userName = d.displayName ||
            (d.firstName && d.lastName ? `${d.firstName} ${d.lastName}` : null) ||
            d.name || d.userName || d.id;
          userEmail = d.email || d.mail || (userName && userName.includes('@') ? userName : null);
          if (userName) break;
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
          email: userEmail || `${userName.toLowerCase().replace(/\s+/g, '.')}@sap.com`,
          source: 'session',
          tenant: window.location.origin,
          detectedAt: Date.now()
        }
      });
    }

    return { name: userName, email: userEmail };
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
    navItem.setAttribute('role', 'treeitem');
    navItem.setAttribute('tabindex', '0');
    navItem.setAttribute('title', 'CPI Pulse - Performance Analytics & Integration Health (Opens in new tab)');

    // Clean structure: NO "LIVE" badge
    navItem.innerHTML = `
      <div class="cpi-pulse-item-content">
        <span class="cpi-pulse-icon-wrapper">
          ${PULSE_SVG_ICON}
        </span>
        <span class="cpi-pulse-label">CPI Pulse</span>
        <span class="cpi-pulse-arrow-wrapper">
          ${LAUNCH_ARROW_SVG}
        </span>
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryInject);
  } else {
    tryInject();
  }

})();
