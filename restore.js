import { translations } from './translations.js';

const { ethers } = window;

const GATEWAYS = ['https://ar-io.dev', 'https://arweave.net'];
const MANIFEST_ID_RE = /^[a-zA-Z0-9_-]{43}$/;
// Base Sepolia PermRepoNFT address used by this deployment.
const NFT_CONTRACT_ADDRESS = '0x653c302009283cEE850D3eD8e7cb6F9633FA418b';
const NFT_ABI = [
    'function repositoryTokens(bytes32 repoHash) view returns (uint256)',
    'function getManifestURI(uint256 tokenId) view returns (string)',
    'function getBackupCount(uint256 tokenId) view returns (uint256)'
];

const CONFIG = {
    chainId: 0x14a34,
    chainIdHex: '0x14a34',
    chainName: 'Base Sepolia',
    rpcUrls: [
        'https://sepolia.base.org',
        'https://base-sepolia-rpc.publicnode.com'
    ],
    blockExplorerUrls: ['https://sepolia.basescan.org']
};

let userAddress = null;
let currentLanguage = localStorage.getItem('permrepo-language') || 'lv';
let manifestData = null;
let manifestTxId = null;
let isManifestLoaded = false;
let walletListenersInstalled = false;

/* Debug ierakstu glabātuve */
let debugEntries = [];

const ICON_SUCCESS = '<img src="izdevas-veiksmigi.svg" class="icon-inline" alt="">';
const ICON_ERROR = '<img src="kluda.svg" class="icon-inline" alt="">';

/* ================================================== */
/* Tulkojumi                                           */
/* ================================================== */

function t(key) {
    return translations[currentLanguage]?.[key] || translations.lv[key] || key;
}

/* ================================================== */
/* Valodas maiņa                                       */
/* ================================================== */

function switchLanguage(lang) {
    if (!translations[lang]) return;
    currentLanguage = lang;
    localStorage.setItem('permrepo-language', lang);

    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.lang === lang);
    });

    document.querySelectorAll('[data-i18n]').forEach(el => {
        el.textContent = t(el.dataset.i18n);
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        el.placeholder = t(el.dataset.i18nPlaceholder);
    });

    updateWalletUI();

    if (lastStatusKey) {
        if (lastStatusKey === 'restore-complete' || lastStatusKey === 'restore-partial') {
            renderStatusByKey(lastStatusKey);
        } else {
            const statusEl = document.getElementById('status');
            renderLocalizedText(lastStatusKey, statusEl.className, lastStatusWithIcon);
        }
    }

    renderDebug();
}

/* ================================================== */
/* Soļu pārvaldība                                     */
/* ================================================== */

function setStepStatus(stepId, status) {
    const step = document.getElementById(stepId);
    if (step) step.dataset.status = status;
}

/* ================================================== */
/* Debug                                               */
/* ================================================== */

function showDebug(key, value = '') {
    debugEntries.push({ key, value: String(value) });
    renderDebug();
}

function renderDebug() {
    const el = document.getElementById('debugInfo');
    if (!el) return;

    if (debugEntries.length === 0) {
        el.replaceChildren();
        el.style.display = 'none';
        return;
    }

    el.style.display = 'block';
    el.replaceChildren();

    for (const entry of debugEntries) {
        const line = document.createElement('div');
        const label = t(entry.key);
        line.textContent = entry.value ? `${label}: ${entry.value}` : label;
        el.appendChild(line);
    }

    el.scrollTop = el.scrollHeight;
}

function clearDebug() {
    debugEntries = [];
    renderDebug();
}

/* ================================================== */
/* Status                                              */
/* ================================================== */

let lastStatusKey = null;
let lastStatusData = null;
let lastStatusWithIcon = false;

function showStatus(htmlContent, type = 'status') {
    const el = document.getElementById('status');
    el.innerHTML = htmlContent;
    el.className = type;
}

function showStatusText(msg, type = 'status') {
    lastStatusKey = null;
    lastStatusData = null;
    lastStatusWithIcon = false;
    showStatus(String(msg), type);
}

