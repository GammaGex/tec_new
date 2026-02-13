const { app, BrowserWindow, session, ipcMain, Menu, MenuItem, screen, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const os = require('os');
const { spawn } = require('child_process');
const { machineIdSync } = require('node-machine-id');

let MACHINE_ID = '';
try {
    MACHINE_ID = machineIdSync();
    console.log('Machine ID:', MACHINE_ID);
} catch (e) {
    console.error('Falha ao obter Machine ID:', e.message);
    MACHINE_ID = 'unknown-' + Date.now();
}

// --- USER AGENT GLOBAL ---
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
app.userAgentFallback = USER_AGENT;

// --- PROXY SECURITY FLAGS ---
app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp');
app.commandLine.appendSwitch('webrtc-max-cpu-consumption-percentage', '100');
app.commandLine.appendSwitch('ignore-certificate-errors');

// --- PERFORMANCE & HARDWARE ACCELERATION FLAGS ---
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('enable-hardware-overlays');
app.commandLine.appendSwitch('disable-gpu-driver-bug-workarounds');
app.commandLine.appendSwitch('accelerated-video-decode');
app.commandLine.appendSwitch('disk-cache-size', '104857600');
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disable-breakpad');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('no-pings');
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

const TEST_SPLIT = process.argv.includes('--testsplit');
const userDataPath = app.getPath('userData');
const SETTINGS_FILE = path.join(userDataPath, 'settings.json');

// --- PROXY ---
// Proxy PRIMÁRIO e SECUNDÁRIO com failover automático
const PROXY_PRIMARY = {
    host: "137.131.210.112",
    port: 3829
};
//const PROXY_SECONDARY = {//  host: "0",
//port: 
//};

const VERSION_URL = "https://gruchckguqbr.objectstorage.sa-saopaulo-1.oci.customer-oci.com/n/gruchckguqbr/b/app-updates/o/gex_version.txt";
const DEFAULT_UPDATE_EXE_URL = "https://gruchckguqbr.objectstorage.sa-saopaulo-1.oci.customer-oci.com/n/gruchckguqbr/b/app-updates/o/GexBrowser_Installer.exe";


// Proxy ativo (será definido após teste de conectividade)
let activeProxy = PROXY_PRIMARY;

// --- DOMINIOS QUE DEVEM SAIR DIRETO (SEM PROXY) ---
// Apenas a API de autenticação deve sair direta para validar IP real do cliente.
// Formato: domínio simples OU *domínio.com para incluir subdomínios
const DIRECT_DOMAINS = [
    'localhost',
    '127.0.0.1',
    '137.131.210.112',   // Repositório
    'spotgamma.com',     // Sai Local (Squid NÃO bloqueia)
    '*.spotgamma.com',   // Subdomínios SpotGamma Local
    'clarity.ms',        // Sai Local (Squid NÃO bloqueia)
    '*.clarity.ms',      // Subdomínios Clarity Local
    '38.240.62.214',
    'gruchckguqbr.objectstorage.sa-saopaulo-1.oci.customer-oci.com'
];


let currentAuth = null;
let remoteConfig = null;

// --- FUNÇÕES AUXILIARES ---
function loadData(file) {
    try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}; }
    catch { return {}; }
}
function saveData(file, data) {
    try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); } catch (e) { console.error(e); }
}

function getSavedCreds() {
    const s = loadData(SETTINGS_FILE);
    const c = s.savedCreds;
    if (c && c.user && c.passB64) {
        try { return { user: c.user, pass: Buffer.from(c.passB64, 'base64').toString('utf8') }; } catch { return null; }
    }
    return null;
}

function normalizeProxyUser(user) {
    const baseUser = String(user || '').trim();
    if (!baseUser) return baseUser;
    const suffix = `__${MACHINE_ID}`;
    if (baseUser.endsWith(suffix)) return baseUser;
    return `${baseUser}${suffix}`;
}

function getProxyAuth() {
    if (currentAuth && currentAuth.user && currentAuth.pass) return `${normalizeProxyUser(currentAuth.user)}:${currentAuth.pass}`;
    const sc = getSavedCreds();
    if (sc && sc.user && sc.pass) return `${normalizeProxyUser(sc.user)}:${sc.pass}`;
    return null;
}

/**
 * Testa conectividade com um proxy específico
 * @returns {Promise<boolean>} true se o proxy responde
 */
