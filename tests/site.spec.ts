import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const base = 'https://github.com/omnizs38/mechvibes-cbc/releases';
const release = {
  name: 'Mechvibes 2.5.3',
  tag_name: 'v2.5.3',
  draft: false,
  prerelease: false,
  html_url: `${base}/tag/v2.5.3`,
  published_at: '2026-08-01T00:00:00Z',
  body: '## Changes\n- A stable published release.',
  assets: ['exe', 'dmg', 'AppImage'].map((extension) => ({
    name: `Mechvibes-2.5.3-x64.${extension}`,
    size: 104857600,
    browser_download_url: `${base}/download/v2.5.3/Mechvibes-2.5.3-x64.${extension}`,
  })),
};

test.beforeEach(async ({ page }) => {
  await page.route('https://api.github.com/**', (route) => route.fulfill({ json: [release] }));
});

test('published downloads, theme and layout are usable', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#releaseStatus')).toContainText('Latest stable release: v2.5.3');
  await expect(page.locator('[data-platform=windows]')).toHaveAttribute('href', /releases\/download\/v2.5.3\/.*\.exe$/);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
  ).toBeTruthy();
  await page.locator('#themeToggle').click();
  await page.locator('#themeToggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('#themeToggle')).toContainText('Dark');
  expect(errors).toEqual([]);
});

test('sound preview is opt-in, scoped and does not transmit typed text', async ({ page }) => {
  const outbound: string[] = [];
  page.on('request', (request) => outbound.push(request.url()));
  await page.goto('/');
  await expect(page.locator('#demoToggle')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#demoToggle').click();
  await expect(page.locator('#demoToggle')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#demoText').fill('private-preview-phrase');
  await page.locator('#demoText').press('A');
  await page.getByRole('button', { name: 'Crisp', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Crisp', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#demoToggle').click();
  await expect(page.locator('#demoToggle')).toHaveAttribute('aria-pressed', 'false');
  expect(outbound.some((url) => url.includes('private-preview-phrase'))).toBeFalsy();
});

test('API failure keeps real fallback links and retry recovers', async ({ page }) => {
  let failures = true;
  await page.route('https://api.github.com/**', (route) =>
    failures ? route.fulfill({ status: 503, body: 'Unavailable' }) : route.fulfill({ json: [release] }),
  );
  await page.goto('/');
  await expect(page.locator('#retryRelease')).toBeVisible();
  await expect(page.locator('[data-platform=windows]')).toHaveAttribute('href', base);
  failures = false;
  await page.locator('#retryRelease').click();
  await expect(page.locator('#releaseStatus')).toContainText('Latest stable release');
});

test('release notes never execute HTML or unsafe links', async ({ page }) => {
  await page.route('https://api.github.com/**', (route) =>
    route.fulfill({
      json: [{ ...release, body: '<img src=x onerror="window.__xss=true">\n[bad](javascript:alert(1))' }],
    }),
  );
  await page.goto('/');
  await expect(page.locator('#releaseName')).toContainText('Mechvibes');
  expect(await page.evaluate(() => (window as unknown as { __xss?: boolean }).__xss)).toBeUndefined();
  expect(await page.locator('#releaseBody img, #releaseBody a[href^="javascript:"]').count()).toBe(0);
});

test('FAQ is keyboard accessible and reduced motion disables smooth scrolling', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const question = page.getByText('Does the demo record what I type?', { exact: true });
  await question.focus();
  await page.keyboard.press('Enter');
  await expect(question.locator('..')).toHaveAttribute('open', '');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe('auto');
});

test('page meets automated WCAG A/AA checks', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#releaseStatus')).toContainText('Latest stable release');
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(results.violations).toEqual([]);
});
