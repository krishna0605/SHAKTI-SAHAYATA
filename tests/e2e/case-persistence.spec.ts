import { execSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { createCaseViaUi, createOfficerCredentials, loginOfficer, signUpFreshOfficer } from './helpers/auth'

const repoRoot = process.cwd()

test('created case stays visible after backend restart', async ({ page }) => {
  const officer = {
    ...createOfficerCredentials('persistence.officer'),
    buckleId: 'BK-1049',
    email: 'playwright.persistence@police.gov.in',
  }

  await signUpFreshOfficer(page, officer)
  const createdCase = await createCaseViaUi(page, {
    caseName: `Phase2 Persist ${Date.now()}`,
    operator: 'Jio',
    caseType: 'Cyber Crime',
    priority: 'high',
  })

  execSync('docker compose -f docker-compose.yml -f docker-compose.dev.yml restart backend', {
    cwd: repoRoot,
    stdio: 'inherit',
  })
  execSync('npx wait-on http-get://localhost:3001/api/health/ready', {
    cwd: repoRoot,
    stdio: 'inherit',
  })

  await loginOfficer(page, officer)
  await page.goto(createdCase.caseUrl)
  await expect(page.getByText(createdCase.caseName)).toBeVisible()
  await expect(page.locator('body')).toContainText(createdCase.firNumber)
})
