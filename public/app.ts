/**
 * Mechvibes Website - TypeScript 7
 * Modern minimalist design with GitHub releases integration
 */

interface GitHubRelease {
  tag_name: string;
  name: string | null;
  published_at: string;
  body: string | null;
  html_url: string;
}

const GITHUB_REPO: string = 'omnizs38/mechvibes-cbc';
const GITHUB_API_URL: string = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

/**
 * Initialize on page load
 */
document.addEventListener('DOMContentLoaded', (): void => {
  initTheme();
  loadLatestRelease();
  setupDownloadLink();
});

/**
 * Initialize theme from localStorage
 */
function initTheme(): void {
  const themeToggle: HTMLElement | null = document.getElementById('themeToggle');
  const savedTheme: string = localStorage.getItem('theme') || 'light';
  
  if (savedTheme === 'dark') {
    document.body.classList.add('dark-mode');
    updateThemeIcon();
  }
  
  if (themeToggle) {
    themeToggle.addEventListener('click', toggleTheme);
  }
}

/**
 * Toggle between light and dark theme
 */
function toggleTheme(): void {
  const isDarkMode: boolean = document.body.classList.toggle('dark-mode');
  localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
  updateThemeIcon();
}

/**
 * Update theme icon
 */
function updateThemeIcon(): void {
  const icon: HTMLElement | null = document.querySelector('.theme-icon');
  if (!icon) return;
  
  const isDarkMode: boolean = document.body.classList.contains('dark-mode');
  icon.textContent = isDarkMode ? '☀️' : '🌙';
}

/**
 * Load latest release from GitHub API
 */
async function loadLatestRelease(): Promise<void> {
  try {
    const response: Response = await fetch(GITHUB_API_URL, {
      headers: {
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    
    if (!response.ok) {
      throw new Error('Failed to fetch release');
    }
    
    const release: GitHubRelease = await response.json();
    displayRelease(release);
  } catch (error) {
    console.error('Error loading release:', error);
    displayReleaseError();
  }
}

/**
 * Display release information
 */
function displayRelease(release: GitHubRelease): void {
  // Update version in hero
  const versionEl: HTMLElement | null = document.getElementById('latestVersion');
  if (versionEl) {
    versionEl.textContent = release.tag_name;
  }
  
  // Update release card
  const releaseName: HTMLElement | null = document.getElementById('releaseName');
  const releaseDate: HTMLElement | null = document.getElementById('releaseDate');
  const releaseBody: HTMLElement | null = document.getElementById('releaseBody');
  const releaseLink: HTMLAnchorElement | null = document.querySelector('#releaseLink');
  
  if (!releaseName || !releaseDate || !releaseBody || !releaseLink) return;
  
  const date: string = new Date(release.published_at).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  
  let bodyText: string = release.body || 'No description available.';
  if (bodyText.length > 500) {
    bodyText = bodyText.substring(0, 500) + '...';
  }
  
  releaseName.textContent = release.name || release.tag_name;
  releaseDate.textContent = date;
  releaseBody.textContent = bodyText;
  releaseLink.href = release.html_url;
  releaseLink.target = '_blank';
  releaseLink.rel = 'noopener noreferrer';
}

/**
 * Display error message
 */
function displayReleaseError(): void {
  const releaseCard: HTMLElement | null = document.getElementById('release-card');
  if (!releaseCard) return;
  
  releaseCard.innerHTML = `
    <p style="color: var(--color-text-secondary); text-align: center;">
      Could not load release information. 
      <a href="https://github.com/${GITHUB_REPO}/releases" target="_blank" style="color: var(--color-text); font-weight: 600;">
        View on GitHub →
      </a>
    </p>
  `;
}

/**
 * Setup download button to link to latest release
 */
function setupDownloadLink(): void {
  const downloadBtn: HTMLElement | null = document.getElementById('downloadBtn');
  
  if (!downloadBtn) return;
  
  downloadBtn.addEventListener('click', async (e: Event): Promise<void> => {
    e.preventDefault();
    
    try {
      const response: Response = await fetch(GITHUB_API_URL, {
        headers: {
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch release');
      }
      
      const release: GitHubRelease = await response.json();
      window.open(release.html_url, '_blank');
    } catch (error) {
      console.error('Error:', error);
      // Fallback to releases page
      window.open(`https://github.com/${GITHUB_REPO}/releases`, '_blank');
    }
  });
}

/**
 * Smooth scroll for nav links
 */
document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach((link: HTMLAnchorElement): void => {
  link.addEventListener('click', (e: Event): void => {
    const href: string | null = link.getAttribute('href');
    if (href === '#') {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });
});

// Log initialization
console.log('%cMechvibes Website - TypeScript 7', 'color: #000; font-weight: bold; font-size: 14px;');