async function testProxyConnection(proxyConfig, timeoutMs = 5000) {
    try {
        const testUrl = 'http://www.google.com/generate_204';
        await axios.get(testUrl, {
            proxy: { host: proxyConfig.host, port: proxyConfig.port },
            timeout: timeoutMs,
            validateStatus: () => true // Aceita qualquer status
        });
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Seleciona o melhor proxy disponível (primário ou secundário)
 * @returns {Promise<void>}
 */
async function selectBestProxy() {
    console.log('🔍 Testando conectividade dos proxies...');

    // Testa o primário primeiro
    const primaryOk = await testProxyConnection(PROXY_PRIMARY, 3000);
    if (primaryOk) {
        activeProxy = PROXY_PRIMARY;
        console.log(`✅ Proxy PRIMÁRIO selecionado: ${PROXY_PRIMARY.host}:${PROXY_PRIMARY.port}`);
        return;
    }

    console.log(`⚠️ Proxy primário (${PROXY_PRIMARY.host}) não respondeu, tentando secundário...`);

    // Fallback para o secundário
    const secondaryOk = await testProxyConnection(PROXY_SECONDARY, 3000);
    if (secondaryOk) {
        activeProxy = PROXY_SECONDARY;
        console.log(`✅ Proxy SECUNDÁRIO selecionado: ${PROXY_SECONDARY.host}:${PROXY_SECONDARY.port}`);
        return;
    }

    // Se nenhum respondeu, usa o primário por padrão
    console.warn('⚠️ Nenhum proxy respondeu! Usando primário por padrão.');
    activeProxy = PROXY_PRIMARY;
}

/**
 * Valida credenciais testando conexão real com o Proxy
 */
async function testProxyAuth(user, pass) {
    console.log(`🛡️ Validando credenciais via Proxy (${activeProxy.host})...`);
    try {
        const testUrl = 'http://www.google.com/generate_204';
        const normUser = normalizeProxyUser(user);
        const auth = Buffer.from(`${normUser}:${pass}`).toString('base64');

        await axios.get(testUrl, {
            proxy: { host: activeProxy.host, port: activeProxy.port },
            headers: { 'Proxy-Authorization': `Basic ${auth}` },
            timeout: 5000,
            validateStatus: (status) => status === 204 || status === 200
        });
        console.log('✅ Credenciais VÁLIDAS!');
        return true;
    } catch (e) {
        console.warn('❌ Credenciais INVÁLIDAS ou erro de conexão:', e.message);
        return false;
    }
}

/**
 * Configures AXIOS (Node.js internal requests)
 * Follows the same logic: Specific domains go LOCAL, the rest via PROXY.
 */
function buildAxiosConfig(targetUrl, stream = false, baseTimeout = 10000) {
    const cfg = { timeout: baseTimeout, maxRedirects: 5 };
    try {
        const u = new URL(targetUrl);
        const host = u.hostname;

        // Domains that the internal system must access DIRECTLY (NO PROXY)
        // Includes localhost, the DDNS control itself, and listed third-party sites
        const bypassHosts = [
            'localhost',
            '127.0.0.1',
            activeProxy.host,
            ...DIRECT_DOMAINS
        ];

        // Checks if host is exact or subdomain of one in the list
        const shouldBypass = bypassHosts.some(bh => host === bh || host.endsWith('.' + bh));

        if (shouldBypass) {
            cfg.proxy = false;
        } else {
            // If not in list (e.g. Gexbot API), use Proxy
            cfg.proxy = { host: activeProxy.host, port: activeProxy.port };
            const auth = getProxyAuth();
            if (auth) {
                const b = Buffer.from(auth).toString('base64');
                cfg.headers = { 'Proxy-Authorization': `Basic ${b}` };
            }
        }
    } catch {
        cfg.proxy = { host: activeProxy.host, port: activeProxy.port };
        const auth = getProxyAuth();
        if (auth) {
            const b = Buffer.from(auth).toString('base64');
            cfg.headers = { 'Proxy-Authorization': `Basic ${b}` };
        }
    }
    if (stream) cfg.responseType = 'stream';
    return cfg;
}

function isGexbotUrl(u) {
    if (!u || typeof u !== 'string') return false;
    try {
        const h = new URL(u).hostname.toLowerCase();
        return h.includes('gexbot.com');
    } catch {
        return String(u || '').toLowerCase().includes('gexbot.com');
    }
}

function countGexbotTabs() {
    if (!global.windowStates) return 0;
    let count = 0;
    Object.values(global.windowStates).forEach(state => {
        const list = Array.isArray(state && state.allTabs) ? state.allTabs : (Array.isArray(state && state.tabs) ? state.tabs : []);
        list.forEach(u => {
            if (isGexbotUrl(u)) count++;
        });
    });
    return count;
}

function broadcastGexbotCount() {
    const count = countGexbotTabs();
    const windows = BrowserWindow.getAllWindows().filter(w => !w.isDestroyed());
    windows.forEach(w => {
        try { w.webContents.send('gexbot-count', { count, limit: 2 }); } catch { }
    });
}

async function applyGammaedgeCookies(cookies) {
    if (!Array.isArray(cookies) || cookies.length === 0) return;
    const ses = session.fromPartition('persist:gex');
    for (const c of cookies) {
        try {
            const domain = (c.domain || 'app.gammaedge.us').replace(/^\./, '');
            const scheme = c.secure ? 'https://' : 'http://';
            const url = `${scheme}${domain}${c.path || '/'}`;
            await ses.cookies.set({
                url,
                name: c.name,
                value: c.value,
                domain: c.domain,
                path: c.path || '/',
                httpOnly: !!c.httpOnly,
                secure: !!c.secure
            });
        } catch (e) {
            console.error('Erro ao aplicar cookie GammaEdge:', e.message || e);
        }
    }
}

async function applySpotgammaCookies(cookies) {
    if (!Array.isArray(cookies) || cookies.length === 0) return;
    const ses = session.fromPartition('persist:gex');
    for (const c of cookies) {
        try {
            const domain = (c.domain || 'spotgamma.com').replace(/^\./, '');
            const scheme = c.secure ? 'https://' : 'http://';
            const url = `${scheme}${domain}${c.path || '/'}`;
            await ses.cookies.set({
                url,
                name: c.name,
                value: c.value,
                domain: c.domain,
                path: c.path || '/',
                httpOnly: !!c.httpOnly,
                secure: !!c.secure
            });
        } catch (e) {
            console.error('Erro ao aplicar cookie SpotGamma:', e.message || e);
        }
    }
}

function getRemoteBaseHost() {
    const settings = loadData(SETTINGS_FILE);
    const fromSettings = settings && settings.remoteBaseHost ? String(settings.remoteBaseHost) : null;
    const fromEnv = process.env.GEX_REMOTE_HOST ? String(process.env.GEX_REMOTE_HOST) : null;
    const fallback = (activeProxy && activeProxy.host) ? String(activeProxy.host) : (PROXY_PRIMARY && PROXY_PRIMARY.host ? String(PROXY_PRIMARY.host) : null);
    return fromSettings || fromEnv || fallback;
}

function cleanTabs(tabs, allowNewTab = false) {
    if (!Array.isArray(tabs)) return [];
    return tabs.map(t => {
        if (typeof t === 'string') return t;
        if (t && typeof t === 'object') return t.url || t.src || '';
        return '';
    }).filter(t => {
        if (t === undefined || t === null || typeof t !== 'string') return false;
        const lower = t.toLowerCase().trim();
        const isFile = lower.startsWith('file://');
        if (lower === '' || lower.includes('chrome://')) {
            if (lower === 'about:blank') return false;
            if (lower === '') return false;
            return false;
        }
        if (lower === 'about:blank') return false;
        if (isFile && lower.includes('/browser.html')) return false;
        return true;
    });
}

// Funções de cookies removidas (GammaEdge/SpotGamma)

async function fetchRemoteConfig(retries = 3) {
    const url = `https://gruchckguqbr.objectstorage.sa-saopaulo-1.oci.customer-oci.com/n/gruchckguqbr/b/app-updates/o/gex_config26.json?t=${Date.now()}`;
    const tokenUrl = `https://gruchckguqbr.objectstorage.sa-saopaulo-1.oci.customer-oci.com/n/gruchckguqbr/b/app-updates/o/gex_tokenkdolarntu45.json?t=${Date.now()}`;
    // Token exclusivo do CLASSIC (assinatura separada)
    const tokenClassicUrl = `https://gruchckguqbr.objectstorage.sa-saopaulo-1.oci.customer-oci.com/n/gruchckguqbr/b/app-updates/o/gex_token_classic.json?t=${Date.now()}`;
    const gammaUrl = `https://gruchckguqbr.objectstorage.sa-saopaulo-1.oci.customer-oci.com/n/gruchckguqbr/b/app-updates/o/gammaedge.json?t=${Date.now()}`;

    try {
        const [configRes, tokenRes, tokenClassicRes, gammaRes] = await Promise.all([
            axios.get(url, buildAxiosConfig(url, false, 5000)).catch(e => null),
            axios.get(tokenUrl, buildAxiosConfig(tokenUrl, false, 5000)).catch(e => null),
            axios.get(tokenClassicUrl, buildAxiosConfig(tokenClassicUrl, false, 5000)).catch(e => null),
            axios.get(gammaUrl, buildAxiosConfig(gammaUrl, false, 5000)).catch(e => null)
        ]);

        if (configRes && configRes.data && configRes.data.credentials) {
            remoteConfig = configRes.data;
            if (tokenRes && tokenRes.data && tokenRes.data.credentials && tokenRes.data.credentials.gexbot) {
                if (!remoteConfig.credentials) remoteConfig.credentials = {};
                remoteConfig.credentials.gexbot = tokenRes.data.credentials.gexbot;
                console.log('✅ Token Gexbot obtido e injetado na memória:', remoteConfig.credentials.gexbot);
            } else {
                console.warn('⚠️ Não foi possível obter token Gexbot.');
            }

            // CLASSIC: o JSON pode vir em formatos diferentes; normalizamos para remoteConfig.credentials.gexbot_classic
            try {
                let classicObj = null;
                if (tokenClassicRes && tokenClassicRes.data) {
                    if (tokenClassicRes.data.credentials && tokenClassicRes.data.credentials.gexbot) classicObj = tokenClassicRes.data.credentials.gexbot;
                    else if (tokenClassicRes.data.credentials && tokenClassicRes.data.credentials.gexbot_classic) classicObj = tokenClassicRes.data.credentials.gexbot_classic;
                    else if (tokenClassicRes.data.gexbot) classicObj = tokenClassicRes.data.gexbot;
                    else if (tokenClassicRes.data.gexbot_classic) classicObj = tokenClassicRes.data.gexbot_classic;
                    else if (tokenClassicRes.data.auth || tokenClassicRes.data.ai_user || tokenClassicRes.data.ai_session) classicObj = tokenClassicRes.data;
                }
                if (classicObj) {
                    if (!remoteConfig.credentials) remoteConfig.credentials = {};
                    remoteConfig.credentials.gexbot_classic = classicObj;
                    console.log('✅ Token Gexbot CLASSIC obtido e injetado na memória:', remoteConfig.credentials.gexbot_classic);
                } else {
                    console.warn('⚠️ Não foi possível obter token Gexbot CLASSIC.');
                }
            } catch (e) {
                console.warn('⚠️ Falha ao normalizar token CLASSIC:', e && e.message ? e.message : e);
            }
            if (gammaRes && gammaRes.data && gammaRes.data.credentials && gammaRes.data.credentials.gammaedge) {
                if (!remoteConfig.credentials) remoteConfig.credentials = {};
                remoteConfig.credentials.gammaedge = gammaRes.data.credentials.gammaedge;
                if (remoteConfig.credentials.gammaedge.cookies) {
                    await applyGammaedgeCookies(remoteConfig.credentials.gammaedge.cookies);
                }
                console.log('✅ GammaEdge carregado na memória.');
            } else {
                console.warn('⚠️ Não foi possível obter GammaEdge.');
            }
            if (remoteConfig.credentials && remoteConfig.credentials.spotgamma && remoteConfig.credentials.spotgamma.cookies) {
                await applySpotgammaCookies(remoteConfig.credentials.spotgamma.cookies);
            }
        } else {
            throw new Error("Falha na config principal");
        }
    } catch (e) {
        console.error('Erro em fetchRemoteConfig:', e.message);
        if (retries > 0) setTimeout(() => fetchRemoteConfig(retries - 1), 2000);
    }
}

// --- AUTH ---
/**
 * (REMOVED) validateWithAPI
 * A verificação de credenciais agora é feita diretamente pelo Proxy,
 * sem chamada de API intermediária.
 */
async function validateWithAPI(username, password) {
    return true; // Bypass total
}

// --- REVALIDATION LOOP ---
let revalidationInterval = null;
let retryInterval = null;
let failureStartTime = null;

function startRevalidationLoop(username, password) {
    stopRevalidationLoop();
    console.log('🔄 Iniciando loop de revalidação de IP a cada 5 minutos.');
    const performCheck = async () => {
        console.log('⏰ Executando revalidação periódica de IP (5min)...');
        const user = (currentAuth && currentAuth.user) ? currentAuth.user : username;
        const pass = (currentAuth && currentAuth.pass) ? currentAuth.pass : password;
        const valid = await validateWithAPI(user, pass);
        if (valid) {
            console.log('✅ Revalidação de IP com sucesso.');
            if (failureStartTime) {
                console.log('🎉 Conexão recuperada!');
                failureStartTime = null;
                if (retryInterval) { clearInterval(retryInterval); retryInterval = null; }
            }
        } else {
            console.warn('⚠️ Falha na revalidação periódica de IP.');
            handleValidationFailure(user, pass);
        }
    };
    revalidationInterval = setInterval(performCheck, 300000);
}

function handleValidationFailure(user, pass) {
    if (failureStartTime) return;
    console.warn('🚨 Falha detectada! Entrando em modo de tentativa de reconexão.');
    failureStartTime = Date.now();
    retryInterval = setInterval(async () => {
        const elapsed = Date.now() - failureStartTime;
        const valid = await validateWithAPI(user, pass);
        if (valid) {
            console.log('✅ Reconectado com sucesso durante o retry.');
            failureStartTime = null;
            clearInterval(retryInterval);
            retryInterval = null;
        } else {
            if (elapsed > 180000) {
                console.error('❌ Falha persistente por 3 minutos. Encerrando aplicação.');
                stopRevalidationLoop();
                app.quit();
            }
        }
    }, 30000);
}

function stopRevalidationLoop() {
    if (revalidationInterval) { clearInterval(revalidationInterval); revalidationInterval = null; }
    if (retryInterval) { clearInterval(retryInterval); retryInterval = null; }
    failureStartTime = null;
}

/**
 * CONFIGURAÇÃO DO PROXY NA SESSÃO DO ELECTRON
 * Regra: apenas Gexbot e GammaEdge saem via PROXY. O restante sai DIRETO.
 */
async function setupProxy(user, pass) {
    const proxyHost = activeProxy.host;
    const proxyPort = activeProxy.port;

    // Configuração "Fixed Servers" para garantir que NÃO navegue se o proxy cair.
    // proxyRules define que TODOS os protocolos (http, https, ftp) devem usar o proxy.
    // proxyBypassRules define as exceções que saem direto.

    // Adiciona <local> para garantir que intranet/localhost não quebrem
    const bypassList = ["<local>", ...DIRECT_DOMAINS].filter(d => !String(d).toLowerCase().includes('gexbot'));
    const proxyBypassRules = bypassList.join(",");

    const proxyRules = `http=${proxyHost}:${proxyPort};https=${proxyHost}:${proxyPort};ftp=${proxyHost}:${proxyPort}`;

    console.log('🛡️ Configurando Proxy RIGOROSO (Global):', proxyRules);
    console.log('⛔ Exceções (Bypass):', proxyBypassRules);

    await session.defaultSession.setProxy({
        mode: 'fixed_servers',
        proxyRules: proxyRules,
        proxyBypassRules: proxyBypassRules
    });

    const ses = session.fromPartition('persist:gex');
    await ses.setProxy({
        mode: 'fixed_servers',
        proxyRules: proxyRules,
        proxyBypassRules: proxyBypassRules
    });

    currentAuth = { user: normalizeProxyUser(user), pass };
}

// --- AUTO-SAVE TIMER ---
let autoSaveTimer = null;
let saveTimer = null;

function debounceSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        try { saveLastSession(); } catch (e) { console.error('Erro no debounceSave:', e); }
    }, 1000);
}

