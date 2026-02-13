const LAYOUT_VERSION = 7;
let CONFIG = {};

// Load configuration (either injected via API or via global variable)
if (window.__GEX_CONFIG) {
    if (window.__GEX_CONFIG.credentials) {
        CONFIG = window.__GEX_CONFIG.credentials;
    } else {
        CONFIG = window.__GEX_CONFIG;
    }
}

// Test proxy as soon as the script loads
setTimeout(() => {
    if (window.api && window.api.testProxy) {
        console.log('[AUTOLOGIN] Starting proxy test...');
        window.api.testProxy().then(result => {
            console.log('[AUTOLOGIN] Proxy test completed:', result);
        }).catch(error => {
            console.error('[AUTOLOGIN] Proxy test error:', error);
        });
    }
}, 5000); // Wait 5 seconds to ensure webviews are created

function showDebugStatus(msg, color = 'yellow') {
    // console.log(`%c [GexAutoLogin] ${msg}`, `color: ${color}`);
}

/**
 * --- SMART FAILOVER (INTELLIGENT ROTATION) ---
 * 1. Search for all accounts starting with the base name (e.g., spotgamma1, spotgamma2).
 * 2. Read from LocalStorage the index of the last attempt.
 * 3. Select the current account.
 * 4. Save the index of the NEXT account in case the page is reloaded (failure).
 */
function getSmartConfig(baseName) {
    // Find candidates with DIGIT SUFFIX only: spotgamma1, spotgamma2, ...
    // IMPORTANT: avoid collisions like "gexbot" matching "gexbot_classic".
    const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const digitRe = new RegExp(`^${esc(baseName)}\\d+$`);
    const candidates = Object.keys(CONFIG).filter(key => digitRe.test(key));

    // If no candidates with suffix, try exact name or return empty
    if (candidates.length === 0) {
        if (CONFIG[baseName]) return CONFIG[baseName];
        return {};
    }

    // If only one account, use it directly
    if (candidates.length === 1) return CONFIG[candidates[0]];

    // Sort to ensure correct sequence
    candidates.sort();

    // Retrieve current index from browser memory
    const storageKey = `gex_lb_index_${baseName}`;
    let currentIndex = 0;
    try {
        currentIndex = parseInt(localStorage.getItem(storageKey) || "0");
    } catch (e) {
        // Ignore LS access error (may occur in iframes/restricted cross-origin)
    }

    // Security validation
    if (isNaN(currentIndex) || currentIndex >= candidates.length) {
        currentIndex = 0;
    }

    // Select current account
    const chosenKey = candidates[currentIndex];

    // Calculate and save the index of the NEXT account (Failover)
    const nextIndex = (currentIndex + 1) % candidates.length;
    try {
        localStorage.setItem(storageKey, nextIndex.toString());
    } catch (e) {
        // Ignore write error
    }

    console.log(`[Gex SmartAuth] Using account: ${chosenKey}. (Next in case of failure: index ${nextIndex})`);

    return CONFIG[chosenKey];
}

// --- CREDENTIALS DEFINITION WITH SMART FAILOVER ---

// GEXBOT (Flow) e GEXBOT CLASSIC (sessões separadas no Electron)
const gexConf = getSmartConfig('gexbot');
const gexClassicConf = (() => {
    const c = getSmartConfig('gexbot_classic');
    if (c && Object.keys(c).length > 0) return c;
    return getSmartConfig('gexbotclassic');
})();

const GEX_EMAIL_ENC = gexConf.email_enc || (CONFIG.gexbot && CONFIG.gexbot.email_enc) || "";
const GEX_PASS_ENC = gexConf.pass_enc || (CONFIG.gexbot && CONFIG.gexbot.pass_enc) || "";

const GEX_CLASSIC_EMAIL_ENC = gexClassicConf.email_enc || (CONFIG.gexbot_classic && CONFIG.gexbot_classic.email_enc) || "";
const GEX_CLASSIC_PASS_ENC = gexClassicConf.pass_enc || (CONFIG.gexbot_classic && CONFIG.gexbot_classic.pass_enc) || "";

const spotConf = getSmartConfig('spotgamma');
const SPOT_EMAIL_ENC = spotConf.email_enc || "";
const SPOT_PASS_ENC = spotConf.pass_enc || "";

