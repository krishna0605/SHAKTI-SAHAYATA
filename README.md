# SHAKTI SAHAYATA

SHAKTI SAHAYATA is a full-stack investigation platform for telecom and cyber-crime workflows. This repository contains the frontend, backend, AI service scaffold, database assets, Docker setup, operational scripts, and test suite in one monorepo.

## Repository

- GitHub: [https://github.com/krishna0605/SHAKTI-SAHAYATA](https://github.com/krishna0605/SHAKTI-SAHAYATA)
- Primary branch: `main`

## What Is Inside

- `frontend/`: React 19 + TypeScript + Vite UI
- `backend/`: Express.js REST API with JWT auth
- `ai-services/`: FastAPI service scaffold for AI features
- `database/`: PostgreSQL schema and seed data
- `docs/`: audit reports, runbooks, and readiness notes
- `tests/`: Playwright end-to-end tests
- `scripts/`: local orchestration, backup, restore, and bundle-budget scripts
- `ops/`: runtime operational artifacts and backup/restore state

## Prerequisites

For the recommended local setup:

- `Git`
- `Node.js 20+`
- `npm 10+`
- `Docker Desktop`
- `Python 3.11+`
- `pip`
- `Ollama`

Optional but useful:

- `psql` if you want to run database scripts manually

## Clone The Repository

```powershell
git clone https://github.com/krishna0605/SHAKTI-SAHAYATA.git
cd SHAKTI-SAHAYATA
```

If you prefer GitHub Desktop, open the repository page and use the `Code` button to clone it, then open the cloned folder in your terminal.

If you do not want to use Git, open the repository page, click `Code`, choose `Download ZIP`, extract the archive, and then open the extracted folder locally.

## Environment Setup

Create a local environment file from the example:

```powershell
Copy-Item .env.example .env
```

Important:

- Do not commit `.env`
- Update `JWT_SECRET` before using anything beyond throwaway local testing
- The root `.gitignore` already excludes `.env`, build output, local uploads, backups, and other machine-specific files

## Recommended Local Run: Docker + Host Ollama

This is the easiest way to run the full development stack.

### 1. Install dependencies

```powershell
npm install
cd ai-services
pip install -r requirements.txt
cd ..
```

Or use the combined helper:

```powershell
npm run install:all
```

### 2. Start Ollama

Make sure Ollama is running on your machine:

```powershell
ollama serve
```

Pull the default model used by this repo:

```powershell
ollama pull phi3.5
```

### 3. Start the development stack

```powershell
npm run up
```

This helper:

- checks whether Ollama is reachable
- ensures the configured model exists locally
- starts PostgreSQL, backend, and frontend via Docker Compose
- waits for backend health checks
- prints seeded local credentials

### 4. Open the app

- Frontend: [http://localhost:5173](http://localhost:5173)
- Backend health: [http://localhost:3001/api/health](http://localhost:3001/api/health)
- Backend live check: [http://localhost:3001/api/health/live](http://localhost:3001/api/health/live)
- Backend readiness check: [http://localhost:3001/api/health/ready](http://localhost:3001/api/health/ready)
- Backend startup report: [http://localhost:3001/api/health/startup](http://localhost:3001/api/health/startup)

### 5. Stop the stack

```powershell
npm run down
```

## Manual Local Run

Use this if you want to run services outside Docker.

### 1. Install root and workspace dependencies

```powershell
npm install
cd frontend
npm install
cd ..
cd backend
npm install
cd ..
cd ai-services
pip install -r requirements.txt
cd ..
```

### 2. Start PostgreSQL

You need a PostgreSQL 15-compatible database configured with the values from `.env`.

### 3. Initialize the database

```powershell
npm run db:init
npm run db:seed
```

### 4. Start the services

In separate terminals:

```powershell
npm run dev:frontend
```

```powershell
npm run dev:backend
```

```powershell
npm run dev:ai
```

Or start all three together:

```powershell
npm run dev
```

## Default Local Login Credentials

The development seed creates these users:

- `BK-4782` / `rajesh@police.gov.in` / `Shakti@123`
- `BK-9999` / `admin@police.gov.in` / `Shakti@123`

These credentials come from the local development seed in [database/seed.sql](./database/seed.sql). Change them for any shared or non-local environment.

## Common Commands

### Install

```powershell
npm run install:all
```

### Development

```powershell
npm run up
```

```powershell
npm run dev
```

### Testing

```powershell
npm run test:unit
```

```powershell
npm run test:e2e
```

```powershell
npm run test:smoke
```

```powershell
npm run test:ci
```

### Docker

```powershell
npm run docker:dev
```

```powershell
npm run docker:prod
```

```powershell
npm run docker:down
```

### Maintenance

```powershell
npm run backup
```

```powershell
npm run restore
```

## Local Access Checklist

When someone else pulls this repo, they should be able to get running with this sequence:

1. Clone the repository.
2. Copy `.env.example` to `.env`.
3. Install Node, Python, Docker Desktop, and Ollama.
4. Run `npm run install:all`.
5. Run `ollama pull phi3.5`.
6. Run `npm run up`.
7. Open `http://localhost:5173`.
8. Sign in with one of the seeded local accounts.

## Troubleshooting

### Frontend does not load

- confirm `npm run up` completed successfully
- check whether port `5173` is already in use
- confirm `VITE_API_URL` points to `http://localhost:3001`

### Backend health fails

- open [http://localhost:3001/api/health/startup](http://localhost:3001/api/health/startup)
- verify Postgres is running
- verify `JWT_SECRET` exists in `.env`
- verify the uploads path is writable

### Ollama errors

- run `ollama serve`
- run `ollama list`
- if `phi3.5` is missing, run `ollama pull phi3.5`

### Login fails

- confirm `database/seed.sql` ran successfully
- verify the backend startup checks passed
- retry with the seeded users listed above

## Repo Hygiene And Safety

This repository is configured so the main unsafe or machine-local files are ignored by Git, including:

- `.env` and other local env variants
- `node_modules`
- build artifacts like `dist/`
- Playwright outputs
- local uploads and runtime state
- backup and restore artifacts

That means contributors can clone the repo and work locally without pushing secrets or machine-generated noise by default.

## Additional Documentation

- [RUNBOOK_STARTUP_AND_HEALTH.md](./docs/RUNBOOK_STARTUP_AND_HEALTH.md)
- [TEST_STRATEGY_PHASE2.md](./docs/TEST_STRATEGY_PHASE2.md)
- [UI_REFRESH_AUDIT_REPORT.md](./docs/UI_REFRESH_AUDIT_REPORT.md)
- [PROJECT_AUDIT_AND_READINESS_REPORT.md](./docs/PROJECT_AUDIT_AND_READINESS_REPORT.md)

## Contributing Locally

```powershell
git checkout main
git pull
git checkout -b codex/your-change-name
```

Make your changes, run the relevant tests, then commit and push:

```powershell
git add .
git commit -m "Describe your change"
git push -u origin HEAD
```
