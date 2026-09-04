import { test, expect } from '@playwright/test';

test.describe('API routes', () => {
  test('auth providers endpoint exposes azure-ad', async ({ request }) => {
    const response = await request.get('/api/auth/providers');
    expect(response.ok()).toBeTruthy();
    expect(await response.json()).toHaveProperty('azure-ad');
  });

  test('health endpoint is public', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.status).toBe('ok');
    expect(body).toHaveProperty('version');
  });

  for (const path of [
    '/api/agents',
    '/api/agents/sallie',
    '/api/agents/sallie/skills',
    '/api/agents/sallie/soul',
    '/api/agents/sallie/licenses',
    '/api/agents/sallie/permissions',
    '/api/agents/sallie/boost',
    '/api/agents/sallie/brain',
    '/api/agents/sallie/brain/events',
    '/api/agents/sallie/activity',
    '/api/agents/sallie/costs',
    '/api/costs',
    '/api/activity',
    '/api/tenants',
    '/api/me/photo',
  ]) {
    test(`${path} requires authentication`, async ({ request }) => {
      const response = await request.get(path);
      expect(response.status()).toBe(401);
    });
  }

  test('boost POST requires authentication', async ({ request }) => {
    const response = await request.post('/api/agents/sallie/boost', { data: { action: 'on' } });
    expect(response.status()).toBe(401);
  });

  test('tenant select validates the tenant id', async ({ request }) => {
    const bad = await request.post('/api/tenants/select', { data: { tenantId: 'not-a-guid' } });
    expect(bad.status()).toBe(400);

    const ok = await request.post('/api/tenants/select', {
      data: { tenantId: '00000000-0000-0000-0000-000000000000' },
    });
    expect(ok.ok()).toBeTruthy();
    expect(ok.headers()['set-cookie']).toContain('agents-portal-tenant=');
  });
});
