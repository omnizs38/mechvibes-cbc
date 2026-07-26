/**
 * Mechvibes-cbc Website
 *
 * The page ships with static fallback values in the markup and upgrades them
 * once the GitHub API responds, so it stays correct and readable without JS,
 * offline, or when the API rate-limits us.
 */

import { renderMarkdown, truncateMarkdown, type Truncated } from './markdown.js';
import {
  GITHUB_URL,
  activityStatus,
  buildPlatforms,
  detectPlatform,
  loadProjectData,
  pickInstaller,
  platformLabel,
  relativeDate,
  type Platform,
  type ProjectData,
  type Release,
  type ReleaseAsset,
} from './github.js';

/**
 * Longest release body we render inline before linking out to GitHub. Real
 * release notes are a heading plus a handful of bullets; this fits that
 * without letting a changelog-sized body take over the page.
 */
const RELEASE_BODY_LIMIT: number = 1400;

document.addEventListener('DOMContentLoaded', (): void => {
  setupTheme();
  setupRepoLinks();
  setupFooterYear();
  void hydrate();
});

/* ===== THEME =====
   The class itself is set by an inline script in <head> so the first paint is
   already correct; this only wires up the toggle. */

function setupTheme(): void {
  const toggle: HTMLElement | null = document.getElementById('themeToggle');
  if (!toggle) return;

  const root: HTMLElement = document.documentElement;
  toggle.setAttribute('aria-pressed', String(root.classList.contains('dark-mode')));

  toggle.addEventListener('click', (): void => {
    const isDark: boolean = root.classList.toggle('dark-mode');
    try {
      localStorage.setItem('theme', isDark ? 'dark' : 'light');
    } catch {
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
function setupRepoLinks(): void {
  const paths: Record<string, string> = {
    repo: '',
    issues: '/issues',
    releases: '/releases',
    readme: '#readme',
    license: '/blob/main/LICENSE',
  };

  document
    .querySelectorAll<HTMLAnchorElement>('[data-gh-link]')
    .forEach((link: HTMLAnchorElement): void => {
      const key: string = link.dataset.ghLink ?? '';
      if (key in paths) {
        link.href = `${GITHUB_URL}${paths[key]}`;
      }
    });
}

function setupFooterYear(): void {
  setSlot('year', String(new Date().getFullYear()));
}

/* ===== LIVE DATA ===== */

async function hydrate(): Promise<void> {
  let data: ProjectData;

  try {
    data = await loadProjectData();
  } catch (error) {
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

  const platforms: string[] = buildPlatforms(latest);
  setSlot('platforms', platforms.length ? platforms.join(' · ') : null);

  if (latest) {
    renderRelease(latest);
    setupDownload(latest);
  } else {
    showReleaseFallback();
  }
}

/**
 * Fill a `data-gh` slot and drop its loading state. A null value leaves the
 * markup's fallback text untouched.
 */
function setSlot(name: string, value: string | null): void {
  document
    .querySelectorAll<HTMLElement>(`[data-gh="${name}"]`)
    .forEach((el: HTMLElement): void => {
      if (value) el.textContent = value;
      el.classList.remove('is-loading');
    });
}

function renderRelease(release: Release): void {
  const name: HTMLElement | null = document.getElementById('releaseName');
  const date: HTMLElement | null = document.getElementById('releaseDate');
  const body: HTMLElement | null = document.getElementById('releaseBody');
  const link: HTMLAnchorElement | null =
    document.querySelector<HTMLAnchorElement>('#releaseLink');

  if (!name || !date || !body || !link) return;

  name.textContent = release.name || release.tag_name;
  name.classList.remove('is-loading');

  const published: Date = new Date(release.published_at);
  date.textContent = published.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  date.setAttribute('datetime', release.published_at);

  renderReleaseBody(body, release.body?.trim() ?? '');

  link.href = release.html_url;
  link.rel = 'noopener noreferrer';

  document.getElementById('release-card')?.classList.remove('is-loading');
}

/**
 * Release notes are Markdown, so render them as such - but the body is
 * authored by whoever can publish a release and is not trusted. renderMarkdown
 * builds DOM nodes and never parses an HTML string, so nothing in the body can
 * become markup; see markdown.ts.
 */
function renderReleaseBody(body: HTMLElement, source: string): void {
  body.replaceChildren();

  if (!source) {
    body.textContent = 'No description available.';
    return;
  }

  const { text, truncated }: Truncated = truncateMarkdown(source, RELEASE_BODY_LIMIT);
  body.appendChild(renderMarkdown(text));

  if (truncated) {
    const note: HTMLParagraphElement = document.createElement('p');
    note.className = 'release-truncated';
    note.textContent = 'Notes truncated - open the release on GitHub to read the rest.';
    body.appendChild(note);
  }
}

function showReleaseFallback(): void {
  const name: HTMLElement | null = document.getElementById('releaseName');
  const body: HTMLElement | null = document.getElementById('releaseBody');

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
    .querySelectorAll<HTMLElement>('[data-gh]')
    .forEach((el: HTMLElement): void => el.classList.remove('is-loading'));
}

/**
 * Send visitors straight to the installer for their OS. The button is a real
 * link with a release-page fallback in the markup, so it works before this
 * runs and when no matching asset exists.
 */
function setupDownload(release: Release): void {
  const button: HTMLAnchorElement | null =
    document.querySelector<HTMLAnchorElement>('#downloadBtn');
  if (!button) return;

  const platform: Platform = detectPlatform();
  const asset: ReleaseAsset | null = pickInstaller(release, platform);

  button.href = asset ? asset.browser_download_url : release.html_url;

  const label: HTMLElement | null = button.querySelector('.btn-label');
  const note: HTMLElement | null = button.querySelector('.btn-note');

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

function formatSize(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

/* ===== NAVIGATION ===== */

document
  .querySelectorAll<HTMLAnchorElement>('a[href="#"]')
  .forEach((link: HTMLAnchorElement): void => {
    link.addEventListener('click', (event: Event): void => {
      event.preventDefault();
      window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    });
  });

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