function startAutoSave() {
    if (autoSaveTimer) clearInterval(autoSaveTimer);
    autoSaveTimer = setInterval(() => {
        try { saveLastSession(); } catch (e) { console.error('Erro no auto-save:', e); }
    }, 30000);
}

function stopAutoSave() {
    if (autoSaveTimer) { clearInterval(autoSaveTimer); autoSaveTimer = null; }
}

// --- CRIAÇÃO DE JANELAS ---
function createBrowserWindow(bounds = null, tabs = null, initialUrl = null, layoutMode = 'single', splitState = null, isAuxiliary = false, restoreMaximized = null) {
    const options = {
        width: bounds ? bounds.width : 1200,
        height: bounds ? bounds.height : 800,
        x: bounds ? bounds.x : undefined,
        y: bounds ? bounds.y : undefined,
        title: "Gex Enterprise Browser",
        icon: path.join(__dirname, 'icon.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            webviewTag: true,
            plugins: true,
            partition: 'persist:gex' // Todas as janelas compartilham a sessão com Proxy Configurado
        },
        autoHideMenuBar: true
    };

    const win = new BrowserWindow(options);
    win.setMenu(null);

    if (bounds) {
        try {
            if (bounds.x !== undefined && bounds.y !== undefined) win.setPosition(bounds.x, bounds.y);
            if (bounds.width !== undefined && bounds.height !== undefined) win.setSize(bounds.width, bounds.height);
        } catch (e) { }
    }

    global.windowStates = global.windowStates || {};
    global.windowStates[win.id] = {
        tabs: tabs || [],
        layout: layoutMode,
        split: splitState,
        allTabs: tabs || [],
        isAux: isAuxiliary
    };

    const shouldMaximize = (restoreMaximized !== null) ? restoreMaximized : !isAuxiliary;
    if (shouldMaximize) win.maximize();

    const browserPath = path.join(__dirname, 'browser.html').replace(/\\/g, '/');
    let loadUrl = `file:///${browserPath}`;
    const params = [];
    const allowNewTab = (layoutMode && layoutMode !== 'single') || (splitState && Array.isArray(splitState.ids) && splitState.ids.length > 0);
    const validTabs = cleanTabs(tabs, allowNewTab);

    if (validTabs.length > 0) {
        const restorationId = Date.now().toString() + Math.random().toString().slice(2, 8);
        global.restorationCache[restorationId] = validTabs;
        params.push(`restorationId=${restorationId}`);
    }

    if (initialUrl) params.push(`initialUrl=${encodeURIComponent(initialUrl)}`);
    if (layoutMode && layoutMode !== 'single') params.push(`layout=${encodeURIComponent(layoutMode)}`);
    // Só passar split se layout não for single
    if (splitState && layoutMode && layoutMode !== 'single') params.push(`split=${encodeURIComponent(JSON.stringify(splitState))}`);
    if (isAuxiliary) params.push(`isAux=1`);

    if (params.length > 0) loadUrl += `?${params.join('&')}`;

    if (validTabs.length === 0 && !initialUrl && !isAuxiliary) {
        win.loadFile('index.html');
    } else {
        win.loadURL(loadUrl);
    }

    win.webContents.setWindowOpenHandler(() => ({ action: 'allow' }));
    win.on('move', debounceSave);
    win.on('resize', debounceSave);

    win.on('close', () => {
        if (isAuxiliary) {
            saveAuxWindowState(win);
            let reattachUrl = null;
            const state = global.windowStates ? global.windowStates[win.id] : null;
            if (state && Array.isArray(state.tabs) && state.tabs.length > 0) {
                reattachUrl = state.tabs.find(u => typeof u === 'string' && u && u !== 'about:blank') || null;
            }
            if (!reattachUrl) {
                try {
                    const current = new URL(win.webContents.getURL());
                    const initial = current.searchParams.get('initialUrl');
                    if (initial) reattachUrl = decodeURIComponent(initial);
                } catch { }
            }
            if (reattachUrl) {
                const mainWin = BrowserWindow.getAllWindows().find(w => {
                    try { return !w.webContents.getURL().includes('isAux=1') && !w.webContents.getURL().includes('index.html'); } catch { return false; }
                });
                if (mainWin && !mainWin.isDestroyed()) {
                    mainWin.webContents.send('reattach-tab', reattachUrl);
                }
            }
        } else {
            saveLastSession();
            BrowserWindow.getAllWindows().forEach(w => { if (w.id !== win.id) w.close(); });
        }
        if (global.windowStates && global.windowStates[win.id]) delete global.windowStates[win.id];
        broadcastGexbotCount();
    });

    return win;
}

