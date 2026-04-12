/**
 * Deterministic Planner Service
 *
 * Classifies the user's intent, resolves scope, and produces a typed execution
 * plan that the chatbot route can follow without trial-and-error handler chains.
 *
 * Intent taxonomy:
 *   metric_lookup     → user asks for a specific metric ("how many records")
 *   summary_request   → user asks for an overview / summary / analysis
 *   record_search     → user asks to find / search / list records
 *   file_question     → user asks about uploaded files
 *   entity_lookup     → user asks about a specific IMEI / MSISDN / phone
 *   case_fact         → user asks a deterministic case fact (FIR, date, sections)
 *   case_insight      → user asks for an insight (top contacts, common numbers)
 *   fir_summary       → user asks for FIR / case summary
 *   prediction        → user asks for crime prediction
 *   open_cdr          → user asks to open CDR / run query
 *   sql_command        → user sends a raw SQL command
 *   pending_sql       → user confirms or rejects a pending SQL
 *   greeting          → simple greeting
 *   chit_chat         → non-case small talk
 *   unknown           → cannot be classified
 */

import {
    classifyGroundability,
    resolveCaseQaCatalogEntry,
    normalizeCaseQaModule,
    normalizeCaseQaView,
    CASE_QA_MODULE_LABELS,
    getMetricLabel
} from '../../../shared/chatbot/caseQaCatalog.js';

// ─── Intent Taxonomy ────────────────────────────────────────────────────

const INTENT_TYPES = [
    'metric_lookup',
    'summary_request',
    'record_search',
    'file_question',
    'entity_lookup',
    'case_fact',
    'case_insight',
    'fir_summary',
    'prediction',
    'open_cdr',
    'sql_command',
    'pending_sql',
    'greeting',
    'chit_chat',
    'unknown'
];

// ─── Scope Descriptor ───────────────────────────────────────────────────

/**
 * Build a unified scope descriptor from the resolved context.
 *
 * @param {object} resolvedContext - merged session + message entities
 * @param {object|null} workspaceContext - normalized workspace context
 * @param {object|null} sessionState - session.state (prior turn state)
 * @returns {ScopeDescriptor}
 */
export const buildScopeDescriptor = (resolvedContext = {}, workspaceContext = null, sessionState = null) => {
    const caseId = resolvedContext.caseId || workspaceContext?.caseId || sessionState?.lastCaseId || null;
    const module = workspaceContext?.module || resolvedContext.module || sessionState?.lastModule || null;
    const view = workspaceContext?.view || sessionState?.lastView || null;

    const hasNarrowScope = Boolean(
        (workspaceContext?.selectedFileIds || []).length > 0
        || (workspaceContext?.filters && Object.keys(workspaceContext.filters).length > 0)
        || workspaceContext?.searchState?.query
        || workspaceContext?.mapState?.selectedTower
        || workspaceContext?.graphState?.selectedNode
        || workspaceContext?.graphState?.selectedParty
        || (workspaceContext?.selectedEntities || []).length > 0
    );

    return {
        caseId,
        caseLabel: resolvedContext.caseName || resolvedContext.caseNumber || (caseId ? `Case ${caseId}` : null),
        module,
        moduleLabel: module ? (CASE_QA_MODULE_LABELS[module] || module.toUpperCase()) : null,
        view,
        scopeMode: module ? (hasNarrowScope ? 'workspace' : 'module-casewide') : 'case-wide',
        scopeOrigin: workspaceContext?.caseId ? 'workspace_context' : (sessionState?.lastCaseId ? 'session_carry' : 'locked_session_case'),
        selectedFileIds: workspaceContext?.selectedFileIds || [],
        selectedFileNames: workspaceContext?.selectedFileNames || [],
        filtersApplied: workspaceContext?.filters || null,
        searchQuery: workspaceContext?.searchState?.query || null,
        selectedEntities: workspaceContext?.selectedEntities || [],
        hasNarrowScope,

        // Follow-up context from prior turns
        lastMetricKey: sessionState?.lastMetricKey || null,
        lastEntityRefs: Array.isArray(sessionState?.lastEntityRefs) ? sessionState.lastEntityRefs : [],
        lastAnswerType: sessionState?.lastAnswerType || null,
        lastScope: sessionState?.lastScope || null,
        lastEvidenceColumns: Array.isArray(sessionState?.lastEvidenceColumns) ? sessionState.lastEvidenceColumns : [],
        lastLimit: Number.isFinite(Number(sessionState?.lastLimit)) ? Number(sessionState.lastLimit) : null
    };
};

