import { renderMarkdown, truncateMarkdown } from './markdown.js';
import { loadProjectData, detectPlatform, pickInstaller, formatSize, type Release, type Platform } from './github.js';
import { setupDemo } from './demo.js';

type Theme = 'system' | 'light' | 'dark';
function setupTheme() {
  const toggle = document.querySelector<HTMLButtonElement>('#themeToggle');
  if (!toggle) return;
  let mode: Theme = 'system';
  try {
    const saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark') mode = saved;
  } catch {
    /* No storage required. */
  }
  const query = matchMedia('(prefers-color-scheme: dark)');
  const apply = () => {
    document.documentElement.dataset.theme = mode === 'system' ? (query.matches ? 'dark' : 'light') : mode;
    toggle.textContent = `Theme: ${mode[0].toUpperCase()}${mode.slice(1)}`;
    toggle.setAttribute('aria-label', `Color theme: ${mode}. Click to change.`);
  };
  toggle.addEventListener('click', () => {
    mode = mode === 'system' ? 'light' : mode === 'light' ? 'dark' : 'system';
    try {
      localStorage.setItem('theme', mode);
    } catch {
      /* Session-only fallback. */
    }
    apply();
  });
  query.addEventListener('change', apply);
  apply();
}
function renderRelease(release: Release) {
  document.getElementById('releaseName')!.textContent = release.name || release.tag_name;
  const date = document.querySelector<HTMLTimeElement>('#releaseDate')!;
  date.dateTime = release.published_at;
  date.textContent = new Date(release.published_at).toLocaleDateString('en', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  const body = document.getElementById('releaseBody')!;
  const notes = truncateMarkdown(release.body?.trim() || 'Release notes are available on GitHub.', 1100);
  body.replaceChildren(renderMarkdown(notes.text));
  const releaseLink = document.querySelector<HTMLAnchorElement>('#releaseLink')!;
  releaseLink.href = release.html_url;
  for (const button of document.querySelectorAll<HTMLAnchorElement>('[data-platform]')) {
    const asset = pickInstaller(release, button.dataset.platform as Platform);
    button.href = asset?.browser_download_url ?? release.html_url;
    button.querySelector('.asset-note')!.textContent = asset
      ? `${release.tag_name} · ${/arm64/i.test(asset.name) ? 'ARM64 · ' : /x64/i.test(asset.name) ? 'x64 · ' : ''}${formatSize(asset.size)}`
      : 'No matching installer · view release';
  }
  const download = document.querySelector<HTMLAnchorElement>('#downloadBtn')!;
  const platform = detectPlatform();
  const asset = pickInstaller(release, platform);
  download.href = asset?.browser_download_url ?? '#download';
  const names = { windows: 'Windows', mac: 'macOS', linux: 'Linux', unknown: '' };
  download.querySelector('.btn-label')!.textContent = asset ? `Get it for ${names[platform]}` : 'Choose your download';
  document.querySelector('.btn-note')!.textContent =
    `${release.tag_name}${release.prerelease ? ' · prerelease' : ' · stable'}`;
}
async function hydrate(force = false) {
  const status = document.getElementById('releaseStatus')!;
  const retry = document.querySelector<HTMLButtonElement>('#retryRelease')!;
  retry.disabled = true;
  status.textContent = 'Fetching published release information…';
  try {
    const data = await loadProjectData(force);
    if (data.latest) {
      renderRelease(data.latest);
      status.textContent = `${data.latest.prerelease ? 'Published prerelease' : 'Latest stable release'}: ${data.latest.tag_name}.${data.source === 'stale' ? ' Showing saved information; check GitHub for newer releases.' : ''}`;
    } else {
      status.textContent = 'No published releases yet. Follow development on GitHub.';
    }
    retry.hidden = data.source !== 'stale';
  } catch {
    status.textContent = 'GitHub is unavailable or rate-limited. The download cards still open the releases page.';
    document.getElementById('releaseName')!.textContent = 'Release information unavailable';
    retry.hidden = false;
  } finally {
    retry.disabled = false;
  }
}
setupTheme();
setupDemo();
document.getElementById('year')!.textContent = String(new Date().getFullYear());
document.getElementById('retryRelease')!.addEventListener('click', () => {
  void hydrate(true);
});
void hydrate();