function showStatusWithIcon(msg, type = 'status') {
    const icon = type === 'success' ? ICON_SUCCESS : (type === 'error' ? ICON_ERROR : '');
    lastStatusKey = null;
    lastStatusData = null;
    lastStatusWithIcon = false;
    showStatus(`${icon}${msg}`, type);
}

function showLocalizedText(key, type = 'status', withIcon = false) {
    lastStatusKey = key;
    lastStatusData = null;
    lastStatusWithIcon = withIcon;
    renderLocalizedText(key, type, withIcon);
    const el = document.getElementById('status');
    el.className = type;
}

function renderLocalizedText(key, type, withIcon) {
    const el = document.getElementById('status');
    if (!el) return;
    const icon = withIcon
        ? (type === 'success' ? ICON_SUCCESS : (type === 'error' ? ICON_ERROR : ''))
        : '';
    el.innerHTML = `${icon}${t(key)}`;
}

function showLocalizedStatus(key, data, type = 'status') {
    lastStatusKey = key;
    lastStatusData = data;
    lastStatusWithIcon = false;
    renderStatusByKey(key);
    const el = document.getElementById('status');
    el.className = type;
}

function renderStatusByKey(key) {
    const data = lastStatusData || {};
    const el = document.getElementById('status');
    if (!el) return;

    if (key === 'restore-complete' || key === 'restore-partial') {
        const hasSkipped = key === 'restore-partial';
        const icon = hasSkipped ? ICON_ERROR : ICON_SUCCESS;
        const title = hasSkipped ? t('restore-partial') : t('restore-complete');
        el.innerHTML =
            `<div class="status-icon-row">${icon}</div>` +
            `<div class="status-title">${title}</div>` +
            `<div class="status-line"><span>${t('files-restored')}:</span> <strong>${data.restoredCount ?? 0}</strong></div>` +
            `<div class="status-line"><span>${t('zip-archives')}:</span> <strong>${data.zipCount ?? 0}</strong></div>` +
            `<div class="status-line"><span>${t('failed-archives')}:</span> <strong>${data.failedCount ?? 0}</strong></div>` +
            `<div class="status-line"><span>${t('missing-files')}:</span> <strong>${data.missingCount ?? 0}</strong></div>`;
    }
}

/* ================================================== */
/* Manifests atiestatīšana                             */
/* ================================================== */

function resetManifestState(reason = '') {
    isManifestLoaded = false;
    manifestData = null;
    manifestTxId = null;

    const infoSection = document.getElementById('manifestInfoSection');
    if (infoSection) infoSection.style.display = 'none';

    const masterKeyInput = document.getElementById('masterKeyInput');
    if (masterKeyInput) masterKeyInput.value = '';

    setStepStatus('step2', 'active');
    setStepStatus('step3', 'locked');

    if (reason) showStatusText(reason, 'status');
}

/* ================================================== */
/* Manifests parse                                     */
/* ================================================== */

function parseManifestTxId(input) {
    const value = String(input || '').trim();
    let id = value;

    if (value.startsWith('ar://')) {
        id = value.slice(5);
    } else if (/^https:\/\//i.test(value)) {
        let parsed;
        try { parsed = new URL(value); } catch { throw new Error(t('invalid-tx-id')); }
        const allowedHosts = new Set(['ar-io.dev', 'arweave.net', 'gateway.arweave.net', 'turbo-gateway.com']);
        if (parsed.protocol !== 'https:' || !allowedHosts.has(parsed.hostname.toLowerCase())) {
            throw new Error(t('invalid-tx-id'));
        }
        const match = parsed.pathname.match(/^\/raw\/([^/]+)\/?$/);
        if (!match) throw new Error(t('invalid-tx-id'));
        id = decodeURIComponent(match[1]);
        if (parsed.search || parsed.hash) throw new Error(t('invalid-tx-id'));
    }

    if (!MANIFEST_ID_RE.test(id)) throw new Error(t('invalid-tx-id'));
    return id;
}

/* ================================================== */
/* Maka klausītāji                                     */
/* ================================================== */