const quantConf = getSmartConfig('quantdata');
const QUANT_EMAIL_ENC = quantConf.email_enc || "";
const QUANT_PASS_ENC = quantConf.pass_enc || "";

const menthorConf = getSmartConfig('menthorq');
const MENTHORQ_EMAIL_ENC = menthorConf.email_enc || "";
const MENTHORQ_PASS_ENC = menthorConf.pass_enc || "";

const discordConf = getSmartConfig('discord');
const DISCORD_EMAIL_ENC = discordConf.email_enc || "";
const DISCORD_PASS_ENC = discordConf.pass_enc || "";
const DISCORD_USER_PLAIN = discordConf.user || "";
const DISCORD_PASS_PLAIN = discordConf.pass || "";
const finvizConf = (() => {
    const c = getSmartConfig('finviz');
    if (c && Object.keys(c).length > 0) return c;
    return getSmartConfig('finz');
})();
const FINVIZ_EMAIL_ENC = finvizConf.email_enc || "";
const FINVIZ_PASS_ENC = finvizConf.pass_enc || "";

// --- ENCRYPTION AND FILLING FUNCTIONS ---

function formatText(hexStr) {
    if (!hexStr) return "";
    const bytes = [];
    for (let i = 0; i < hexStr.length; i += 2) {
        bytes.push(parseInt(hexStr.slice(i, i + 2), 16));
    }
    let reversed = "";
    for (let i = 0; i < bytes.length; i++) {
        reversed += String.fromCharCode(bytes[i]);
    }
    let buffer = "";
    for (let i = reversed.length - 1; i >= 0; i--) {
        buffer += reversed[i];
    }
    let result = "";
    for (let i = 0; i < buffer.length; i++) {
        result += String.fromCharCode(buffer.charCodeAt(i) ^ LAYOUT_VERSION);
    }
    return result;
}

function fillSimple(element, value) {
    if (!element) return;
    element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
}

function fillReact(element, value) {
    if (!element) return;
    element.focus();
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    nativeInputValueSetter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.blur();
}

