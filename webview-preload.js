const { ipcRenderer, webFrame } = require('electron');

// Listen for zoom commands from the host (browser.html)
ipcRenderer.on('set-zoom', (event, factor) => {
    try {
        webFrame.setZoomFactor(factor);
    } catch (e) {
        console.error("Failed to set zoom:", e);
    }
});

ipcRenderer.on('get-zoom', (event) => {
    try {
        event.sender.send('zoom-level', webFrame.getZoomFactor());
    } catch (e) { }
});

// F5 Refresh Handler (Running inside the guest page)
window.addEventListener('keydown', (e) => {
    if (e.key === 'F5') {
        e.preventDefault();
        window.location.reload();
    }
}, true); // Use capture phase to ensure we catch it

let lastScrollSent = 0;
let scrollTimer = null;
function sendScrollPosition() {
    const now = Date.now();
    if (now - lastScrollSent < 250) {
        if (!scrollTimer) {
            scrollTimer = setTimeout(() => {
                scrollTimer = null;
                sendScrollPosition();
            }, 250);
        }
        return;
    }
    lastScrollSent = now;
    try {
        ipcRenderer.sendToHost('scroll-position', { x: window.scrollX || 0, y: window.scrollY || 0, url: window.location.href || '' });
    } catch { }
}
window.addEventListener('scroll', sendScrollPosition, { passive: true });
window.addEventListener('DOMContentLoaded', () => { sendScrollPosition(); }, true);
window.addEventListener('beforeunload', () => { sendScrollPosition(); }, true);

const SPOTGAMMA_BLOCK_BASE = 'https://dashboard.spotgamma.com/';
const MENTHORQ_BLOCK_BASE = 'https://menthorq.com/';

function isSpotgammaPreferencesUrl(url) {
    try {
        const u = new URL(url);
        const host = String(u.hostname || '').toLowerCase();
        if (!host.endsWith('spotgamma.com')) return false;
        const path = String(u.pathname || '').toLowerCase();
        const hash = String(u.hash || '').toLowerCase();
        const search = String(u.search || '').toLowerCase();
        return path.includes('/preferences') || hash.includes('preferences') || search.includes('preferences');
    } catch {
        return false;
    }
}

function isMenthorqIntegrationsUrl(url) {
    try {
        const u = new URL(url);
        const host = String(u.hostname || '').toLowerCase();
        if (!host.endsWith('menthorq.com')) return false;
        const search = String(u.search || '').toLowerCase();
        return search.includes('action=data') && search.includes('type=integrations') && search.includes('slug=');
    } catch {
        return false;
    }
}

function enforceSpotgammaBlock() {
    if (isSpotgammaPreferencesUrl(window.location.href)) {
        window.location.replace(SPOTGAMMA_BLOCK_BASE);
    }
    if (isMenthorqIntegrationsUrl(window.location.href)) {
        window.location.replace(MENTHORQ_BLOCK_BASE);
    }
}

try {
    const wrapHistory = (fn) => function (...args) {
        const ret = fn.apply(this, args);
        enforceSpotgammaBlock();
        return ret;
    };
    if (window.history && window.history.pushState) window.history.pushState = wrapHistory(window.history.pushState);
    if (window.history && window.history.replaceState) window.history.replaceState = wrapHistory(window.history.replaceState);
} catch (e) { }

window.addEventListener('popstate', enforceSpotgammaBlock, true);
window.addEventListener('hashchange', enforceSpotgammaBlock, true);
window.addEventListener('DOMContentLoaded', enforceSpotgammaBlock, true);
window.addEventListener('load', enforceSpotgammaBlock, true);
setInterval(enforceSpotgammaBlock, 3000);