function installWalletListeners() {
    if (!window.ethereum || walletListenersInstalled || typeof window.ethereum.on !== 'function') return;
    walletListenersInstalled = true;

    window.ethereum.on('accountsChanged', (accounts) => {
        userAddress = accounts && accounts.length ? accounts[0] : null;
        updateWalletUI();
    });

    window.ethereum.on('chainChanged', () => updateWalletUI());
}

/* ================================================== */
/* Progress                                            */
/* ================================================== */

function showProgress(percent) {
    document.getElementById('progress').style.display = 'block';
    document.getElementById('progressBar').style.width = percent + '%';
}

function hideProgress() {
    document.getElementById('progress').style.display = 'none';
}

/* ================================================== */
/* Arweave fetch                                       */
/* ================================================== */

async function fetchFromArweave(txId, gatewayIndex = 0) {
    if (!MANIFEST_ID_RE.test(String(txId || ''))) throw new Error(t('invalid-tx-id'));
    if (gatewayIndex >= GATEWAYS.length) throw new Error(`${t('fetch-error')}: ${txId}`);

    const gateway = GATEWAYS[gatewayIndex];
    try {
        const response = await fetch(`${gateway}/raw/${encodeURIComponent(txId)}`, {
            method: 'GET',
            credentials: 'omit',
            redirect: 'error'
        });
        if (response.ok) return await response.arrayBuffer();
    } catch (error) {
        /* mēģinām nākamo gateway */
    }

    return fetchFromArweave(txId, gatewayIndex + 1);
}

/* ================================================== */
/* Maka UI                                             */
/* ================================================== */

function updateWalletUI() {
    const btn = document.getElementById('connectWalletBtn');
    const statusEl = document.getElementById('walletStatus');
    if (!btn || !statusEl) return;

    const span = btn.querySelector('span[data-i18n]');
    if (userAddress) {
        statusEl.textContent = `${t('wallet-connected')}: ${userAddress}`;
        btn.dataset.action = 'disconnect';
        if (span) {
            span.dataset.i18n = 'disconnect-wallet';
            span.textContent = t('disconnect-wallet');
        }
        btn.setAttribute('aria-pressed', 'true');

        setStepStatus('step1', 'complete');
        if (!isManifestLoaded) {
            setStepStatus('step2', 'active');
        }
    } else {
        statusEl.textContent = t('wallet-not-connected');
        btn.dataset.action = 'connect';
        if (span) {
            span.dataset.i18n = 'connect-wallet';
            span.textContent = t('connect-wallet');
        }
        btn.setAttribute('aria-pressed', 'false');

        setStepStatus('step1', 'active');
        if (!isManifestLoaded) {
            setStepStatus('step2', 'active');
        }
    }
}

/* ================================================== */
/* Savienot / atvienot maku                            */
/* ================================================== */

async function connectWallet() {
    if (!window.ethereum) {
        showLocalizedText('wallet-install-required', 'error', true);
        return;
    }

    try {
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        userAddress = accounts && accounts.length ? accounts[0] : null;
        installWalletListeners();
        updateWalletUI();
        showLocalizedText('wallet-connected-optional', 'success', true);
    } catch (e) {
        showStatusWithIcon(e.message || t('wallet-connect-failed'), 'error');
    }
}

function disconnectWallet() {
    userAddress = null;
    updateWalletUI();
    showStatusText('', 'status');
}

/* ================================================== */
/* RPC izvēle — vispirms hardkodētie, tad maka RPC      */
/* ================================================== */

async function createProviderWithFallback() {
    let lastError = null;

    for (const rpcUrl of CONFIG.rpcUrls) {
        try {
            const provider = new ethers.JsonRpcProvider(rpcUrl);
            const network = await provider.getNetwork();
            if (Number(network.chainId) === CONFIG.chainId) {
                showDebug('debug-rpc-used', rpcUrl);
                return provider;
            }
            lastError = new Error(t('rpc-wrong-network'));
        } catch (error) {
            lastError = error;
        }
    }

    if (userAddress && window.ethereum) {
        try {
            const browserProvider = new ethers.BrowserProvider(window.ethereum);
            const network = await browserProvider.getNetwork();
            if (Number(network.chainId) === CONFIG.chainId) {
                showDebug('debug-rpc-used', 'wallet');
                return browserProvider;
            }
            lastError = new Error(t('rpc-wrong-network'));
        } catch (error) {
            lastError = error;
        }
    }

    throw new Error(`${t('rpc-unavailable')}${lastError?.message ? `: ${lastError.message}` : ''}`);
}

