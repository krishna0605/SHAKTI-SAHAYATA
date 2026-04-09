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

const { default: cdrRouter } = await import('../routes/cdr.js');
const { default: ildRouter } = await import('../routes/ild.js');
const { default: towerRouter } = await import('../routes/tower.js');
const { default: ipdrRouter } = await import('../routes/ipdr.js');

const app = express();
app.use(express.json());
app.use('/api/cdr', cdrRouter);
app.use('/api/ild', ildRouter);
app.use('/api/tower', towerRouter);
app.use('/api/ipdr', ipdrRouter);

describe('telecom ingest timestamp normalization', () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockResolvedValue({ rows: [], rowCount: 1 });
  });

  it('stores normalized CDR call_date, call_time, and date_time', async () => {
    const response = await request(app)
      .post('/api/cdr/records')
      .send({
        caseId: 55,
        records: [
          {
            a_party: '9414397023',
            b_party: 'VM-BOBCRD-S',
            call_type: 'SMS',
            call_date: '30/06/2025',
            call_start_time: '1:13:37 PM',
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(queryMock).toHaveBeenCalledTimes(1);
    const [, params] = queryMock.mock.calls[0];
    expect(params[5]).toBe('13:13:37');
    expect(params[6]).toBe('2025-06-30');
    expect(params[7]).toBe('2025-06-30T13:13:37+05:30');
  });

  it('stores normalized ILD date_time for split date and time columns', async () => {
    const response = await request(app)
      .post('/api/ild/records')
      .send({
        caseId: 55,
        records: [
          {
            calling_party_number: '911234567890',
            called_party_number: '441234567890',
            call_date: '30-06-2025',
            call_time: '00:13:37',
            call_type: 'voice',
          },
        ],
      });

    expect(response.status).toBe(200);
    const [, params] = queryMock.mock.calls[0];
    expect(params[4]).toBe('2025-06-30');
    expect(params[5]).toBe('00:13:37');
    expect(params[6]).toBe('2025-06-30T00:13:37+05:30');
  });

  it('derives tower start_time from call_date and call_time when start_time is missing', async () => {
    const response = await request(app)
      .post('/api/tower/records')
      .send({
        caseId: 55,
        records: [
          {
            a_party: '9414397023',
            b_party: '9414000000',
            call_date: '2025-06-30',
            call_time: '00:00:46',
          },
        ],
      });

    expect(response.status).toBe(200);
    const [, params] = queryMock.mock.calls[0];
    expect(params[4]).toBe('2025-06-30');
    expect(params[5]).toBe('00:00:46');
    expect(params[6]).toBe('2025-06-30T00:00:46+05:30');
  });

  it('normalizes IPDR start and end timestamps into parseable ISO strings', async () => {
    const response = await request(app)
      .post('/api/ipdr/records')
      .send({
        caseId: 55,
        records: [
          {
            source_ip: '8.8.8.8',
            destination_ip: '1.1.1.1',
            start_time: '2025-06-30 00:13:37',
            end_time: '30/06/2025 1:13:37 PM',
          },
        ],
      });

    expect(response.status).toBe(200);
    const [, params] = queryMock.mock.calls[0];
    expect(params[17]).toBe('2025-06-30T00:13:37+05:30');
    expect(params[18]).toBe('2025-06-30T13:13:37+05:30');
  });
});