global.windowStates = {};
global.restorationCache = {};

ipcMain.handle('get-restoration-data', (event, id) => {
    const data = global.restorationCache[id];
    if (data) {
        setTimeout(() => { delete global.restorationCache[id]; }, 300000);
    }
    return data || [];
});

ipcMain.on('window-state-update', (event, state) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
        const currentState = global.windowStates[win.id] || {};
        const currentIsAux = currentState.isAux || false;
        if (Array.isArray(state)) {
            global.windowStates[win.id] = {
                tabs: state,
                layout: currentState.layout || 'single',
                split: currentState.split || null,
                allTabs: state,
                isAux: currentIsAux
            };
        } else {
            global.windowStates[win.id] = {
                tabs: state.tabs,
                layout: state.layoutMode || currentState.layout || 'single',
                split: state.splitState || currentState.split || null,
                allTabs: state.allTabs || state.tabs,
                isAux: currentIsAux
            };
        }
        debounceSave();
        broadcastGexbotCount();
    }
});

ipcMain.handle('get-gexbot-count', () => {
    return { count: countGexbotTabs(), limit: 2 };
});

function captureSession() {
    const data = [];
    let windows = BrowserWindow.getAllWindows().filter(w => !w.isDestroyed());
    windows.sort((a, b) => {
        const stateA = global.windowStates[a.id];
        const stateB = global.windowStates[b.id];
        const isAuxA = stateA && stateA.isAux === true;
        const isAuxB = stateB && stateB.isAux === true;
        if (isAuxA !== isAuxB) return isAuxA ? 1 : -1;
        return a.id - b.id;
    });

    windows.forEach(w => {
        const url = w.webContents.getURL();
        if (url.includes('index.html') || url.startsWith('devtools:')) return;
        const state = global.windowStates[w.id];
        let isAux = false;
        if (state && typeof state.isAux === 'boolean') {
            isAux = state.isAux;
        } else {
            isAux = url.includes('isAux=1');
        }
        const allowNewTab = state && state.split && Array.isArray(state.split.ids) && state.split.ids.length > 0;
        const currentTabs = cleanTabs(state ? state.tabs : [], allowNewTab);
        const currentLayout = state ? (state.layout || 'single') : 'single';
        const currentSplit = state ? (state.split || null) : null;

        data.push({
            bounds: w.getBounds(),
            isMaximized: w.isMaximized(),
            tabs: currentTabs.length > 0 ? currentTabs : null,
            layout: currentLayout,
            split: currentSplit,
            isAux: isAux
        });
    });
    return data;
}

