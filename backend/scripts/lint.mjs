import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const ignored = new Set(['node_modules', 'uploads', 'dist', 'coverage']);
const jsFiles = [];

const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }
    if (entry.isFile() && fullPath.endsWith('.js')) {
      jsFiles.push(fullPath);
    }
  }
};

walk(rootDir);

let failed = 0;
for (const file of jsFiles) {
  const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (check.status !== 0) {
    failed += 1;
    process.stderr.write(`\n[lint] Syntax error in ${file}\n`);
    if (check.stderr) process.stderr.write(check.stderr);
  }
}

if (failed > 0) {
  process.stderr.write(`\n[lint] ${failed} file(s) failed syntax check.\n`);
  process.exit(1);
}

process.stdout.write(`[lint] Syntax check passed for ${jsFiles.length} backend files.\n`);
