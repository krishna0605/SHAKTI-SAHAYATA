import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { expect, type Page } from '@playwright/test'

const mainOfficerBuckleId = process.env.PLAYWRIGHT_OFFICER_BUCKLE_ID || 'BK-1001'
const mainOfficerPassword = process.env.PLAYWRIGHT_OFFICER_PASSWORD || 'SmokeTest@123!'
const adminBaseUrl = process.env.PLAYWRIGHT_ADMIN_BASE_URL || 'http://localhost:4174'
const adminEmail = process.env.PLAYWRIGHT_ADMIN_EMAIL || 'it.admin@police.gov.in'
const adminPassword = process.env.PLAYWRIGHT_ADMIN_PASSWORD || ''
const adminTotpCode = process.env.PLAYWRIGHT_ADMIN_TOTP || ''
const normalizedAdminBaseUrl = adminBaseUrl.replace(/\/+$/, '')

export interface OfficerCredentials {
  buckleId: string
  email: string
  password: string
  fullName: string
}

export interface CaseSeedInput {
  caseName?: string
  operator?: string
  caseType?: string
  priority?: 'low' | 'medium' | 'high' | 'critical'
  firNumber?: string
  investigationDetails?: string
  startDate?: string
  endDate?: string
}

const repoRoot = process.cwd()
const playwrightProvisionScript = path.join(repoRoot, 'scripts', 'provision-playwright-officer.mjs')

export function createOfficerCredentials(prefix = 'smoke.officer'): OfficerCredentials {
  const timestamp = Date.now()
  return {
    buckleId: mainOfficerBuckleId,
    email: `${prefix}+${timestamp}@police.gov.in`,
    password: mainOfficerPassword,
    fullName: 'Smoke Test Officer',
  }
}

async function selectShadcnOption(page: Page, triggerId: string, optionLabel: string) {
  await page.locator(`#${triggerId}`).click()
  await page.getByRole('option', { name: new RegExp(`^${escapeRegExp(optionLabel)}$`, 'i') }).click()
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildAdminConsoleUrlPattern() {
  return new RegExp(`^${escapeRegExp(normalizedAdminBaseUrl)}(?:/|/dashboard)?(?:[?#].*)?$`, 'i')
}

export async function signUpFreshOfficer(page: Page, credentials = createOfficerCredentials()) {
  provisionOfficerAccount(credentials)
  await loginOfficer(page, credentials)
  return credentials
}

export async function loginOfficer(page: Page, credentials: OfficerCredentials) {
  await page.goto('/login')
  await page.getByLabel(/buckle id/i).fill(credentials.buckleId)
  await page.getByLabel(/email address/i).fill(credentials.email)
  await page.getByLabel(/^password$/i).fill(credentials.password)
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page).toHaveURL(/dashboard/)
}

export async function createCaseViaUi(page: Page, input: CaseSeedInput = {}) {
  const timestamp = Date.now()
  const caseName = input.caseName || `Phase2 Case ${timestamp}`
  const operator = input.operator || 'Jio'
  const caseType = input.caseType || 'Cyber Crime'
  const priority = input.priority || 'high'
  const firNumber = input.firNumber || `FIR/${new Date().getFullYear()}/${timestamp}`
  const investigationDetails =
    input.investigationDetails || 'Playwright-generated case used for persistence and chatbot regression coverage.'
  const startDate = input.startDate || '2026-01-01'
  const endDate = input.endDate || '2026-01-31'

  await page.goto('/create-case')
  await page.getByLabel(/case name/i).fill(caseName)
  await selectShadcnOption(page, 'operator-select', operator)
  await selectShadcnOption(page, 'case-type-select', caseType)
  await selectShadcnOption(page, 'priority-select', priority)
  await page.getByLabel(/fir number/i).fill(firNumber)
  await page.getByLabel(/investigation details/i).fill(investigationDetails)
  await page.getByLabel(/start date/i).fill(startDate)
  await page.getByLabel(/end date/i).fill(endDate)
  await page.getByRole('button', { name: /^create case$/i }).click()

  await expect(page).toHaveURL(/\/case\/\d+/)
  const caseUrl = page.url()
  const caseIdMatch = caseUrl.match(/\/case\/(\d+)/)
  const caseId = caseIdMatch?.[1]
  if (!caseId) {
    throw new Error(`Unable to determine case ID from URL: ${caseUrl}`)
  }

  await expect(page.getByText(caseName)).toBeVisible()

  return {
    caseId,
    caseName,
    operator,
    firNumber,
    caseUrl,
  }
}

function provisionOfficerAccount(credentials: OfficerCredentials) {
  execFileSync(
    'node',
    [
      playwrightProvisionScript,
      credentials.buckleId,
      credentials.email,
      credentials.password,
      credentials.fullName,
    ],
    {
      cwd: repoRoot,
      stdio: 'pipe',
      env: process.env,
    },
  )
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
  await expect(page).toHaveURL(buildAdminConsoleUrlPattern())
}