// ─── Intent Classification ──────────────────────────────────────────────

const GREETING_PATTERNS = /^(hi|hello|hey|namaste|namaskar|kem cho|salam)\b/i;
const SQL_COMMAND_PATTERN = /^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\b/i;
const FIR_SUMMARY_PATTERNS = /\b(fir|case)\s*(summary|overview|detail|number)\b/i;
const PREDICTION_PATTERNS = /\b(predict|prediction|forecast|risk|hotspot|crime\s*prediction)\b/i;
const OPEN_CDR_PATTERNS = /\b(open\s*cdr|run\s*cdr|open\s*analysis|start\s*analysis)\b/i;
const ENTITY_PATTERNS = /\b(imei|imsi|msisdn|phone)\s*(?:number)?\s*(?:is|:)?\s*[\d\-+]+/i;
const FACT_PATTERNS = /\b(ipc\s*section|case\s*date|date\s*of\s*offence|fir\s*date|complainant|victim|accused|offence|police\s*station|court)\b/i;
const INSIGHT_PATTERNS = /\b(common\s*contacts?|associated\s*names?|top\s*contacts?|common\s*numbers?|shared\s*contacts?|link|connection|relationship)\b/i;
const RECORD_SEARCH_PATTERNS = /\b(find|search|lookup|look\s*up|show\s*me|records?\s*for|rows?\s*for|list|entries\s*for)\b.*\b(\d{10}|imei|imsi|msisdn|phone|number)\b/i;
const FILE_PATTERNS = /\b(file|upload|uploaded|manifest|parsed|parse\s*status)\b/i;
const PENDING_SQL_PATTERNS = /^(yes|no|confirm|cancel|run|execute|haan|nahi|ha|na)\s*$/i;

/**
 * Classify the user's intent from the message text and context.
 *
 * Returns an intent object: { type, confidence, metricKey, catalogEntry, groundability }
 */
export const classifyIntent = (message = '', { scope = null, sessionState = null, hasPendingSql = false } = {}) => {
    const text = String(message || '').trim();
    if (!text) return { type: 'unknown', confidence: 0, metricKey: null, catalogEntry: null, groundability: null };

    // 1. Pending SQL confirmation
    if (hasPendingSql && PENDING_SQL_PATTERNS.test(text)) {
        return { type: 'pending_sql', confidence: 0.99, metricKey: null, catalogEntry: null, groundability: null };
    }

    // 2. Raw SQL command
    if (SQL_COMMAND_PATTERN.test(text)) {
        return { type: 'sql_command', confidence: 0.99, metricKey: null, catalogEntry: null, groundability: null };
    }

    // 3. Simple greeting
    if (GREETING_PATTERNS.test(text) && text.split(/\s+/).length <= 3) {
        return { type: 'greeting', confidence: 0.95, metricKey: null, catalogEntry: null, groundability: null };
    }

    // 4. Groundability classification
    const groundability = classifyGroundability(text);

    // 5. Chit-chat
    if (!groundability.groundable && groundability.bucket === 'chit_chat' && groundability.confidence >= 0.9) {
        return { type: 'chit_chat', confidence: groundability.confidence, metricKey: null, catalogEntry: null, groundability };
    }

    // 6. FIR / case summary (checked before catalog since "case summary" matches catalog aliases)
    if (FIR_SUMMARY_PATTERNS.test(text)) {
        return { type: 'fir_summary', confidence: 0.9, metricKey: null, catalogEntry: null, groundability };
    }

    // 7. Catalog-matched metric lookup
    const catalogEntry = resolveCaseQaCatalogEntry({ message: text, module: scope?.module });
    if (catalogEntry) {
        const isFileQuestion = catalogEntry.key === 'uploaded_files' || catalogEntry.key === 'file_manifest';
        return {
            type: isFileQuestion ? 'file_question' : 'metric_lookup',
            confidence: 0.95,
            metricKey: catalogEntry.key,
            catalogEntry,
            groundability
        };
    }

    // 8. Crime prediction
    if (PREDICTION_PATTERNS.test(text)) {
        return { type: 'prediction', confidence: 0.9, metricKey: null, catalogEntry: null, groundability };
    }

    // 9. Open CDR / analysis
    if (OPEN_CDR_PATTERNS.test(text)) {
        return { type: 'open_cdr', confidence: 0.9, metricKey: null, catalogEntry: null, groundability };
    }

    // 10. Record search with entity
    if (RECORD_SEARCH_PATTERNS.test(text)) {
        return { type: 'record_search', confidence: 0.85, metricKey: null, catalogEntry: null, groundability };
    }

    // 11. Entity lookup (IMEI / MSISDN / phone number)
    if (ENTITY_PATTERNS.test(text)) {
        return { type: 'entity_lookup', confidence: 0.85, metricKey: null, catalogEntry: null, groundability };
    }

    // 12. Case fact (IPC section, date, complainant, etc.)
    if (FACT_PATTERNS.test(text)) {
        return { type: 'case_fact', confidence: 0.85, metricKey: null, catalogEntry: null, groundability };
    }

    // 13. Case insight (common contacts, associated names)
    if (INSIGHT_PATTERNS.test(text)) {
        return { type: 'case_insight', confidence: 0.85, metricKey: null, catalogEntry: null, groundability };
    }

    // 14. File question
    if (FILE_PATTERNS.test(text)) {
        return { type: 'file_question', confidence: 0.8, metricKey: 'uploaded_files', catalogEntry: null, groundability };
    }

    // 15. Summary request (from groundability bucket)
    if (groundability.bucket === 'summary') {
        return { type: 'summary_request', confidence: 0.8, metricKey: 'module_summary', catalogEntry: null, groundability };
    }

    // 16. Generic record search (from groundability bucket)
    if (groundability.bucket === 'record_search') {
        return { type: 'record_search', confidence: 0.75, metricKey: null, catalogEntry: null, groundability };
    }

    // 17. Any other groundable intent
    if (groundability.groundable) {
        return { type: 'metric_lookup', confidence: 0.7, metricKey: null, catalogEntry: null, groundability };
    }

    // 18. Unknown — low confidence, will route to LLM fallback
    return { type: 'unknown', confidence: groundability.confidence, metricKey: null, catalogEntry: null, groundability };
};

