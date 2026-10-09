import { expect, test, type Page } from '@playwright/test'

async function startLocalMatch(page: Page, nickname = 'Tester') {
  await page.goto('/')
  await expect(page.getByText(/100%/).first()).toBeVisible({ timeout: 30_000 })

  const startButton = page.getByRole('button', { name: 'Start Match' })
  await startButton.click()

  // First start may open the nickname modal; confirm and start again.
  const nicknameDialog = page.getByRole('dialog')
  if (await nicknameDialog.isVisible().catch(() => false)) {
    await nicknameDialog.getByRole('textbox').fill(nickname)
    await nicknameDialog.getByRole('button', { name: 'Confirm' }).click()
    await startButton.click()
  }

  await expect(page.locator('.hand-fan')).toBeVisible({ timeout: 20_000 })
}

test.describe('local match', () => {
  test('hand fan renders and every card center is clickable', async ({ page }) => {
    await startLocalMatch(page)

    const handButtons = page.locator('.hand-fan button.card-image-button')
    await expect(handButtons).toHaveCount(6)

    // Regression: no overlay may cover a card button's center (hand-fan pointer-events bug).
    const coverage = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.hand-fan button.card-image-button')).map((button) => {
        const rect = button.getBoundingClientRect()
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
        return hit === button || Boolean(hit && button.contains(hit))
      })
    })
    expect(coverage.every(Boolean)).toBe(true)
  })

  test('regression: hovered card paints above its fan neighbors', async ({ page }) => {
    await startLocalMatch(page)

    const thirdCard = page.locator('.hand-fan button.card-image-button').nth(2)
    const box = await thirdCard.boundingBox()
    expect(box).not.toBeNull()

    // Hover the visible (left) part of the card, like a real pointer would.
    await page.mouse.move(box!.x + box!.width * 0.25, box!.y + box!.height * 0.4, { steps: 5 })
    await expect
      .poll(async () => thirdCard.evaluate((el) => getComputedStyle(el).zIndex), { timeout: 5_000 })
      .toBe('200')
  })

  test('reaction window opens, has a single pass control, and hud is click-through', async ({ page }) => {
    await startLocalMatch(page)

    // Play the first valid card via the advertised keyboard shortcut.
    await page.keyboard.press('1')

    const reactionHud = page.locator('.table-action-hud')
    await expect(reactionHud).toBeVisible({ timeout: 10_000 })
    await expect(reactionHud.locator('.table-phase-pill')).toHaveText('Reaction Window')

    // Regression: the redundant "Skip" button was removed; only "Pass reaction" remains.
    await expect(page.getByRole('button', { name: 'Skip' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Pass reaction/ })).toHaveCount(1)

    // Regression: the HUD never blocks clicks to seats/cards underneath it.
    const pointerContract = await page.evaluate(() => {
      const hud = document.querySelector('.table-action-hud')
      if (!hud) return null
      const hudStyle = getComputedStyle(hud)
      const button = hud.querySelector('button')
      return {
        hud: hudStyle.pointerEvents,
        button: button ? getComputedStyle(button).pointerEvents : null,
      }
    })
    expect(pointerContract).toEqual({ hud: 'none', button: 'auto' })

    // Bots may TNH-cancel the play; either way the window must close and the game move on
    // (next turn starts, or a follow-up selection like discard/target opens).
    await expect(page.getByRole('button', { name: /Pass reaction/ })).toHaveCount(0, { timeout: 20_000 })
    await expect(page.locator('.hud-status-line')).toContainText(/turn|discard|opponent/i, { timeout: 10_000 })
  })

  test('draw action via keyboard decreases deck count', async ({ page }) => {
    await startLocalMatch(page)

    const deckBefore = await page.getByText('Deck:').locator('..').innerText()
    const before = Number(deckBefore.replace(/\D+/g, ''))

    await page.keyboard.press('2') // quick action: Draw

    await expect
      .poll(async () => {
        const deckNow = await page.getByText('Deck:').locator('..').innerText()
        return Number(deckNow.replace(/\D+/g, ''))
      })
      .toBeLessThan(before)
  })
})
