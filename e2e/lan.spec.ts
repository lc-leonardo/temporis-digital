import { expect, test, type Browser, type Page } from '@playwright/test'

async function openClient(browser: Browser, nickname: string): Promise<Page> {
  const context = await browser.newContext({ baseURL: 'http://localhost:5173' })
  const page = await context.newPage()
  await page.goto('/')
  await expect(page.getByText(/100%/).first()).toBeVisible({ timeout: 30_000 })
  await page.getByRole('textbox', { name: 'Nickname' }).fill(nickname)
  return page
}

test.describe('lan multiplayer (real two-client simulation)', () => {
  test('host and guest sync a match, hands stay masked, chat works both ways', async ({ browser }) => {
    test.setTimeout(120_000)

    const hostPage = await openClient(browser, 'Hoster')
    const guestPage = await openClient(browser, 'Guesty')

    // Host creates the room.
    await hostPage.getByRole('button', { name: 'Host Room' }).click()
    const roomCodeInput = hostPage.getByRole('textbox', { name: 'Room code' })
    await expect(roomCodeInput).not.toHaveValue('', { timeout: 10_000 })
    const roomCode = await roomCodeInput.inputValue()
    expect(roomCode).toMatch(/^[A-Z0-9]{6}$/)

    // Guest joins with the code.
    await guestPage.getByRole('textbox', { name: 'Room code' }).fill(roomCode)
    await guestPage.getByRole('button', { name: 'Join Room' }).click()

    // Both sides list the two players.
    await expect(hostPage.getByText('Players (2/6)')).toBeVisible({ timeout: 10_000 })
    await expect(guestPage.getByText('Players (2/6)')).toBeVisible({ timeout: 10_000 })
    await expect(guestPage.getByText('Hoster')).toBeVisible()

    // Host starts the match; the loading barrier resolves when both clients finish preloading.
    await hostPage.getByRole('button', { name: 'Start Match with Room Players' }).click()
    await expect(hostPage.locator('.hand-fan')).toBeVisible({ timeout: 30_000 })
    await expect(guestPage.locator('.hand-fan')).toBeVisible({ timeout: 30_000 })

    // Both boards show both players.
    for (const page of [hostPage, guestPage]) {
      await expect(page.getByText('Hoster').first()).toBeVisible()
      await expect(page.getByText('Guesty').first()).toBeVisible()
    }

    // Privacy: each client sees its own 6 real cards, and NO real card images from the opponent's hand.
    for (const page of [hostPage, guestPage]) {
      const ownHandCards = await page.locator('.hand-fan img[alt^="Card "]').count()
      expect(ownHandCards).toBe(6)
      const opponentAreaCards = await page.locator('.seat-node img[alt^="Card "], .seat-chip img[alt^="Card "]').count()
      expect(opponentAreaCards).toBe(0)
    }

    // Chat works host -> guest.
    await hostPage.getByRole('button', { name: 'Chat' }).click()
    await hostPage.getByRole('textbox', { name: /Type/ }).fill('hello-from-host')
    await hostPage.getByRole('button', { name: 'Send' }).click()

    await guestPage.getByRole('button', { name: 'Chat' }).click()
    await expect(guestPage.getByText('hello-from-host')).toBeVisible({ timeout: 10_000 })

    // And guest -> host.
    await guestPage.getByRole('textbox', { name: /Type/ }).fill('hello-from-guest')
    await guestPage.getByRole('button', { name: 'Send' }).click()
    await expect(hostPage.getByText('hello-from-guest')).toBeVisible({ timeout: 10_000 })

    // Disconnect cleanup: closing the context drops the socket; the seat is preserved for reconnection by design.
    await hostPage.context().close()
    await guestPage.context().close()
  })
})
