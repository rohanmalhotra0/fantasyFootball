/**
 * Draft room acceptance (Phase 4): a full 12-team x 15-round mock draft with
 * continuous UI-vs-API zero-desync checks, a mid-draft undo, and the final
 * graded draft report.
 *
 * Speed strategy: my turns go through the UI (draft-best-button — its
 * appearance proves the WS pushed "my turn" to the page); opponent turns go
 * through the REST API with expect.poll on the API pick count; the grid is
 * fully reconciled against the API every 20 picks.
 */
import { expect, request as pwRequest, test } from '@playwright/test'
import {
  assertBoardInSync,
  openTab,
  createDraft,
  getDraftState,
  getRecs,
  mockDraftRunner,
  resetSettings,
  resolveDraftId,
} from './helpers'

test.describe('draft room', () => {
  test.beforeAll(async () => {
    // The 180-pick math below assumes stock settings: 12 teams, slot 5,
    // 15 roster spots => 15 rounds.
    const ctx = await pwRequest.newContext()
    await resetSettings(ctx)
    await ctx.dispose()
  })

  test('full 180-pick mock draft with live sync, undo, and graded report', async ({ page, request }) => {
    test.setTimeout(240_000)

    // --- Create the draft from the lobby ---
    await page.goto('/draft')
    await page.getByTestId('create-draft').click()
    const draftId = await resolveDraftId(page, request)

    // --- Opening state: pick 1, team 1 on the clock (I am slot 5) ---
    const banner = page.getByTestId('on-clock-banner')
    await expect(banner).toBeVisible()
    await expect(banner, 'banner should show pick 1').toContainText(/pick\s*1\b|1\.01/i)

    await expect(page.getByTestId('pick-timer')).toBeVisible()
    await openTab(page, 'board')
    await expect(page.getByTestId('board-grid')).toBeVisible()
    await openTab(page, 'teams')
    await expect(page.getByTestId('opponent-tracker')).toBeVisible()
    await openTab(page, 'next')
    await expect(page.getByTestId('next-up')).toBeVisible()
    await expect(page.getByTestId('my-team-panel')).toBeVisible()
    // Not my turn yet, so the one-click best pick must not be offered.
    await expect(page.getByTestId('draft-best-button')).toBeHidden()

    const initial = await getDraftState(request, draftId)
    expect(initial.teams).toBe(12)
    expect(initial.rounds).toBe(15)
    expect(initial.my_slot).toBe(5)
    expect(initial.picks.length).toBe(0)

    // --- Drive all 180 picks. Undo at pick 100 (round 9, an opponent's pick
    // in a 12-team snake with slot 5) to exercise undo + re-pick mid-draft.
    const final = await mockDraftRunner(page, request, draftId, {
      checkpointEvery: 20,
      undoAtPick: 100,
    })

    expect(final.picks.length).toBe(180)
    expect(final.current_overall).toBeNull()
    expect(final.picks.filter((p) => p.team_index === final.my_slot).length).toBe(15)

    // --- Completion: graded draft report ---
    const report = page.getByTestId('draft-report')
    await expect(report).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('report-grade'), 'grade should be a letter A+..F').toContainText(
      /[A-F][+-]?/,
    )
  })

  test('pick-search logs a pick for the team on the clock', async ({ page, request }) => {
    const draft = await createDraft(request)
    await page.goto(`/draft/${draft.id}`)
    await openTab(page, 'board')
    await expect(page.getByTestId('board-grid')).toBeVisible()

    const recs = await getRecs(request, draft.id)
    const target = recs.recommendations[0]

    await openTab(page, 'next')
    await page.getByTestId('pick-search').click()
    const input = page.getByTestId('pick-search-input')
    await expect(input).toBeVisible()
    await input.fill(target.name)
    await input.press('Enter')

    await expect
      .poll(async () => (await getDraftState(request, draft.id)).picks.length, {
        timeout: 15_000,
        message: 'pick-search should log the pick server-side',
      })
      .toBe(1)
    const state = await getDraftState(request, draft.id)
    expect(state.picks[0].player_id).toBe(target.player_id)

    // The UI reflects its own pick.
    await assertBoardInSync(page, request, draft.id)
  })
})
