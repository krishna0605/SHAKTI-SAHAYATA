import { expect, test } from '@playwright/test'
import { loginAsAdmin } from './helpers/auth'

test.describe('chatbot release paths', () => {
  test('deterministic branch answers direct case fact', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/case/2')
    await page.getByRole('button', { name: /support_agent/i }).click()

    const input = page.getByPlaceholder(/tag the case again in this message/i)
    await input.fill('@"Test Case Alpha" what is the telecom operator in this case')
    await page.getByRole('button', { name: /^send$/i }).click()

    await expect(page.getByText(/Jio/i)).toBeVisible()
  })

  test('llm branch answers tagged case synthesis question without degraded fallback', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/case/2')
    await page.getByRole('button', { name: /support_agent/i }).click()

    const input = page.getByPlaceholder(/tag the case again in this message/i)
    await input.fill('@"Test Case Alpha" summarize this case in two short lines')
    await page.getByRole('button', { name: /^send$/i }).click()

    await expect(page.getByText(/SHAKTI SAHAYATA AI/i).last()).toBeVisible()
    await expect(page.getByText(/database query/i)).toHaveCount(0)
    await expect(page.getByText(/Ollama unavailable/i)).toHaveCount(0)
  })
})