/* ================================================== */
/* On-chain manifesta izcelsmes pārbaude                */
/* ================================================== */

function validateManifestStructure(manifest) {
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        throw new Error(t('invalid-manifest'));
    }
    if (manifest.manifest !== 'arweave/paths') throw new Error(t('invalid-manifest'));
    if (manifest.version !== '0.2.0') throw new Error(t('invalid-manifest'));
    if (!manifest.paths || typeof manifest.paths !== 'object' || Array.isArray(manifest.paths)) {
        throw new Error(t('invalid-manifest'));
    }
    if (!manifest.metadata || typeof manifest.metadata !== 'object') {
        throw new Error(t('invalid-manifest'));
    }
    const repoId = manifest.metadata.repositoryId;
    if ((typeof repoId !== 'string' && typeof repoId !== 'number') ||
        !/^\d+$/.test(String(repoId)) || BigInt(repoId) <= 0n) {
        throw new Error(t('invalid-manifest'));
    }
    if (manifest.encryption?.algorithm !== 'AES-GCM' ||
        manifest.encryption?.kdf !== 'HKDF-SHA-256' ||
        manifest.encryption?.version !== 1 ||
        typeof manifest.encryption?.keyVerifier !== 'string') {
        throw new Error(t('unsupported-format'));
    }
}


async function verifyManifestOnChain(requestedManifestId, requestedManifest) {
    const provider = await createProviderWithFallback();
    const contract = new ethers.Contract(NFT_CONTRACT_ADDRESS, NFT_ABI, provider);
    const repositoryId = BigInt(String(requestedManifest.metadata.repositoryId));
    const repoHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [repositoryId]));
    const tokenId = await contract.repositoryTokens(repoHash);
    if (tokenId === 0n) throw new Error(t('onchain-repository-not-found'));

    const [latestURI, backupCount] = await Promise.all([
        contract.getManifestURI(tokenId),
        contract.getBackupCount(tokenId)
    ]);
    const latestId = parseManifestTxId(latestURI);
    const latestBuffer = await fetchFromArweave(latestId);
    const latestManifest = JSON.parse(new TextDecoder().decode(latestBuffer));
    validateManifestStructure(latestManifest);
    if (String(latestManifest.metadata.repositoryId) !== String(repositoryId)) {
        throw new Error(t('onchain-repository-mismatch'));
    }

    const inHistory = Array.isArray(latestManifest.history) && latestManifest.history.some(entry =>
        entry && typeof entry.manifestId === 'string' && entry.manifestId === requestedManifestId
    );
    if (requestedManifestId !== latestId && !inHistory) {
        throw new Error(t('onchain-manifest-not-in-history'));
    }
    if (String(requestedManifest.metadata.repositoryId) !== String(latestManifest.metadata.repositoryId)) {
        throw new Error(t('onchain-repository-mismatch'));
    }
    showDebug('debug-onchain-verified', `${latestId} (#${String(backupCount)})`);
    return { latestId, tokenId: String(tokenId), backupCount: String(backupCount) };
}

