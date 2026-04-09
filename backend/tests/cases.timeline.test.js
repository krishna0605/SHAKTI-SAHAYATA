import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();

vi.mock('../config/database.js', () => ({
  default: {
    query: (...args) => queryMock(...args),
  },
}));

vi.mock('../middleware/auth.js', () => ({
  authenticateToken: (req, _res, next) => {
    req.user = { userId: 7, buckleId: 'BK-9999', role: 'investigator' };
    next();
  },
}));

vi.mock('../middleware/authorize.js', () => ({
  requireRole: () => (_req, _res, next) => next(),
}));

vi.mock('../middleware/caseAccess.js', () => ({
  requireCaseAccess: () => (_req, _res, next) => next(),
}));

vi.mock('../middleware/evidenceLock.js', () => ({
  checkEvidenceLock: (_req, _res, next) => next(),
}));

vi.mock('../services/chatbot/caseContext.service.js', () => ({
  buildCaseKnowledgeContract: vi.fn(),
  getCaseModuleSummary: vi.fn(),
  searchCasesForChat: vi.fn(),
}));

const { default: casesRouter } = await import('../routes/cases.js');

const app = express();
app.use(express.json());
app.use('/api/cases', casesRouter);

describe('case timeline timestamp fallback', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('derives event_time for legacy rows and sorts timeline events by the resolved timestamp', async () => {
    queryMock.mockResolvedValue({
      rows: [
        {
          source: 'ipdr',
          source_id: '10',
          event_time: null,
          primary_value: '9414000000',
          secondary_value: '8.8.8.8',
          event_type: 'session',
          device_id: 'IMEI-IPDR',
          location_ref: null,
          details: { start_time: '2025-06-29 23:00:00' },
          fallback_date: null,
          fallback_time: null,
          fallback_timestamp: '2025-06-29 23:00:00',
          created_at: '2026-04-09T10:00:00.000Z',
        },
        {
          source: 'cdr',
          source_id: '11',
          event_time: null,
          primary_value: '9414397023',
          secondary_value: 'VM-BOBCRD-S',
          event_type: 'SMS',
          device_id: 'IMEI-CDR',
          location_ref: '404-98-8473-231484161',
          details: { duration_sec: 0, operator: 'VODAFONE' },
          fallback_date: '2025-06-30',
          fallback_time: '00:13:37',
          fallback_timestamp: null,
          created_at: '2026-04-09T09:59:00.000Z',
        },
      ],
    });

    const response = await request(app).get('/api/cases/55/timeline');

    expect(response.status).toBe(200);
    expect(response.body.events).toHaveLength(2);
    expect(response.body.events[0]).toMatchObject({
      source: 'cdr',
      source_id: '11',
      event_time: '2025-06-30T00:13:37+05:30',
    });
    expect(response.body.events[1]).toMatchObject({
      source: 'ipdr',
      source_id: '10',
      event_time: '2025-06-29T23:00:00+05:30',
    });
  });
});
