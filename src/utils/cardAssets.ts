import type { SyntheticEvent } from 'react'

export const CARD_ID_MIN = 1
export const CARD_ID_MAX = 120

export const ALL_CARD_IDS = Array.from(
  { length: CARD_ID_MAX - CARD_ID_MIN + 1 },
  (_, index) => CARD_ID_MIN + index,
)

export function getCardWebpUrl(cardId: number): string {
  return `/cards_webp/${cardId}.webp`
}

export function getCardPngUrl(cardId: number): string {
  return `/cards/${cardId}.png`
}

export function getPreferredCardImageUrl(cardId: number): string {
  return getCardWebpUrl(cardId)
}

export function handleCardImageError(event: SyntheticEvent<HTMLImageElement, Event>) {
  const image = event.currentTarget
  if (image.dataset.fallbackApplied === '1') {
    return
  }

  const fallbackSrc = image.dataset.fallbackSrc
  if (!fallbackSrc) {
    return
  }

  image.dataset.fallbackApplied = '1'
  image.src = fallbackSrc
}

function preloadSingleCardImage(cardId: number): Promise<void> {
  return new Promise((resolve) => {
    const webpImage = new Image()
    webpImage.onload = () => resolve()
    webpImage.onerror = () => {
      const pngImage = new Image()
      pngImage.onload = () => resolve()
      pngImage.onerror = () => resolve()
      pngImage.src = getCardPngUrl(cardId)
    }
    webpImage.src = getCardWebpUrl(cardId)
  })
}

export async function preloadCardImages(
  cardIds: number[],
  onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
  if (cardIds.length === 0) {
    onProgress?.(0, 0)
    return
  }

  const queue = [...cardIds]
  const total = queue.length
  let loaded = 0
  onProgress?.(0, total)

  const workers = Math.max(1, Math.min(8, total))
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (queue.length > 0) {
        const nextCardId = queue.pop()
        if (nextCardId === undefined) {
          return
        }
        await preloadSingleCardImage(nextCardId)
        loaded += 1
        onProgress?.(loaded, total)
      }
    }),
  )
}