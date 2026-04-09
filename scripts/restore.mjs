import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const repoRoot = process.cwd();
const runtimeRoot = path.resolve(repoRoot, 'ops/runtime');
const backendRuntimeRoot = path.resolve(repoRoot, 'backend/runtime');
const restoreStatusFile = path.resolve(runtimeRoot, 'restore-status.json');
const backendRestoreStatusFile = path.resolve(backendRuntimeRoot, 'restore-status.json');
const bundleArgIndex = process.argv.findIndex((arg) => arg === '--bundle');
const bundleDir = bundleArgIndex >= 0 ? path.resolve(process.argv[bundleArgIndex + 1]) : null;
const dbUser = process.env.DB_USER || 'shakti_admin';
const postgresContainer = process.env.POSTGRES_CONTAINER || 'shakti-postgres';
const targetDb = process.env.RESTORE_TARGET_DB || `shakti_restore_${Date.now()}`;

const run = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, ...options });
    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });
    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} failed with code ${code}\n${stderr}`));
    });
  });

const writeStatus = async (payload) => {
  await fs.mkdir(runtimeRoot, { recursive: true });
  await fs.mkdir(backendRuntimeRoot, { recursive: true });
  await fs.writeFile(restoreStatusFile, JSON.stringify(payload, null, 2), 'utf8');
  await fs.writeFile(backendRestoreStatusFile, JSON.stringify(payload, null, 2), 'utf8');
};

const main = async () => {
  if (!bundleDir) {
    throw new Error('Usage: npm run restore -- --bundle <path-to-backup-bundle>');
  }

  const manifestPath = path.join(bundleDir, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const sqlPath = path.join(bundleDir, manifest.database.dumpFile);
  const uploadsArchivePath = path.join(bundleDir, manifest.uploads.archiveFile);
  const restoreWorkspace = path.join(repoRoot, 'ops/restores', path.basename(bundleDir));
  const uploadsExtractPath = path.join(restoreWorkspace, 'uploads');

  await fs.mkdir(restoreWorkspace, { recursive: true });
  await fs.mkdir(uploadsExtractPath, { recursive: true });

  await run('docker', ['exec', postgresContainer, 'psql', '-U', dbUser, '-d', 'postgres', '-c', `DROP DATABASE IF EXISTS ${targetDb};`]);
  await run('docker', ['exec', postgresContainer, 'psql', '-U', dbUser, '-d', 'postgres', '-c', `CREATE DATABASE ${targetDb};`]);
  await run('docker', ['cp', sqlPath, `${postgresContainer}:/tmp/shakti-restore.sql`]);
  await run('docker', ['exec', postgresContainer, 'psql', '-U', dbUser, '-d', targetDb, '-f', '/tmp/shakti-restore.sql']);
  await run('docker', ['exec', postgresContainer, 'rm', '-f', '/tmp/shakti-restore.sql']);

  const uploadsArchiveInContainer = '/tmp/shakti-uploads-restore.tar.gz';
  await run('docker', ['cp', uploadsArchivePath, `${postgresContainer}:${uploadsArchiveInContainer}`]);
  await run('docker', ['exec', postgresContainer, 'mkdir', '-p', '/tmp/shakti-uploads-extract']);
  await run('docker', ['exec', postgresContainer, 'tar', '-xzf', uploadsArchiveInContainer, '-C', '/tmp/shakti-uploads-extract']);
  await run('docker', ['cp', `${postgresContainer}:/tmp/shakti-uploads-extract/.`, uploadsExtractPath]);
  await run('docker', ['exec', postgresContainer, 'rm', '-rf', uploadsArchiveInContainer, '/tmp/shakti-uploads-extract']);

  const caseCount = await run('docker', ['exec', postgresContainer, 'psql', '-U', dbUser, '-d', targetDb, '-t', '-A', '-c', 'SELECT COUNT(*) FROM cases']);
  const fileCount = await run('docker', ['exec', postgresContainer, 'psql', '-U', dbUser, '-d', targetDb, '-t', '-A', '-c', 'SELECT COUNT(*) FROM uploaded_files']);
  const bootstrapOfficerCount = await run('docker', ['exec', postgresContainer, 'psql', '-U', dbUser, '-d', targetDb, '-t', '-A', '-c', "SELECT COUNT(*) FROM officers WHERE buckle_id BETWEEN 'BK-1001' AND 'BK-1050'"]);
  const adminCount = await run('docker', ['exec', postgresContainer, 'psql', '-U', dbUser, '-d', targetDb, '-t', '-A', '-c', 'SELECT COUNT(*) FROM admin_accounts']);

  const report = {
    status: 'success',
    timestamp: new Date().toISOString(),
    bundleDir,
    targetDb,
    restoredCaseCount: Number(caseCount.stdout.trim() || 0),
    restoredFileCount: Number(fileCount.stdout.trim() || 0),
    bootstrapOfficerCount: Number(bootstrapOfficerCount.stdout.trim() || 0),
    adminCount: Number(adminCount.stdout.trim() || 0),
    uploadsExtractPath,
  };

  await writeStatus(report);
  console.log(`Restore verification completed: ${targetDb}`);
};

main().catch(async (error) => {
  await writeStatus({
    status: 'failed',
    timestamp: new Date().toISOString(),
    error: error?.message || String(error),
    bundleDir,
    targetDb,
  });
  console.error(`[restore] ${error?.message || error}`);
  process.exitCode = 1;
});
