/**
 * Big Board: full player pool, search, position filter, and the pin/ban
 * edits (which persist server-side via /api/rankings/edits).
 */
import { expect, test } from '@playwright/test'
import { editPlayer, getRankings, tableRows, type BoardPlayer } from './helpers'

test.describe.serial('rankings board', () => {
  test('board renders the full player pool (>100 rows)', async ({ page }) => {
    await page.goto('/rankings')
    await expect(page.getByTestId('board-table')).toBeVisible()
    await expect
      .poll(async () => tableRows(page, 'board-table').count(), {
        message: 'board-table should render well over 100 player rows',
      })
      .toBeGreaterThan(100)
  })

  test('search narrows the board to the searched player', async ({ page, request }) => {
    const { players } = await getRankings(request)
    // A player from inside the board (not row 1) so narrowing is observable.
    const target = players[20]

    await page.goto('/rankings')
    const rows = tableRows(page, 'board-table')
    await expect.poll(() => rows.count()).toBeGreaterThan(100)

    await page.getByTestId('board-search').fill(target.name)

    await expect.poll(() => rows.count(), { message: 'search should narrow the board' }).toBeLessThan(20)
    await expect(rows.filter({ hasText: target.name }).first()).toBeVisible()
  })

  test('QB position filter leaves only QB rows', async ({ page }) => {
    await page.goto('/rankings')
    const rows = tableRows(page, 'board-table')
    await expect.poll(() => rows.count()).toBeGreaterThan(100)

    await page.getByTestId('filter-pos-QB').click()

    await expect
      .poll(
        async () => {
          const texts = await rows.allInnerTexts()
          return texts.length > 0 && texts.every((t) => /\bQB\b/.test(t))
        },
        { message: 'every visible row should carry a QB position chip' },
      )
      .toBe(true)
  })

  test('pinning the top player persists across reload', async ({ page, request }) => {
    const { players } = await getRankings(request)
    const target = players[0]
    const pinnedInApi = async () =>
      (await getRankings(request)).players.find((p: BoardPlayer) => p.player_id === target.player_id)?.pinned

    await page.goto('/rankings')
    const pin = page.getByTestId(`pin-${target.player_id}`)
    await pin.click()
    await expect.poll(pinnedInApi, { message: 'pin should persist server-side' }).toBe(true)

    await page.reload()

    // Row still renders and the pin survived the reload.
    const reloadedPin = page.getByTestId(`pin-${target.player_id}`)
    await expect(reloadedPin).toBeVisible()
    expect(await pinnedInApi()).toBe(true)
    // If the toggle exposes its state (aria-pressed), it must reflect pinned.
    const pressed = await reloadedPin.getAttribute('aria-pressed')
    if (pressed !== null) expect(pressed).toBe('true')

    // Cleanup: unpin through the same control.
    await reloadedPin.click()
    await expect.poll(pinnedInApi, { message: 'unpin should persist server-side' }).toBe(false)
  })

  test('banning removes a player from the board; unban restores', async ({ page, request }) => {
    const { players } = await getRankings(request)
    const target = players[5]

    await page.goto('/rankings')
    const rows = tableRows(page, 'board-table')
    await expect(rows.filter({ hasText: target.name }).first()).toBeVisible()

    await page.getByTestId(`ban-${target.player_id}`).click()

    await expect(
      rows.filter({ hasText: target.name }),
      'banned player should disappear from the main board',
    ).toHaveCount(0)
    await expect
      .poll(async () => (await getRankings(request)).players.find((p) => p.player_id === target.player_id)?.banned)
      .toBe(true)

    // Unban via the API (the row — and its ban control — is gone from the
    // main table), then confirm the board restores the player.
    await editPlayer(request, { player_id: target.player_id, banned: false })
    await page.reload()
    await expect(
      rows.filter({ hasText: target.name }).first(),
      'unbanned player should reappear on the board',
    ).toBeVisible()
  })
})
