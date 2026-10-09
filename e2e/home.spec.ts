import { expect, test } from '@playwright/test'

test.describe('home screen', () => {
  test('loads with all setup cards and keyboard shortcut hint', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Temporis' })).toBeVisible()

    await expect(page.getByRole('heading', { name: 'Local Match' })).toBeVisible()
    await expect(page.getByRole('heading', { name: /LAN Lobby/ })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Accessibility' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Leaderboard' })).toBeVisible()

    // QoL regression: keyboard shortcut hint is advertised on the home screen
    await expect(page.getByText(/use keys 1\/2\/3 for quick actions/)).toBeVisible()
  })

  test('regression: shell box hugs content and page does not force-scroll', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText(/100%/).first()).toBeVisible({ timeout: 30_000 })

    const metrics = await page.evaluate(() => {
      const doc = document.documentElement
      const main = document.querySelector('main.app-home')
      const grid = document.querySelector('.home-grid')
      if (!main || !grid) return null
      const mainRect = main.getBoundingClientRect()
      const gridRect = grid.getBoundingClientRect()
      return {
        canScroll: doc.scrollHeight > window.innerHeight + 2,
        emptyBelowGrid: Math.round(mainRect.bottom - gridRect.bottom),
      }
    })

    expect(metrics).not.toBeNull()
    // The background shell must end right after the content (only its 1rem padding).
    expect(metrics!.canScroll).toBe(false)
    expect(metrics!.emptyBelowGrid).toBeLessThanOrEqual(20)
  })

  test('regression: grid cards do not stretch beyond their content', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText(/100%/).first()).toBeVisible({ timeout: 30_000 })

    const gaps = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.home-grid > .setup-card')).map((card) => {
        const cardRect = card.getBoundingClientRect()
        const lastChild = card.lastElementChild?.getBoundingClientRect()
        return lastChild ? Math.round(cardRect.bottom - lastChild.bottom) : 0
      })
    })

    expect(gaps.length).toBeGreaterThanOrEqual(4)
    for (const gap of gaps) {
      // only the card's own padding (~14px) below the content
      expect(gap).toBeLessThanOrEqual(22)
    }
  })

  test('leaderboard loads via API (or shows the empty state)', async ({ page }) => {
    await page.goto('/')
    const list = page.locator('.leaderboard-list')
    await expect(list).toBeVisible()
    // Either persisted entries or the graceful empty message — never an error line.
    await expect(list.getByRole('listitem').first()).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.setup-error-line')).toHaveCount(0)
  })

  test('rules page opens and goes back', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'View Rules' }).click()
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
    await page.getByRole('button', { name: 'Back' }).click()
    await expect(page.getByRole('heading', { name: 'Local Match' })).toBeVisible()
  })
})