function saveLastSession() {
    try {
        const sessionData = captureSession();
        if (sessionData.length === 0) return;
        const settings = loadData(SETTINGS_FILE);
        settings.lastSession = sessionData;
        saveData(SETTINGS_FILE, settings);
    } catch (e) {
        console.error('saveLastSession: Erro ao salvar sessão:', e);
    }
}

function saveAuxWindowState(auxWindow) {
    try {
        const settings = loadData(SETTINGS_FILE);
        if (!settings.lastSession) settings.lastSession = [];
        const state = global.windowStates ? global.windowStates[auxWindow.id] : null;
        const allowNewTab = state && state.split && Array.isArray(state.split.ids) && state.split.ids.length > 0;
        const currentTabs = cleanTabs(state ? state.tabs : [], allowNewTab);

        const auxData = {
            bounds: auxWindow.getBounds(),
            isMaximized: auxWindow.isMaximized(),
            tabs: currentTabs.length > 0 ? currentTabs : null,
            layout: state ? (state.layout || 'single') : 'single',
            split: state ? (state.split || null) : null,
            isAux: true
        };

        const existingIndex = settings.lastSession.findIndex(w => w.isAux === true);
        if (existingIndex >= 0) {
            settings.lastSession[existingIndex] = auxData;
        } else {
            settings.lastSession.push(auxData);
        }
        saveData(SETTINGS_FILE, settings);
    } catch (e) { }
}

function restoreSession(win, data) {
    const browserPath = path.join(__dirname, 'browser.html').replace(/\\/g, '/');
    const newTabPath = path.join(__dirname, 'newtab.html').replace(/\\/g, '/');
    const newTabUrl = `file:///${newTabPath}`;

    // JANELA PRINCIPAL: Restaurar com layout se havia colunas
    if (!Array.isArray(data) || data.length === 0) {
        win.loadURL(`file:///${browserPath}`);
        return;
    }

    const win1 = data[0];

    // Aplicar bounds e maximização da janela principal
    if (win1.bounds) {
        try {
            if (win1.bounds.x !== undefined && win1.bounds.y !== undefined) win.setPosition(win1.bounds.x, win1.bounds.y);
            if (win1.bounds.width !== undefined && win1.bounds.height !== undefined) win.setSize(win1.bounds.width, win1.bounds.height);
        } catch (e) { win.setBounds(win1.bounds); }
    }
    if (win1.isMaximized) win.maximize();

    // CORREÇÃO: Restaurar layout e abas da janela principal
    let lMode = win1.layout || 'single';
    let sState = win1.split || null;
    const allowNewTab = (lMode && lMode !== 'single') || (sState && Array.isArray(sState.ids) && sState.ids.length > 0);
    let tList = cleanTabs(win1.tabs, allowNewTab);
    if (tList.length > 0) {
        tList = tList.map(() => newTabUrl);
    }
    if (tList.length <= 1) {
        lMode = 'single';
        sState = null;
    }

    // Construir URL com parâmetros de restauração
    let loadUrl = `file:///${browserPath}`;
    const params = [];

    // Passar abas via restorationCache (evita limite de URL)
    if (tList.length > 0) {
        const restorationId = Date.now().toString() + Math.random().toString().slice(2, 8);
        global.restorationCache[restorationId] = tList;
        params.push(`restorationId=${restorationId}`);
    }

    // Passar layout mode
    if (lMode && lMode !== 'single') {
        params.push(`layout=${encodeURIComponent(lMode)}`);
    }

    // Passar split state
    if (sState) {
        params.push(`split=${encodeURIComponent(JSON.stringify(sState))}`);
    }

    if (params.length > 0) loadUrl += `?${params.join('&')}`;

    // Atualizar o estado global da janela
    global.windowStates[win.id] = {
        tabs: tList,
        layout: lMode,
        split: sState,
        allTabs: tList,
        isAux: false
    };

    win.loadURL(loadUrl);

    // JANELAS AUXILIARES: Restaurar normalmente com suas abas
    for (let i = 1; i < data.length; i++) {
        const isAux = data[i].isAux !== false;
        const isMax = data[i].isMaximized || false;
        const lMode = data[i].layout || 'single';
        const sState = data[i].split || null;
        const allowNewTabAux = (lMode && lMode !== 'single') || (sState && Array.isArray(sState.ids) && sState.ids.length > 0);
        let tList = cleanTabs(data[i].tabs, allowNewTabAux);
        if (tList.length > 0) {
            tList = tList.map(() => newTabUrl);
        }
        createBrowserWindow(data[i].bounds, tList, null, lMode, sState, isAux, isMax);
    }
}

