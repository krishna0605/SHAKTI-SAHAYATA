import { describe, expect, it } from 'vitest';

const {
    getCaseQaCatalog,
    getCaseQaCatalogEntry,
    classifyGroundability,
    resolveCaseQaCatalogEntry,
    findCaseQaCatalogEntries,
    normalizeCaseQaModule,
    normalizeCaseQaView,
    isGroundableCaseQuestionText
} = await import('../../shared/chatbot/caseQaCatalog.js');

describe('caseQaCatalog', () => {
    describe('catalog integrity', () => {
        it('has no duplicate keys', () => {
            const catalog = getCaseQaCatalog();
            const keys = catalog.map((entry) => entry.key);
            const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
            expect(duplicates).toEqual([]);
        });

        it('every entry has at least one alias', () => {
            for (const entry of getCaseQaCatalog()) {
                expect(entry.aliases.length, `${entry.key} has no aliases`).toBeGreaterThanOrEqual(1);
            }
        });

        it('every entry has a displayLabel', () => {
            for (const entry of getCaseQaCatalog()) {
                expect(entry.displayLabel, `${entry.key} has no displayLabel`).toBeTruthy();
            }
        });

        it('every entry has a renderer field', () => {
            for (const entry of getCaseQaCatalog()) {
                expect(entry.renderer, `${entry.key} has no renderer`).toBeTruthy();
            }
        });

        it('every entry has a valid answerType', () => {
            const validTypes = ['scalar', 'summary', 'table', 'list', 'timeseries'];
            for (const entry of getCaseQaCatalog()) {
                expect(validTypes, `${entry.key} has invalid answerType: ${entry.answerType}`).toContain(entry.answerType);
            }
        });

        it('every displayLabel resolves back via resolveCaseQaCatalogEntry', () => {
            for (const entry of getCaseQaCatalog()) {
                const resolved = resolveCaseQaCatalogEntry({ message: entry.displayLabel });
                expect(resolved, `displayLabel "${entry.displayLabel}" for key "${entry.key}" does not resolve`).not.toBeNull();
            }
        });
    });

    describe('classifyGroundability', () => {
        it('returns groundable:true with metric bucket for a catalog-matched question', () => {
            const result = classifyGroundability('how many records');
            expect(result.groundable).toBe(true);
            expect(result.bucket).toBe('metric');
            expect(result.confidence).toBeGreaterThanOrEqual(0.9);
        });

        it('returns groundable:true for "international calls"', () => {
            const result = classifyGroundability('international calls');
            expect(result.groundable).toBe(true);
        });

        it('returns groundable:true for "total records"', () => {
            const result = classifyGroundability('total records');
            expect(result.groundable).toBe(true);
            expect(result.catalogKey).toBe('total_records');
        });

        it('returns groundable:false with chit_chat for "tell me a joke"', () => {
            const result = classifyGroundability('tell me a joke');
            expect(result.groundable).toBe(false);
            expect(result.bucket).toBe('chit_chat');
            expect(result.confidence).toBeGreaterThanOrEqual(0.9);
        });

        it('returns groundable:false with chit_chat for "how are you"', () => {
            const result = classifyGroundability('how are you');
            expect(result.groundable).toBe(false);
            expect(result.bucket).toBe('chit_chat');
        });

        it('returns groundable:true for entity lookups like "find IMEI"', () => {
            const result = classifyGroundability('find IMEI 123456');
            expect(result.groundable).toBe(true);
        });

        it('returns groundable:true for summary requests', () => {
            const result = classifyGroundability('summarize this case');
            expect(result.groundable).toBe(true);
            expect(result.bucket).toBe('summary');
        });

        it('returns low-confidence non-groundable for unknown messages', () => {
            const result = classifyGroundability('xyzabc123');
            expect(result.groundable).toBe(false);
            expect(result.confidence).toBeLessThan(0.9);
        });

        it('returns groundable:false for empty input', () => {
            const result = classifyGroundability('');
            expect(result.groundable).toBe(false);
        });
    });

    describe('Hindi/Gujarati aliases', () => {
        it('resolves Hindi alias "kitne records" to total_records', () => {
            const result = resolveCaseQaCatalogEntry({ message: 'kitne records' });
            expect(result?.key).toBe('total_records');
        });

        it('resolves Gujarati alias "files batavo" to uploaded_files', () => {
            const result = resolveCaseQaCatalogEntry({ message: 'files batavo' });
            expect(result?.key).toBe('uploaded_files');
        });

        it('resolves Hindi alias "raat ki activity" to night_activity', () => {
            const result = resolveCaseQaCatalogEntry({ message: 'raat ki activity' });
            expect(result?.key).toBe('night_activity');
        });

        it('classifies Hindi metrics as groundable', () => {
            const result = classifyGroundability('kitne records hain');
            expect(result.groundable).toBe(true);
        });
    });

    describe('module and view normalization', () => {
        it('normalizes "call" to "cdr"', () => {
            expect(normalizeCaseQaModule('call')).toBe('cdr');
        });

        it('normalizes "internet" to "ipdr"', () => {
            expect(normalizeCaseQaModule('internet')).toBe('ipdr');
        });

        it('normalizes "tower dump" to "tower"', () => {
            expect(normalizeCaseQaModule('tower dump')).toBe('tower');
        });

        it('normalizes "analysis" to "advanced"', () => {
            expect(normalizeCaseQaView('analysis')).toBe('advanced');
        });

        it('returns null for unknown module', () => {
            expect(normalizeCaseQaModule('unknown_module')).toBeNull();
        });
    });

    describe('isGroundableCaseQuestionText', () => {
        it('returns true for groundable questions', () => {
            expect(isGroundableCaseQuestionText('how many records')).toBe(true);
        });

        it('returns false for chit-chat', () => {
            expect(isGroundableCaseQuestionText('tell me a joke')).toBe(false);
        });

        it('returns false for empty input', () => {
            expect(isGroundableCaseQuestionText('')).toBe(false);
        });
    });

    describe('findCaseQaCatalogEntries', () => {
        it('filters by module when provided', () => {
            const entries = findCaseQaCatalogEntries({ message: 'total records', module: 'ipdr' });
            expect(entries.length).toBeGreaterThan(0);
            for (const entry of entries) {
                if (entry.modules.length > 0) {
                    expect(entry.modules).toContain('ipdr');
                }
            }
        });

        it('returns empty for non-matching message', () => {
            const entries = findCaseQaCatalogEntries({ message: 'xyzabc_nonexistent' });
            expect(entries).toEqual([]);
        });
    });
});
