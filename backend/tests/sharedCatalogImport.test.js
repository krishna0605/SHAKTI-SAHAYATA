import { describe, expect, it } from 'vitest';

describe('shared chatbot catalog import boundary', () => {
    it('loads the shared catalog as an ESM module from backend context', async () => {
        const mod = await import('../../shared/chatbot/caseQaCatalog.js');
        const catalog = mod.getCaseQaCatalog();
        expect(Array.isArray(catalog)).toBe(true);
        expect(catalog.length).toBeGreaterThan(0);
        expect(mod.getMetricLabel('total_records')).toBe('Total Records');
    });
});