// ─── Plan Generation ────────────────────────────────────────────────────

/**
 * Map intent types to handler names in the chatbot route.
 * These correspond to the existing handler functions.
 */
const INTENT_TO_HANDLER = {
    pending_sql: 'handlePendingSql',
    sql_command: 'handleSqlCommand',
    greeting: 'handleSimpleGreeting',
    chit_chat: 'handleChitChatRejection',
    metric_lookup: 'handleWorkspaceAwareResponse',
    file_question: 'handleWorkspaceAwareResponse',
    record_search: 'handleWorkspaceAwareResponse',
    summary_request: 'handleWorkspaceAwareResponse',
    case_fact: 'handleDeterministicCaseFact',
    case_insight: 'handleDeterministicCaseInsight',
    fir_summary: 'handleFirSummary',
    prediction: 'handleCrimePrediction',
    open_cdr: 'handleOpenCdr',
    entity_lookup: 'handleWorkspaceAwareResponse',
    unknown: 'handleDefaultChat'
};

/**
 * Fallback handlers to try when the primary handler returns false.
 * Order matters — these are tried sequentially.
 */
const FALLBACK_CHAIN = [
    'handleWorkspaceAwareResponse',
    'handleDeterministicCaseFact',
    'handleDeterministicCaseInsight',
    'handleCaseAwareSummary',
    'handleFirSummary',
    'handleCrimePrediction',
    'handleOpenCdr',
    'handleDirectDbRequest',
    'handleDefaultChat'
];

/**
 * Generate a deterministic execution plan for the given message.
 *
 * @param {string} message - user message
 * @param {object} context - { resolvedContext, workspaceContext, sessionState, hasPendingSql }
 * @returns {Plan}
 */
