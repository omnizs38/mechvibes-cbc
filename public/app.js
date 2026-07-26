/**
 * Mechvibes Website
 *
 * The page ships with static fallback values in the markup and upgrades them
 * once the GitHub API responds, so it stays correct and readable without JS,
 * offline, or when the API rate-limits us.
 */
import { GITHUB_URL, activityStatus, buildPlatforms, detectPlatform, loadProjectData, pickInstaller, platformLabel, relativeDate, } from './github.js';
/** Longest release body we render inline before linking out to GitHub. */
const RELEASE_BODY_LIMIT = 500;
document.addEventListener('DOMContentLoaded', () => {
    setupTheme();
    setupRepoLinks();
    setupFooterYear();
    void hydrate();
});
/* ===== THEME =====
   The class itself is set by an inline script in <head> so the first paint is
   already correct; this only wires up the toggle. */
function setupTheme() {
    const toggle = document.getElementById('themeToggle');
    if (!toggle)
        return;
    const root = document.documentElement;
    toggle.setAttribute('aria-pressed', String(root.classList.contains('dark-mode')));
    toggle.addEventListener('click', () => {
        const isDark = root.classList.toggle('dark-mode');
        try {
            localStorage.setItem('theme', isDark ? 'dark' : 'light');
        }
        catch {
            // Private browsing: the toggle still works for this session.
        }
        toggle.setAttribute('aria-pressed', String(isDark));
    });
}
/* ===== STATIC DERIVATIONS ===== */
/**
 * Point every GitHub link at the repository named in github.ts, so the slug
 * lives in exactly one place instead of being repeated across the markup.
 */
function setupRepoLinks() {
    const paths = {
        repo: '',
        issues: '/issues',
        releases: '/releases',
        readme: '#readme',
        license: '/blob/main/LICENSE',
    };
    document
        .querySelectorAll('[data-gh-link]')
        .forEach((link) => {
        const key = link.dataset.ghLink ?? '';
        if (key in paths) {
            link.href = `${GITHUB_URL}${paths[key]}`;
        }
    });
}
function setupFooterYear() {
    setSlot('year', String(new Date().getFullYear()));
}
/* ===== LIVE DATA ===== */
async function hydrate() {
    let data;
    try {
        data = await loadProjectData();
    }
    catch (error) {
        console.error('Could not load project data from GitHub:', error);
        showReleaseFallback();
        return;
    }
    const { latest } = data;
    setSlot('version', latest?.tag_name ?? null);
    setSlot('license', data.license);
    setSlot('status', activityStatus(data.pushedAt));
    setSlot('release-count', data.releaseCount ? String(data.releaseCount) : null);
    setSlot('updated', latest ? relativeDate(latest.published_at) : null);
    const platforms = buildPlatforms(latest);
    setSlot('platforms', platforms.length ? platforms.join(' · ') : null);
    if (latest) {
        renderRelease(latest);
        setupDownload(latest);
    }
    else {
        showReleaseFallback();
    }
}
/**
 * Fill a `data-gh` slot and drop its loading state. A null value leaves the
 * markup's fallback text untouched.
 */
function setSlot(name, value) {
    document
        .querySelectorAll(`[data-gh="${name}"]`)
        .forEach((el) => {
        if (value)
            el.textContent = value;
        el.classList.remove('is-loading');
    });
}
function renderRelease(release) {
    const name = document.getElementById('releaseName');
    const date = document.getElementById('releaseDate');
    const body = document.getElementById('releaseBody');
    const link = document.querySelector('#releaseLink');
    if (!name || !date || !body || !link)
        return;
    name.textContent = release.name || release.tag_name;
    name.classList.remove('is-loading');
    const published = new Date(release.published_at);
    date.textContent = published.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
    date.setAttribute('datetime', release.published_at);
    let text = release.body?.trim() || 'No description available.';
    if (text.length > RELEASE_BODY_LIMIT) {
        text = `${text.slice(0, RELEASE_BODY_LIMIT).trimEnd()}...`;
    }
    // textContent, never innerHTML: the body is authored by whoever can publish
    // a release and is not trusted markup.
    body.textContent = text;
    link.href = release.html_url;
    link.rel = 'noopener noreferrer';
    document.getElementById('release-card')?.classList.remove('is-loading');
}
function showReleaseFallback() {
    const name = document.getElementById('releaseName');
    const body = document.getElementById('releaseBody');
    if (name) {
        name.textContent = 'Release information unavailable';
        name.classList.remove('is-loading');
    }
    if (body) {
        body.textContent =
            'Could not reach the GitHub API. Use the link above to see the latest release.';
    }
    document.getElementById('release-card')?.classList.remove('is-loading');
    document
        .querySelectorAll('[data-gh]')
        .forEach((el) => el.classList.remove('is-loading'));
}
/**
 * Send visitors straight to the installer for their OS. The button is a real
 * link with a release-page fallback in the markup, so it works before this
 * runs and when no matching asset exists.
 */
function setupDownload(release) {
    const button = document.querySelector('#downloadBtn');
    if (!button)
        return;
    const platform = detectPlatform();
    const asset = pickInstaller(release, platform);
    button.href = asset ? asset.browser_download_url : release.html_url;
    const label = button.querySelector('.btn-label');
    const note = button.querySelector('.btn-note');
    if (label) {
        label.textContent = asset
            ? `Download ${platformLabel(platform)}`.trim()
            : 'View latest release';
    }
    if (note) {
        note.textContent = asset
            ? `${release.tag_name} · ${formatSize(asset.size)}`
            : release.tag_name;
    }
}
function formatSize(bytes) {
    return `${Math.round(bytes / 1024 / 1024)} MB`;
}
/* ===== NAVIGATION ===== */
document
    .querySelectorAll('a[href="#"]')
    .forEach((link) => {
    link.addEventListener('click', (event) => {
        event.preventDefault();
        window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    });
});
function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
