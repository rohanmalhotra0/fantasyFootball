import { afterEach, describe, expect, it, vi } from 'vitest'
import { csvEscape, downloadCsv, toCsv, type CsvColumn } from '../lib/csv'

interface Row {
  name: string
  points: number | null
}

const COLUMNS: CsvColumn<Row>[] = [
  { header: 'name', value: (r) => r.name },
  { header: 'points', value: (r) => r.points },
]

describe('csvEscape', () => {
  it('leaves plain fields alone', () => {
    expect(csvEscape('Justin Jefferson')).toBe('Justin Jefferson')
  })

  it('quotes fields containing commas', () => {
    expect(csvEscape('Smith, Jr.')).toBe('"Smith, Jr."')
  })

  it('doubles embedded quotes', () => {
    expect(csvEscape('the "Cheetah"')).toBe('"the ""Cheetah"""')
  })

  it('quotes fields containing newlines', () => {
    expect(csvEscape('a\nb')).toBe('"a\nb"')
  })
})

describe('toCsv', () => {
  it('writes a header row plus one row per item, CRLF separated', () => {
    const csv = toCsv([{ name: 'CMC', points: 320.5 }], COLUMNS)
    expect(csv).toBe('name,points\r\nCMC,320.5')
  })

  it('escapes commas and quotes inside data', () => {
    const rows: Row[] = [
      { name: 'Smith, Jr.', points: 100 },
      { name: 'the "Cheetah"', points: 200 },
    ]
    const csv = toCsv(rows, COLUMNS)
    const lines = csv.split('\r\n')
    expect(lines[1]).toBe('"Smith, Jr.",100')
    expect(lines[2]).toBe('"the ""Cheetah""",200')
  })

  it('renders null/undefined as empty fields', () => {
    const csv = toCsv([{ name: 'X', points: null }], COLUMNS)
    expect(csv.split('\r\n')[1]).toBe('X,')
  })

  it('escapes commas in headers too', () => {
    const cols: CsvColumn<Row>[] = [{ header: 'a,b', value: (r) => r.name }]
    expect(toCsv([], cols)).toBe('"a,b"')
  })
})

describe('downloadCsv', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates an object URL and clicks a download anchor', () => {
    const createObjectURL = vi.fn(() => 'blob:fake')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL,
      revokeObjectURL,
    })
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)

    downloadCsv('test.csv', 'a,b\r\n1,2')

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(click).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake')
    vi.unstubAllGlobals()
  })
})
