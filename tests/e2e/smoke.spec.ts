import { expect, test } from '@playwright/test'
import { signUpFreshOfficer } from './helpers/auth'

test.describe('phase 2 smoke', () => {
  test('officer signup and dashboard load', async ({ page }) => {
    await signUpFreshOfficer(page)
    await expect(page).toHaveURL(/dashboard/)
    await expect(page.locator('body')).toContainText(/dashboard|investigation|case/i)
  })
})
