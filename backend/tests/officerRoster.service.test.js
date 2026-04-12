import { describe, expect, it } from 'vitest';
import {
  normalizeBuckleId,
  normalizeRosterEmail,
  normalizeRosterHeader,
  normalizeRosterPhoneNumber,
  parseOfficerRosterBuffer,
  resolveRosterColumn,
} from '../services/officerRoster.service.js';

describe('officerRoster.service helpers', () => {
  it('normalizes buckle ids, emails, and phone numbers for roster matching', () => {
    expect(normalizeBuckleId(' bk-1042 ')).toBe('BK-1042');
    expect(normalizeRosterEmail(' Officer@Police.Gov.In ')).toBe('officer@police.gov.in');
    expect(normalizeRosterPhoneNumber('+91 98765-43210')).toBe('9876543210');
  });

  it('maps common roster headers to canonical officer fields', () => {
    expect(normalizeRosterHeader('Phone Number')).toBe('phone_number');
    expect(resolveRosterColumn('Phone Number')).toBe('phone_number');
    expect(resolveRosterColumn('Email ID')).toBe('email');
    expect(resolveRosterColumn('Buckle ID')).toBe('buckle_id');
    expect(resolveRosterColumn('Name')).toBe('full_name');
  });

  it('parses csv roster buffers into normalized officer rows', () => {
    const csv = [
      'Buckle ID,Full Name,Email ID,Phone Number,Department,Station,Position',
      'bk-1001,Inspector Rajesh Sharma,rajesh@police.gov.in,+91 98765 43210,CID,Ahmedabad,Inspector',
    ].join('\n');

    const parsed = parseOfficerRosterBuffer({
      buffer: Buffer.from(csv, 'utf8'),
      fileName: 'gujarat-roster.csv',
    });

    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({
      buckle_id: 'BK-1001',
      full_name: 'Inspector Rajesh Sharma',
      email: 'rajesh@police.gov.in',
      phone_number: '9876543210',
      department: 'CID',
      station: 'Ahmedabad',
      position: 'Inspector',
    });
  });
});