export const generatePlan = (message = '', { resolvedContext = {}, workspaceContext = null, sessionState = null, hasPendingSql = false } = {}) => {
    const scope = buildScopeDescriptor(resolvedContext, workspaceContext, sessionState);
    const intent = classifyIntent(message, { scope, sessionState, hasPendingSql });

    const primaryHandler = INTENT_TO_HANDLER[intent.type] || 'handleDefaultChat';
    const fallbacks = FALLBACK_CHAIN.filter((h) => h !== primaryHandler);

    // Build the execution plan
    const plan = {
        intent,
        scope,
        primaryHandler,
        fallbacks,
        metricKey: intent.metricKey || null,
        catalogEntry: intent.catalogEntry || null,

        // Structured log fields for observability
        logFields: {
            intent_type: intent.type,
            intent_confidence: intent.confidence,
            metric_key: intent.metricKey || null,
            planner_path: primaryHandler,
            scope_mode: scope.scopeMode,
            scope_origin: scope.scopeOrigin,
            module: scope.module || null,
            view: scope.view || null,
            has_narrow_scope: scope.hasNarrowScope,
            has_follow_up: Boolean(scope.lastMetricKey)
        },

        // Follow-up slot resolution
        followUpResolution: resolveFollowUp(message, intent, scope)
    };

    return plan;
};

// ─── Follow-Up Slot Resolution ──────────────────────────────────────────

const FOLLOW_UP_PATTERNS = {
    broaden: /\b(broaden|expand|entire case|case wide|all files|full case)\b/i,
    evidence: /\b(evidence|show evidence|show more|details?|drill|expand)\b/i,
    different_module: /\b(show me (?:the )?(cdr|ipdr|sdr|tower|ild)\b|(switch to|change to|go to|same for|same in)\s+(cdr|ipdr|sdr|tower|ild))\b/i,
    refine: /\b(filter|only|just|specific|narrow)\b/i,
    compare: /\b(compare|versus|vs|difference)\b/i,
    next: /\b(next|more|continue|what else)\b/i,
    file: /\b(from which file|which file|same file|file wise|file-wise)\b/i,
    whichDay: /\b(which day|what day|day wise|day-wise)\b/i,
    thatNumber: /\b(that number|this number|same number)\b/i,
    openRecords: /\b(open records|show records|record view|open full records)\b/i
};

/**
 * Detect if the current message is a follow-up to the prior answer.
 *
 * @returns {{ isFollowUp, action, targetModule, lastMetricKey }} or null
 */
const resolveFollowUp = (message = '', intent, scope) => {
    const text = String(message || '').trim().toLowerCase();
    if (!text || !scope?.lastMetricKey) return null;

    // Check for broaden request
    if (FOLLOW_UP_PATTERNS.broaden.test(text)) {
        return { isFollowUp: true, action: 'broaden', targetModule: scope.module, lastMetricKey: scope.lastMetricKey };
    }

    // Check for evidence toggle
    if (FOLLOW_UP_PATTERNS.evidence.test(text)) {
        return { isFollowUp: true, action: 'show_evidence', targetModule: scope.module, lastMetricKey: scope.lastMetricKey };
    }

    if (FOLLOW_UP_PATTERNS.openRecords.test(text)) {
        return { isFollowUp: true, action: 'open_records', targetModule: scope.module, lastMetricKey: scope.lastMetricKey };
    }

    // Check for module switch
    const moduleMatch = text.match(FOLLOW_UP_PATTERNS.different_module);
    if (moduleMatch) {
        const targetModule = normalizeCaseQaModule(moduleMatch[2] || moduleMatch[4]);
        if (targetModule && targetModule !== scope.module) {
            return { isFollowUp: true, action: 'switch_module', targetModule, lastMetricKey: scope.lastMetricKey };
        }
    }

    // Check for refine
    if (FOLLOW_UP_PATTERNS.refine.test(text)) {
        return { isFollowUp: true, action: 'refine', targetModule: scope.module, lastMetricKey: scope.lastMetricKey };
    }

    if (FOLLOW_UP_PATTERNS.file.test(text)) {
        return { isFollowUp: true, action: 'from_file', targetModule: scope.module, lastMetricKey: scope.lastMetricKey };
    }

    if (FOLLOW_UP_PATTERNS.whichDay.test(text)) {
        return { isFollowUp: true, action: 'which_day', targetModule: scope.module, lastMetricKey: scope.lastMetricKey };
    }

    if (FOLLOW_UP_PATTERNS.thatNumber.test(text)) {
        return { isFollowUp: true, action: 'that_number', targetModule: scope.module, lastMetricKey: scope.lastMetricKey };
    }

    // Check for "more" / "next"
    if (FOLLOW_UP_PATTERNS.next.test(text) && intent.type === 'unknown') {
        return { isFollowUp: true, action: 'continue', targetModule: scope.module, lastMetricKey: scope.lastMetricKey };
    }

    return null;
};

