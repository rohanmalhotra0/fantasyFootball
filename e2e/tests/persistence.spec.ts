/**
 * Draft-room persistence and realtime resilience: reload recovery, two-tab
 * WS fan-out, and reconnection after a network drop.
 *
 * All picks are made through the REST API (a separate APIRequestContext, so
 * it keeps working while the browser context is offline); the pages must
 * catch up purely via their own fetch/WS logic.
 */
import { expect, test } from '@playwright/test'
import { assertBoardInSync, createDraft, draftBestViaApi, getDraftState, openTab } from './helpers'

test('reload, two-tab sync, and offline recovery all converge on the API state', async ({
  page,
  context,
  request,
}) => {
  test.setTimeout(120_000)

  const draft = await createDraft(request)
  await page.goto(`/draft/${draft.id}`)
  await openTab(page, 'board')
  await expect(page.getByTestId('board-grid')).toBeVisible()

  // --- 5 picks via the API, then a hard reload: the board must rebuild ---
  for (let i = 0; i < 5; i++) {
    await draftBestViaApi(request, draft.id)
  }
  expect((await getDraftState(request, draft.id)).picks.length).toBe(5)

  await page.reload()
  await assertBoardInSync(page, request, draft.id) // 5 filled cells

  // --- Second tab on the same draft: both tabs see pick 6 ---
  const page2 = await context.newPage()
  await page2.goto(`/draft/${draft.id}`)
  await openTab(page2, 'board')
  await expect(page2.getByTestId('board-grid')).toBeVisible()
  await assertBoardInSync(page2, request, draft.id)

  await draftBestViaApi(request, draft.id) // pick 6
  await assertBoardInSync(page, request, draft.id) // tab 1 -> 6 filled cells
  await assertBoardInSync(page2, request, draft.id) // tab 2 -> 6 filled cells

  // --- Network drop: offline 3s, back online, pick 7 lands via API; the
  // page must reconnect and converge without a reload ---
  await context.setOffline(true)
  await page.waitForTimeout(3_000)
  await context.setOffline(false)

  await draftBestViaApi(request, draft.id) // pick 7
  await assertBoardInSync(page, request, draft.id, { timeout: 30_000 }) // reconnect + catch up
  await assertBoardInSync(page2, request, draft.id, { timeout: 30_000 })

  expect((await getDraftState(request, draft.id)).picks.length).toBe(7)
  await page2.close()
})
