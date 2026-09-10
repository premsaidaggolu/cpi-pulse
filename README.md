# CPI Pulse - SAP Cloud Integration Cockpit

Enterprise performance analytics and live integration health cockpit for **SAP Cloud Integration (CPI) / SAP Integration Suite**.

## Features

1. **Sidebar Integration**:
   - Injects a seamless "CPI Pulse" entry directly into the native SAP Integration Suite navigation sidebar.
   - Highlights live health status with a subtle animated pulse wave icon.

2. **Dedicated Fiori Cockpit Tab**:
   - Clicking the sidebar item opens a high-fidelity SAP Fiori (Morning Horizon) dashboard in a new tab.
   - Matches SAP Integration Suite fonts ("72"), card sizes, borders, colors, and layout proportions.

3. **Modular Capabilities**:
   - **Integration Overview**: Live health of all iFlows (Total Deployed, Running/Started, Failed/Error, Stopped/Suspended, Recently Modified Artifacts).
   - **Performance Analytics**: Real-time average runtime (ms), message volume throughput, peak hours detection, and slowest iFlow leaderboard with root-cause insights.
   - **Extensible "+" Add Tile**: Easily register custom monitored scopes, metrics, and new capabilities.

## How to Install in Chrome

1. Clone or download this repository:
   ```bash
   git clone https://github.com/premsaidaggolu/cpi-pulse.git
   ```
2. Open Google Chrome and navigate to `chrome://extensions`.
3. Toggle **Developer mode** on (top-right corner).
4. Click **Load unpacked**.
5. Select the `cpi-pulse` repository folder.
6. Open any SAP Integration Suite / CPI tenant:
   - You will see the **CPI Pulse** header entry in the sidebar and a quick-launch pill in the bottom-right corner.

## Architecture

- **Manifest V3**: Modern, secure Chrome Extension architecture.
- **Content Scripts**: Injected into SAP Integration Suite tabs to provide seamless UI hooks and native sidebar navigation.
- **Background Service Worker**: Manages background communications and deep-link routing.
- **Cockpit Dashboard**: High-fidelity dashboard visualizing live integration statistics, error diagnostics, and throughput metrics.

## License

MIT
