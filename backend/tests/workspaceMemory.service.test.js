import { beforeEach, describe, expect, it, vi } from 'vitest';

const snapshotStore = [];
const queryCounters = {
  cdrStats: 0,
  ipdrStats: 0,
  towerStats: 0,
  ildStats: 0
};

const resetSnapshots = () => {
  snapshotStore.splice(0, snapshotStore.length);
};

const resetCounters = () => {
  Object.keys(queryCounters).forEach((key) => {
    queryCounters[key] = 0;
  });
};

const queryMock = vi.fn(async (sql, params = []) => {
  const text = String(sql);

  if (text.includes('SELECT *') && text.includes('FROM case_memory_snapshots')) {
    const [caseId, module, view, snapshotKind, fileScopeKey, filterHash] = params;
    const row = snapshotStore.find((entry) =>
      entry.case_id === Number(caseId)
      && entry.module === module
      && entry.view === view
      && entry.snapshot_kind === snapshotKind
      && entry.file_scope_key === fileScopeKey
      && entry.filter_hash === filterHash
    );
    return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
  }

  if (text.includes('INSERT INTO case_memory_snapshots')) {
    const [
      caseId,
      module,
      view,
      snapshotKind,
      fileIds,
      fileScopeKey,
      filterHash,
      filters,
      facts,
      insights,
      artifacts,
      sources,
      version
    ] = params;

    const row = {
      id: snapshotStore.length + 1,
      case_id: Number(caseId),
      module,
      view,
      snapshot_kind: snapshotKind,
      file_ids: fileIds,
      file_scope_key: fileScopeKey,
      filter_hash: filterHash,
      filters: JSON.parse(filters),
      facts: JSON.parse(facts),
      insights: JSON.parse(insights),
      artifacts: JSON.parse(artifacts),
      sources: JSON.parse(sources),
      generated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version
    };

    const existingIndex = snapshotStore.findIndex((entry) =>
      entry.case_id === row.case_id
      && entry.module === row.module
      && entry.view === row.view
      && entry.snapshot_kind === row.snapshot_kind
      && entry.file_scope_key === row.file_scope_key
      && entry.filter_hash === row.filter_hash
    );

    if (existingIndex >= 0) {
      snapshotStore[existingIndex] = { ...snapshotStore[existingIndex], ...row, id: snapshotStore[existingIndex].id };
      return { rows: [snapshotStore[existingIndex]], rowCount: 1 };
    }

    snapshotStore.push(row);
    return { rows: [row], rowCount: 1 };
  }

  if (text.includes('DELETE FROM case_memory_snapshots')) {
    snapshotStore.splice(0, snapshotStore.length);
    return { rows: [], rowCount: 1 };
  }

  if (text.includes('COUNT(*)::int AS total_records') && text.includes('FROM cdr_records')) {
    queryCounters.cdrStats += 1;
    return {
      rows: [
        {
          total_records: 32420,
          unique_a_parties: 2491,
          unique_b_parties: 7164,
          avg_duration_sec: 65,
          total_duration_sec: 2107300
        }
      ],
      rowCount: 1
    };
  }

  if (text.includes("COALESCE(NULLIF(call_type, ''), 'Unknown') AS label")) {
    return {
      rows: [
        { label: 'VOICE', count: 18900 },
        { label: 'SMS', count: 13520 }
      ],
      rowCount: 2
    };
  }

  if (text.includes('EXTRACT(HOUR FROM')) {
    return {
      rows: [
        { hour: 0, count: 320 },
        { hour: 1, count: 281 }
      ],
      rowCount: 2
    };
  }

  if (text.includes('FROM cdr_records') && text.includes('GROUP BY 1') && text.includes('NULLIF(called_number')) {
    return {
      rows: [
        { label: '9876543210', count: 120, duration_sec: 8200 },
        { label: '9123456789', count: 98, duration_sec: 7300 }
      ],
      rowCount: 2
    };
  }

  if (text.includes('FROM cdr_records') && text.includes('COALESCE(NULLIF(first_cell_id')) {
    return {
      rows: [
        { label: '404-98-8473-231484161', count: 220, duration_sec: 6400 },
        { label: '404-98-8473-231484420', count: 175, duration_sec: 5100 }
      ],
      rowCount: 2
    };
  }

  if (text.includes('FROM cdr_records') && text.includes('WHERE case_id = $1') && text.includes('ILIKE')) {
    return {
      rows: [
        {
          calling_number: '9414397023',
          called_number: '9876543210',
          call_type: 'VOICE',
          duration_sec: 120,
          date_time: '2026-04-10T12:00:00.000Z',
          file_id: 29
        }
      ],
      rowCount: 1
    };
  }

  if (text.includes('MIN(NULLIF(call_time, \'\')) AS first_call_time') && text.includes('MAX(NULLIF(call_time, \'\')) AS last_call_time')) {
    return {
      rows: [
        { label: '2025-07-01', first_call_time: '00:02:39', last_call_time: '23:56:31' },
        { label: '2025-06-30', first_call_time: '00:00:46', last_call_time: '23:57:57' }
      ],
      rowCount: 2
    };
  }

  if (text.includes('COUNT(*)::int AS total_records') && text.includes('FROM ipdr_records')) {
    queryCounters.ipdrStats += 1;
    return {
      rows: [
        {
          total_records: 2091,
          unique_msisdn: 24,
          unique_imei: 19,
          unique_imsi: 22,
          total_volume: 987654,
          records_with_volume: 1880
        }
      ],
      rowCount: 1
    };
  }

  if (text.includes('FROM ipdr_records') && text.includes('COALESCE(NULLIF(source_ip')) {
    return {
      rows: [
        { label: '10.1.1.5', count: 61 },
        { label: '8.8.8.8', count: 28 }
      ],
      rowCount: 2
    };
  }

  if (text.includes('FROM ipdr_records') && text.includes("COALESCE(NULLIF(msisdn, ''), 'Unknown')")) {
    return {
      rows: [
        { label: '8511131701', count: 102 },
        { label: '8511131702', count: 88 }
      ],
      rowCount: 2
    };
  }

  if (text.includes('FROM ipdr_records') && text.includes('ILIKE')) {
    return {
      rows: [
        {
          msisdn: '8511131701',
          source_ip: '10.1.1.5',
          destination_ip: '8.8.8.8',
          public_ip: '49.205.10.12',
          private_ip: '10.1.1.5',
          domain_name: 'example.com',
          url: 'https://example.com/login',
          file_id: 44,
          created_at: '2026-04-10T09:00:00.000Z'
        }
      ],
      rowCount: 1
    };
  }

  if (text.includes('COUNT(*)::int AS total_records') && text.includes('FROM tower_dump_records')) {
    queryCounters.towerStats += 1;
    return {
      rows: [
        {
          total_records: 1180,
          unique_a_parties: 60,
          unique_b_parties: 74,
          unique_towers: 11
        }
      ],
      rowCount: 1
    };
  }

  if (text.includes('FROM tower_dump_records') && text.includes("COALESCE(NULLIF(cell_id, ''), NULLIF(first_cell_id")) {
    return {
      rows: [
        { label: 'CELL-101', count: 140 },
        { label: 'CELL-102', count: 121 }
      ],
      rowCount: 2
    };
  }

  if (text.includes('FROM tower_dump_records') && text.includes("COALESCE(NULLIF(a_party, ''), NULLIF(b_party")) {
    return {
      rows: [
        { label: '9876543210', count: 90 },
        { label: '8511131701', count: 84 }
      ],
      rowCount: 2
    };
  }

  if (text.includes('FROM tower_dump_records') && text.includes('ILIKE')) {
    return {
      rows: [
        {
          a_party: '9414397023',
          b_party: '9876543210',
          cell_id: 'CELL-101',
          first_cell_id: 'CELL-101',
          last_cell_id: 'CELL-102',
          site_name: 'Navrangpura',
          site_address: 'Ahmedabad',
          file_id: 55,
          start_time: '2026-04-10T08:00:00.000Z'
        }
      ],
      rowCount: 1
    };
  }

  if (text.includes('COUNT(*)::int AS total_records') && text.includes('FROM ild_records')) {
    queryCounters.ildStats += 1;
    return {
      rows: [
        {
          total_records: 640,
          unique_calling_numbers: 25,
          unique_called_numbers: 42,
          avg_duration_sec: 145,
          total_duration_sec: 92800
        }
      ],
      rowCount: 1
    };
  }

  if (text.includes('FROM ild_records') && text.includes("COALESCE(NULLIF(called_number, ''), NULLIF(international_num")) {
    return {
      rows: [
        { label: '+442012341234', count: 44 },
        { label: '+971501231234', count: 39 }
      ],
      rowCount: 2
    };
  }

  if (text.includes('FROM ild_records') && text.includes("COALESCE(NULLIF(destination_country, ''), 'Unknown')")) {
    return {
      rows: [
        { label: 'United Kingdom', count: 44 },
        { label: 'UAE', count: 39 }
      ],
      rowCount: 2
    };
  }

  if (text.includes('FROM ild_records') && text.includes('ILIKE')) {
    return {
      rows: [
        {
          calling_number: '9414397023',
          called_number: '+442012341234',
          international_num: '+442012341234',
          destination_country: 'United Kingdom',
          duration_sec: 260,
          file_id: 66,
          date_time: '2026-04-10T06:00:00.000Z'
        }
      ],
      rowCount: 1
    };
  }

  if (text.includes('FROM sdr_records') && text.includes('GROUP BY 1')) {
    return {
      rows: [
        { label: 'Rajesh Thakor', count: 4 },
        { label: 'Rajesh Kumar', count: 2 }
      ],
      rowCount: 2
    };
  }

  if (text.includes('COUNT(*)::int AS total_records') && text.includes('FROM sdr_records')) {
    return {
      rows: [
        {
          total_records: 562,
          subscriber_name_rows: 540,
          msisdn_rows: 552,
          email_rows: 128
        }
      ],
      rowCount: 1
    };
  }

  if (text.includes('SELECT subscriber_name') && text.includes('FROM sdr_records')) {
    return {
      rows: [
        {
          subscriber_name: 'Rajesh Thakor',
          msisdn: '8511131701',
          email: 'rajesh@example.com',
          file_id: 77,
          created_at: '2026-04-09T10:00:00.000Z'
        },
        {
          subscriber_name: 'Rajesh Kumar',
          msisdn: '9876501234',
          email: 'rajesh.kumar@example.com',
          file_id: 79,
          created_at: '2026-04-08T12:00:00.000Z'
        }
      ],
      rowCount: 2
    };
  }

  return { rows: [], rowCount: 0 };
});

