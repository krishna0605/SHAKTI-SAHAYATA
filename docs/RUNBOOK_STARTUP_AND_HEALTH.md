# Runbook: Startup And Health

## Primary Startup

```powershell
cd "C:\Users\ADMIN\Desktop\kavish\old new porject\shakti"
npm run up
```

This command:
- verifies host Ollama is reachable
- ensures the configured model is present
- starts Docker services
- waits for backend health
- reports latest backup and restore drill metadata

## Core URLs
- Frontend: `http://localhost:5173`
- Backend live/ready: `http://localhost:3001/api/health`
- Liveness: `http://localhost:3001/api/health/live`
- Readiness: `http://localhost:3001/api/health/ready`
- Startup report: `http://localhost:3001/api/health/startup`

## Expected Healthy States

### Liveness
- status code: `200`
- meaning: process is alive

### Readiness
- status code: `200`
- meaning:
  - DB reachable
  - uploads writable
  - auth config valid
  - startup checks completed
  - Ollama either healthy or explicitly degraded

### Startup
- status code: `200`
- includes:
  - timestamp
  - startup status
  - check-by-check results

## Failure Handling

### Backend not ready
1. open `http://localhost:3001/api/health/startup`
2. inspect failing checks
3. if `database` failed:
   - verify postgres container is running
   - verify DB env vars
4. if `uploads` failed:
   - verify backend upload mount
   - verify write permissions
5. if `auth` failed:
   - verify `JWT_SECRET`
6. if `ollama` degraded:
   - verify host Ollama is running
   - verify model exists with `ollama list`

### Force a new self-check
- open Settings > System Diagnostics > `Run self-check`
- or call:

```powershell
curl.exe -X POST http://localhost:3001/api/system/self-check -H "Authorization: Bearer <access-token>"
```

## Seed User Checks
Expected seed users:
- `BK-4782 / rajesh@police.gov.in / Shakti@123`
- `BK-9999 / admin@police.gov.in / Shakti@123`

If login fails:
- verify backend startup logs mention seed principals
- verify `/api/health/startup` has `seedUsers.status = pass`

## Shutdown

```powershell
npm run down
```
