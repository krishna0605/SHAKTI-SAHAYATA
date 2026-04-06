import { execSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { loginAsAdmin } from './helpers/auth'

const repoRoot = process.cwd()

test('created case stays visible after backend restart', async ({ page }) => {
  const caseName = `Phase2 Persist ${Date.now()}`

  await loginAsAdmin(page)
  await page.goto('/create-case')

  await page.getByPlaceholder(/mumbai cyber fraud 2026/i).fill(caseName)
  await page.getByRole('combobox').first().selectOption('Jio')
  await page.getByRole('button', { name: /create case/i }).click()

  await expect(page).toHaveURL(/\/case\//)
  const caseUrl = page.url()
  await expect(page.getByText(caseName)).toBeVisible()

  execSync('docker compose -f docker-compose.yml -f docker-compose.dev.yml restart backend', {
    cwd: repoRoot,
    stdio: 'inherit',
  })
  execSync('npx wait-on http-get://localhost:3001/api/health/ready', {
    cwd: repoRoot,
    stdio: 'inherit',
  })

  await loginAsAdmin(page)
  await page.goto(caseUrl)
  await expect(page.getByText(caseName)).toBeVisible()
})