const buildCaseWideWorkspaceContext = (scope = {}) => ({
    caseId: scope.caseId || null,
    caseTag: scope.caseLabel || null,
    module: scope.module || null,
    view: scope.view || null,
    selectedFileIds: [],
    selectedFileNames: [],
    selectedEntities: [],
    filters: null,
    searchState: null,
    mapState: null,
    graphState: null
});

const buildRecordWorkspaceContext = (scope = {}, entityRefs = []) => ({
    ...buildCaseWideWorkspaceContext(scope),
    view: 'records',
    selectedEntities: Array.isArray(entityRefs) ? entityRefs : []
});

const deriveReplayMessage = (sessionState = {}, scope = {}) => {
    const entityRefs = Array.isArray(sessionState?.lastEntityRefs) ? sessionState.lastEntityRefs.filter(Boolean) : [];
    if (entityRefs.length > 0) {
        return `find records for "${entityRefs[0]}"`;
    }
    if (scope?.lastMetricKey) {
        return getMetricLabel(scope.lastMetricKey) || scope.lastMetricKey;
    }
    return null;
};

export const applyFollowUpResolution = (plan, sessionState = {}) => {
    if (!plan?.followUpResolution?.isFollowUp) return plan;

    const followUp = plan.followUpResolution;
    const nextScope = {
        ...plan.scope,
        selectedFileIds: [...(plan.scope?.selectedFileIds || [])],
        selectedFileNames: [...(plan.scope?.selectedFileNames || [])],
        selectedEntities: [...(plan.scope?.selectedEntities || [])]
    };
    const entityRefs = Array.isArray(sessionState?.lastEntityRefs) ? sessionState.lastEntityRefs.filter(Boolean) : [];
    const defaultLimit = Number.isFinite(Number(sessionState?.lastLimit)) ? Math.max(Number(sessionState.lastLimit), 10) : 10;
    const nextPlan = {
        ...plan,
        scope: nextScope,
        workspaceContextOverride: null,
        messageOverride: deriveReplayMessage(sessionState, plan.scope),
        queryOptions: {
            limit: defaultLimit
        }
    };

    const unresolvedEntityFollowUp = (action) => ({
        ...nextPlan,
        unresolvedFollowUp: {
            action,
            reason: 'missing_entity_reference',
            title: 'Clarify Follow-up',
            shortAnswer: 'I need a specific number, entity, or prior record query before I can answer that follow-up.'
        }
    });

    if (!nextPlan.messageOverride && followUp.action !== 'show_evidence') {
        nextPlan.unresolvedFollowUp = {
            action: followUp.action,
            reason: 'missing_follow_up_context',
            title: 'Clarify Follow-up',
            shortAnswer: 'I could not find enough grounded context from the previous answer to continue this follow-up.'
        };
        return nextPlan;
    }

    switch (followUp.action) {
        case 'broaden':
            nextPlan.scope = {
                ...nextScope,
                scopeMode: 'case-wide',
                scopeOrigin: 'broadened_case_fallback',
                selectedFileIds: [],
                selectedFileNames: [],
                filtersApplied: null,
                searchQuery: null,
                selectedEntities: []
            };
            nextPlan.workspaceContextOverride = buildCaseWideWorkspaceContext(nextPlan.scope);
            nextPlan.primaryHandler = 'handleWorkspaceAwareResponse';
            nextPlan.logFields.scope_mode = 'case-wide';
            nextPlan.logFields.scope_origin = 'broadened_case_fallback';
            break;
        case 'show_evidence':
        case 'continue':
            nextPlan.queryOptions.limit = Math.max(defaultLimit, 50);
            nextPlan.primaryHandler = 'handleWorkspaceAwareResponse';
            break;
        case 'switch_module':
            nextPlan.scope = {
                ...nextScope,
                module: followUp.targetModule || nextScope.module,
                moduleLabel: followUp.targetModule ? (CASE_QA_MODULE_LABELS[followUp.targetModule] || followUp.targetModule.toUpperCase()) : nextScope.moduleLabel,
                view: null,
                scopeMode: 'module-casewide',
                selectedFileIds: [],
                selectedFileNames: [],
                filtersApplied: null,
                searchQuery: null,
                selectedEntities: []
            };
            nextPlan.workspaceContextOverride = buildCaseWideWorkspaceContext(nextPlan.scope);
            nextPlan.primaryHandler = 'handleWorkspaceAwareResponse';
            nextPlan.logFields.module = nextPlan.scope.module;
            nextPlan.logFields.scope_mode = 'module-casewide';
            break;
        case 'from_file':
            if (!entityRefs.length) return unresolvedEntityFollowUp('from_file');
            nextPlan.messageOverride = `find records for "${entityRefs[0]}" from which file`;
            nextPlan.workspaceContextOverride = buildRecordWorkspaceContext(nextPlan.scope, entityRefs);
            nextPlan.primaryHandler = 'handleWorkspaceAwareResponse';
            nextPlan.queryOptions.limit = Math.max(defaultLimit, 50);
            break;
        case 'which_day':
            if (nextScope.lastMetricKey === 'daily_first_last_call') {
                nextPlan.messageOverride = getMetricLabel('daily_first_last_call') || 'Daily First/Last Call';
                nextPlan.primaryHandler = 'handleWorkspaceAwareResponse';
                nextPlan.queryOptions.limit = Math.max(defaultLimit, 50);
                break;
            }
            if (!entityRefs.length) return unresolvedEntityFollowUp('which_day');
            nextPlan.messageOverride = `find records for "${entityRefs[0]}" which day`;
            nextPlan.workspaceContextOverride = buildRecordWorkspaceContext(nextPlan.scope, entityRefs);
            nextPlan.primaryHandler = 'handleWorkspaceAwareResponse';
            nextPlan.queryOptions.limit = Math.max(defaultLimit, 50);
            break;
        case 'that_number':
            if (!entityRefs.length) return unresolvedEntityFollowUp('that_number');
            nextPlan.messageOverride = `find records for "${entityRefs[0]}"`;
            nextPlan.workspaceContextOverride = buildRecordWorkspaceContext(nextPlan.scope, entityRefs);
            nextPlan.primaryHandler = 'handleWorkspaceAwareResponse';
            nextPlan.queryOptions.limit = Math.max(defaultLimit, 50);
            break;
        case 'open_records':
            if (!entityRefs.length && !nextPlan.messageOverride) return unresolvedEntityFollowUp('open_records');
            nextPlan.messageOverride = entityRefs.length > 0 ? `find records for "${entityRefs[0]}"` : nextPlan.messageOverride;
            nextPlan.workspaceContextOverride = buildRecordWorkspaceContext(nextPlan.scope, entityRefs);
            nextPlan.primaryHandler = 'handleWorkspaceAwareResponse';
            nextPlan.queryOptions.limit = Math.max(defaultLimit, 50);
            break;
        default:
            break;
    }

    return nextPlan;
};

