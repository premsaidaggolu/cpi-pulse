document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('btnOpenDashboard');
  if (btn) {
    btn.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
      window.close();
    });
  }
});
