import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { importOfficerRoster } from '../backend/services/officerRoster.service.js';

const args = process.argv.slice(2);
const fileArg = args.find((value) => !value.startsWith('--'));
const fullSync = args.includes('--full-sync');

if (!fileArg) {
  console.error('Usage: node scripts/import-officer-roster.mjs <path-to-roster.xlsx|csv> [--full-sync]');
  process.exit(1);
}

const run = async () => {
  const absolutePath = path.resolve(process.cwd(), fileArg);
  const buffer = await fs.readFile(absolutePath);
  const result = await importOfficerRoster({
    buffer,
    fileName: path.basename(absolutePath),
    adminAccountId: null,
    fullSync,
  });

  console.log(`[OFFICER_ROSTER] Import complete for ${result.fileName}`);
  console.log(`[OFFICER_ROSTER] Rows=${result.totalRows} inserted=${result.inserted} updated=${result.updated} deactivated=${result.deactivated} skipped=${result.skipped}`);
  if (result.errors.length) {
    console.log('[OFFICER_ROSTER] Validation errors:');
    result.errors.slice(0, 20).forEach((item) => {
      console.log(`  - row ${item.rowNumber}: ${item.message}`);
    });
  }
};

run().catch((error) => {
  console.error(`[OFFICER_ROSTER] Failed: ${error.message}`);
  process.exit(1);
});