// ─── Session State Patch Builder ────────────────────────────────────────

/**
 * Build a session state patch from the plan after a successful answer.
 * Call this after the handler produces a result.
 *
 * @param {Plan} plan
 * @param {object} result - the answer result from the handler
 * @returns {object} patch to merge into session state
 */
export const buildSessionStatePatch = (plan, result = {}) => ({
    lastCaseId: plan.scope.caseId || null,
    lastModule: plan.scope.module || result?.answerPayload?.scope?.module || null,
    lastView: plan.scope.view || result?.answerPayload?.scope?.view || null,
    lastMetricKey: plan.metricKey || result?.answerPayload?.debugMeta?.metricKey || null,
    lastEntityRefs: Array.isArray(result?.answerPayload?.debugMeta?.entityRefs)
        ? result.answerPayload.debugMeta.entityRefs
        : [],
    lastAnswerType: result?.answerPayload?.kind || plan.intent.type || null,
    lastScope: result?.answerPayload?.scope || plan.scope || null,
    lastEvidenceColumns: Array.isArray(result?.answerPayload?.debugMeta?.evidenceColumns)
        ? result.answerPayload.debugMeta.evidenceColumns
        : [],
    lastLimit: Number.isFinite(Number(result?.answerPayload?.debugMeta?.defaultLimit))
        ? Number(result.answerPayload.debugMeta.defaultLimit)
        : (Number.isFinite(Number(plan?.queryOptions?.limit)) ? Number(plan.queryOptions.limit) : null),
    lastIntent: plan.intent.type,
    lastPlannerPath: plan.primaryHandler
});

// ─── Exports for testing ────────────────────────────────────────────────

export { INTENT_TYPES, INTENT_TO_HANDLER, FALLBACK_CHAIN };
