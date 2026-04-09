import { expect, test } from '@playwright/test'
import { createCaseViaUi, createOfficerCredentials, signUpFreshOfficer } from './helpers/auth'

test.describe('chatbot release paths', () => {
  test('deterministic branch answers direct case fact for a real created case', async ({ page }) => {
    const officer = {
      ...createOfficerCredentials('chatbot.officer'),
      buckleId: 'BK-1050',
      email: 'playwright.chatbot@police.gov.in',
    }
    await signUpFreshOfficer(page, officer)
    const createdCase = await createCaseViaUi(page, {
      caseName: `Chatbot Deterministic ${Date.now()}`,
      operator: 'Jio',
      caseType: 'Cyber Crime',
      priority: 'medium',
      investigationDetails: 'Deterministic chatbot verification case.',
    })

    await page.goto(createdCase.caseUrl)
    await page.getByRole('button', { name: /support_agent/i }).click()

    const input = page.getByPlaceholder(/tag the case again in this message/i)
    await input.fill(`@"${createdCase.caseName}" what is the telecom operator in this case`)
    await page.getByRole('button', { name: /send message/i }).click()

    await expect(page.getByText(/Jio/i)).toBeVisible()
  })

  test('llm branch answers tagged case synthesis question when chatbot capability is available', async ({ page, request }) => {
    const capabilitiesResponse = await request.get('/api/chatbot/capabilities')
    test.skip(!capabilitiesResponse.ok(), 'Chatbot capabilities endpoint is unavailable.')

    const capabilityPayload = await capabilitiesResponse.json()
    test.skip(
      !Array.isArray(capabilityPayload?.features) || !capabilityPayload.features.includes('chat_assistant'),
      'Chatbot assistant capability is disabled.',
    )
    test.skip(
      String(process.env.PLAYWRIGHT_ENABLE_LLM_CHATBOT || '').trim().toLowerCase() !== 'true',
      'Set PLAYWRIGHT_ENABLE_LLM_CHATBOT=true to run the model-backed chatbot regression.',
    )

    const officer = {
      ...createOfficerCredentials('chatbot.llm.officer'),
      buckleId: 'BK-1048',
      email: 'playwright.chatbot.llm@police.gov.in',
    }
    await signUpFreshOfficer(page, officer)
    const createdCase = await createCaseViaUi(page, {
      caseName: `Chatbot LLM ${Date.now()}`,
      operator: 'Airtel',
      caseType: 'Financial Fraud',
      priority: 'high',
      investigationDetails: 'LLM-backed chatbot synthesis verification case.',
    })

    await page.goto(createdCase.caseUrl)
    await page.getByRole('button', { name: /support_agent/i }).click()

    const input = page.getByPlaceholder(/tag the case again in this message/i)
    await input.fill(`@"${createdCase.caseName}" summarize this case in two short lines`)
    await page.getByRole('button', { name: /send message/i }).click()

    await expect(page.getByText(/SHAKTI SAHAYATA AI/i).last()).toBeVisible()
    await expect(page.getByText(/database query/i)).toHaveCount(0)
    await expect(page.getByText(/Ollama unavailable/i)).toHaveCount(0)
  })
})
