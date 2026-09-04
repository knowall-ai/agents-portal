import { test, expect } from '@playwright/test';

test.describe('Navigation (unauthenticated)', () => {
  test('landing page links to the GitHub repo', async ({ page }) => {
    await page.goto('/');
    const link = page.getByRole('link', { name: /github.com\/knowall-ai\/agents-portal/ });
    await expect(link).toHaveAttribute('href', 'https://github.com/knowall-ai/agents-portal');
  });

  test('/agents redirects to the home page keeping filters', async ({ page }) => {
    await page.goto('/agents?status=online');
    await expect(page).toHaveURL(/\/\?status=online$/);
  });

  test('has correct page metadata', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Agents Portal/);
    const themeColor = page.locator('meta[name="theme-color"]');
    await expect(themeColor).toHaveAttribute('content', '#0f1117');
  });
});