app.whenReady().then(async () => {
    fetchRemoteConfig();
    startAutoSave();

    // Inicia verificação de atualização a cada 60 minutos
     	setInterval(performBackgroundUpdateCheck, 3600000);
    const setupHeaderInterceptor = (ses) => {
        ses.webRequest.onBeforeSendHeaders((details, callback) => {
            details.requestHeaders['X-Gex-ID'] = MACHINE_ID;
            callback({ requestHeaders: details.requestHeaders });
        });
    };
    setupHeaderInterceptor(session.defaultSession);
    setupHeaderInterceptor(session.fromPartition('persist:gex'));

    app.on('web-contents-created', (event, contents) => {
        if (contents.getType() === 'webview') {
            contents.on('context-menu', (e, params) => {
                const menu = new Menu();
                if (params.isEditable) {
                    menu.append(new MenuItem({ label: 'Desfazer', role: 'undo', enabled: params.editFlags.canUndo }));
                    menu.append(new MenuItem({ label: 'Refazer', role: 'redo', enabled: params.editFlags.canRedo }));
                    menu.append(new MenuItem({ type: 'separator' }));
                    menu.append(new MenuItem({ label: 'Recortar', role: 'cut', enabled: params.editFlags.canCut }));
                    menu.append(new MenuItem({ label: 'Copiar', role: 'copy', enabled: params.editFlags.canCopy }));
                    menu.append(new MenuItem({ label: 'Colar', role: 'paste', enabled: params.editFlags.canPaste }));
                    menu.append(new MenuItem({ label: 'Selecionar tudo', role: 'selectAll' }));
                } else if (params.selectionText && params.selectionText.trim().length > 0) {
                    menu.append(new MenuItem({ label: 'Copiar', role: 'copy' }));
                }
                if (params.mediaType === 'image' && params.srcURL) {
                    if (menu.items.length > 0) menu.append(new MenuItem({ type: 'separator' }));
                    menu.append(new MenuItem({
                        label: 'Copiar Imagem',
                        click: () => { contents.copyImageAt(params.x, params.y); }
                    }));
                    menu.append(new MenuItem({
                        label: 'Salvar imagem como...',
                        click: async () => {
                            let fileName = 'imagem';
                            try {
                                const u = new URL(params.srcURL);
                                const base = path.basename(u.pathname);
                                if (base && base.length < 50) fileName = base;
                            } catch { }
                            const win = BrowserWindow.fromWebContents(contents) || BrowserWindow.getFocusedWindow();
                            const result = await dialog.showSaveDialog(win, {
                                defaultPath: fileName,
                                filters: [
                                    { name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] },
                                    { name: 'Todos os arquivos', extensions: ['*'] }
                                ]
                            });
                            if (!result.canceled && result.filePath) {
                                const session = contents.session;
                                session.once('will-download', (event, item, webContents) => { item.setSavePath(result.filePath); });
                                contents.downloadURL(params.srcURL);
                            }
                        }
                    }));
                }
                if (menu.items.length > 0) {
                    const win = BrowserWindow.fromWebContents(contents) || BrowserWindow.getFocusedWindow();
                    menu.popup({ window: win });
                }
            });
        }
    });

    app.on('login', (e, w, d, auth, cb) => {
        e.preventDefault();
        if (auth.isProxy && currentAuth) {
            const userWithId = normalizeProxyUser(currentAuth.user);
            cb(userWithId, currentAuth.pass);
        } else cb();
    });
    if (TEST_SPLIT) {
        const testTabs = ['https://example.com/', 'https://example.org/'];
        const testSplit = { mode: 'split-row', ids: [0, 1], widths: [50, 50] };
        createBrowserWindow(null, testTabs, null, 'split-row', testSplit);
    } else {
        createBrowserWindow();
    }
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createBrowserWindow(); });
});
app.on('before-quit', () => {
    stopAutoSave();
    stopRevalidationLoop();
    saveLastSession();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.handle('get-remote-config', () => remoteConfig);
ipcMain.handle('get-autologin-script', async () => {
    try {
        let p = app.isPackaged ? path.join(process.resourcesPath, 'autologin.js') : path.join(__dirname, 'autologin.js');
        return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : "";
    } catch { return ""; }
});
ipcMain.handle('get-app-version', () => app.getVersion());
ipcMain.handle('check-version', async () => {
    const currentApp = app.getVersion();
    let currentPkg = null;
    try { currentPkg = require(path.join(__dirname, 'package.json')).version; } catch { }
    const current = currentApp || currentPkg || "0.0.0";
    let latest = null;
    try {
        const vurl = `${VERSION_URL}?t=${Date.now()}`;
        let r = null;
        try { r = await axios.get(vurl, buildAxiosConfig(vurl, false, 5000)); } catch (e1) { }
        let raw = (r && r.data) ? String(r.data) : "";
        latest = parseVersionText(raw);
        if (!latest) {
            const cfg = { timeout: 5000, proxy: { host: activeProxy.host, port: activeProxy.port } };
            const auth = getProxyAuth();
            if (auth) {
                const b = Buffer.from(auth).toString('base64');
                cfg.headers = { 'Proxy-Authorization': `Basic ${b}` };
            }
            try {
                const r2 = await axios.get(vurl, cfg);
                const raw2 = (r2 && r2.data) ? String(r2.data) : "";
                latest = parseVersionText(raw2);
            } catch (e2) { }
        }
    } catch { }
    const settings = loadData(SETTINGS_FILE);
    const expected = settings && settings.expectedVersion ? String(settings.expectedVersion) : null;
    const norm = (s) => {
        const str = String(s || "").trim().replace(/^v/i, "");
        const m = str.match(/(\d+)(?:\.\d+){0,3}/);
        return m ? m[0] : "";
    };
    const cmp = (a, b) => {
        const pa = norm(a).split(".").map(x => parseInt(x, 10) || 0);
        const pb = norm(b).split(".").map(x => parseInt(x, 10) || 0);
        const n = Math.max(pa.length, pb.length);
        for (let i = 0; i < n; i++) {
            const va = pa[i] || 0, vb = pb[i] || 0;
            if (va > vb) return 1;
            if (va < vb) return -1;
        }
        return 0;
    };
    const effectiveLatest = latest || expected || null;
    const outdated = !!effectiveLatest && cmp(current, effectiveLatest) < 0;
    if (latest && cmp(current, latest) < 0) {
        settings.expectedVersion = latest;
        saveData(SETTINGS_FILE, settings);
    } else if (effectiveLatest && cmp(current, effectiveLatest) >= 0) {
        if (settings.expectedVersion) {
            delete settings.expectedVersion;
            saveData(SETTINGS_FILE, settings);
        }
    }
    const url = (remoteConfig && remoteConfig.updateDriveUrl) ? remoteConfig.updateDriveUrl : null;
    let exeUrl = (remoteConfig && remoteConfig.updateExeUrl) ? remoteConfig.updateExeUrl : DEFAULT_UPDATE_EXE_URL;
    if (outdated && !exeUrl) {
        try { await fetchRemoteConfig(1); } catch { }
        exeUrl = (remoteConfig && remoteConfig.updateExeUrl) ? remoteConfig.updateExeUrl : DEFAULT_UPDATE_EXE_URL;
    }
    return { current, latest, outdated, url, exeUrl };
});

function parseVersionText(raw) {
    const text = String(raw || "").trim();
    if (!text) return null;
    const m1 = text.match(/version\s*[:=]\s*(\d+(?:\.\d+){0,3})/i);
    if (m1 && m1[1]) return m1[1];
    const m2 = text.match(/(\d+)(?:\.\d+){0,3}/);
    if (m2 && m2[0]) return m2[0];
    return null;
}
ipcMain.handle('get-saved-creds', () => {
    const s = loadData(SETTINGS_FILE);
    const c = s.savedCreds;
    if (c && c.user && c.passB64) return c;
    return null;
});
ipcMain.handle('set-saved-creds', (ev, { username, password }) => {
    if (!username || !password) return false;
    const s = loadData(SETTINGS_FILE);
    s.savedCreds = { user: String(username), passB64: Buffer.from(String(password), 'utf8').toString('base64') };
    saveData(SETTINGS_FILE, s);
    return true;
});
ipcMain.handle('clear-saved-creds', () => {
    const s = loadData(SETTINGS_FILE);
    if (s.savedCreds) {
        delete s.savedCreds;
        saveData(SETTINGS_FILE, s);
    }
    return true;
});
ipcMain.handle('check-login-cookies', async (event, url) => {
    try {
        const ses = session.fromPartition('persist:gex');
        let host = null;
        try { const u = new URL(url); host = u.hostname; } catch { }
        const patterns = (() => {
            const h = String(host || "").toLowerCase();
            if (h.includes('menthorq')) return ['wordpress_logged_in', 'mepr_', 'remember'];
            if (h.includes('spotgamma')) return ['session', 'sess', 'auth', 'logged', 'remember', 'cf_clearance'];
            if (h.includes('quantdata')) return ['session', 'sess', 'auth', 'logged', 'remember', 'connect.sid'];
            return ['session', 'sess', 'auth', 'logged', 'remember'];
        })();
        const all = await ses.cookies.get({});
        const scoped = all.filter(c => {
            const d = String(c.domain || '').toLowerCase();
            const h = String(host || '').toLowerCase();
            if (!h) return true;
            return d === h || d === '.' + h || d.endsWith('.' + h) || h.endsWith(d);
        });
        const names = scoped.map(c => c.name || '').filter(Boolean);
        const matched = names.filter(n => {
            const ln = String(n || '').toLowerCase();
            return patterns.some(p => ln.includes(p));
        });
        return { has: matched.length > 0, names: matched, host: host || null };
    } catch (e) {
        return { has: false, names: [], error: String(e) };
    }
});
ipcMain.handle('download-update', async (ev, url) => {
    if (!url || typeof url !== 'string') return { ok: false, error: 'URL inválida' };
    const tempFile = path.join(os.tmpdir(), 'GexBrowser_Update_Installer.exe');
    try {
        const dl = `${url}?t=${Date.now()}`;
        const res = await axios.get(dl, buildAxiosConfig(dl, true, 60000));
        await new Promise((resolve, reject) => {
            const w = fs.createWriteStream(tempFile);
            res.data.pipe(w);
            w.on('finish', resolve);
            w.on('error', reject);
        });
        return { ok: true, path: tempFile };
    } catch (e) {
        return { ok: false, error: e.message || 'Falha no download' };
    }
});
ipcMain.handle('apply-update', async (ev, exePath) => {
    try {
        // Executar o instalador de forma visível
        const p = spawn(exePath, [], {
            detached: true,
            stdio: 'ignore'
        });
        p.unref();

        setTimeout(() => { app.quit(); }, 500);
        return true;
    } catch (e) {
        return false;
    }
});
ipcMain.handle('login-attempt', async (ev, { username, password }) => {
    // 1. Validate credentials against Proxy BEFORE opening
    const valid = await testProxyAuth(username, password);
    if (!valid) {
        return { success: false, error: "Conexão Recusada: Usuário/Senha incorretos ou Proxy inacessível." };
    }

    // 2. If valid, configure session and proceed
    await setupProxy(username, password);
    if (!remoteConfig) await fetchRemoteConfig(1);

    return { success: true };
});

ipcMain.on('load-browser', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const settings = loadData(SETTINGS_FILE);
    const lastSession = settings.lastSession;
    BrowserWindow.getAllWindows().forEach(w => { if (w.id !== win.id) w.close(); });
    restoreSession(win, lastSession);
});
ipcMain.on('detach-tab', (e, url) => {
    createBrowserWindow(null, null, url, 'single', null, true);
});
ipcMain.on('create-window', (event, url) => {
    createBrowserWindow(null, null, url, 'single', null, true);
});
ipcMain.on('force-save-session', () => {
    saveLastSession();
});

function performWindowOrganization() {
    const allWindows = BrowserWindow.getAllWindows().filter(w => !w.isDestroyed() && w.isVisible());
    if (allWindows.length === 0) return;
    const displays = screen.getAllDisplays();
    displays.forEach(display => {
        const windowsOnDisplay = allWindows.filter(w => {
            const bounds = w.getBounds();
            const winDisplay = screen.getDisplayMatching(bounds);
            return winDisplay.id === display.id;
        });
        if (windowsOnDisplay.length === 0) return;
        windowsOnDisplay.sort((a, b) => a.getBounds().x - b.getBounds().x);

        const workArea = display.workArea;
        const count = windowsOnDisplay.length;
        let currentX = workArea.x;
        const totalWidth = workArea.width;
        const baseWidth = Math.floor(totalWidth / count);
        const remainder = totalWidth % count;

        const SHADOW_OFFSET = 8; // Ajustado para remover bordas sem sobrepor muito

        windowsOnDisplay.forEach((win, index) => {
            if (win.isMinimized()) win.restore();
            if (win.isMaximized()) win.unmaximize();

            const extraPixel = index < remainder ? 1 : 0;
            const myWidth = baseWidth + extraPixel;

            const newBounds = {
                x: currentX - SHADOW_OFFSET,
                y: workArea.y,
                width: myWidth + (SHADOW_OFFSET * 2),
                height: workArea.height + SHADOW_OFFSET
            };

            currentX += myWidth;
            win.setBounds(newBounds);
        });
    });
}

ipcMain.on('organize-windows', (event) => performWindowOrganization());

ipcMain.on('set-window-layout', (event, { count, urls }) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    const bounds = senderWin ? senderWin.getBounds() : null;
    const urlsToCreate = Array.isArray(urls) ? urls : [];
    urlsToCreate.forEach(url => {
        createBrowserWindow(bounds, null, url, 'single', null, true);
    });
    let currentEstimated = 1 + urlsToCreate.length;
    if (currentEstimated < count) {
        const needed = count - currentEstimated;
        for (let i = 0; i < needed; i++) {
            createBrowserWindow(bounds, null, null, 'single', null, true);
        }
    }
    setTimeout(performWindowOrganization, 1000);
    setTimeout(performWindowOrganization, 2000);
});

