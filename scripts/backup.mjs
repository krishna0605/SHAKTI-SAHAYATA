import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const repoRoot = process.cwd();
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupRoot = path.resolve(repoRoot, process.env.BACKUP_ROOT_DIR || 'ops/backups');
const runtimeRoot = path.resolve(repoRoot, 'ops/runtime');
const backendRuntimeRoot = path.resolve(repoRoot, 'backend/runtime');
const backupStatusFile = path.resolve(runtimeRoot, 'backup-status.json');
const backendBackupStatusFile = path.resolve(backendRuntimeRoot, 'backup-status.json');
const dbUser = process.env.DB_USER || 'shakti_admin';
const dbName = process.env.DB_NAME || 'shakti_db';
const postgresContainer = process.env.POSTGRES_CONTAINER || 'shakti-postgres';
const backendContainer = process.env.BACKEND_CONTAINER || 'shakti-backend';
const offsiteDir = process.env.BACKUP_OFFSITE_DIR ? path.resolve(process.env.BACKUP_OFFSITE_DIR) : null;

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

const sha256File = async (filePath) => {
  const content = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
};

const writeStatus = async (payload) => {
  await fs.mkdir(runtimeRoot, { recursive: true });
  await fs.mkdir(backendRuntimeRoot, { recursive: true });
  await fs.writeFile(backupStatusFile, JSON.stringify(payload, null, 2), 'utf8');
  await fs.writeFile(backendBackupStatusFile, JSON.stringify(payload, null, 2), 'utf8');
};

const main = async () => {
  await fs.mkdir(backupRoot, { recursive: true });
  await fs.mkdir(runtimeRoot, { recursive: true });

  const bundleDir = path.join(backupRoot, timestamp);
  await fs.mkdir(bundleDir, { recursive: true });

  const dbDumpPath = path.join(bundleDir, 'database.sql');
  const uploadsArchivePath = path.join(bundleDir, 'uploads.tar.gz');
  const manifestPath = path.join(bundleDir, 'manifest.json');

  const dumpResult = await run('docker', [
    'exec',
    postgresContainer,
    'sh',
    '-lc',
    `pg_dump -U ${dbUser} -d ${dbName} --clean --if-exists --no-owner --no-privileges`,
  ]);
  await fs.writeFile(dbDumpPath, dumpResult.stdout, 'utf8');

  await run('docker', [
    'exec',
    backendContainer,
    'sh',
    '-lc',
    'tar -czf /tmp/shakti-uploads-backup.tar.gz -C /app uploads',
  ]);
  await run('docker', ['cp', `${backendContainer}:/tmp/shakti-uploads-backup.tar.gz`, uploadsArchivePath]);
  await run('docker', ['exec', backendContainer, 'rm', '-f', '/tmp/shakti-uploads-backup.tar.gz']);

  const [caseCount, fileCount] = await Promise.all([
    run('docker', ['exec', postgresContainer, 'psql', '-U', dbUser, '-d', dbName, '-t', '-A', '-c', 'SELECT COUNT(*) FROM cases']),
    run('docker', ['exec', postgresContainer, 'psql', '-U', dbUser, '-d', dbName, '-t', '-A', '-c', 'SELECT COUNT(*) FROM uploaded_files']),
  ]);

  const manifest = {
    timestamp: new Date().toISOString(),
    bundleDir,
    database: {
      dbName,
      dbUser,
      dumpFile: path.basename(dbDumpPath),
      sha256: await sha256File(dbDumpPath),
      caseCount: Number(caseCount.stdout.trim() || 0),
    },
    uploads: {
      archiveFile: path.basename(uploadsArchivePath),
      sha256: await sha256File(uploadsArchivePath),
      fileCount: Number(fileCount.stdout.trim() || 0),
    },
    offsiteCopy: {
      configured: Boolean(offsiteDir),
      destination: offsiteDir,
      copied: false,
    },
  };

  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  if (offsiteDir) {
    await fs.mkdir(offsiteDir, { recursive: true });
    const target = path.join(offsiteDir, path.basename(bundleDir));
    await fs.cp(bundleDir, target, { recursive: true });
    manifest.offsiteCopy.copied = true;
    manifest.offsiteCopy.destination = target;
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  }

  await writeStatus({
    status: 'success',
    timestamp: manifest.timestamp,
    completedAt: manifest.timestamp,
    bundleDir,
    manifest: manifestPath,
    offsiteCopy: manifest.offsiteCopy,
    caseCount: manifest.database.caseCount,
    uploadedFileCount: manifest.uploads.fileCount,
  });

  console.log(`Backup completed: ${bundleDir}`);
};

main().catch(async (error) => {
  await writeStatus({
    status: 'failed',
    timestamp: new Date().toISOString(),
    error: error?.message || String(error),
  });
  console.error(`[backup] ${error?.message || error}`);
  process.exitCode = 1;
});
