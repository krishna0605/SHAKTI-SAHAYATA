import { describe, expect, it } from 'vitest';

const {
    classifyIntent,
    buildScopeDescriptor,
    generatePlan,
    applyFollowUpResolution,
    buildSessionStatePatch,
    INTENT_TYPES,
    INTENT_TO_HANDLER,
    FALLBACK_CHAIN
} = await import('../../services/chatbot/planner.service.js');

describe('planner.service', () => {
    describe('classifyIntent', () => {
        it('classifies "how many records" as metric_lookup', () => {
            const intent = classifyIntent('how many records');
            expect(intent.type).toBe('metric_lookup');
            expect(intent.confidence).toBeGreaterThanOrEqual(0.9);
            expect(intent.metricKey).toBe('total_records');
        });

        it('classifies "total records" as metric_lookup with catalog entry', () => {
            const intent = classifyIntent('total records');
            expect(intent.type).toBe('metric_lookup');
            expect(intent.catalogEntry).not.toBeNull();
            expect(intent.catalogEntry.key).toBe('total_records');
        });

        it('classifies "uploaded files" as file_question', () => {
            const intent = classifyIntent('uploaded files');
            expect(intent.type).toBe('file_question');
        });

        it('classifies "tell me a joke" as chit_chat', () => {
            const intent = classifyIntent('tell me a joke');
            expect(intent.type).toBe('chit_chat');
            expect(intent.confidence).toBeGreaterThanOrEqual(0.9);
        });

        it('classifies "how are you" as chit_chat', () => {
            const intent = classifyIntent('how are you');
            expect(intent.type).toBe('chit_chat');
        });

        it('classifies "hello" as greeting', () => {
            const intent = classifyIntent('hello');
            expect(intent.type).toBe('greeting');
        });

        it('classifies "namaste" as greeting', () => {
            const intent = classifyIntent('namaste');
            expect(intent.type).toBe('greeting');
        });

        it('classifies "SELECT * FROM cdr_records" as sql_command', () => {
            const intent = classifyIntent('SELECT * FROM cdr_records');
            expect(intent.type).toBe('sql_command');
        });

        it('classifies "yes" with pending SQL as pending_sql', () => {
            const intent = classifyIntent('yes', { hasPendingSql: true });
            expect(intent.type).toBe('pending_sql');
        });

        it('classifies "yes" without pending SQL as not pending_sql', () => {
            const intent = classifyIntent('yes', { hasPendingSql: false });
            expect(intent.type).not.toBe('pending_sql');
        });

        it('classifies "summarize this case" as summary_request', () => {
            const intent = classifyIntent('summarize this case');
            expect(intent.type).toBe('summary_request');
        });

        it('classifies "find IMEI 123456789012345" as entity_lookup', () => {
            const intent = classifyIntent('find IMEI 123456789012345');
            // Could be entity_lookup or metric_lookup depending on catalog match
            expect(['entity_lookup', 'metric_lookup', 'record_search']).toContain(intent.type);
        });

        it('classifies "IPC section" as case_fact', () => {
            const intent = classifyIntent('what is the IPC section');
            expect(intent.type).toBe('case_fact');
        });

        it('classifies "common contacts" as case_insight', () => {
            const intent = classifyIntent('show common contacts');
            expect(intent.type).toBe('case_insight');
        });

        it('classifies "crime prediction" as prediction', () => {
            const intent = classifyIntent('crime prediction for this area');
            expect(intent.type).toBe('prediction');
        });

        it('classifies "case summary" as fir_summary', () => {
            const intent = classifyIntent('case summary');
            expect(intent.type).toBe('fir_summary');
        });

        it('classifies empty string as unknown', () => {
            const intent = classifyIntent('');
            expect(intent.type).toBe('unknown');
            expect(intent.confidence).toBe(0);
        });

        it('classifies random gibberish as unknown with low confidence', () => {
            const intent = classifyIntent('xyzabc123 qwerty');
            expect(intent.type).toBe('unknown');
            expect(intent.confidence).toBeLessThan(0.9);
        });

        it('always returns a valid intent type', () => {
            const testMessages = [
                'hello', 'how many records', 'tell me a joke',
                'SELECT 1', 'summarize', 'find phone 9876543210',
                '   ', 'xyz', 'international calls'
            ];
            for (const msg of testMessages) {
                const intent = classifyIntent(msg);
                expect(INTENT_TYPES, `"${msg}" returned invalid type: ${intent.type}`).toContain(intent.type);
            }
        });
    });

    describe('buildScopeDescriptor', () => {
        it('builds scope from resolved context with case and module', () => {
            const scope = buildScopeDescriptor(
                { caseId: '41', caseName: 'Test Case', module: 'cdr' },
                null,
                null
            );
            expect(scope.caseId).toBe('41');
            expect(scope.caseLabel).toBe('Test Case');
            expect(scope.module).toBe('cdr');
            expect(scope.scopeMode).toBe('module-casewide');
        });

        it('builds scope with workspace narrow scope', () => {
            const scope = buildScopeDescriptor(
                { caseId: '41' },
                { module: 'cdr', view: 'overview', selectedFileIds: [29, 30] },
                null
            );
            expect(scope.module).toBe('cdr');
            expect(scope.view).toBe('overview');
            expect(scope.scopeMode).toBe('workspace');
            expect(scope.hasNarrowScope).toBe(true);
            expect(scope.selectedFileIds).toEqual([29, 30]);
        });

        it('falls back to session state for module and case', () => {
            const scope = buildScopeDescriptor(
                {},
                null,
                { lastCaseId: '42', lastModule: 'ipdr', lastView: 'map', lastMetricKey: 'total_records' }
            );
            expect(scope.caseId).toBe('42');
            expect(scope.module).toBe('ipdr');
            expect(scope.view).toBe('map');
            expect(scope.lastMetricKey).toBe('total_records');
            expect(scope.scopeOrigin).toBe('session_carry');
        });

        it('returns case-wide scope when no module', () => {
            const scope = buildScopeDescriptor({ caseId: '41' }, null, null);
            expect(scope.scopeMode).toBe('case-wide');
        });
    });

    describe('generatePlan', () => {
        it('produces a plan with correct primary handler for metric_lookup', () => {
            const plan = generatePlan('how many records', {
                resolvedContext: { caseId: '41', module: 'cdr' }
            });
            expect(plan.intent.type).toBe('metric_lookup');
            expect(plan.primaryHandler).toBe('handleWorkspaceAwareResponse');
            expect(plan.metricKey).toBe('total_records');
            expect(plan.scope.caseId).toBe('41');
        });

        it('produces a plan with correct primary handler for greeting', () => {
            const plan = generatePlan('hello');
            expect(plan.intent.type).toBe('greeting');
            expect(plan.primaryHandler).toBe('handleSimpleGreeting');
        });

        it('produces a plan with logFields for observability', () => {
            const plan = generatePlan('total records', {
                resolvedContext: { caseId: '41', module: 'cdr' }
            });
            expect(plan.logFields.intent_type).toBe('metric_lookup');
            expect(plan.logFields.metric_key).toBe('total_records');
            expect(plan.logFields.module).toBe('cdr');
            expect(plan.logFields.scope_mode).toBe('module-casewide');
        });

        it('produces fallbacks that do not include the primary handler', () => {
            const plan = generatePlan('total records', {
                resolvedContext: { caseId: '41', module: 'cdr' }
            });
            expect(plan.fallbacks).not.toContain(plan.primaryHandler);
        });

        it('resolves follow-up for "broaden" when lastMetricKey exists', () => {
            const plan = generatePlan('broaden to entire case', {
                resolvedContext: { caseId: '41', module: 'cdr' },
                sessionState: { lastMetricKey: 'total_records', lastModule: 'cdr' }
            });
            expect(plan.followUpResolution).not.toBeNull();
            expect(plan.followUpResolution.action).toBe('broaden');
            expect(plan.followUpResolution.lastMetricKey).toBe('total_records');
        });

        it('returns null follow-up when no lastMetricKey in session', () => {
            const plan = generatePlan('broaden to entire case', {
                resolvedContext: { caseId: '41' },
                sessionState: {}
            });
            expect(plan.followUpResolution).toBeNull();
        });

        it('produces plan for chit-chat', () => {
            const plan = generatePlan('tell me a joke');
            expect(plan.intent.type).toBe('chit_chat');
            expect(plan.primaryHandler).toBe('handleChitChatRejection');
        });
    });

    describe('applyFollowUpResolution', () => {
        it('rewrites broaden follow-ups to case-wide scope and keeps the last metric', () => {
            const plan = generatePlan('broaden to entire case', {
                resolvedContext: { caseId: '41', module: 'cdr' },
                workspaceContext: { caseId: '41', module: 'cdr', view: 'advanced', selectedFileIds: [29] },
                sessionState: { lastMetricKey: 'daily_first_last_call', lastModule: 'cdr', lastLimit: 10 }
            });

            const resolved = applyFollowUpResolution(plan, {
                lastMetricKey: 'daily_first_last_call',
                lastModule: 'cdr',
                lastLimit: 10
            });

            expect(resolved.primaryHandler).toBe('handleWorkspaceAwareResponse');
            expect(resolved.scope.scopeMode).toBe('case-wide');
            expect(resolved.scope.selectedFileIds).toEqual([]);
            expect(resolved.messageOverride).toContain('Daily First/Last Call');
        });

        it('switches module for "same for IPDR" while keeping the locked case', () => {
            const plan = generatePlan('same for IPDR', {
                resolvedContext: { caseId: '41', module: 'cdr' },
                sessionState: { lastMetricKey: 'total_records', lastModule: 'cdr' }
            });

            const resolved = applyFollowUpResolution(plan, {
                lastMetricKey: 'total_records',
                lastModule: 'cdr'
            });

            expect(resolved.scope.caseId).toBe('41');
            expect(resolved.scope.module).toBe('ipdr');
            expect(resolved.primaryHandler).toBe('handleWorkspaceAwareResponse');
            expect(resolved.workspaceContextOverride?.module).toBe('ipdr');
        });

        it('expands the limit for "show more" follow-ups', () => {
            const plan = generatePlan('show more', {
                resolvedContext: { caseId: '41', module: 'ipdr' },
                sessionState: { lastMetricKey: 'top_msisdn', lastModule: 'ipdr', lastLimit: 10 }
            });

            const resolved = applyFollowUpResolution(plan, {
                lastMetricKey: 'top_msisdn',
                lastModule: 'ipdr',
                lastLimit: 10
            });

            expect(resolved.queryOptions.limit).toBe(50);
            expect(resolved.primaryHandler).toBe('handleWorkspaceAwareResponse');
        });

        it('returns an unresolved follow-up when "that number" has no grounded entity context', () => {
            const plan = generatePlan('that number', {
                resolvedContext: { caseId: '41', module: 'cdr' },
                sessionState: { lastMetricKey: 'international_calls', lastModule: 'cdr' }
            });

            const resolved = applyFollowUpResolution(plan, {
                lastMetricKey: 'international_calls',
                lastModule: 'cdr',
                lastEntityRefs: []
            });

            expect(resolved.unresolvedFollowUp).toBeTruthy();
            expect(resolved.unresolvedFollowUp.reason).toBe('missing_entity_reference');
        });
    });

    describe('buildSessionStatePatch', () => {
        it('builds a patch with case and metric tracking', () => {
            const plan = generatePlan('total records', {
                resolvedContext: { caseId: '41', module: 'cdr' }
            });
            const patch = buildSessionStatePatch(plan, {
                answerPayload: {
                    kind: 'scalar',
                    scope: { module: 'cdr' },
                    debugMeta: {
                        metricKey: 'total_records',
                        entityRefs: ['9876543210'],
                        evidenceColumns: ['number', 'count'],
                        defaultLimit: 50
                    }
                }
            });
            expect(patch.lastCaseId).toBe('41');
            expect(patch.lastModule).toBe('cdr');
            expect(patch.lastMetricKey).toBe('total_records');
            expect(patch.lastAnswerType).toBe('scalar');
            expect(patch.lastIntent).toBe('metric_lookup');
            expect(patch.lastEntityRefs).toEqual(['9876543210']);
            expect(patch.lastEvidenceColumns).toEqual(['number', 'count']);
            expect(patch.lastLimit).toBe(50);
        });

        it('uses plan scope when result has no payload', () => {
            const plan = generatePlan('hello');
            const patch = buildSessionStatePatch(plan, {});
            expect(patch.lastIntent).toBe('greeting');
            expect(patch.lastPlannerPath).toBe('handleSimpleGreeting');
        });
    });

    describe('intent-to-handler mapping', () => {
        it('maps all intent types to a handler', () => {
            for (const intentType of INTENT_TYPES) {
                expect(INTENT_TO_HANDLER[intentType], `Missing handler for ${intentType}`).toBeDefined();
            }
        });

        it('FALLBACK_CHAIN contains handleDefaultChat as the last entry', () => {
            expect(FALLBACK_CHAIN[FALLBACK_CHAIN.length - 1]).toBe('handleDefaultChat');
        });
    });
});
