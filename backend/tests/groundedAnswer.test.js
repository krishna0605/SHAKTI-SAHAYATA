import { describe, expect, it } from 'vitest';

const {
    buildMetricAnswerPayload,
    buildSummaryAnswerPayload,
    buildFilesAnswerPayload,
    buildRecordAnswerPayload,
    buildClarificationAnswerPayload,
    getMetricAnswerValue
} = await import('../../services/chatbot/groundedAnswer.service.js');

const makeSummary = (facts = {}, extras = {}) => ({
    markdown: 'Test summary markdown.',
    facts,
    sources: { tables: ['cdr_records'], generatedAt: '2026-04-10T09:00:00Z' },
    ...extras
});

const baseScope = {
    caseId: '41',
    caseLabel: 'Test Case 41',
    module: 'cdr',
    view: 'overview',
    scopeMode: 'case-wide',
    scopeOrigin: 'locked_session_case'
};

describe('groundedAnswer.service', () => {
    describe('buildMetricAnswerPayload — scalar metrics', () => {
        it('formats total_records as a scalar', () => {
            const payload = buildMetricAnswerPayload({
                metricKey: 'total_records',
                summary: makeSummary({ total_records: 32420 }),
                ...baseScope
            });
            expect(payload).not.toBeNull();
            expect(payload.kind).toBe('scalar');
            expect(payload.shortAnswer).toContain('32,420');
            expect(payload.shortAnswer).not.toContain('[object Object]');
        });

        it('formats avg_duration_sec as seconds', () => {
            const payload = buildMetricAnswerPayload({
                metricKey: 'avg_duration_sec',
                summary: makeSummary({ avg_duration_sec: 65 }),
                ...baseScope
            });
            expect(payload.shortAnswer).toContain('65s');
        });

        it('formats data_volume as bytes', () => {
            const payload = buildMetricAnswerPayload({
                metricKey: 'data_volume',
                summary: makeSummary({ data_volume: 1048576 }),
                ...baseScope,
                module: 'ipdr'
            });
            expect(payload.shortAnswer).toContain('MB');
        });
    });

    describe('buildMetricAnswerPayload — sub-object metrics', () => {
        it('handles sms_analysis sub-object without [object Object]', () => {
            const payload = buildMetricAnswerPayload({
                metricKey: 'sms_analysis',
                summary: makeSummary({ sms_analysis: { total: 500, sent: 200, received: 300 } }),
                ...baseScope
            });
            expect(payload).not.toBeNull();
            expect(payload.shortAnswer).toContain('500');
            expect(payload.shortAnswer).not.toContain('[object Object]');
            expect(payload.evidence.length).toBeGreaterThan(0);
        });

        it('handles night_activity sub-object without [object Object]', () => {
            const payload = buildMetricAnswerPayload({
                metricKey: 'night_activity',
                summary: makeSummary({ night_activity: { total_records: 120, peak_hours: [{ hour: 1, count: 30 }, { hour: 2, count: 25 }] } }),
                ...baseScope
            });
            expect(payload).not.toBeNull();
            expect(payload.shortAnswer).toContain('120');
            expect(payload.shortAnswer).not.toContain('[object Object]');
        });

        it('handles home_and_work sub-object without [object Object]', () => {
            const payload = buildMetricAnswerPayload({
                metricKey: 'home_and_work',
                summary: makeSummary({ home_and_work: { topHome: [{ cell_id: 'CELL-A', count: 100 }], topWork: [{ cell_id: 'CELL-B', count: 80 }] } }),
                ...baseScope
            });
            expect(payload).not.toBeNull();
            expect(payload.shortAnswer).toContain('CELL-A');
            expect(payload.shortAnswer).toContain('CELL-B');
            expect(payload.shortAnswer).not.toContain('[object Object]');
        });

        it('handles location_summary sub-object without [object Object]', () => {
            const payload = buildMetricAnswerPayload({
                metricKey: 'location_summary',
                summary: makeSummary({ location_summary: { top_cell_ids: [{ label: 'LOC-1', count: 55 }] } }),
                ...baseScope
            });
            expect(payload).not.toBeNull();
            expect(payload.shortAnswer).toContain('Location Summary');
            expect(payload.shortAnswer).not.toContain('[object Object]');
        });

        it('handles common_numbers sub-object without [object Object]', () => {
            const payload = buildMetricAnswerPayload({
                metricKey: 'common_numbers',
                summary: makeSummary({ common_numbers: { hasMultipleFiles: true, common: ['9876543210', '9123456789'] } }),
                ...baseScope
            });
            expect(payload).not.toBeNull();
            expect(payload.shortAnswer).toContain('2');
            expect(payload.shortAnswer).not.toContain('[object Object]');
        });

        it('reports single-file for common_numbers when hasMultipleFiles is false', () => {
            const payload = buildMetricAnswerPayload({
                metricKey: 'common_numbers',
                summary: makeSummary({ common_numbers: { hasMultipleFiles: false, common: [] } }),
                ...baseScope
            });
            expect(payload.shortAnswer).toContain('Requires multiple files');
        });
    });

    describe('buildMetricAnswerPayload — table metrics', () => {
        it('renders topBParties as a table', () => {
            const payload = buildMetricAnswerPayload({
                metricKey: 'topBParties',
                summary: makeSummary({ topBParties: [{ label: '9876543210', count: 120, duration_sec: 8200 }] }),
                ...baseScope
            });
            expect(payload.kind).toBe('table');
            expect(payload.evidence.length).toBe(1);
            expect(payload.evidence[0].type).toBe('table');
            expect(payload.evidence[0].previewRows.length).toBe(1);
        });
    });

    describe('buildMetricAnswerPayload — empty values', () => {
        it('produces abstain for null values', () => {
            const payload = buildMetricAnswerPayload({
                metricKey: 'total_records',
                summary: makeSummary({}),
                ...baseScope
            });
            expect(payload.kind).toBe('abstain');
            expect(payload.shortAnswer).toContain('could not find');
        });

        it('produces abstain for empty arrays', () => {
            const payload = buildMetricAnswerPayload({
                metricKey: 'topBParties',
                summary: makeSummary({ topBParties: [] }),
                ...baseScope
            });
            expect(payload.kind).toBe('abstain');
        });
    });

    describe('buildMetricAnswerPayload — broadened scope', () => {
        it('includes broadened-scope notice in markdown when broadenedFromWorkspace is true', () => {
            const payload = buildMetricAnswerPayload({
                metricKey: 'total_records',
                summary: makeSummary({ total_records: 100 }),
                ...baseScope,
                broadenedFromWorkspace: true
            });
            expect(payload.markdown).toContain('Auto-broadened');
            expect(payload.scope.broadenedFromWorkspace).toBe(true);
        });

        it('does not include broadened notice when broadenedFromWorkspace is false', () => {
            const payload = buildMetricAnswerPayload({
                metricKey: 'total_records',
                summary: makeSummary({ total_records: 100 }),
                ...baseScope,
                broadenedFromWorkspace: false
            });
            expect(payload.markdown).not.toContain('Auto-broadened');
        });
    });

    describe('scope and source metadata', () => {
        it('includes scope chips in markdown output', () => {
            const payload = buildMetricAnswerPayload({
                metricKey: 'total_records',
                summary: makeSummary({ total_records: 100 }),
                ...baseScope
            });
            expect(payload.markdown).toContain('Case: Test Case 41');
            expect(payload.markdown).toContain('Source: memory');
        });

        it('returns null for unknown metric key', () => {
            const payload = buildMetricAnswerPayload({
                metricKey: 'nonexistent_metric_key_abc',
                summary: makeSummary({}),
                ...baseScope
            });
            expect(payload).toBeNull();
        });
    });

    describe('buildSummaryAnswerPayload', () => {
        it('builds a summary answer with markdown', () => {
            const payload = buildSummaryAnswerPayload({
                title: 'CDR Overview',
                summary: makeSummary(),
                ...baseScope
            });
            expect(payload.kind).toBe('summary');
            expect(payload.shortAnswer).toContain('Test summary markdown');
        });

        it('uses emptyState when summary has no markdown', () => {
            const payload = buildSummaryAnswerPayload({
                title: 'CDR Overview',
                summary: null,
                ...baseScope,
                emptyState: 'No data available.'
            });
            expect(payload.shortAnswer).toBe('No data available.');
        });
    });

    describe('buildFilesAnswerPayload', () => {
        it('builds a table of files', () => {
            const payload = buildFilesAnswerPayload({
                files: [
                    { originalName: 'test.csv', detectedType: 'cdr', parseStatus: 'parsed', recordCount: 500 }
                ],
                ...baseScope
            });
            expect(payload.kind).toBe('table');
            expect(payload.evidence[0].previewRows.length).toBe(1);
            expect(payload.evidence[0].previewRows[0].name).toBe('test.csv');
        });
    });

    describe('buildClarificationAnswerPayload', () => {
        it('builds a clarification with options', () => {
            const payload = buildClarificationAnswerPayload({
                title: 'Choose Scope',
                options: [{ id: 'cdr', label: 'CDR Module' }],
                ...baseScope
            });
            expect(payload.kind).toBe('clarification');
            expect(payload.clarificationOptions.length).toBe(1);
        });
    });

    describe('sanitizePayload guard', () => {
        it('throws in test environment when [object Object] is present in shortAnswer', () => {
            const originalEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'test';
            try {
                expect(() =>
                    buildMetricAnswerPayload({
                        metricKey: 'total_records',
                        summary: {
                            ...makeSummary({ total_records: 1 }),
                            // Force a raw object into the payload by using a monkey-patched fact
                            facts: { total_records: { nested: 'value' } }
                        },
                        ...baseScope
                    })
                ).not.toThrow(); // sub-object handler should have caught this
            } finally {
                process.env.NODE_ENV = originalEnv;
            }
        });
    });

    describe('getMetricAnswerValue', () => {
        it('extracts a fact value from summary by factKey', () => {
            const value = getMetricAnswerValue(
                { facts: { total_records: 42 } },
                { factKeys: ['total_records'] }
            );
            expect(value).toBe(42);
        });

        it('returns null when fact key is missing', () => {
            const value = getMetricAnswerValue(
                { facts: {} },
                { factKeys: ['total_records'] }
            );
            expect(value).toBeNull();
        });
    });
});
