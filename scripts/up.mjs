import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const composeArgs = ['compose', '--profile', 'observability', '-f', 'docker-compose.yml', '-f', 'docker-compose.dev.yml'];
const backendHealthUrl = 'http://localhost:3001/api/health';
const graphqlUrl = 'http://localhost:3001/graphql';
const prometheusUrl = 'http://localhost:9090';
const grafanaUrl = 'http://localhost:3002';
const hostOllamaUrl = (process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/$/, '');
const ollamaModel = process.env.OLLAMA_MODEL || 'phi3.5';
const forceBuild = process.argv.includes('--build') || process.env.SHAKTI_FORCE_BUILD === '1' || process.env.SHAKTI_FORCE_BUILD === 'true';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const runtimeDir = path.join(repoRoot, 'ops', 'runtime');
const backupStatusPath = path.join(runtimeDir, 'backup-status.json');
const restoreStatusPath = path.join(runtimeDir, 'restore-status.json');
const hostMetricsProfile = process.platform === 'linux' ? 'observability-host' : null;

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

const runCommandCapture = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} exited with code ${code}: ${stderr || stdout}`));
    });
  });

const getContainerState = async (containerName) => {
  try {
    const { stdout } = await runCommandCapture('docker', ['inspect', '--format', '{{.State.Status}}', containerName]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
};

const waitForBackend = async (timeoutMs = 180000) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(backendHealthUrl);
      if (response.ok) {
        const payload = await response.json().catch(() => null);
        return {
          ready: true,
          payload,
        };
      }
    } catch {
      // keep waiting
    }

    const backendState = await getContainerState('shakti-backend');
    if (backendState && backendState !== 'running' && backendState !== 'restarting' && backendState !== 'created') {
      throw new Error(`Backend container entered "${backendState}" state before becoming healthy.`);
    }

    await sleep(3000);
  }

  return {
    ready: false,
    payload: null,
  };
};

const waitForHttp = async (url, { timeoutMs = 120000, init = {}, validate = (response) => response.ok } = {}) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, init);
      if (await validate(response)) return true;
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

  console.log(`\n[up] Starting SHAKTI development stack with Docker (host Ollama mode${forceBuild ? ', forced rebuild' : ''})...\n`);
  const effectiveComposeArgs = hostMetricsProfile ? ['compose', '--profile', 'observability', '--profile', hostMetricsProfile, '-f', 'docker-compose.yml', '-f', 'docker-compose.dev.yml'] : composeArgs;
  await runCommand('docker', [...effectiveComposeArgs, 'up', ...(forceBuild ? ['--build'] : []), '-d']);

  console.log('\n[up] Waiting for backend, GraphQL, Prometheus, and Grafana readiness...\n');
  const backendHealth = await waitForBackend();
  const [graphqlReady, prometheusReady, grafanaReady] = await Promise.all([
    waitForHttp(graphqlUrl, {
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '{ health { status } }' }),
      },
      validate: (response) => response.ok,
    }),
    waitForHttp(`${prometheusUrl}/-/ready`),
    waitForHttp(`${grafanaUrl}/api/health`, {
      validate: async (response) => {
        if (!response.ok) return false;
        const payload = await response.json().catch(() => null);
        return payload?.database === 'ok';
      },
    }),
  ]);

  if (!backendHealth.ready) {
    console.warn('[up] Backend did not become healthy within the expected time window.');
  } else {
    const backendStatus = backendHealth.payload?.status || 'unknown';
    const degraded = backendHealth.payload?.summary?.degraded || [];
    const failed = backendHealth.payload?.summary?.failed || [];
    console.log(`[up] Backend is reachable (health=${backendStatus}).`);
    if (degraded.length > 0) {
      console.log(`[up] Backend degraded checks: ${degraded.join(', ')}`);
    }
    if (failed.length > 0) {
      console.log(`[up] Backend failed checks: ${failed.join(', ')}`);
    }
  }
  console.log(`[up] GraphQL endpoint: ${graphqlReady ? 'ready' : 'not ready yet'}`);
  console.log(`[up] Prometheus: ${prometheusReady ? 'ready' : 'not ready yet'}`);
  console.log(`[up] Grafana: ${grafanaReady ? 'ready' : 'not ready yet'}`);
  if (!hostMetricsProfile) {
    console.log('[up] Host node exporter: skipped on this platform; backend metrics remain available.');
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

  const credentialsMessage = `
SHAKTI dev stack is starting.

No default reusable credentials are shipped with this stack.

To create baseline identities:
- run schema setup
- export BOOTSTRAP_ADMIN_PASSWORD with a strong runtime-only secret
- run: npm run db:bootstrap-identities

The controlled officer roster will be loaded from database/bootstrap/officers-bootstrap.sql
and the bootstrap admin will be created from your runtime environment.

Frontend:    http://localhost:5173
Admin:       http://localhost:4174
Backend:     ${backendHealthUrl}
GraphQL:     ${graphqlUrl}
Prometheus:  ${prometheusUrl}
Grafana:     ${grafanaUrl}
AI:          optional future service (not started by default)
Ollama:      ${hostOllamaUrl}
`.trim();

  console.log(`\n${credentialsMessage}\n`);
};

main().catch((error) => {
  console.error(`\n[up] Failed to start SHAKTI: ${error.message}`);
  process.exitCode = 1;
});