const fetchCaseKnowledgeMock = vi.fn(async () => ({
  case: {
    id: 41,
    caseName: 'test',
    caseNumber: 'T-2026-6174'
  },
  files: {
    items: [
      { id: 29, originalName: 'vodafone-june.csv', detectedType: 'cdr', parseStatus: 'parsed', recordCount: 7304 },
      { id: 30, originalName: 'airtel-june.csv', detectedType: 'cdr', parseStatus: 'parsed', recordCount: 7304 },
      { id: 44, originalName: 'ipdr-april.csv', detectedType: 'ipdr', parseStatus: 'parsed', recordCount: 2091 },
      { id: 55, originalName: 'tower-april.csv', detectedType: 'tower', parseStatus: 'parsed', recordCount: 1180 },
      { id: 66, originalName: 'ild-april.csv', detectedType: 'ild', parseStatus: 'parsed', recordCount: 640 },
      { id: 77, originalName: 'subscriber-data.csv', detectedType: 'sdr', parseStatus: 'parsed', recordCount: 562 }
    ]
  }
}));

const getCaseModuleSummaryMock = vi.fn(async (_caseId, module) => {
  if (module === 'cdr') {
    return {
      markdown: 'Overview highlights for the current CDR scope.',
      facts: {
        total_records: 32420,
        unique_a_parties: 2491,
        unique_b_parties: 7164,
        avg_duration_sec: 65
      }
    };
  }

  if (module === 'sdr') {
    return {
      markdown: 'SDR search-ready context.',
      facts: {
        topSubscriberNames: [{ label: 'Rajesh Thakor', count: 3 }]
      }
    };
  }

  return {
    markdown: 'Scoped summary.',
    facts: {}
  };
});

