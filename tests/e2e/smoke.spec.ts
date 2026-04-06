import { expect, test } from '@playwright/test'
import { loginAsAdmin } from './helpers/auth'

test.describe('phase 2 smoke', () => {
  test('login and dashboard load', async ({ page }) => {
    await loginAsAdmin(page)
    await expect(page.getByText(/your investigations/i)).toBeVisible()
  })
})

