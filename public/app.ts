/**
 * Mechvibes Website - TypeScript 7
 * Minimalist SPA with navigation, theme toggle, and GitHub releases integration
 */

// Types
interface GitHubRelease {
    id: number;
    tag_name: string;
    name: string;
    published_at: string;
    body: string;
    html_url: string;
}

interface ReleaseElement {
    element: HTMLDivElement;
    title: string;
    date: string;
    body: string;
    url: string;
}

// Configuration
const GITHUB_REPO = 'omnizs38/mechvibes-cbc';
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases`;

// DOM Elements
const themeToggleBtn = document.getElementById('themeToggle') as HTMLButtonElement;
const navLinks = document.querySelectorAll<HTMLAnchorElement>('.nav-link');
const navMenu = document.getElementById('navMenu') as HTMLElement;
const releasesList = document.getElementById('releases-list') as HTMLElement;

// State
let currentTheme: 'light' | 'dark' = 'light';

/**
 * Initialize the application
 */
function init(): void {
    initTheme();
    setupEventListeners();
    loadReleases();
    observeSections();
}

/**
 * Initialize theme from localStorage or system preference
 */
function initTheme(): void {
    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
    
    if (savedTheme) {
        currentTheme = savedTheme;
    } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        currentTheme = 'dark';
    }
    
    applyTheme(currentTheme);
}

/**
 * Apply theme to document
 */
function applyTheme(theme: 'light' | 'dark'): void {
    currentTheme = theme;
    const isDark = theme === 'dark';
    
    if (isDark) {
        document.body.classList.add('dark-mode');
    } else {
        document.body.classList.remove('dark-mode');
    }
    
    updateThemeIcon();
    localStorage.setItem('theme', theme);
}

/**
 * Update theme toggle button icon
 */
function updateThemeIcon(): void {
    const icon = themeToggleBtn.querySelector('.theme-icon') as HTMLElement;
    if (icon) {
        icon.textContent = currentTheme === 'dark' ? '☀️' : '🌙';
    }
}

/**
 * Setup event listeners
 */
function setupEventListeners(): void {
    // Theme toggle
    themeToggleBtn.addEventListener('click', toggleTheme);
    
    // Navigation links
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const target = link.getAttribute('data-section');
            if (target) {
                navigateToSection(target);
            }
        });
    });
    
    // Update active nav link on scroll
    window.addEventListener('scroll', updateActiveNavLink);
}

/**
 * Toggle between light and dark theme
 */
function toggleTheme(): void {
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    applyTheme(newTheme);
}

/**
 * Navigate to section
 */
function navigateToSection(sectionId: string): void {
    const section = document.getElementById(sectionId) as HTMLElement;
    if (section) {
        section.scrollIntoView({ behavior: 'smooth' });
        updateActiveNavLink();
    }
}

/**
 * Update active navigation link based on scroll position
 */
function updateActiveNavLink(): void {
    const sections = document.querySelectorAll<HTMLElement>('.section');
    let currentSection = '';
    
    sections.forEach(section => {
        const rect = section.getBoundingClientRect();
        if (rect.top <= 100) {
            currentSection = section.id;
        }
    });
    
    navLinks.forEach(link => {
        const target = link.getAttribute('data-section');
        if (target === currentSection) {
            link.classList.add('active');
        } else {
            link.classList.remove('active');
        }
    });
}

/**
 * Observe sections for intersection (lazy loading animations)
 */
function observeSections(): void {
    const observerOptions: IntersectionObserverInit = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
            }
        });
    }, observerOptions);
    
    document.querySelectorAll<HTMLElement>('.section').forEach(section => {
        observer.observe(section);
    });
}

/**
 * Load releases from GitHub API
 */
async function loadReleases(): Promise<void> {
    try {
        const response = await fetch(GITHUB_API_URL, {
            headers: {
                'Accept': 'application/vnd.github.v3+json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`GitHub API error: ${response.status}`);
        }
        
        const releases: GitHubRelease[] = await response.json();
        
        if (releases.length === 0) {
            displayNoReleases();
            return;
        }
        
        // Display latest 5 releases
        const latestReleases = releases.slice(0, 5);
        displayReleases(latestReleases);
    } catch (error) {
        console.error('Failed to load releases:', error);
        displayReleasesError();
    }
}

/**
 * Display releases in the DOM
 */
function displayReleases(releases: GitHubRelease[]): void {
    releasesList.innerHTML = '';
    
    releases.forEach((release, index) => {
        const element = createReleaseElement(release, index);
        releasesList.appendChild(element);
    });
}

/**
 * Create a release element
 */
function createReleaseElement(release: GitHubRelease, index: number): HTMLDivElement {
    const div = document.createElement('div');
    div.className = 'release-item';
    div.style.animationDelay = `${index * 0.1}s`;
    
    const dateStr = new Date(release.published_at).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
    
    const isLatest = index === 0;
    const tagHTML = isLatest ? '<span class="release-tag">Latest</span>' : '';
    
    // Truncate body if too long
    let bodyText = release.body || 'No description provided.';
    if (bodyText.length > 300) {
        bodyText = bodyText.substring(0, 300) + '...';
    }
    
    div.innerHTML = `
        <div class="release-header">
            <div>
                <div class="release-title">${escapeHtml(release.name || release.tag_name)}</div>
                <div class="release-date">${dateStr}</div>
            </div>
            ${tagHTML}
        </div>
        <div class="release-body">${escapeHtml(bodyText).replace(/\n/g, '<br>')}</div>
        <a href="${release.html_url}" target="_blank" rel="noopener noreferrer" class="release-link">
            View Release →
        </a>
    `;
    
    return div;
}

/**
 * Display no releases message
 */
function displayNoReleases(): void {
    releasesList.innerHTML = '<div class="loading">No releases found.</div>';
}

/**
 * Display error message
 */
function displayReleasesError(): void {
    releasesList.innerHTML = `
        <div class="loading">
            Failed to load releases. 
            <a href="https://github.com/${GITHUB_REPO}/releases" target="_blank" rel="noopener noreferrer">
                View on GitHub →
            </a>
        </div>
    `;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Handle keyboard navigation
 */
function setupKeyboardNavigation(): void {
    document.addEventListener('keydown', (e) => {
        // Prevent keyboard nav on inputs
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
            return;
        }
        
        // Alt + number for quick nav
        if (e.altKey) {
            const sections = ['home', 'features', 'about', 'releases', 'docs', 'faq'];
            const num = parseInt(e.key);
            
            if (num >= 1 && num <= sections.length) {
                navigateToSection(sections[num - 1]);
                e.preventDefault();
            }
        }
    });
}

/**
 * Setup focus management for accessibility
 */
function setupAccessibility(): void {
    // Close mobile menu on link click
    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            // Menu management would go here for mobile
        });
    });
    
    // Skip to main content link (for screen readers)
    const skipLink = document.createElement('a');
    skipLink.href = '#main-content';
    skipLink.className = 'skip-link';
    skipLink.textContent = 'Skip to main content';
    document.body.insertBefore(skipLink, document.body.firstChild);
}

/**
 * Add skip link styles
 */
function addAccessibilityStyles(): void {
    const style = document.createElement('style');
    style.textContent = `
        .skip-link {
            position: absolute;
            top: -40px;
            left: 0;
            background: #000;
            color: white;
            padding: 8px;
            text-decoration: none;
            z-index: 100;
        }
        
        .skip-link:focus {
            top: 0;
        }
    `;
    document.head.appendChild(style);
}

/**
 * Initialize analytics (if needed)
 */
function initAnalytics(): void {
    // Track page views
    if (window.location.hostname !== 'localhost') {
        console.log('Analytics would be initialized here');
    }
}

// Start the application when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        init();
        setupKeyboardNavigation();
        setupAccessibility();
        addAccessibilityStyles();
        initAnalytics();
    });
} else {
    init();
    setupKeyboardNavigation();
    setupAccessibility();
    addAccessibilityStyles();
    initAnalytics();
}

// Expose version for debugging
console.log('%cMechvibes Website v1.0.0', 'color: #000; font-weight: bold; font-size: 14px;');