ipcMain.handle('get-windows', () => {
    const windows = BrowserWindow.getAllWindows().filter(w => !w.isDestroyed());
    return windows.map(w => ({
        id: w.id,
        title: w.getTitle(),
        isMaximized: w.isMaximized(),
        bounds: w.getBounds(),
        isAux: global.windowStates[w.id] ? global.windowStates[w.id].isAux : false
    }));
});

ipcMain.on('quit-now', () => {
    app.quit();
});

let isUpdateCountdownActive = false;

async function performBackgroundUpdateCheck() {
    if (isUpdateCountdownActive) return;

    const logPath = path.join(app.getPath('userData'), 'update_log.txt');
    const log = (msg) => {
        try { fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`); } catch (e) { console.error(e); }
    };

    log("Iniciando verificação de atualização (Background)...");

    try {
        const currentApp = app.getVersion();
        let currentPkg = null;
        try { currentPkg = require(path.join(__dirname, 'package.json')).version; } catch { }
        const current = currentApp || currentPkg || "0.0.0";

        const vurl = `${VERSION_URL}?t=${Date.now()}`;
        log(`Verificando URL: ${vurl}`);
        
        let latest = null;

        try {
            const r = await axios.get(vurl, buildAxiosConfig(vurl, false, 5000));
            log(`Resposta direta: ${r.status}`);
            latest = parseVersionText((r && r.data) ? String(r.data) : "");
        } catch (e) { 
            log(`Erro conexão direta: ${e.message}`);
        }

        if (!latest) {
            log("Tentando via Proxy...");
            const cfg = { timeout: 5000, proxy: { host: activeProxy.host, port: activeProxy.port } };
            const auth = getProxyAuth();
            if (auth) {
                const b = Buffer.from(auth).toString('base64');
                cfg.headers = { 'Proxy-Authorization': `Basic ${b}` };
            }
            try {
                const r2 = await axios.get(vurl, cfg);
                log(`Resposta proxy: ${r2.status}`);
                latest = parseVersionText((r2 && r2.data) ? String(r2.data) : "");
            } catch (e) { 
                log(`Erro conexão proxy: ${e.message}`);
            }
        }

        if (latest) {
            const norm = (s) => {
                const str = String(s || "").trim().replace(/^v/i, "");
                const m = str.match(/(\d+)(?:\.\d+){0,3}/);
                return m ? m[0] : "";
            };
            const cmp = (a, b) => {
                const pa = norm(a).split(".").map(x => parseInt(x, 10) || 0);
                const pb = norm(b).split(".").map(x => parseInt(x, 10) || 0);
                const n = Math.max(pa.length, pb.length);
                for (let i = 0; i < n; i++) {
                    const va = pa[i] || 0, vb = pb[i] || 0;
                    if (va > vb) return 1;
                    if (va < vb) return -1;
                }
                return 0;
            };

            if (cmp(current, latest) < 0) {
                log(`[AutoUpdate] Nova versão detectada: ${latest} (Atual: ${current}). Iniciando countdown...`);
                console.log(`[AutoUpdate] Nova versão detectada: ${latest} (Atual: ${current}). Iniciando countdown...`);
                
                isUpdateCountdownActive = true;
                const windows = BrowserWindow.getAllWindows();
                windows.forEach(w => {
                    if (!w.isDestroyed()) {
                        try { w.webContents.send('update-countdown', { seconds: 300, version: latest }); } catch (e) { }
                    }
                });

                setTimeout(() => {
                    log("[AutoUpdate] Tempo esgotado. Encerrando aplicação.");
                    app.quit();
                }, 300000);
            } else {
                log(`Versão atual (${current}) é igual ou superior à remota (${latest}). Nenhuma ação necessária.`);
            }
        } else {
            log("Não foi possível obter a versão remota (latest é null).");
        }
    } catch (e) {
        log(`[AutoUpdate] Erro fatal na verificação: ${e.message}`);
        console.error("[AutoUpdate] Erro na verificação:", e.message);
    }
}
