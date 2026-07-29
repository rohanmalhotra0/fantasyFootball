import { expect, test } from '@playwright/test'

test('app boots and talks to the backend', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
  await expect(page.getByTestId('health-status')).toHaveText('connected')
})
