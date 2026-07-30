/**
 * League settings: teams / roster edits move the replacement-level preview,
 * my-slot is bounded by team count, and the suite leaves stock settings
 * behind for the draft-room specs.
 */
import { expect, request as pwRequest, test } from '@playwright/test'
import { getSettings, resetSettings } from './helpers'

async function replacementPreview(page: import('@playwright/test').Page): Promise<string> {
  const preview = page.getByTestId('replacement-preview')
  await expect(preview).toBeVisible()
  return (await preview.innerText()).trim()
}

test.describe.serial('league settings', () => {
  test.beforeAll(async () => {
    // Start from a known baseline (12 teams, RB2, slot 5).
    const ctx = await pwRequest.newContext()
    await resetSettings(ctx)
    await ctx.dispose()
  })

  test.afterAll(async () => {
    // Safety net: later specs (draft room) assume stock settings even if a
    // test in this file failed midway.
    const ctx = await pwRequest.newContext()
    await resetSettings(ctx)
    await ctx.dispose()
  })

  test('changing teams 12 -> 10 saves and moves the replacement preview', async ({ page, request }) => {
    await page.goto('/settings')
    const before = await replacementPreview(page)

    await page.getByTestId('teams-input').fill('10')
    await page.getByTestId('save-settings').click()

    await expect(page.getByTestId('settings-saved')).toBeVisible()
    await expect
      .poll(() => replacementPreview(page), {
        message: 'replacement-preview should change when the league shrinks to 10 teams',
      })
      .not.toBe(before)

    expect((await getSettings(request)).settings.teams).toBe(10)
  })

  test('changing roster RB 2 -> 3 saves and moves the replacement preview again', async ({ page, request }) => {
    await page.goto('/settings')
    const before = await replacementPreview(page)

    await page.getByTestId('roster-rb-input').fill('3')
    await page.getByTestId('save-settings').click()

    await expect(page.getByTestId('settings-saved')).toBeVisible()
    await expect
      .poll(() => replacementPreview(page), {
        message: 'replacement-preview should change when RB slots go 2 -> 3',
      })
      .not.toBe(before)

    expect((await getSettings(request)).settings.roster.rb).toBe(3)
  })

  test('my-slot cannot exceed the team count', async ({ page, request }) => {
    // League is 10 teams at this point in the serial run.
    await page.goto('/settings')

    await page.getByTestId('my-slot-input').fill('12')
    await page.getByTestId('save-settings').click()

    // Whether the input clamps client-side or the backend rejects the save,
    // the persisted invariant must hold: my_slot <= teams.
    await expect
      .poll(
        async () => {
          const { settings } = await getSettings(request)
          return settings.my_slot <= settings.teams
        },
        { message: 'persisted my_slot must never exceed the team count' },
      )
      .toBe(true)
    expect((await getSettings(request)).settings.my_slot).not.toBe(12)
  })

  test('restore defaults through the UI (teams 12, RB 2, slot 5)', async ({ page, request }) => {
    await page.goto('/settings')

    await page.getByTestId('teams-input').fill('12')
    await page.getByTestId('roster-rb-input').fill('2')
    await page.getByTestId('my-slot-input').fill('5')
    await page.getByTestId('scoring-preset-ppr').click()
    await page.getByTestId('save-settings').click()

    await expect(page.getByTestId('settings-saved')).toBeVisible()

    const { settings, rounds } = await getSettings(request)
    expect(settings.teams).toBe(12)
    expect(settings.roster.rb).toBe(2)
    expect(settings.my_slot).toBe(5)
    expect(settings.scoring_preset).toBe('ppr')
    // Stock roster => 15 rounds, which draftroom.spec depends on.
    expect(rounds).toBe(15)
  })
})
