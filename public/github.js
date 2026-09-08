/** Validated public release data. Never invent installer URLs or unreleased versions. */
export const GITHUB_REPO = 'omnizs38/mechvibes-cbc';
export const GITHUB_URL = `https://github.com/${GITHUB_REPO}`;
const API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=100`;
const CACHE_KEY = 'mechvibes:releases:v3';
const FRESH_MS = 10 * 60 * 1000;
const STALE_MS = 24 * 60 * 60 * 1000;
let inFlight = null;
export function safeReleaseUrl(value, asset = false) {
    if (typeof value !== 'string' || value.length > 4096)
        return null;
    try {
        const url = new URL(value);
        const prefix = `/${GITHUB_REPO}/releases/${asset ? 'download/' : 'tag/'}`;
        return url.protocol === 'https:' &&
            url.hostname === 'github.com' &&
            !url.port &&
            !url.username &&
            !url.password &&
            url.pathname.startsWith(prefix)
            ? url.href
            : null;
    }
    catch {
        return null;
    }
}
export function normalizeRelease(value) {
    if (!value || typeof value !== 'object')
        return null;
    const r = value;
    const url = safeReleaseUrl(r.html_url);
    if (!url ||
        r.draft !== false ||
        typeof r.prerelease !== 'boolean' ||
        typeof r.tag_name !== 'string' ||
        r.tag_name.length > 128 ||
        typeof r.published_at !== 'string' ||
        !Number.isFinite(Date.parse(r.published_at)))
        return null;
    const assets = [];
    for (const a of Array.isArray(r.assets) ? r.assets.slice(0, 200) : []) {
        if (!a || typeof a !== 'object')
            continue;
        const link = safeReleaseUrl(a.browser_download_url, true);
        if (link && typeof a.name === 'string' && a.name.length <= 512 && Number.isSafeInteger(a.size) && a.size > 0) {
            assets.push({ name: a.name, browser_download_url: link, size: a.size });
        }
    }
    return {
        tag_name: r.tag_name,
        name: typeof r.name === 'string' ? r.name.slice(0, 200) : null,
        published_at: r.published_at,
        body: typeof r.body === 'string' ? r.body.slice(0, 100000) : null,
        html_url: url,
        draft: false,
        prerelease: r.prerelease,
        assets,
    };
}
export function selectReleases(values) {
    if (!Array.isArray(values))
        throw new Error('Unexpected GitHub release response.');
    const releases = values
        .map(normalizeRelease)
        .filter((r) => r !== null)
        .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));
    const preview = releases.find((r) => r.prerelease) ?? null;
    return { latest: releases.find((r) => !r.prerelease) ?? preview, preview };
}
function readCache() {
    try {
        const raw = sessionStorage.getItem(CACHE_KEY);
        if (!raw || raw.length > 300000)
            return null;
        const data = JSON.parse(raw);
        if (!Number.isFinite(data.fetchedAt) || Date.now() < data.fetchedAt || Date.now() - data.fetchedAt > STALE_MS)
            return null;
        const latest = normalizeRelease(data.latest);
        const preview = normalizeRelease(data.preview);
        if ((data.latest !== null && !latest) || (data.preview !== null && !preview))
            return null;
        return { latest, preview, fetchedAt: data.fetchedAt, source: 'cache' };
    }
    catch {
        return null;
    }
}
export function loadProjectData(force = false) {
    if (force)
        inFlight = null;
    if (!inFlight)
        inFlight = fetchProjectData(force).catch((error) => {
            inFlight = null;
            throw error;
        });
    return inFlight;
}
async function fetchProjectData(force) {
    const cache = readCache();
    if (!force && cache && Date.now() - cache.fetchedAt < FRESH_MS)
        return cache;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
        const response = await fetch(API_URL, {
            signal: controller.signal,
            credentials: 'omit',
            headers: { Accept: 'application/vnd.github+json' },
        });
        if (!response.ok)
            throw new Error(`GitHub release request failed (${response.status}).`);
        const data = { ...selectReleases(await response.json()), fetchedAt: Date.now(), source: 'network' };
        try {
            sessionStorage.setItem(CACHE_KEY, JSON.stringify(data));
        }
        catch {
            /* Optional cache. */
        }
        return data;
    }
    catch (error) {
        if (cache)
            return { ...cache, source: 'stale' };
        throw error;
    }
    finally {
        clearTimeout(timer);
    }
}
export function platformFromHints(platform, userAgent, maxTouchPoints = 0) {
    if (/android|iphone|ipad|ipod/i.test(userAgent) || (/mac/i.test(platform) && maxTouchPoints > 1))
        return 'unknown';
    const hint = `${platform} ${userAgent}`.toLowerCase();
    if (/win/.test(hint))
        return 'windows';
    if (/mac|darwin/.test(hint))
        return 'mac';
    if (/linux|x11/.test(hint))
        return 'linux';
    return 'unknown';
}
export function detectPlatform() {
    const nav = navigator;
    return platformFromHints(nav.userAgentData?.platform ?? nav.platform, nav.userAgent, nav.maxTouchPoints);
}
export function pickInstaller(release, platform) {
    const patterns = {
        windows: [/\.exe$/i],
        mac: [/\.dmg$/i, /\.pkg$/i],
        linux: [/\.AppImage$/i, /\.deb$/i, /\.snap$/i],
        unknown: [],
    };
    for (const pattern of patterns[platform]) {
        const match = release?.assets.find((asset) => /^Mechvibes[-_]/i.test(asset.name) &&
            pattern.test(asset.name) &&
            safeReleaseUrl(asset.browser_download_url, true));
        if (match)
            return match;
    }
    return null;
}
export function formatSize(bytes) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
