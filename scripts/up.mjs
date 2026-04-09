import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const composeArgs = ['compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.dev.yml'];
const backendHealthUrl = 'http://localhost:3001/api/health';
const hostOllamaUrl = (process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/$/, '');
const ollamaModel = process.env.OLLAMA_MODEL || 'phi3.5';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const runtimeDir = path.join(repoRoot, 'ops', 'runtime');
const backupStatusPath = path.join(runtimeDir, 'backup-status.json');
const restoreStatusPath = path.join(runtimeDir, 'restore-status.json');

const credentialsMessage = `
SHAKTI dev stack is starting.

Default seeded users verified during backend startup:
- BK-4782 / rajesh@police.gov.in / Shakti@123
- BK-9999 / admin@police.gov.in / Shakti@123

Frontend: http://localhost:5173
Admin:    http://localhost:4174
Backend:  http://localhost:3001/api/health
AI:       optional future service (not started by default)
Ollama:   ${hostOllamaUrl}
`.trim();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const readJson = async (filePath) => {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const runCommand = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: true,
      ...options
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });

const waitForBackend = async (timeoutMs = 180000) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(backendHealthUrl);
      if (response.ok) return true;
    } catch {
      // keep waiting
    }
    await sleep(3000);
  }

  return false;
};

const waitForOllama = async (timeoutMs = 30000) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${hostOllamaUrl}/api/tags`);
      if (response.ok) {
        const payload = await response.json().catch(() => ({}));
        return {
          ready: true,
          models: Array.isArray(payload?.models) ? payload.models : []
        };
      }
    } catch {
      // keep waiting
    }
    await sleep(2000);
  }

  return { ready: false, models: [] };
};

const ensureOllamaModel = async (models = []) => {
  const modelNames = models
    .map((entry) => String(entry?.name || '').trim())
    .filter(Boolean);

  if (modelNames.some((name) => name === ollamaModel || name.startsWith(`${ollamaModel}:`))) {
    console.log(`[up] Ollama model "${ollamaModel}" is available locally.`);
    return;
  }

  console.log(`[up] Ollama is running, but model "${ollamaModel}" is missing. Pulling it now...`);
  try {
    await runCommand('ollama', ['pull', ollamaModel]);
  } catch (error) {
    throw new Error(
      `Ollama model "${ollamaModel}" is not installed. Run "ollama pull ${ollamaModel}" and retry. (${error.message})`
    );
  }
};

const startHostOllama = async () => {
  console.log('[up] Local Ollama is not reachable. Trying to start host Ollama...');
  try {
    const child = spawn('ollama', ['serve'], {
      stdio: 'ignore',
      shell: true,
      detached: true
    });
    child.unref();
  } catch {
    // Ignore here and let the health check below produce the actionable message.
  }
};

const ensureHostOllama = async () => {
  let status = await waitForOllama(5000);
  if (!status.ready) {
    await startHostOllama();
    status = await waitForOllama(30000);
  }

  if (!status.ready) {
    throw new Error(
      `Local Ollama is not running at ${hostOllamaUrl}. Open the Ollama app or run "ollama serve", then retry "npm run up".`
    );
  }

  await ensureOllamaModel(status.models);
};

const main = async () => {
  await mkdir(runtimeDir, { recursive: true });

  console.log('\n[up] Checking host Ollama runtime...\n');
  await ensureHostOllama();

  console.log('\n[up] Starting SHAKTI development stack with Docker (host Ollama mode)...\n');
  await runCommand('docker', [...composeArgs, 'up', '--build', '-d']);

  console.log('\n[up] Waiting for backend health check...\n');
  const backendReady = await waitForBackend();
  if (!backendReady) {
    console.warn('[up] Backend did not become healthy within the expected time window.');
  } else {
    console.log('[up] Backend is reachable. Seed users were verified during startup.');
  }

  const [backupStatus, restoreStatus] = await Promise.all([
    readJson(backupStatusPath),
    readJson(restoreStatusPath)
  ]);

  if (backupStatus?.completedAt) {
    console.log(`[up] Latest backup: ${new Date(backupStatus.completedAt).toLocaleString()} (${backupStatus.status || 'unknown'})`);
  } else {
    console.log('[up] Latest backup: not recorded yet');
  }

  if (restoreStatus?.verifiedAt) {
    console.log(`[up] Latest restore drill: ${new Date(restoreStatus.verifiedAt).toLocaleString()} (${restoreStatus.status || 'unknown'})`);
  } else {
    console.log('[up] Latest restore drill: not recorded yet');
  }

  console.log(`\n${credentialsMessage}\n`);
};

main().catch((error) => {
  console.error(`\n[up] Failed to start SHAKTI: ${error.message}`);
  process.exitCode = 1;
});
