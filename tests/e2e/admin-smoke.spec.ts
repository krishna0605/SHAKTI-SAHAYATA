import { expect, test } from '@playwright/test'
import { loginToAdminConsole } from './helpers/auth'

test.describe('admin console smoke', () => {
  test('admin login and dashboard load', async ({ page }) => {
    await loginToAdminConsole(page)
    await expect(page.locator('body')).toContainText(/backend operations console|operational feed|attention list/i)
  })
})