const SITES_CONFIG = {
    'newsite': {
        checkUrl: () => window.location.hostname.includes('newsite.com'),
        fillMethod: 'simple',
        getEmail: () => "different_login@example.com",
        getPass: () => "different_pass_123",
        findFields: () => {
            const email = document.querySelector('input[name="email"]') || document.querySelector('input[type="email"]');
            const pass = document.querySelector('input[name="password"]') || document.querySelector('input[type="password"]');
            const btn = document.querySelector('button[type="submit"]');
            return { email, pass, btn }
        },
        extraActions: () => { }
    },
    'gexbot': {
        checkUrl: () => window.location.hostname.includes('gexbot.com'),
        fillMethod: 'simple',
        getEmail: () => "",
        getPass: () => "",
        findFields: () => { return { email: null, pass: null, btn: null } },
        extraActions: () => {
            console.log('[GEX DEBUG] Verifying Gexbot injection...');
            let didSetAuth = false;
            // Perfil vem do host (browser.html). Se não existir, tenta inferir.
            const profileRaw = (window.__GEX_GEXBOT_PROFILE || '').toString().toLowerCase();
            let profile = (profileRaw === 'classic' || profileRaw === 'flow') ? profileRaw : '';
            if (!profile) {
                try {
                    const ls = (localStorage.getItem('gexbot_profile') || '').toString().toLowerCase();
                    if (ls === 'classic' || ls === 'flow') profile = ls;
                } catch { }
            }
            if (!profile) profile = 'flow';
            try { localStorage.setItem('gexbot_profile', profile); } catch { }
            const cfgRoot = (profile === 'classic')
                ? (CONFIG.gexbot_classic || CONFIG.gexbotclassic || null)
                : (CONFIG.gexbot || null);

            if (cfgRoot) {
                const d = (profile === 'classic' && gexClassicConf && gexClassicConf.auth)
                    ? gexClassicConf
                    : (gexConf && gexConf.auth ? gexConf : (cfgRoot.injection_data || cfgRoot));

                const hasAuth = d.auth && document.cookie.includes('auth=' + d.auth);
                const isApp = window.location.hostname.includes('app.gexbot.com');
                const path = window.location.pathname;
                const isRoot = (!path || path === '/' || path === '/index.html');

                // Passo 1: se estou no WWW raiz e ainda não tenho auth, ir para APP (isso é necessário para o cookie "pegar")
                if (!isApp && isRoot) {
                    if (!hasAuth && d.auth) {
                        console.log('🔄 [GEX DEBUG] Missing session on WWW. Going to APP...');
                        window.location.href = "https://app.gexbot.com/";
                        return;
                    }
                }
                if (!hasAuth && d.auth) {
                    console.log('🚀 [GEX DEBUG] Restoring session (Cookies) and Clearing problematic LS...');
                    const setC = (n, v) => {
                        const c1 = n + "=" + v + "; domain=.gexbot.com; path=/; secure";
                        const c2 = n + "=" + v + "; path=/";
                        document.cookie = c1;
                        document.cookie = c2;
                    };
                    if (d.auth) setC('auth', d.auth);
                    if (d.ai_user) setC('ai_user', d.ai_user);
                    if (d.ai_session) setC('ai_session', d.ai_session);
                    didSetAuth = true;
                    const keysToRemove = ["gex10Settings", "state-alerts-config-by-ticker", "state-price-multiplier-storage", "urlConfigurations", "classic_category", "state_category"];
                    keysToRemove.forEach(key => {
                        if (localStorage.getItem(key)) {
                            console.log(`🗑️ Removing problematic key: ${key}`);
                            localStorage.removeItem(key);
                        }
                    });
                }
            }
            if (didSetAuth) {
                const returnKey = '__gexbot_returned_www';
                let shouldReturn = false;
                try { shouldReturn = !sessionStorage.getItem(returnKey); } catch { shouldReturn = true; }
                if (shouldReturn) {
                    try { sessionStorage.setItem(returnKey, '1'); } catch { }
                    setTimeout(() => {
                        const path = window.location.pathname;
                        const isApp = window.location.hostname.includes('app.gexbot.com');
                        const isRoot = (!path || path === '/' || path === '/index.html');
                        // Passo 2: depois de aplicar cookies, voltar para WWW (mesma conta) para o usuário usar normalmente
                        if (isApp || !isRoot) {
                            console.log('🔄 [GEX DEBUG] Returning to gexbot.com...');
                            window.location.href = "https://www.gexbot.com/";
                        }
                    }, 2000);
                }
            }
            startHideAccountWatcher();
            disablePageTranslation();
        }
    },
    'gammaedge': {
        checkUrl: () => window.location.hostname.includes('gammaedge.us'),
        fillMethod: 'simple',
        getEmail: () => "",
        getPass: () => "",
        findFields: () => { return { email: null, pass: null, btn: null } },
        extraActions: () => {
            if (CONFIG.gammaedge && Array.isArray(CONFIG.gammaedge.cookies)) {
                CONFIG.gammaedge.cookies.forEach(c => {
                    if (c && c.name && typeof c.value === 'string' && !c.httpOnly) {
                        const domain = c.domain ? `domain=${c.domain}; ` : '';
                        const path = `path=${c.path || '/'}; `;
                        const secure = c.secure ? 'secure; ' : '';
                        document.cookie = `${c.name}=${c.value}; ${domain}${path}${secure}`;
                    }
                });
            }
        }
    },
    'menthorq': {
        checkUrl: () => window.location.hostname.includes('menthorq.com'),
        fillMethod: 'simple',
        getEmail: () => formatText(MENTHORQ_EMAIL_ENC),
        getPass: () => formatText(MENTHORQ_PASS_ENC),
        findFields: () => {
            const email = document.querySelector('input[name="log"]') || document.querySelector('input[id="user_login"]') || document.querySelector('input[name="email"]') || document.querySelector('input[name="username"]') || document.querySelector('input[type="email"]');
            const pass = document.querySelector('input[name="pwd"]') || document.querySelector('input[id="user_pass"]') || document.querySelector('input[name="password"]') || document.querySelector('input[type="password"]');
            let btn = document.querySelector('button[type="submit"]');
            if (!btn) {
                const candidates = Array.from(document.querySelectorAll("button, input[type='submit']"));
                btn = candidates.find(b => {
                    const t = (b.innerText || b.value || "").toLowerCase();
                    return t.includes("login") || t.includes("entrar") || t.includes("sign in") || t.includes("acessar");
                })
            }
            return { email, pass, btn }
        },
        extraActions: () => { }
    },
    'discord': {
        checkUrl: () => window.location.hostname.includes('discord.com'),
        fillMethod: 'react',
        getEmail: () => {
            const val = formatText(DISCORD_EMAIL_ENC) || DISCORD_USER_PLAIN;
            if (!val) showDebugStatus("ERROR: Email not configured!", "red");
            return val;
        },
        getPass: () => {
            const val = formatText(DISCORD_PASS_ENC) || DISCORD_PASS_PLAIN;
            if (!val) showDebugStatus("ERROR: Password not configured!", "red");
            return val;
        },
        findFields: () => {
            showDebugStatus("Searching for fields (v3)...", "yellow");
            const email = document.querySelector('input[name="email"]')
                || document.querySelector('input[type="email"]')
                || document.querySelector('input[placeholder*="email" i]')
                || document.querySelector('input[aria-label*="email" i]')
                || document.querySelector('input[autocomplete*="username" i]');
            const pass = document.querySelector('input[name="password"]')
                || document.querySelector('input[type="password"]')
                || document.querySelector('input[placeholder*="password" i]')
                || document.querySelector('input[aria-label*="password" i]')
                || document.querySelector('input[autocomplete*="current-password" i]');
            let btn = document.querySelector('button[type="submit"]') || document.querySelector('div[role="button"]');
            if (!btn) {
                const candidates = Array.from(document.querySelectorAll("button, div[role='button']"));
                btn = candidates.find(b => {
                    const t = (b.innerText || "").toLowerCase();
                    return t.includes("log in") || t.includes("entrar") || t.includes("sign in");
                })
            }
            if (email && pass) {
                showDebugStatus("Fields found!", "blue");
            } else {
                const allInputs = document.querySelectorAll('input').length;
                showDebugStatus(`Missing: ${!email ? 'Email ' : ''}${!pass ? 'Password' : ''} (Inputs: ${allInputs})`, "orange");
            }
            return { email, pass, btn }
        },
        extraActions: () => { showDebugStatus("Discord Detected", "blue") }
    },
    'finviz': {
        checkUrl: () => window.location.hostname.includes('finviz.com'),
        fillMethod: 'simple',
        getEmail: () => formatText(FINVIZ_EMAIL_ENC),
        getPass: () => formatText(FINVIZ_PASS_ENC),
        findFields: () => {
            const email = document.querySelector('input[type="email"]')
                || document.querySelector('input[name="email"]')
                || document.querySelector('input[id*="email" i]');
            const pass = document.querySelector('input[type="password"]')
                || document.querySelector('input[name="password"]')
                || document.querySelector('input[id*="pass" i]');
            let btn = document.querySelector('button[type="submit"]') || document.querySelector('input[type="submit"]');
            if (!btn) {
                const candidates = Array.from(document.querySelectorAll("button, input[type='submit']"));
                btn = candidates.find(b => {
                    const t = (b.innerText || b.value || "").toLowerCase();
                    return t.includes("log in") || t.includes("login") || t.includes("sign in") || t.includes("entrar");
                })
            }
            return { email, pass, btn }
        },
        extraActions: () => {
            try {
                const hint = window.__GEX_COOKIES_HINT;
                const href = String(location.href || '').toLowerCase();
                if (hint && hint.has && href.includes('finviz.com/login')) {
                    const email = document.querySelector('input[type="email"]')
                        || document.querySelector('input[name="email"]')
                        || document.querySelector('input[id*="email" i]');
                    const pass = document.querySelector('input[type="password"]')
                        || document.querySelector('input[name="password"]')
                        || document.querySelector('input[id*="pass" i]');
                    if (!email && !pass) {
                        const key = '__gex_finviz_login_redirect';
                        if (!sessionStorage.getItem(key)) {
                            sessionStorage.setItem(key, '1');
                            setTimeout(() => {
                                if (String(location.href || '').toLowerCase().includes('finviz.com/login')) {
                                    location.href = 'https://finviz.com/';
                                }
                            }, 1500);
                            return;
                        }
                    }
                }
            } catch (e) { }
            const remember = document.querySelector('input[type="checkbox"][name*="remember" i]')
                || document.querySelector('input[type="checkbox"][id*="remember" i]');
            if (remember && !remember.checked) {
                remember.checked = true;
                remember.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
    },
    'quantdata': {
        checkUrl: () => window.location.hostname.includes('quantdata.us'),
        fillMethod: 'react',
        getEmail: () => formatText(QUANT_EMAIL_ENC),
        getPass: () => formatText(QUANT_PASS_ENC),
        findFields: () => {
            const email = document.querySelector('input[autocomplete="username"]') || document.querySelector('input[name="username"]') || document.querySelector('input[type="email"]');
            const pass = document.querySelector('input[autocomplete="password"]') || document.querySelector('input[name="password"]') || document.querySelector('input[type="password"]');
            let btn = document.querySelector('button[type="submit"]');
            if (!btn) {
                const candidates = Array.from(document.querySelectorAll("button"));
                btn = candidates.find(b => {
                    const t = (b.innerText || "").toLowerCase();
                    return t.includes("login") || t.includes("sign in") || t.includes("entrar");
                })
            }
            return { email, pass, btn }
        },
        extraActions: () => {
            const s = document.createElement("style");
            s.innerHTML = 'input[type="password"]~svg,input[type="password"]~i,input[type="password"]~*[role="button"],[class*="eye"],[class*="Eye"]{display:none!important;pointer-events:none!important}';
            document.head.appendChild(s)
        }
    },
    'spotgamma': {
        checkUrl: () => window.location.hostname.includes('spotgamma.com'),
        fillMethod: 'react',
        getEmail: () => formatText(SPOT_EMAIL_ENC),
        getPass: () => formatText(SPOT_PASS_ENC),
        findFields: () => {
            const email = document.getElementById('login-username') || document.querySelector('input[name="email"]');
            const pass = document.getElementById('login-password') || document.querySelector('input[name="password"]');
            let btn = document.querySelector('button[type="submit"]');
            if (!btn) {
                const candidates = Array.from(document.querySelectorAll("button"));
                btn = candidates.find(b => {
                    const t = (b.innerText || "").toLowerCase();
                    return t.includes("log in") || t.includes("sign in")
                })
            }
            return { email, pass, btn }
        },
        extraActions: () => {
            if (CONFIG.spotgamma && Array.isArray(CONFIG.spotgamma.cookies)) {
                CONFIG.spotgamma.cookies.forEach(c => {
                    if (c && c.name && typeof c.value === 'string' && !c.httpOnly) {
                        const domain = c.domain ? `domain=${c.domain}; ` : '';
                        const path = `path=${c.path || '/'}; `;
                        const secure = c.secure ? 'secure; ' : '';
                        document.cookie = `${c.name}=${c.value}; ${domain}${path}${secure}`;
                    }
                });
            }
            if (!window.__gex_disable_sync_button) {
                window.__gex_disable_sync_button = true;

                // Helper robusto para clicar em elementos por texto
                const clickElementByText = (selectors, text) => {
                    const elements = Array.from(document.querySelectorAll(selectors));
                    const target = elements.find(el => (el.textContent || '').trim().toLowerCase() === text.toLowerCase());
                    if (target) {
                        try { target.style.pointerEvents = 'auto'; } catch (e) { }
                        try { target.removeAttribute('disabled'); } catch (e) { }
                        try { target.click(); } catch (e) { }
                        return true;
                    }
                    return false;
                };

                const clickSyncSwitchOnce = () => {
                    // Tenta encontrar o label "Sync Time" e clicar no switch pai ou irmão
                    const labels = Array.from(document.querySelectorAll('span, div, label, p'));
                    const label = labels.find(el => (el.textContent || '').trim().toLowerCase() === 'sync time');
                    if (!label) return false;

                    // Tenta subir alguns níveis para achar o input do switch
                    let parent = label.parentElement;
                    let switchInput = null;
                    for (let i = 0; i < 3; i++) {
                        if (!parent) break;
                        switchInput = parent.querySelector('input[type="checkbox"], input.MuiSwitch-input, .MuiSwitch-root input');
                        if (switchInput) break;
                        parent = parent.parentElement;
                    }

                    if (switchInput) {
                        try { switchInput.click(); console.log('[SpotGamma] Sync Time clicado.'); return true; } catch (e) { }
                    }
                    return false;
                };

                const clickLiveFlowOnce = () => {
                    // Tenta clicar no botão "Live Flow" diretamente
                    if (clickElementByText('button, div[role="button"], span', 'live flow')) {
                        console.log('[SpotGamma] Live Flow clicado.');
                        return true;
                    }
                    return false;
                };

                const startAt = Date.now();
                const timer = setInterval(() => {
                    const syncClicked = clickSyncSwitchOnce();
                    const flowClicked = clickLiveFlowOnce();

                    // Se ambos foram clicados OU passou muito tempo (30s), para.
                    if ((syncClicked && flowClicked) || Date.now() - startAt > 30000) {
                        clearInterval(timer);
                        console.log('[SpotGamma] Tentativas de clique finalizadas.');
                    }
                }, 1500); // Tenta a cada 1.5s
            }
        }
    }
};

function performAutoLogin() {
    if (window.__autoLoginDone) return;
    let currentSite = null;
    for (const config of Object.values(SITES_CONFIG)) {
        if (config.checkUrl()) {
            currentSite = config;
            break;
        }
    }
    if (!currentSite) return;
    const emailVal = currentSite.getEmail();
    const passVal = currentSite.getPass();
    if (!emailVal || !passVal) {
        return;
    }
    const fields = currentSite.findFields();
    if (fields.email && fields.pass) {
        fields.email.setAttribute("autocomplete", "off");
        fields.pass.setAttribute("autocomplete", "off");
        const filler = currentSite.fillMethod === 'react' ? fillReact : fillSimple;
        console.log("Gamma AutoLogin: Filling...");
        filler(fields.email, emailVal);
        setTimeout(() => {
            filler(fields.pass, passVal);
            window.__autoLoginDone = true;
            setTimeout(() => {
                if (fields.btn) {
                    fields.btn.click();
                } else {
                    const form = fields.email.form;
                    if (form) form.requestSubmit();
                }
            }, 100);
        }, 50);
    }
}

function hideAccountElements() {
    if (!window.location.hostname.includes("gexbot.com")) return;
    const selectors = ["button", "a"];
    const keywords = ["account", "profile"];
    for (const sel of selectors) {
        const elements = document.querySelectorAll(sel);
        for (const el of elements) {
            const text = (el.innerText || "").toLowerCase();
            const aria = (el.getAttribute("aria-label") || "").toLowerCase();
            for (const k of keywords) {
                if ((text && text.includes(k)) || (aria && aria.includes(k))) {
                    el.style.display = "none";
                    break;
                }
            }
        }
    }
}

function startHideAccountWatcher() {
    setInterval(hideAccountElements, 3000);
    window.addEventListener("click", (e) => {
        if (!window.location.hostname.includes("gexbot.com")) return;
        let el = e.target.closest("button, a");
        if (!el) return;
        const text = (el.innerText || "").toLowerCase();
        if (text.includes("account")) {
            e.stopImmediatePropagation();
            e.preventDefault();
        }
    }, true);
}

function disablePageTranslation() {
    if (!window.location.hostname.includes("gexbot.com")) return;
    const meta = document.createElement("meta");
    meta.name = "google";
    meta.content = "notranslate";
    document.head.appendChild(meta);
    document.documentElement.classList.add("notranslate");
}

function init() {
    let attempts = 0;
    const interval = setInterval(() => {
        attempts++;
        if (window.__autoLoginDone || attempts > 30) {
            clearInterval(interval);
            return;
        }
        performAutoLogin();
    }, 1000);
    let currentSite = null;
    for (const config of Object.values(SITES_CONFIG)) {
        if (config.checkUrl()) {
            currentSite = config;
            break;
        }
    }
    if (currentSite && typeof currentSite.extraActions === 'function') {
        let extraAttempts = 0;
        const maxExtra = 8;
        const runExtra = () => {
            try { currentSite.extraActions(); } catch (e) { }
        };
        runExtra();
        const extraInterval = setInterval(() => {
            extraAttempts++;
            runExtra();
            if (extraAttempts >= maxExtra) clearInterval(extraInterval);
        }, 1500);
    }
}
const delayedInit = () => init();
if (document.readyState === "complete" || document.readyState === "interactive") {
    delayedInit();
} else {
    window.addEventListener("DOMContentLoaded", delayedInit);
}
