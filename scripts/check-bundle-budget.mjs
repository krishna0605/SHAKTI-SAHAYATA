import fs from 'node:fs/promises';
import path from 'node:path';

const distAssetsDir = path.resolve(process.cwd(), 'frontend/dist/assets');
const mainChunkBudgetKb = Number(process.env.BUNDLE_MAIN_BUDGET_KB || 520);
const analyticsChunkBudgetKb = Number(process.env.BUNDLE_ANALYTICS_BUDGET_KB || 900);

const mainChunkPattern = /^index-.*\.js$/i;
const analyticsChunkPatterns = [
  /^CDRAdvancedAnalysis-.*\.js$/i,
  /^IPDRAnalytics-.*\.js$/i,
  /^TowerDumpAnalysis-.*\.js$/i,
  /^AnalysisTabBar-.*\.js$/i,
];

const main = async () => {
  const entries = await fs.readdir(distAssetsDir, { withFileTypes: true });
  const files = await Promise.all(entries.filter((entry) => entry.isFile()).map(async (entry) => {
    const fullPath = path.join(distAssetsDir, entry.name);
    const stats = await fs.stat(fullPath);
    return {
      name: entry.name,
      sizeKb: Number((stats.size / 1024).toFixed(2)),
    };
  }));

  const mainChunk = files.find((file) => mainChunkPattern.test(file.name));
  const analyticsChunks = files.filter((file) => analyticsChunkPatterns.some((pattern) => pattern.test(file.name)));

  const failures = [];
  if (mainChunk && mainChunk.sizeKb > mainChunkBudgetKb) {
    failures.push(`Main chunk ${mainChunk.name} is ${mainChunk.sizeKb}KB (budget ${mainChunkBudgetKb}KB).`);
  }

  for (const chunk of analyticsChunks) {
    if (chunk.sizeKb > analyticsChunkBudgetKb) {
      failures.push(`Analytics chunk ${chunk.name} is ${chunk.sizeKb}KB (budget ${analyticsChunkBudgetKb}KB).`);
    }
  }

  if (failures.length > 0) {
    console.error('[bundle-budget] Budget check failed:');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log('[bundle-budget] Bundle sizes are within configured budgets.');
};

main().catch((error) => {
  console.error(`[bundle-budget] ${error?.message || error}`);
  process.exitCode = 1;
});

