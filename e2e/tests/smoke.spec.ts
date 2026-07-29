import { expect, test } from '@playwright/test'

test('app boots and talks to the backend', async ({ page, request }) => {
  const health = await request.get('http://localhost:8000/api/health')
  expect(health.ok()).toBeTruthy()
  expect((await health.json()).status).toBe('ok')

  await page.goto('/')
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
  // Works in both data states: with a trained model the dashboard shows
  // the enter-draft-room CTA; without data it shows the not-ready cards —
  // either way the dashboard must render from the live API, not crash.
  await expect(
    page.getByTestId('enter-draft-room').or(page.getByTestId('last-refresh')).first(),
  ).toBeVisible()
})
