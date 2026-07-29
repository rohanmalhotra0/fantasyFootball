/**
 * Research surfaces: the dashboard (model validation + heatmaps) and the
 * backtest lab (hits/busts, position errors, season simulator, CSV export).
 */
import { expect, test } from '@playwright/test'
import { tableRows } from './helpers'

test.describe('dashboard', () => {
  test('validation table, refresh stamp, and heatmaps render', async ({ page }) => {
    await page.goto('/')

    // At least 4 validated seasons in the table.
    const rows = tableRows(page, 'validation-table')
    await expect(page.getByTestId('validation-table')).toBeVisible()
    await expect(rows.nth(3), 'validation-table should have at least 4 year rows').toBeVisible()

    await expect(page.getByTestId('last-refresh')).toBeVisible()

    // Heatmaps are nullable server-side; either the chart or its labeled
    // empty-state renders inside the same testid, so visible + non-empty
    // covers both.
    for (const id of ['vorp-heatmap', 'hit-rate-heatmap']) {
      const heatmap = page.getByTestId(id)
      await expect(heatmap).toBeVisible()
      await expect(heatmap, `${id} should not be blank`).not.toHaveText('')
    }
  })

  test('enter-draft-room navigates to the draft lobby', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('enter-draft-room').click()
    await expect(page).toHaveURL(/\/draft(\/|$)/)
  })
})

test.describe('backtest', () => {
  test('year 2024 shows 10 hits, 10 busts, and position errors', async ({ page }) => {
    await page.goto('/backtest')

    await page.getByTestId('year-select').selectOption('2024')

    await expect(tableRows(page, 'hits-table')).toHaveCount(10)
    await expect(tableRows(page, 'busts-table')).toHaveCount(10)
    await expect(page.getByTestId('position-errors')).toBeVisible()
  })

  test('season simulator reports a league median for slot 5', async ({ page }) => {
    await page.goto('/backtest')
    await page.getByTestId('year-select').selectOption('2024')

    // Slot 5 is the SimulationRequest default; the page exposes no slot input
    // in the testid contract, so the button runs the default slot.
    await page.getByTestId('simulate-button').click()

    const result = page.getByTestId('sim-result')
    await expect(result).toBeVisible({ timeout: 30_000 })
    await expect(result).toContainText(/median/i)
  })

  test('export-hits triggers a CSV download', async ({ page }) => {
    await page.goto('/backtest')
    await page.getByTestId('year-select').selectOption('2024')
    await expect(tableRows(page, 'hits-table')).toHaveCount(10)

    const downloadPromise = page.waitForEvent('download')
    await page.getByTestId('export-hits').click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBeTruthy()
  })
})
