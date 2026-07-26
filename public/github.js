/**
 * Mechvibes-cbc Website - GitHub data layer
 *
 * Every fact the site states about the project is read from here, so nothing
 * has to be kept in sync by hand. One constant identifies the repository;
 * links, versions, release notes and installer URLs are all derived from it.
 */
export const GITHUB_REPO = 'omnizs38/mechvibes-cbc';
export const GITHUB_URL = `https://github.com/${GITHUB_REPO}`;
const API_BASE = `https://api.github.com/repos/${GITHUB_REPO}`;
const CACHE_KEY = `mechvibes:gh:${GITHUB_REPO}`;
const CACHE_TTL_MS = 10 * 60 * 1000;
/** How long a repository can go unpushed before it stops counting as active. */
const ACTIVE_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
/**
 * Shared across every consumer on the page. Without this the hero and the
 * download button each issue their own request, and the button's only starts
 * on click - so the first click waits on a round trip.
 */
let inFlight = null;
export function loadProjectData() {
    if (!inFlight) {
        inFlight = fetchProjectData();
    }
    return inFlight;
}
async function fetchProjectData() {
    const cached = readCache();
    if (cached)
        return cached;
    const [repo, releases] = await Promise.all([
        getJson(API_BASE),
        getJson(`${API_BASE}/releases?per_page=100`),
    ]);
    const published = Array.isArray(releases)
        ? releases.filter((r) => !r.draft)
        : [];
    const data = {
        // The list is newest-first, so the first stable entry is the current
        // release. Falling back to a prerelease keeps the page populated on a
        // repository that has only ever shipped betas.
        latest: published.find((r) => !r.prerelease) ?? published[0] ?? null,
        releaseCount: published.length,
        stars: repo?.stargazers_count ?? 0,
        forks: repo?.forks_count ?? 0,
        license: repo?.license?.spdx_id ?? null,
        pushedAt: repo?.pushed_at ?? null,
    };
    writeCache(data);
    return data;
}
async function getJson(url) {
    const response = await fetch(url, {
        headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) {
        throw new Error(`GitHub API ${response.status} for ${url}`);
    }
    return (await response.json());
}
function readCache() {
    try {
        const raw = sessionStorage.getItem(CACHE_KEY);
        if (!raw)
            return null;
        const envelope = JSON.parse(raw);
        if (Date.now() - envelope.at > CACHE_TTL_MS)
            return null;
        return envelope.data;
    }
    catch {
        // Private browsing, disabled storage, or corrupt JSON: just refetch.
        return null;
    }
}
function writeCache(data) {
    try {
        const envelope = { at: Date.now(), data };
        sessionStorage.setItem(CACHE_KEY, JSON.stringify(envelope));
    }
    catch {
        // Storage is a nicety, never a requirement.
    }
}
/* ===== DERIVED VALUES ===== */
/**
 * The repository is "Active" while it has been pushed to recently. Anything
 * older is honestly labelled rather than left permanently claiming activity.
 */
export function activityStatus(pushedAt) {
    if (!pushedAt)
        return 'Open Source';
    const pushed = new Date(pushedAt).getTime();
    if (Number.isNaN(pushed))
        return 'Open Source';
    return Date.now() - pushed < ACTIVE_WINDOW_MS ? 'Active' : 'Maintenance';
}
/** "today", "3 days ago", "2 months ago" - whichever unit reads best. */
export function relativeDate(iso) {
    if (!iso)
        return '-';
    const then = new Date(iso).getTime();
    if (Number.isNaN(then))
        return '-';
    const seconds = Math.round((then - Date.now()) / 1000);
    const units = [
        ['year', 31536000],
        ['month', 2592000],
        ['week', 604800],
        ['day', 86400],
        ['hour', 3600],
        ['minute', 60],
    ];
    const formatter = new Intl.RelativeTimeFormat('en', {
        numeric: 'auto',
    });
    for (const [unit, size] of units) {
        if (Math.abs(seconds) >= size) {
            return formatter.format(Math.round(seconds / size), unit);
        }
    }
    return formatter.format(0, 'day');
}
export function detectPlatform() {
    const nav = navigator;
    const hint = (nav.userAgentData?.platform ??
        nav.platform ??
        nav.userAgent ??
        '').toLowerCase();
    if (hint.includes('win'))
        return 'windows';
    // "mac" also matches iPadOS, which reports as a Mac; a .dmg is still the
    // closest thing we can offer it.
    if (hint.includes('mac') || hint.includes('darwin'))
        return 'mac';
    if (hint.includes('linux') || hint.includes('x11'))
        return 'linux';
    return 'unknown';
}
/**
 * Pick the installer matching the visitor's OS. Checksums, blockmaps, SBOMs
 * and electron-builder's *.yml metadata are all published alongside the real
 * artifacts, so match on installer extensions only.
 */
export function pickInstaller(release, platform) {
    if (!release?.assets?.length)
        return null;
    const patterns = {
        windows: [/\.exe$/i],
        mac: [/\.dmg$/i, /\.pkg$/i],
        linux: [/\.AppImage$/i, /\.deb$/i, /\.snap$/i],
        unknown: [],
    };
    for (const pattern of patterns[platform]) {
        const match = release.assets.find((asset) => pattern.test(asset.name));
        if (match)
            return match;
    }
    return null;
}
/**
 * Which platforms the release actually ships binaries for. Derived from the
 * published assets rather than asserted, so it cannot drift from the builds.
 */
export function buildPlatforms(release) {
    if (!release?.assets?.length)
        return [];
    const known = [
        ['Windows', /\.exe$/i],
        ['macOS', /\.(dmg|pkg)$/i],
        ['Linux', /\.(AppImage|deb|snap|rpm)$/i],
    ];
    return known
        .filter(([, pattern]) => release.assets.some((asset) => pattern.test(asset.name)))
        .map(([label]) => label);
}
export function platformLabel(platform) {
    switch (platform) {
        case 'windows':
            return 'for Windows';
        case 'mac':
            return 'for macOS';
        case 'linux':
            return 'for Linux';
        default:
            return '';
    }
}