async function loadManifest() {
    const manifestInput = document.getElementById('manifestInput').value.trim();

    if (!manifestInput) {
        resetManifestState();
        showLocalizedText('enter-manifest', 'error', true);
        return;
    }

    resetManifestState();
    clearDebug();

    let requestedManifestId;
    try {
        requestedManifestId = parseManifestTxId(manifestInput);
    } catch (error) {
        showStatusWithIcon(error.message || t('invalid-tx-id'), 'error');
        return;
    }

    showLocalizedText('download-manifest', 'status', false);
    showProgress(10);

    try {
        const manifestBuffer = await fetchFromArweave(requestedManifestId);
        const manifestText = new TextDecoder().decode(manifestBuffer);
        const parsedManifest = JSON.parse(manifestText);

        validateManifestStructure(parsedManifest);
        await verifyManifestOnChain(requestedManifestId, parsedManifest);

        manifestData = parsedManifest;
        manifestTxId = requestedManifestId;
        isManifestLoaded = true;

        const repoName = parsedManifest.metadata?.repo || '-';
        const repoId = parsedManifest.metadata?.repositoryId || '-';
        const fileCount = Object.keys(parsedManifest.paths).length;

        showDebug('debug-repo', repoName);
        showDebug('debug-repository-id', String(repoId));
        showDebug('debug-manifest', requestedManifestId);

        document.getElementById('manifestRepoName').textContent = String(repoName);
        document.getElementById('manifestRepoId').textContent = String(repoId);
        document.getElementById('manifestFileCount').textContent = String(fileCount);
        document.getElementById('manifestInfoSection').style.display = 'block';

        setStepStatus('step2', 'complete');
        setStepStatus('step3', 'active');

        showProgress(100);
        showLocalizedText('manifest-loaded', 'success', true);
    } catch (e) {
        resetManifestState();
        hideProgress();
        showStatusWithIcon(e.message || String(e), 'error');
    }
}

/* ================================================== */
/* Master Key                                          */
/* ================================================== */

function getMasterKeyFromInput() {
    const input = document.getElementById('masterKeyInput').value.trim();
    if (!input) throw new Error(t('enter-master-key'));
    const keyHex = input.startsWith('0x') || input.startsWith('0X') ? '0x' + input.slice(2) : '0x' + input;
    if (!/^0x[0-9a-fA-F]{64}$/.test(keyHex)) {
        throw new Error('Master Key jābūt 32 baitiem (64 hex simboliem).');
    }
    return keyHex;
}

async function deriveSubkeyBytes(keyHex, purpose) {
    const keyBytes = ethers.getBytes(keyHex);
    if (keyBytes.length !== 32) throw new Error('Master Key jābūt 32 baitiem.');
    const hkdfKey = await crypto.subtle.importKey('raw', keyBytes, 'HKDF', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new TextEncoder().encode('PermRepo HKDF salt v1'),
        info: new TextEncoder().encode(`PermRepo/v1/${purpose}`)
    }, hkdfKey, 256);
    return new Uint8Array(bits);
}

async function importAESKey(keyHex) {
    const keyBytes = await deriveSubkeyBytes(keyHex, 'aes-gcm');
    return await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
}

async function decryptData(encryptedData, iv, keyHex) {
    const cryptoKey = await importAESKey(keyHex);
    const ivBytes = new Uint8Array(iv);
    const dataBytes = new Uint8Array(encryptedData);
    const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: ivBytes }, cryptoKey, dataBytes
    );
    return new Uint8Array(decrypted);
}

async function verifyMasterKey(keyHex, expectedVerifier) {
    if (typeof expectedVerifier !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(expectedVerifier)) {
        throw new Error('Master Key verifikācijas vērtība manifestā nav derīga.');
    }
    const verifierKeyBytes = await deriveSubkeyBytes(keyHex, 'key-verifier');
    const hmacKey = await crypto.subtle.importKey(
        'raw', verifierKeyBytes,
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const message = new TextEncoder().encode('PermRepo Master Key verifier v1');
    const signature = new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, message));
    const actualVerifier = '0x' + Array.from(signature, byte => byte.toString(16).padStart(2, '0')).join('');
    return actualVerifier.toLowerCase() === expectedVerifier.toLowerCase();
}

/* ================================================== */
/* Restore                                             */
/* ================================================== */

