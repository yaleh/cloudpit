const { contextBridge, ipcRenderer } = require('electron');

function isCloudCliAppOrigin(location) {
  if (location.protocol === 'file:') return true;

  if (location.protocol === 'http:') {
    return location.hostname === '127.0.0.1' || location.hostname === 'localhost';
  }

  return location.protocol === 'https:' && (
    location.hostname === 'cloudcli.ai' || location.hostname.endsWith('.cloudcli.ai')
  );
}

function onDesktopStateUpdated(callback) {
  const listener = (_event, state) => callback(state);
  ipcRenderer.on('cloudpit-desktop:state-updated', listener);
  return () => {
    ipcRenderer.removeListener('cloudpit-desktop:state-updated', listener);
  };
}

if (isCloudCliAppOrigin(window.location)) {
  contextBridge.exposeInMainWorld('cloudpitDesktopNotifications', {
    getState: () => ipcRenderer.invoke('cloudpit-desktop:get-state'),
    update: (settings) => ipcRenderer.invoke('cloudpit-desktop:update-desktop-notifications', settings),
    onStateUpdated: onDesktopStateUpdated,
  });
}

if (window.location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('cloudpitDesktop', {
    connectCloud: () => ipcRenderer.invoke('cloudpit-desktop:connect-cloud'),
    disconnectCloud: () => ipcRenderer.invoke('cloudpit-desktop:disconnect-cloud'),
    copyDiagnostics: () => ipcRenderer.invoke('cloudpit-desktop:copy-diagnostics'),
    copyLocalWebUrl: () => ipcRenderer.invoke('cloudpit-desktop:copy-local-web-url'),
    getState: () => ipcRenderer.invoke('cloudpit-desktop:get-state'),
    openCloudDashboard: () => ipcRenderer.invoke('cloudpit-desktop:open-cloud-dashboard'),
    openEnvironment: (environmentId) => ipcRenderer.invoke('cloudpit-desktop:open-environment', environmentId),
    runActiveEnvironmentAction: (action) => ipcRenderer.invoke('cloudpit-desktop:run-active-environment-action', action),
    openLocal: () => ipcRenderer.invoke('cloudpit-desktop:open-local'),
    openLocalWebUi: () => ipcRenderer.invoke('cloudpit-desktop:open-local-web-ui'),
    refreshEnvironments: () => ipcRenderer.invoke('cloudpit-desktop:refresh-environments'),
    refreshActiveTab: () => ipcRenderer.invoke('cloudpit-desktop:reload-active-tab'),
    showEnvironmentPicker: () => ipcRenderer.invoke('cloudpit-desktop:show-environment-picker'),
    showLauncher: () => ipcRenderer.invoke('cloudpit-desktop:show-launcher'),
    showLocalSettings: () => ipcRenderer.invoke('cloudpit-desktop:show-local-settings'),
    showDesktopSettings: () => ipcRenderer.invoke('cloudpit-desktop:show-desktop-settings'),
    closeSettingsWindow: () => ipcRenderer.invoke('cloudpit-desktop:close-settings-window'),
    showActiveEnvironmentActionsMenu: () => ipcRenderer.invoke('cloudpit-desktop:show-active-environment-actions-menu'),
    showEnvironmentActionsMenu: (environmentId) => ipcRenderer.invoke('cloudpit-desktop:show-environment-actions-menu', environmentId),
    switchTab: (tabId) => ipcRenderer.invoke('cloudpit-desktop:switch-tab', tabId),
    closeTab: (tabId) => ipcRenderer.invoke('cloudpit-desktop:close-tab', tabId),
    updateSetting: (key, value) => ipcRenderer.invoke('cloudpit-desktop:update-setting', key, value),
    onStateUpdated: onDesktopStateUpdated,
    onLauncherCommand: (callback) => {
      ipcRenderer.on('cloudpit-desktop:launcher-command', (_event, command) => callback(command));
    },
  });
}
