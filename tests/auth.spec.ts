import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('login page shows branding and Microsoft sign-in', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/login');

    await expect(page.getByRole('heading', { name: 'Agent Dashboard' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in with Microsoft' })).toBeVisible();
    await expect(page.getByText('Welcome back')).toBeVisible();
    await page.screenshot({ path: 'test-results/login-page.png' });

    expect(errors, `Console errors: ${errors.join('\n')}`).toHaveLength(0);
  });

  test('home page shows landing page for unauthenticated users', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Sign in with Microsoft' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Monitor Your AI Agents');
    await page.screenshot({ path: 'test-results/landing-page.png' });
  });
});