async function restoreRepo() {
    if (!isManifestLoaded || !manifestData || !manifestTxId) {
        showLocalizedText('manifest-not-loaded', 'error', true);
        return;
    }

    let masterKey;
    try {
        masterKey = getMasterKeyFromInput();
    } catch (error) {
        showStatusWithIcon(`${t('error')}: ${error.message}`, 'error');
        return;
    }

    const button = document.getElementById('restoreBtn');
    button.disabled = true;
    clearDebug();

    try {
        const manifest = manifestData;
        const pathEntries = Object.entries(manifest.paths);
        if (pathEntries.length === 0) throw new Error(t('invalid-manifest'));

        showDebug('debug-manifest-tx-id', manifestTxId);
        showDebug('debug-paths-count', pathEntries.length);

        const encryptionIVs = manifest.encryption?.ivs && typeof manifest.encryption.ivs === 'object'
            ? manifest.encryption.ivs
            : {};
        const currentArchiveId = manifest.archive?.id || null;
        const zipIds = new Set();
        const fileZipMap = Object.create(null);

        for (const [filePath, info] of pathEntries) {
            if (typeof filePath !== 'string' || !filePath || filePath.startsWith('/') || filePath.startsWith('\\') || /^[a-zA-Z]:/.test(filePath) || filePath.includes('\\') || filePath.split('/').some(part => part === '..' || part === '.') || /[\x00-\x1f]/.test(filePath)) {
                showDebug('debug-invalid-path', filePath);
                continue;
            }
            const zipId = info && (info.zipId || info.id);
            if (typeof zipId !== 'string' || !MANIFEST_ID_RE.test(zipId)) {
                showDebug('debug-invalid-zip-id', filePath);
                continue;
            }
            zipIds.add(zipId);
            fileZipMap[filePath] = zipId;
        }

        if (zipIds.size === 0) throw new Error('Manifestā nav derīgu ZIP arhīvu.');

        showDebug('debug-unique-zips', zipIds.size);
        showLocalizedText('download-zip', 'status', false);
        showProgress(40);

        const zipContents = Object.create(null);
        const failedZipIds = new Set();

        if (manifest.encryption?.algorithm !== 'AES-GCM' ||
            manifest.encryption?.kdf !== 'HKDF-SHA-256' ||
            manifest.encryption?.version !== 1 ||
            typeof manifest.encryption?.keyVerifier !== 'string') {
            throw new Error(t('unsupported-format'));
        }
        showDebug('debug-master-key-verifying');
        const keyIsValid = await verifyMasterKey(masterKey, manifest.encryption.keyVerifier);
        if (!keyIsValid) {
            hideProgress();
            showLocalizedText('master-key-invalid', 'error', true);
            return;
        }
        showDebug('debug-master-key-verified');
        showDebug('debug-decrypting-zip-count', zipIds.size);
        showDebug('debug-aes-gcm-init');

        let zipIndex = 0;
        const ivOwners = new Map();
        for (const zipId of zipIds) {
            try {
                let zipBytes;
                const hasIV = Object.prototype.hasOwnProperty.call(encryptionIVs, zipId);
                if (!hasIV) throw new Error('Manifestā trūkst šī arhīva AES-GCM IV.');
                const iv = encryptionIVs[zipId];
                if (!Array.isArray(iv) || iv.length !== 12 || iv.some(n => !Number.isInteger(n) || n < 0 || n > 255)) {
                    throw new Error('Nederīgs AES-GCM IV šim arhīvam.');
                }
                const ivKey = iv.join(',');
                if (ivOwners.has(ivKey)) throw new Error(`Atkārtots AES-GCM IV (arhīvam ${ivOwners.get(ivKey)}). Drošības dēļ šis arhīvs izlaists.`);
                ivOwners.set(ivKey, zipId);
                showDebug('debug-decrypting-zip', `${zipIndex + 1}/${zipIds.size} — ${zipId}`);
                const downloadedBytes = await fetchFromArweave(zipId);
                try {
                    zipBytes = await decryptData(downloadedBytes, iv, masterKey);
                } catch (error) {
                    throw new Error('AES-GCM autentifikācija neizdevās šim arhīvam.');
                }
                const zip = await JSZip.loadAsync(zipBytes);
                zipContents[zipId] = zip;
                showDebug('debug-zip-opened', zipId);
            } catch (error) {
                failedZipIds.add(zipId);
                showDebug('debug-zip-skipped', `${zipId} — ${error.message || error}`);
            }

            zipIndex++;
            showProgress(40 + (zipIndex / zipIds.size) * 30);
        }

        showDebug('debug-decrypting-done');
        showDebug('debug-decrypting-summary', `${zipIds.size - failedZipIds.size}/${zipIds.size}`);
        if (failedZipIds.size > 0) {
            showDebug('debug-decrypting-failed', failedZipIds.size);
        }

        showLocalizedText('extracting', 'status', false);
        showProgress(70);

        const finalFiles = Object.create(null);
        const missingPaths = [];
        for (const [filePath, zipId] of Object.entries(fileZipMap)) {
            const zip = zipContents[zipId];
            if (!zip) {
                missingPaths.push(filePath);
                continue;
            }

            const zipFile = zip.file(filePath);
            if (!zipFile || zipFile.dir) {
                showDebug('debug-path-not-found', filePath);
                missingPaths.push(filePath);
                continue;
            }

            try {
                finalFiles[filePath] = await zipFile.async('uint8array');
            } catch (error) {
                showDebug('debug-read-failed', `${filePath} — ${error.message || error}`);
                missingPaths.push(filePath);
            }
        }

        const restoredCount = Object.keys(finalFiles).length;
        showDebug('debug-restored-count', restoredCount);
        showDebug('debug-missing-count', missingPaths.length);
        showDebug('debug-failed-zips-count', failedZipIds.size);

        if (restoredCount === 0) {
            hideProgress();
            showLocalizedText('restore-none', 'error', true);
            return;
        }

        showLocalizedText('creating-zip', 'status', false);
        showProgress(85);

        const finalZip = new JSZip();
        for (const [filePath, data] of Object.entries(finalFiles)) {
            finalZip.file(filePath, data);
        }

        const finalBlob = await finalZip.generateAsync({ type: 'blob' });
        showProgress(100);

        const safeRepoName = String(manifest.metadata?.repo || 'repo')
            .replace(/[^a-zA-Z0-9._-]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'repo';
        const url = URL.createObjectURL(finalBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${safeRepoName}-atjaunots.zip`;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        a.remove();

        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);

        hideProgress();
        setStepStatus('step3', 'complete');

        const hasSkippedData = failedZipIds.size > 0 || missingPaths.length > 0;
        const statusKey = hasSkippedData ? 'restore-partial' : 'restore-complete';
        const statusType = hasSkippedData ? 'error' : 'success';

        showLocalizedStatus(statusKey, {
            restoredCount,
            zipCount: zipIds.size,
            failedCount: failedZipIds.size,
            missingCount: missingPaths.length
        }, statusType);

    } catch (e) {
        console.error('Kļūda:', e);
        hideProgress();
        showStatusWithIcon(`${t('error')}: ${e.message || String(e)}`, 'error');
    } finally {
        button.disabled = false;
        const keyInput = document.getElementById('masterKeyInput');
        if (keyInput) keyInput.value = '';
        masterKey = '';
    }
}

/* ================================================== */
/* Event listeners                                     */
/* ================================================== */

document.getElementById('connectWalletBtn').addEventListener('click', () => {
    const btn = document.getElementById('connectWalletBtn');
    if (btn.dataset.action === 'disconnect') {
        disconnectWallet();
    } else {
        connectWallet();
    }
});

document.getElementById('verifyBtn').addEventListener('click', loadManifest);
document.getElementById('restoreBtn').addEventListener('click', restoreRepo);

document.getElementById('manifestInput').addEventListener('input', () => {
    resetManifestState();
    const hasValue = document.getElementById('manifestInput').value.trim().length > 0;
    if (hasValue) setStepStatus('step2', 'active');
});

document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === currentLanguage);
    btn.addEventListener('click', () => switchLanguage(btn.dataset.lang));
});

/* ================================================== */
/* Inicializācija                                      */
/* ================================================== */

document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
});

document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
});

installWalletListeners();
updateWalletUI();
