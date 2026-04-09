import { expect, type Page } from '@playwright/test'

const mainOfficerBuckleId = process.env.PLAYWRIGHT_OFFICER_BUCKLE_ID || 'BK-1001'
const mainOfficerPassword = process.env.PLAYWRIGHT_OFFICER_PASSWORD || 'SmokeTest@123!'
const adminBaseUrl = process.env.PLAYWRIGHT_ADMIN_BASE_URL || 'http://localhost:4174'
const adminEmail = process.env.PLAYWRIGHT_ADMIN_EMAIL || 'it.admin@police.gov.in'
const adminPassword = process.env.PLAYWRIGHT_ADMIN_PASSWORD || ''
const adminTotpCode = process.env.PLAYWRIGHT_ADMIN_TOTP || ''

export async function signUpFreshOfficer(page: Page) {
  const timestamp = Date.now()
  const email = `smoke.officer+${timestamp}@police.gov.in`

  await page.goto('/signup')
  await page.getByLabel(/buckle id/i).fill(mainOfficerBuckleId)
  await page.getByLabel(/full name/i).fill('Smoke Test Officer')
  await page.getByLabel(/email address/i).fill(email)
  await page.getByLabel(/^password$/i).fill(mainOfficerPassword)
  await page.getByLabel(/confirm password/i).fill(mainOfficerPassword)
  await page.getByRole('button', { name: /create account/i }).click()

  await expect(page).toHaveURL(/dashboard/)
  return { email, buckleId: mainOfficerBuckleId }
}

export async function loginAsAdmin(page: Page) {
  return signUpFreshOfficer(page)
}

export async function loginToAdminConsole(page: Page) {
  if (!adminPassword) {
    throw new Error('PLAYWRIGHT_ADMIN_PASSWORD is required for admin smoke tests.')
  }

  await page.goto(`${adminBaseUrl}/login`)
  await page.getByLabel(/email address/i).fill(adminEmail)
  await page.getByLabel(/^password$/i).fill(adminPassword)

  if (adminTotpCode) {
    await page.getByLabel(/totp code/i).fill(adminTotpCode)
  }

  await page.getByRole('button', { name: /enter admin console/i }).click()
  await expect(page).toHaveURL(/dashboard/)
}
