import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ingestCaseUploads } from './caseFileIngestion'

const uploadMock = vi.fn()
const insertCdrMock = vi.fn()

vi.mock('../components/lib/apis', () => ({
  fileAPI: {
    upload: (...args: unknown[]) => uploadMock(...args),
  },
  cdrAPI: {
    insertRecords: (...args: unknown[]) => insertCdrMock(...args),
  },
  ipdrAPI: {
    insertRecords: vi.fn(),
    enrichCase: vi.fn(),
  },
  sdrAPI: {
    insertRecords: vi.fn(),
  },
  towerDumpAPI: {
    insertRecords: vi.fn(),
  },
  ildAPI: {
    insertRecords: vi.fn(),
  },
}))

vi.mock('../components/utils/normalization', () => ({
  parseCSV: vi.fn((content: string) => [{ source: content.trim() || 'cdr-row' }]),
}))

vi.mock('../components/utils/ipdrNormalization', () => ({
  parseIPDR: vi.fn(() => []),
}))

vi.mock('../components/utils/sdrNormalization', () => ({
  parseSDRCsv: vi.fn(() => []),
}))

vi.mock('../components/utils/towerDumpParserAsync', () => ({
  parseTowerDumpCsvAsync: vi.fn(async () => []),
}))

vi.mock('../components/utils/ildNormalization', () => ({
  parseILD: vi.fn(() => []),
}))

describe('ingestCaseUploads', () => {
  beforeEach(() => {
    uploadMock.mockReset()
    insertCdrMock.mockReset()
  })

  it('uploads and inserts every selected file in a telecom slot', async () => {
    uploadMock
      .mockResolvedValueOnce({ id: 101 })
      .mockResolvedValueOnce({ id: 102 })

    insertCdrMock
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)

    const firstFile = new File(['first-row'], 'first-cdr.csv', { type: 'text/csv' })
    const secondFile = new File(['second-row'], 'second-cdr.csv', { type: 'text/csv' })

    const failures = await ingestCaseUploads({
      caseId: 55,
      operator: 'Jio',
      uploads: [
        {
          key: 'cdr',
          label: 'CDR',
          files: [firstFile, secondFile],
        },
      ],
    })

    expect(failures).toEqual([])
    expect(uploadMock).toHaveBeenCalledTimes(2)
    expect(uploadMock).toHaveBeenNthCalledWith(1, '55', firstFile, 'Jio', 'cdr')
    expect(uploadMock).toHaveBeenNthCalledWith(2, '55', secondFile, 'Jio', 'cdr')

    expect(insertCdrMock).toHaveBeenCalledTimes(2)
    expect(insertCdrMock).toHaveBeenNthCalledWith(
      1,
      '55',
      expect.arrayContaining([
        expect.objectContaining({
          file_name: 'first-cdr.csv',
          file_index: 0,
          row_index: 0,
        }),
      ]),
      '101'
    )
    expect(insertCdrMock).toHaveBeenNthCalledWith(
      2,
      '55',
      expect.arrayContaining([
        expect.objectContaining({
          file_name: 'second-cdr.csv',
          file_index: 1,
          row_index: 0,
        }),
      ]),
      '102'
    )
  })
})
