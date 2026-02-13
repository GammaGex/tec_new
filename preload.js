const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('api', {
    login: (username, password) => ipcRenderer.invoke('login-attempt', { username, password }),
    getAutoLoginScript: () => ipcRenderer.invoke('get-autologin-script'),
    getRemoteConfig: () => ipcRenderer.invoke('get-remote-config'),
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    checkVersion: () => ipcRenderer.invoke('check-version'),
    checkLoginCookies: (url) => ipcRenderer.invoke('check-login-cookies', url),
    downloadUpdate: (url) => ipcRenderer.invoke('download-update', url),
    applyUpdate: (path) => ipcRenderer.invoke('apply-update', path),
    getSavedCreds: () => ipcRenderer.invoke('get-saved-creds'),
    setSavedCreds: (username, password) => ipcRenderer.invoke('set-saved-creds', { username, password }),
    clearSavedCreds: () => ipcRenderer.invoke('clear-saved-creds'),
    loadBrowser: () => ipcRenderer.send('load-browser'),
    
    detachTab: (url) => ipcRenderer.send('detach-tab', url),
    createWindow: (url) => ipcRenderer.send('create-window', url),
    updateWindowState: (tabs) => ipcRenderer.send('window-state-update', tabs),
    setWindowLayout: (count, urls) => ipcRenderer.send('set-window-layout', { count, urls }),
    organizeWindows: () => ipcRenderer.send('organize-windows'),
    getRestorationData: (id) => ipcRenderer.invoke('get-restoration-data', id),
    testProxy: () => ipcRenderer.invoke('test-proxy'),
    getGexbotCount: () => ipcRenderer.invoke('get-gexbot-count'),
    onReattach: (callback) => ipcRenderer.on('reattach-tab', (event, url) => callback(url)),
    onOpenDetachedTab: (callback) => ipcRenderer.on('open-detached-tab', (event, url) => callback(url)),
    onAuthBlocked: (callback) => ipcRenderer.on('auth-blocked', (event, payload) => callback(payload)),
    onGexbotCount: (callback) => ipcRenderer.on('gexbot-count', (event, payload) => callback(payload)),
    onUpdateCountdown: (callback) => ipcRenderer.on('update-countdown', (event, payload) => callback(payload)),
    quitNow: () => ipcRenderer.send('quit-now')
});


// Zoom via Ctrl + Scroll Mouse
window.addEventListener('wheel', (e) => {
    if (e.ctrlKey) {
        e.preventDefault();
        const currentZoom = webFrame.getZoomLevel();
        // Se deltaY > 0 (para baixo), diminui zoom. Se < 0 (para cima), aumenta.
        const delta = e.deltaY > 0 ? -0.5 : 0.5;
        webFrame.setZoomLevel(currentZoom + delta);
    }
}, { passive: false });
