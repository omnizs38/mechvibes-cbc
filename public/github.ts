/**
 * Mechvibes Website - GitHub data layer
 *
 * Every fact the site states about the project is read from here, so nothing
 * has to be kept in sync by hand. One constant identifies the repository;
 * links, versions, release notes and installer URLs are all derived from it.
 */

export const GITHUB_REPO: string = 'omnizs38/mechvibes-cbc';
export const GITHUB_URL: string = `https://github.com/${GITHUB_REPO}`;

const API_BASE: string = `https://api.github.com/repos/${GITHUB_REPO}`;
const CACHE_KEY: string = `mechvibes:gh:${GITHUB_REPO}`;
const CACHE_TTL_MS: number = 10 * 60 * 1000;

/** How long a repository can go unpushed before it stops counting as active. */
const ACTIVE_WINDOW_MS: number = 90 * 24 * 60 * 60 * 1000;

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

export interface Release {
  tag_name: string;
  name: string | null;
  published_at: string;
  body: string | null;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  assets: ReleaseAsset[];
}

interface RepoResponse {
  stargazers_count: number;
  forks_count: number;
  pushed_at: string;
  html_url: string;
  license: { spdx_id: string | null } | null;
}

/** Everything the page needs, flattened out of the two API responses. */
export interface ProjectData {
  latest: Release | null;
  releaseCount: number;
  stars: number;
  forks: number;
  license: string | null;
  pushedAt: string | null;
}

export type Platform = 'windows' | 'mac' | 'linux' | 'unknown';

/**
 * Shared across every consumer on the page. Without this the hero and the
 * download button each issue their own request, and the button's only starts
 * on click - so the first click waits on a round trip.
 */
let inFlight: Promise<ProjectData> | null = null;

export function loadProjectData(): Promise<ProjectData> {
  if (!inFlight) {
    inFlight = fetchProjectData();
  }
  return inFlight;
}

async function fetchProjectData(): Promise<ProjectData> {
  const cached: ProjectData | null = readCache();
  if (cached) return cached;

  const [repo, releases] = await Promise.all([
    getJson<RepoResponse>(API_BASE),
    getJson<Release[]>(`${API_BASE}/releases?per_page=100`),
  ]);

  const published: Release[] = Array.isArray(releases)
    ? releases.filter((r: Release): boolean => !r.draft)
    : [];

  const data: ProjectData = {
    // The list is newest-first, so the first stable entry is the current
    // release. Falling back to a prerelease keeps the page populated on a
    // repository that has only ever shipped betas.
    latest:
      published.find((r: Release): boolean => !r.prerelease) ?? published[0] ?? null,
    releaseCount: published.length,
    stars: repo?.stargazers_count ?? 0,
    forks: repo?.forks_count ?? 0,
    license: repo?.license?.spdx_id ?? null,
    pushedAt: repo?.pushed_at ?? null,
  };

  writeCache(data);
  return data;
}

async function getJson<T>(url: string): Promise<T> {
  const response: Response = await fetch(url, {
    headers: { Accept: 'application/vnd.github+json' },
  });

  if (!response.ok) {
    throw new Error(`GitHub API ${response.status} for ${url}`);
  }

  return (await response.json()) as T;
}

/* ===== CACHE =====
   Unauthenticated GitHub allows 60 requests/hour/IP, which a handful of
   reloads will exhaust. sessionStorage keeps repeat views instant and well
   inside the limit. */

interface CacheEnvelope {
  at: number;
  data: ProjectData;
}

function readCache(): ProjectData | null {
  try {
    const raw: string | null = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;

    const envelope: CacheEnvelope = JSON.parse(raw) as CacheEnvelope;
    if (Date.now() - envelope.at > CACHE_TTL_MS) return null;

    return envelope.data;
  } catch {
    // Private browsing, disabled storage, or corrupt JSON: just refetch.
    return null;
  }
}

function writeCache(data: ProjectData): void {
  try {
    const envelope: CacheEnvelope = { at: Date.now(), data };
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(envelope));
  } catch {
    // Storage is a nicety, never a requirement.
  }
}

/* ===== DERIVED VALUES ===== */

/**
 * The repository is "Active" while it has been pushed to recently. Anything
 * older is honestly labelled rather than left permanently claiming activity.
 */
export function activityStatus(pushedAt: string | null): string {
  if (!pushedAt) return 'Open Source';

  const pushed: number = new Date(pushedAt).getTime();
  if (Number.isNaN(pushed)) return 'Open Source';

  return Date.now() - pushed < ACTIVE_WINDOW_MS ? 'Active' : 'Maintenance';
}

/** "today", "3 days ago", "2 months ago" - whichever unit reads best. */
export function relativeDate(iso: string | null): string {
  if (!iso) return '-';

  const then: number = new Date(iso).getTime();
  if (Number.isNaN(then)) return '-';

  const seconds: number = Math.round((then - Date.now()) / 1000);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];

  const formatter: Intl.RelativeTimeFormat = new Intl.RelativeTimeFormat('en', {
    numeric: 'auto',
  });

  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) {
      return formatter.format(Math.round(seconds / size), unit);
    }
  }

  return formatter.format(0, 'day');
}

/* ===== DOWNLOADS ===== */

interface UserAgentData {
  platform?: string;
}

export function detectPlatform(): Platform {
  const nav: Navigator & { userAgentData?: UserAgentData } = navigator;
  const hint: string = (
    nav.userAgentData?.platform ??
    nav.platform ??
    nav.userAgent ??
    ''
  ).toLowerCase();

  if (hint.includes('win')) return 'windows';
  // "mac" also matches iPadOS, which reports as a Mac; a .dmg is still the
  // closest thing we can offer it.
  if (hint.includes('mac') || hint.includes('darwin')) return 'mac';
  if (hint.includes('linux') || hint.includes('x11')) return 'linux';

  return 'unknown';
}

/**
 * Pick the installer matching the visitor's OS. Checksums, blockmaps, SBOMs
 * and electron-builder's *.yml metadata are all published alongside the real
 * artifacts, so match on installer extensions only.
 */
export function pickInstaller(
  release: Release | null,
  platform: Platform,
): ReleaseAsset | null {
  if (!release?.assets?.length) return null;

  const patterns: Record<Platform, RegExp[]> = {
    windows: [/\.exe$/i],
    mac: [/\.dmg$/i, /\.pkg$/i],
    linux: [/\.AppImage$/i, /\.deb$/i, /\.snap$/i],
    unknown: [],
  };

  for (const pattern of patterns[platform]) {
    const match: ReleaseAsset | undefined = release.assets.find(
      (asset: ReleaseAsset): boolean => pattern.test(asset.name),
    );
    if (match) return match;
  }

  return null;
}

/**
 * Which platforms the release actually ships binaries for. Derived from the
 * published assets rather than asserted, so it cannot drift from the builds.
 */
export function buildPlatforms(release: Release | null): string[] {
  if (!release?.assets?.length) return [];

  const known: Array<[string, RegExp]> = [
    ['Windows', /\.exe$/i],
    ['macOS', /\.(dmg|pkg)$/i],
    ['Linux', /\.(AppImage|deb|snap|rpm)$/i],
  ];

  return known
    .filter(([, pattern]: [string, RegExp]): boolean =>
      release.assets.some((asset: ReleaseAsset): boolean => pattern.test(asset.name)),
    )
    .map(([label]: [string, RegExp]): string => label);
}

export function platformLabel(platform: Platform): string {
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
