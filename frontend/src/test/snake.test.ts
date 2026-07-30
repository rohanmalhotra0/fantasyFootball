import { describe, expect, it } from 'vitest'
import { overallToTeam, slotToOverall } from '../lib/draftStore'

describe('overallToTeam (snake order)', () => {
  it('matches the spec cases for 12 teams', () => {
    expect(overallToTeam(1, 12)).toBe(1)
    expect(overallToTeam(12, 12)).toBe(12)
    expect(overallToTeam(13, 12)).toBe(12)
    expect(overallToTeam(24, 12)).toBe(1)
    expect(overallToTeam(25, 12)).toBe(1)
  })

  it('snakes back and forth across whole rounds (10 teams)', () => {
    // Round 1: 1..10 -> teams 1..10
    for (let overall = 1; overall <= 10; overall++) {
      expect(overallToTeam(overall, 10)).toBe(overall)
    }
    // Round 2 reverses: 11 -> 10, 20 -> 1
    expect(overallToTeam(11, 10)).toBe(10)
    expect(overallToTeam(15, 10)).toBe(6)
    expect(overallToTeam(20, 10)).toBe(1)
    // Round 3 goes forward again
    expect(overallToTeam(21, 10)).toBe(1)
    expect(overallToTeam(30, 10)).toBe(10)
  })

  it('every team gets exactly one pick per round', () => {
    const teams = 12
    for (let round = 1; round <= 4; round++) {
      const seen = new Set<number>()
      for (let i = 1; i <= teams; i++) {
        seen.add(overallToTeam((round - 1) * teams + i, teams))
      }
      expect(seen.size).toBe(teams)
    }
  })

  it('is the inverse of slotToOverall', () => {
    const teams = 12
    for (let overall = 1; overall <= teams * 4; overall++) {
      const round = Math.ceil(overall / teams)
      const team = overallToTeam(overall, teams)
      expect(slotToOverall(round, team, teams)).toBe(overall)
    }
  })
})
