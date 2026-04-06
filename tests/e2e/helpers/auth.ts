import { expect, type Page } from '@playwright/test'

export async function loginAsAdmin(page: Page) {
  await page.goto('/login')
  await page.getByLabel(/buckle id/i).fill('BK-9999')
  await page.getByLabel(/email address/i).fill('admin@police.gov.in')
  await page.getByLabel(/password/i).fill('Shakti@123')
  await page.getByRole('button', { name: /^sign in$/i }).click()
  await expect(page).toHaveURL(/dashboard/)
}