vi.mock('../config/database.js', () => ({
  default: {
    query: queryMock,
    on: vi.fn()
  }
}));

vi.mock('../services/chatbot/caseContext.service.js', () => ({
  fetchCaseKnowledge: fetchCaseKnowledgeMock,
  getCaseModuleSummary: getCaseModuleSummaryMock
}));

const { lookupWorkspaceAnswer, normalizeWorkspaceContext } = await import('../services/chatbot/workspaceMemory.service.js');

describe('workspaceMemory service', () => {
  beforeEach(() => {
    queryMock.mockClear();
    fetchCaseKnowledgeMock.mockClear();
    getCaseModuleSummaryMock.mockClear();
    resetSnapshots();
    resetCounters();
  });

  it('answers file-scoped CDR metrics from the active workspace selection', async () => {
    const result = await lookupWorkspaceAnswer({
      message: 'In this CDR analysis, how many unique A-parties are there?',
      resolvedContext: { caseId: '41' },
      workspaceContext: {
        caseId: '41',
        caseTag: 'T-2026-6174',
        module: 'cdr',
        view: 'overview',
        selectedFileIds: [29, 30],
        selectedFileNames: ['vodafone-june.csv', 'airtel-june.csv'],
        selectionTimestamp: '2026-04-10T09:00:00.000Z'
      }
    });

    expect(result?.route).toBe('workspace_metric_unique_a_parties');
    expect(result?.markdown).toContain('Unique A-Parties');
    expect(result?.markdown).toContain('2,491');
    expect(result?.markdown).toContain('Case: test');
    expect(queryCounters.cdrStats).toBe(1);
  });

  it('returns the case file manifest for uploaded-file questions', async () => {
    const result = await lookupWorkspaceAnswer({
      message: 'Which files are uploaded in this case?',
      resolvedContext: { caseId: '41' },
      workspaceContext: {
        caseId: '41',
        caseTag: 'T-2026-6174',
        module: 'cdr',
        view: 'overview',
        selectedFileIds: [29],
        selectionTimestamp: '2026-04-10T09:00:00.000Z'
      }
    });

    expect(result?.route).toBe('workspace_files');
    expect(result?.markdown).toContain('Uploaded Files');
    expect(result?.markdown).toContain('6');
    expect(result?.markdown).toContain('vodafone-june.csv');
  });

  it('answers daily first slash last call questions from the active CDR workspace', async () => {
    const result = await lookupWorkspaceAnswer({
      message: 'Daily First/Last Call',
      resolvedContext: { caseId: '41' },
      workspaceContext: {
        caseId: '41',
        caseTag: 'T-2026-6174',
        module: 'cdr',
        view: 'advanced',
        selectedFileIds: [29],
        selectedFileNames: ['vodafone-june.csv'],
        selectionTimestamp: '2026-04-10T09:00:00.000Z'
      }
    });

    expect(result?.route).toBe('workspace_metric_daily_first_last_call');
    expect(result?.markdown).toContain('Daily First/Last Call');
    expect(result?.markdown).toContain('2025-07-01');
    expect(queryCounters.cdrStats).toBe(1);
  });

  it('uses the active SDR search state for subscriber-detail answers', async () => {
    const result = await lookupWorkspaceAnswer({
      message: 'Show the subscriber details for the current SDR search results.',
      resolvedContext: { caseId: '41' },
      workspaceContext: {
        caseId: '41',
        caseTag: 'T-2026-6174',
        module: 'sdr',
        view: 'search',
        searchState: {
          query: 'rajesh',
          resultCount: 2
        },
        selectionTimestamp: '2026-04-10T09:00:00.000Z'
      }
    });

    expect(result?.route).toBe('workspace_records_sdr');
    expect(result?.markdown).toContain('SDR');
    expect(result?.markdown).toContain('Rajesh Thakor');
  });

  it('grounds IPDR map questions to the current workspace selection', async () => {
    const result = await lookupWorkspaceAnswer({
      message: 'What does this IPDR map show?',
      resolvedContext: { caseId: '41' },
      workspaceContext: {
        caseId: '41',
        caseTag: 'T-2026-6174',
        module: 'ipdr',
        view: 'map',
        selectedFileIds: [44],
        selectedFileNames: ['ipdr-april.csv'],
        selectionTimestamp: '2026-04-10T09:00:00.000Z'
      }
    });

    expect(result?.route).toBe('workspace_summary_ipdr');
    expect(result?.markdown).toContain('IPDR');
    expect(queryCounters.ipdrStats).toBe(1);
  });

  it('runs generic Tower record lookups from the records view', async () => {
    const result = await lookupWorkspaceAnswer({
      message: 'Find records for 9876543210',
      resolvedContext: { caseId: '41' },
      workspaceContext: {
        caseId: '41',
        caseTag: 'T-2026-6174',
        module: 'tower',
        view: 'records',
        selectedFileIds: [55],
        selectedFileNames: ['tower-april.csv'],
        selectionTimestamp: '2026-04-10T09:00:00.000Z'
      }
    });

    expect(result?.route).toBe('workspace_records_tower');
    expect(result?.markdown).toContain('Tower');
    expect(result?.markdown).toContain('9876543210');
  });

  it('surfaces ILD advanced summaries from the active view bundle', async () => {
    const result = await lookupWorkspaceAnswer({
      message: 'Give me the advanced analysis for this ILD view',
      resolvedContext: { caseId: '41' },
      workspaceContext: {
        caseId: '41',
        caseTag: 'T-2026-6174',
        module: 'ild',
        view: 'advanced',
        selectedFileIds: [66],
        selectedFileNames: ['ild-april.csv'],
        selectionTimestamp: '2026-04-10T09:00:00.000Z'
      }
    });

    expect(result?.route).toBe('workspace_advanced_ild');
    expect(result?.markdown).toContain('ILD');
    expect(result?.markdown).toContain('Advanced');
    expect(queryCounters.ildStats).toBe(1);
  });

  it('abstains clearly when a metric is not grounded for the active module', async () => {
    const result = await lookupWorkspaceAnswer({
      message: 'In this IPDR analysis how many unique A-parties are there?',
      resolvedContext: { caseId: '41' },
      workspaceContext: {
        caseId: '41',
        caseTag: 'T-2026-6174',
        module: 'ipdr',
        view: 'overview',
        selectedFileIds: [44],
        selectedFileNames: ['ipdr-april.csv'],
        selectionTimestamp: '2026-04-10T09:00:00.000Z'
      }
    });

    expect(result?.route).toMatch(/^workspace_(?:abstain|metric|summary)_/);
    expect(result?.markdown).toBeTruthy();
  });

  it('reuses a persistent snapshot instead of recomputing the same IPDR summary twice', async () => {
    const request = {
      message: 'What does this IPDR map show?',
      resolvedContext: { caseId: '41' },
      workspaceContext: {
        caseId: '41',
        caseTag: 'T-2026-6174',
        module: 'ipdr',
        view: 'map',
        selectedFileIds: [44],
        selectedFileNames: ['ipdr-april.csv'],
        selectionTimestamp: '2026-04-10T09:00:00.000Z'
      }
    };

    await lookupWorkspaceAnswer(request);
    await lookupWorkspaceAnswer(request);

    expect(queryCounters.ipdrStats).toBe(1);
    expect(snapshotStore).toHaveLength(1);
    expect(snapshotStore[0]?.module).toBe('ipdr');
    expect(snapshotStore[0]?.snapshot_kind).toBe('view_bundle');
  });

  it('normalizes module and view aliases coming from the workspace payload', () => {
    expect(
      normalizeWorkspaceContext({
        caseId: '41',
        module: 'Tower',
        view: 'party_graph',
        selectedFileIds: ['11', '11', '18']
      })
    ).toMatchObject({
      caseId: '41',
      module: 'tower',
      view: 'party-graph',
      selectedFileIds: [11, 18]
    });
  });
});
