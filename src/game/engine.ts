import type {
  CardDefinition,
  EventEra,
  GameAction,
  GameSetupOptions,
  GameState,
  PlayerState,
  TemporisRules,
  TimelineCard,
} from './types'

const TOTAL_CARDS = 120

const RANGE = {
  events: {
    past: [1, 20] as const,
    present: [21, 40] as const,
    future: [41, 60] as const,
    paradox: [61, 74] as const,
  },
  actions: {
    back_in_time: [75, 84] as const,
    that_never_happened: [85, 92] as const,
    rewrite_event: [93, 98] as const,
    local_reset: [99, 106] as const,
    time_skip: [107, 112] as const,
    time_swap: [113, 120] as const,
  },
}

function inRange(value: number, range: readonly [number, number]): boolean {
  return value >= range[0] && value <= range[1]
}

function getCardNameById(cardId: number): string {
  if (inRange(cardId, RANGE.events.past)) return 'Past Event'
  if (inRange(cardId, RANGE.events.present)) return 'Present Event'
  if (inRange(cardId, RANGE.events.future)) return 'Future Event'
  if (inRange(cardId, RANGE.events.paradox)) return 'Paradox Event'
  if (inRange(cardId, RANGE.actions.back_in_time)) return 'Back in Time'
  if (inRange(cardId, RANGE.actions.that_never_happened)) return 'That Never Happened'
  if (inRange(cardId, RANGE.actions.rewrite_event)) return 'Rewrite Event'
  if (inRange(cardId, RANGE.actions.local_reset)) return 'Local Reset'
  if (inRange(cardId, RANGE.actions.time_skip)) return 'Time Skip'
  if (inRange(cardId, RANGE.actions.time_swap)) return 'Time Swap'
  return 'Unknown Card'
}

function cardLabel(cardId: number): string {
  return `${getCardNameById(cardId)} (#${cardId})`
}

function hasThatNeverHappenedInHand(hand: number[]): boolean {
  return hand.some((cardId) => inRange(cardId, RANGE.actions.that_never_happened))
}

function anyOtherPlayerHasThatNeverHappened(players: PlayerState[], excludedPlayerIndex: number): boolean {
  return players.some(
    (player, index) => index !== excludedPlayerIndex && hasThatNeverHappenedInHand(player.hand),
  )
}

function isEligibleReactionResponder(game: GameState, playerIndex: number): boolean {
  if (!game.pendingPlay || playerIndex < 0 || playerIndex >= game.players.length) {
    return false
  }

  if (playerIndex === game.pendingPlay.playedBy) {
    return false
  }

  if ((game.pendingPlay.cancelers ?? []).includes(playerIndex)) {
    return false
  }

  if (game.pendingPlay.effectOnly) {
    return playerIndex === game.pendingPlay.reactor
  }

  return true
}

function hasAnyEligibleReactionCanceler(game: GameState): boolean {
  return game.players.some(
    (player, index) => isEligibleReactionResponder(game, index) && hasThatNeverHappenedInHand(player.hand),
  )
}

function pickDeterministicHandIndex(
  hand: number[],
  actorIndex: number,
  targetIndex: number,
  sourceCardId: number,
  entropySeed: number,
): number {
  if (hand.length <= 1) {
    return 0
  }
  const weightedHandHash = hand.reduce((accumulator, cardId, index) => accumulator + cardId * (index + 3), 0)
  const seed =
    sourceCardId * 31 +
    actorIndex * 17 +
    targetIndex * 13 +
    hand.length * 7 +
    weightedHandHash * 5 +
    entropySeed * 11
  return Math.abs(seed) % hand.length
}

function createSeededRng(seed: number): () => number {
  let value = seed >>> 0
  return () => {
    value += 0x6d2b79f5
    let result = Math.imul(value ^ (value >>> 15), 1 | value)
    result ^= result + Math.imul(result ^ (result >>> 7), 61 | result)
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296
  }
}

function shuffledDeck(size: number, rng: () => number = Math.random): number[] {
  const cards = Array.from({ length: size }, (_, index) => index + 1)
  for (let i = cards.length - 1; i > 0; i -= 1) {
    const randomIndex = Math.floor(rng() * (i + 1))
    const temp = cards[i]
    cards[i] = cards[randomIndex]
    cards[randomIndex] = temp
  }
  return cards
}

function draw(deck: number[]): number | null {
  return deck.shift() ?? null
}

function nextPlayer(current: number, totalPlayers: number): number {
  return (current + 1) % totalPlayers
}

function clonePlayers(players: PlayerState[]): PlayerState[] {
  return players.map((player) => ({
    ...player,
    hand: [...player.hand],
    timeline: [...player.timeline],
  }))
}

export function getCardDefinition(cardId: number): CardDefinition {
  if (inRange(cardId, RANGE.actions.back_in_time)) {
    return { id: cardId, kind: 'action', actionName: 'back_in_time' }
  }
  if (inRange(cardId, RANGE.actions.that_never_happened)) {
    return { id: cardId, kind: 'action', actionName: 'that_never_happened' }
  }
  if (inRange(cardId, RANGE.actions.rewrite_event)) {
    return { id: cardId, kind: 'action', actionName: 'rewrite_event' }
  }
  if (inRange(cardId, RANGE.actions.local_reset)) {
    return { id: cardId, kind: 'action', actionName: 'local_reset' }
  }
  if (inRange(cardId, RANGE.actions.time_skip)) {
    return { id: cardId, kind: 'action', actionName: 'time_skip' }
  }
  if (inRange(cardId, RANGE.actions.time_swap)) {
    return { id: cardId, kind: 'action', actionName: 'time_swap' }
  }

  let era: EventEra = 'future'
  if (inRange(cardId, RANGE.events.past)) {
    era = 'past'
  } else if (inRange(cardId, RANGE.events.present)) {
    era = 'present'
  } else if (inRange(cardId, RANGE.events.future)) {
    era = 'future'
  } else if (inRange(cardId, RANGE.events.paradox)) {
    era = 'paradox'
  }
  return { id: cardId, kind: 'event', era }
}

function moveCardFromHandToDiscard(players: PlayerState[], playerIndex: number, cardId: number, discard: number[]) {
  const hand = players[playerIndex].hand
  const index = hand.indexOf(cardId)
  if (index >= 0) {
    hand.splice(index, 1)
  }
  discard.push(cardId)
}

function eraRank(era: EventEra): number {
  if (era === 'past') {
    return 0
  }
  if (era === 'present') {
    return 1
  }
  if (era === 'future') {
    return 2
  }
  return 99
}

function normalizeTimelineOrder(timeline: TimelineCard[]): void {
  const nonParadoxIndices: number[] = []
  const nonParadoxCards: TimelineCard[] = []

  timeline.forEach((entry, index) => {
    if (entry.era !== 'paradox') {
      nonParadoxIndices.push(index)
      nonParadoxCards.push(entry)
    }
  })

  nonParadoxCards.sort((left, right) => eraRank(left.era) - eraRank(right.era))

  nonParadoxIndices.forEach((index, nonParadoxIndex) => {
    timeline[index] = nonParadoxCards[nonParadoxIndex]
  })
}

function normalizePlayersTimelines(players: PlayerState[]): void {
  players.forEach((player) => {
    normalizeTimelineOrder(player.timeline)
  })
}

function insertEventIntoTimeline(timeline: TimelineCard[], timelineCard: TimelineCard, playerIndex: number): void {
  if (timelineCard.era === 'paradox') {
    const deterministicIndex =
      (timelineCard.id * 31 + playerIndex * 17 + timeline.length * 13) % (timeline.length + 1)
    timeline.splice(deterministicIndex, 0, timelineCard)
    return
  }

  const targetRank = eraRank(timelineCard.era)
  let insertAt = timeline.length

  for (let index = 0; index < timeline.length; index += 1) {
    const entry = timeline[index]
    if (entry.era === 'paradox') {
      continue
    }

    if (eraRank(entry.era) > targetRank) {
      insertAt = index
      break
    }
  }

  timeline.splice(insertAt, 0, timelineCard)
}

function applyEventOnPlay(
  _game: GameState,
  _rules: TemporisRules,
  players: PlayerState[],
  card: CardDefinition,
  playedBy: number,
): { statusSuffix: string; requiresManualDiscard: boolean } {
  const era = card.era ?? 'future'
  const eraLabel = era.charAt(0).toUpperCase() + era.slice(1)
  const current = players[playedBy]
  const timelineCard: TimelineCard = { id: card.id, era }
  insertEventIntoTimeline(current.timeline, timelineCard, playedBy)

  if (era === 'past') {
    return {
      statusSuffix: 'Past event placed. Draw 1 card.',
      requiresManualDiscard: false,
    }
  }

  if (era === 'present') {
    return {
      statusSuffix: `${eraLabel} event placed. Choose 1 card to discard, then draw 1.`,
      requiresManualDiscard: true,
    }
  }

  if (era === 'paradox') {
    return {
      statusSuffix: 'Paradox event resolved: placed in timeline (no era points).',
      requiresManualDiscard: false,
    }
  }

  return { statusSuffix: `${eraLabel} event resolved.`, requiresManualDiscard: false }
}

function findTimelineOwnerAndIndex(players: PlayerState[], cardId: number): { playerIndex: number; index: number } | null {
  let match: { playerIndex: number; index: number } | null = null

  for (let playerIndex = 0; playerIndex < players.length; playerIndex += 1) {
    const index = players[playerIndex].timeline.findIndex((entry) => entry.id === cardId)
    if (index >= 0) {
      if (match) {
        return null
      }
      match = { playerIndex, index }
    }
  }

  return match
}

function validateUniquePhysicalCards(game: GameState): string | null {
  const seen = new Map<number, string>()

  const registerCard = (cardId: number, location: string): string | null => {
    if (!Number.isInteger(cardId) || cardId < 1 || cardId > TOTAL_CARDS) {
      return `Invalid card id ${cardId} at ${location}.`
    }

    const previousLocation = seen.get(cardId)
    if (previousLocation) {
      return `Card #${cardId} is duplicated (${previousLocation} and ${location}).`
    }

    seen.set(cardId, location)
    return null
  }

  for (let index = 0; index < game.deck.length; index += 1) {
    const error = registerCard(game.deck[index], `deck[${index}]`)
    if (error) return error
  }

  for (let index = 0; index < game.discardPile.length; index += 1) {
    const error = registerCard(game.discardPile[index], `discard[${index}]`)
    if (error) return error
  }

  for (let playerIndex = 0; playerIndex < game.players.length; playerIndex += 1) {
    const player = game.players[playerIndex]

    for (let handIndex = 0; handIndex < player.hand.length; handIndex += 1) {
      const error = registerCard(player.hand[handIndex], `players[${playerIndex}].hand[${handIndex}]`)
      if (error) return error
    }

    for (let timelineIndex = 0; timelineIndex < player.timeline.length; timelineIndex += 1) {
      const error = registerCard(player.timeline[timelineIndex].id, `players[${playerIndex}].timeline[${timelineIndex}]`)
      if (error) return error
    }
  }

  return null
}

function getScore(game: GameState, playerIndex: number): { eraPoints: number; paradoxCount: number; handCount: number } {
  const timeline = game.players[playerIndex].timeline
  const eraPoints = timeline.filter((entry) => entry.era !== 'paradox').length
  const paradoxCount = timeline.filter((entry) => entry.era === 'paradox').length
  return {
    eraPoints,
    paradoxCount,
    handCount: game.players[playerIndex].hand.length,
  }
}

function getWinnerNameByDeckDepletion(game: GameState): string {
  let contenders = game.players.map((player, index) => ({
    index,
    name: player.name,
    timelineCount: player.timeline.length,
    ...getScore(game, index),
  }))

  const maxTimelineCards = Math.max(...contenders.map((entry) => entry.timelineCount))
  contenders = contenders.filter((entry) => entry.timelineCount === maxTimelineCards)

  const maxEraPoints = Math.max(...contenders.map((entry) => entry.eraPoints))
  contenders = contenders.filter((entry) => entry.eraPoints === maxEraPoints)

  const minHand = Math.min(...contenders.map((entry) => entry.handCount))
  contenders = contenders.filter((entry) => entry.handCount === minHand)

  if (contenders.length === 1) {
    return contenders[0].name
  }

  return `Shared victory: ${contenders.map((entry) => entry.name).join(', ')}`
}

function getEraTimelineCounts(timeline: TimelineCard[]): { past: number; present: number; future: number } {
  return timeline.reduce(
    (counts, entry) => {
      if (entry.era === 'past') {
        counts.past += 1
      } else if (entry.era === 'present') {
        counts.present += 1
      } else if (entry.era === 'future') {
        counts.future += 1
      }
      return counts
    },
    { past: 0, present: 0, future: 0 },
  )
}

function hasValidTimeline(timeline: TimelineCard[], timelineTarget: number): boolean {
  if (timeline.length < timelineTarget) {
    return false
  }

  const counts = getEraTimelineCounts(timeline)
  return counts.past > 0 && counts.present > 0 && counts.future > 0
}

function checkEndGame(game: GameState): GameState {
  normalizePlayersTimelines(game.players)

  const currentTimeline = game.players[game.currentPlayerIndex].timeline
  const currentTimelinePoints = currentTimeline.filter((entry) => entry.era !== 'paradox').length
  if (hasValidTimeline(currentTimeline, game.timelineTarget)) {
    const winner = game.players[game.currentPlayerIndex].name
    const counts = getEraTimelineCounts(currentTimeline)
    const paradoxCount = currentTimeline.length - currentTimelinePoints
    return {
      ...game,
      phase: 'GAME_OVER',
      winner,
      statusText: `Game over. ${winner} completed a valid timeline (Past ${counts.past}, Present ${counts.present}, Future ${counts.future}; total ${currentTimeline.length}/${game.timelineTarget}, era points ${currentTimelinePoints}, paradox ${paradoxCount}).`,
    }
  }

  if (game.deck.length === 0) {
    const winner = getWinnerNameByDeckDepletion(game)
    return {
      ...game,
      phase: 'GAME_OVER',
      winner,
      statusText: `Game over. Winner: ${winner}.`,
    }
  }

  if (game.pendingForcedSkips && game.currentPlayerIndex === game.pendingForcedSkips.playerIndex) {
    const skippedPlayer = game.players[game.pendingForcedSkips.playerIndex]
    const next = nextPlayer(game.currentPlayerIndex, game.players.length)
    const remaining = game.pendingForcedSkips.remaining - 1
    return checkEndGame({
      ...game,
      currentPlayerIndex: next,
      pendingForcedSkips:
        remaining > 0
          ? {
              playerIndex: game.pendingForcedSkips.playerIndex,
              remaining,
            }
          : null,
      statusText: `${skippedPlayer.name} skips turn due to Time Skip. ${game.players[next].name}'s turn.`,
    })
  }

  return game
}

export function createInitialGame(options: GameSetupOptions): GameState {
  const { startingHand, startingTimeline = 7, totalPlayers, botCount, playerRoster, seed } = options
  const rng = typeof seed === 'number' ? createSeededRng(seed) : Math.random
  const deck = shuffledDeck(TOTAL_CARDS, rng)
  let players: PlayerState[]

  if (playerRoster && playerRoster.length >= 2) {
    const roster = playerRoster.slice(0, 6)
    players = roster.map((entry, id) => ({
      id,
      name: entry.name,
      isBot: entry.isBot,
      hand: [],
      timeline: [],
    }))
  } else {
    const clampedTotalPlayers = Math.max(2, Math.min(6, totalPlayers))
    const clampedBotCount = Math.max(0, Math.min(clampedTotalPlayers - 1, botCount))

    players = Array.from({ length: clampedTotalPlayers }, (_, id) => {
      const isBot = id > 0 && id <= clampedBotCount
      return {
        id,
        name: id === 0 ? 'You' : isBot ? `Bot ${id}` : `Player ${id + 1}`,
        isBot,
        hand: [],
        timeline: [],
      }
    })
  }

  for (let round = 0; round < startingHand; round += 1) {
    players.forEach((player) => {
      const card = draw(deck)
      if (card !== null) {
        player.hand.push(card)
      }
    })
  }

  return {
    timelineTarget: startingTimeline,
    deck,
    discardPile: [],
    players,
    currentPlayerIndex: 0,
    phase: 'PLAYER_CHOICE',
    pendingPlay: null,
    pendingDiscard: null,
    pendingActionSelection: null,
    pendingFuturePeek: null,
    pendingForcedSkips: null,
    lastFutureReveal: null,
    reactionHistory: [],
    statusText: `${players[0].name}'s turn. Choose one action: play one card or draw one card.`,
    winner: null,
  }
}

export function queueCardPlay(game: GameState, cardId: number): GameState {
  if (game.winner) {
    return game
  }

  if (game.phase !== 'PLAYER_CHOICE') {
    return game
  }

  const activePlayer = game.players[game.currentPlayerIndex]
  if (!activePlayer.hand.includes(cardId)) {
    return game
  }

  const updatedPlayers = clonePlayers(game.players)
  const current = updatedPlayers[game.currentPlayerIndex]
  const card = getCardDefinition(cardId)

  if (card.kind === 'action' && card.actionName === 'that_never_happened') {
    return {
      ...game,
      statusText:
        'That Never Happened is reaction-only. You can only use it outside your turn in the reaction window.',
    }
  }

  if (card.kind === 'action' && card.actionName === 'rewrite_event') {
    if (activePlayer.timeline.length === 0) {
      return {
        ...game,
        statusText: 'Rewrite Event requires at least one card in your timeline to replace.',
      }
    }

    const hasEventInHand = activePlayer.hand.some((id) => getCardDefinition(id).kind === 'event')
    if (!hasEventInHand) {
      return {
        ...game,
        statusText: 'Rewrite Event requires at least one Event card in your hand to use as replacement.',
      }
    }
  }

  if (card.kind === 'action' && card.actionName === 'time_swap') {
    const hasOwnTimelineCard = activePlayer.timeline.length > 0
    const hasOtherTimelineCard = game.players.some(
      (player, index) => index !== game.currentPlayerIndex && player.timeline.length > 0,
    )

    if (!hasOwnTimelineCard || !hasOtherTimelineCard) {
      return {
        ...game,
        statusText: 'Time Swap requires one Event in your timeline and one Event in another player timeline.',
      }
    }
  }

  if (card.kind === 'action' && card.actionName === 'back_in_time') {
    const hasAnyTimelineCard = game.players.some((player) => player.timeline.length > 0)
    if (!hasAnyTimelineCard) {
      return {
        ...game,
        statusText: 'Back in Time requires at least one card in timeline.',
      }
    }
  }

  if (card.kind === 'action' && card.actionName === 'local_reset') {
    const hasAnyTimelineCard = game.players.some((player) => player.timeline.length > 0)
    if (!hasAnyTimelineCard) {
      return {
        ...game,
        statusText: 'Local Reset requires at least one card in timeline.',
      }
    }
  }

  if (card.kind === 'event' && card.era === 'paradox') {
    const hasReplaceableTimelineCard = activePlayer.timeline.length > 0
    const hasOpponentWithHand = game.players.some(
      (player, index) => index !== game.currentPlayerIndex && player.hand.length > 0,
    )
    if (!hasReplaceableTimelineCard) {
      return {
        ...game,
        statusText: 'Paradox requires another card in your timeline to swap. Play a different card first.',
      }
    }
    if (!hasOpponentWithHand) {
      return {
        ...game,
        statusText: 'Paradox requires an opponent with at least one card in hand.',
      }
    }
  }

  if (card.kind === 'event' && card.era === 'present' && activePlayer.hand.length <= 1) {
    return {
      ...game,
      statusText: 'Present Event requires another card in your hand to discard. Draw first or play a different card.',
    }
  }

  const playedCardIndex = current.hand.indexOf(cardId)
  if (playedCardIndex >= 0) {
    current.hand.splice(playedCardIndex, 1)
  }

  const reactor = nextPlayer(game.currentPlayerIndex, updatedPlayers.length)
  const chainLog = [`${current.name} played ${cardLabel(cardId)}.`]

  return {
    ...game,
    players: updatedPlayers,
    currentPlayerIndex: reactor,
    phase: 'REACTION_WINDOW',
    pendingPlay: {
      playedBy: game.currentPlayerIndex,
      reactor,
      card,
      cancelChainCount: 0,
      cancelers: [],
      nextResponder: reactor,
      passesSinceLastCancel: 0,
      chainLog,
    },
    pendingDiscard: null,
    pendingActionSelection: null,
    pendingFuturePeek: null,
    lastFutureReveal: null,
    reactionHistory: chainLog,
    statusText: `${current.name} played ${cardLabel(cardId)}. Reaction window (5s): any other player may cancel with That Never Happened (85-92).`,
  }
}

export function cancelPendingPlay(game: GameState, responderIndexOverride?: number): GameState {
  if (!game.pendingPlay || game.phase !== 'REACTION_WINDOW') {
    return game
  }

  const responderIndex =
    typeof responderIndexOverride === 'number' ? responderIndexOverride : game.currentPlayerIndex

  if (!isEligibleReactionResponder(game, responderIndex)) {
    return game
  }

  const { card, cancelChainCount, cancelers, chainLog } = game.pendingPlay
  const players = clonePlayers(game.players)
  const discardPile = [...game.discardPile]
  const responderHand = players[responderIndex].hand

  const cancelCard = responderHand.find((id) => inRange(id, RANGE.actions.that_never_happened))
  if (!cancelCard) {
    return game
  }

  moveCardFromHandToDiscard(players, responderIndex, cancelCard, discardPile)
  const nextResponderAfter = nextPlayer(responderIndex, players.length)
  const updatedChainLog = [
    ...chainLog,
    `${players[responderIndex].name} played That Never Happened.`,
  ]

  return {
    ...game,
    players,
    discardPile,
    phase: 'REACTION_WINDOW',
    pendingPlay: {
      ...game.pendingPlay,
      cancelChainCount: cancelChainCount + 1,
      cancelers: [...cancelers, responderIndex],
      nextResponder: nextResponderAfter,
      passesSinceLastCancel: 0,
      chainLog: updatedChainLog,
    },
    pendingDiscard: null,
    pendingActionSelection: null,
    pendingFuturePeek: game.pendingFuturePeek,
    reactionHistory: updatedChainLog,
    currentPlayerIndex: nextResponderAfter,
    statusText: `${players[responderIndex].name} played That Never Happened against ${cardLabel(card.id)}. Reaction window remains open.`,
  }
}

export function resolvePendingPlay(game: GameState, rules: TemporisRules): GameState {
  if (!game.pendingPlay || game.phase !== 'REACTION_WINDOW') {
    return game
  }

  const { playedBy, card, cancelChainCount, chainLog } = game.pendingPlay
  const players = clonePlayers(game.players)
  const discardPile = [...game.discardPile]
  const deck = [...game.deck]
  const next = nextPlayer(playedBy, players.length)
  const updatedReactionHistory = [...chainLog, 'Reaction window ended.']

  if (cancelChainCount % 2 === 1) {
    if (!game.pendingPlay.effectOnly) {
      discardPile.push(card.id)
    }

    const futurePeekState = game.pendingFuturePeek
    const futurePeekCanceled =
      game.pendingPlay.effectOnly && card.kind === 'action' && card.actionName === 'future_peek' && Boolean(futurePeekState)

    return checkEndGame({
      ...game,
      players,
      discardPile,
      phase: 'PLAYER_CHOICE',
      pendingPlay: null,
      pendingDiscard: null,
      pendingActionSelection: null,
      pendingFuturePeek: null,
      lastFutureReveal: futurePeekCanceled ? null : game.lastFutureReveal,
      reactionHistory: updatedReactionHistory,
      currentPlayerIndex: futurePeekCanceled ? futurePeekState!.nextPlayerIndex : next,
      statusText: futurePeekCanceled
        ? `${players[futurePeekState!.playedBy].name}'s Future Event hand peek was canceled by That Never Happened. ${players[futurePeekState!.nextPlayerIndex].name}'s turn.`
        : `${players[playedBy].name}'s card ${cardLabel(card.id)} stays canceled after the That Never Happened chain. ${players[next].name}'s turn.`,
    })
  }

  if (card.kind === 'event') {
    const { statusSuffix, requiresManualDiscard } = applyEventOnPlay(game, rules, players, card, playedBy)

    if (requiresManualDiscard) {
      if (players[playedBy].hand.length === 0) {
        const drawn = draw(deck)
        if (drawn !== null) {
          players[playedBy].hand.push(drawn)
        }

        return checkEndGame({
          ...game,
          players,
          discardPile,
          deck,
          phase: 'PLAYER_CHOICE',
          pendingPlay: null,
          pendingDiscard: null,
          pendingActionSelection: null,
          pendingFuturePeek: null,
          reactionHistory: updatedReactionHistory,
          currentPlayerIndex: next,
          statusText:
            drawn === null
              ? `${players[playedBy].name} resolved ${cardLabel(card.id)}. No card available to discard; draw failed (deck empty). ${players[next].name}'s turn.`
              : `${players[playedBy].name} resolved ${cardLabel(card.id)}. No card available to discard; drew 1 card. ${players[next].name}'s turn.`,
        })
      }

      return {
        ...game,
        players,
        discardPile,
        phase: 'DISCARD_SELECTION',
        pendingPlay: null,
        pendingDiscard: {
          playerIndex: playedBy,
          nextPlayerIndex: next,
          sourceEra: card.era as 'past' | 'present',
        },
        pendingActionSelection: null,
        pendingFuturePeek: null,
        reactionHistory: updatedReactionHistory,
        currentPlayerIndex: playedBy,
        statusText: `${players[playedBy].name} resolved ${cardLabel(card.id)}. ${statusSuffix}`,
      }
    }

    if (card.era === 'past') {
      const drawn = draw(deck)
      if (drawn !== null) {
        players[playedBy].hand.push(drawn)
      }

      return checkEndGame({
        ...game,
        players,
        discardPile,
        deck,
        phase: 'PLAYER_CHOICE',
        pendingPlay: null,
        pendingDiscard: null,
        pendingActionSelection: null,
        pendingFuturePeek: null,
        reactionHistory: updatedReactionHistory,
        currentPlayerIndex: next,
        statusText:
          drawn === null
            ? `${players[playedBy].name} resolved ${cardLabel(card.id)}. ${statusSuffix} Draw failed (deck empty). ${players[next].name}'s turn.`
            : `${players[playedBy].name} resolved ${cardLabel(card.id)}. ${statusSuffix} Drew 1 card. ${players[next].name}'s turn.`,
      })
    }

    if (card.era === 'future') {
      return {
        ...game,
        players,
        discardPile,
        phase: 'ACTION_SELECTION',
        pendingPlay: null,
        pendingDiscard: null,
        pendingActionSelection: {
          actionName: 'future_peek',
          playerIndex: playedBy,
          nextPlayerIndex: next,
          step: 'choose_target',
          sourceCardId: card.id,
        },
        pendingFuturePeek: null,
        lastFutureReveal: null,
        reactionHistory: updatedReactionHistory,
        currentPlayerIndex: playedBy,
        statusText: `${players[playedBy].name} resolved ${cardLabel(card.id)}. Choose an opponent to reveal hand (target may react with That Never Happened).`,
      }
    }

    if (card.era === 'paradox') {
      const replaceableTimelineCards = players[playedBy].timeline.filter((entry) => entry.id !== card.id)
      if (replaceableTimelineCards.length === 0) {
        const paradoxEntryIndex = players[playedBy].timeline.findIndex((entry) => entry.id === card.id)
        if (paradoxEntryIndex >= 0) {
          players[playedBy].timeline.splice(paradoxEntryIndex, 1)
        }
        players[playedBy].hand.push(card.id)

        return {
          ...game,
          players,
          discardPile,
          phase: 'PLAYER_CHOICE',
          pendingPlay: null,
          pendingDiscard: null,
          pendingActionSelection: null,
          pendingFuturePeek: null,
          reactionHistory: updatedReactionHistory,
          currentPlayerIndex: playedBy,
          statusText: `${players[playedBy].name} cannot resolve ${cardLabel(card.id)} without another timeline card. Card returned to hand.`,
        }
      }

      const hasTargetWithHand = players.some((player, index) => index !== playedBy && player.hand.length > 0)
      if (!hasTargetWithHand) {
        return checkEndGame({
          ...game,
          players,
          discardPile,
          phase: 'PLAYER_CHOICE',
          pendingPlay: null,
          pendingDiscard: null,
          pendingActionSelection: null,
          pendingFuturePeek: null,
          reactionHistory: updatedReactionHistory,
          currentPlayerIndex: next,
          statusText: `${players[playedBy].name} resolved ${cardLabel(card.id)}. No opponent has cards in hand for Paradox swap. ${players[next].name}'s turn.`,
        })
      }

      return {
        ...game,
        players,
        discardPile,
        phase: 'ACTION_SELECTION',
        pendingPlay: null,
        pendingDiscard: null,
        pendingActionSelection: {
          actionName: 'paradox_swap',
          playerIndex: playedBy,
          nextPlayerIndex: next,
          step: 'choose_swap_source',
          sourceCardId: card.id,
        },
        pendingFuturePeek: null,
        reactionHistory: updatedReactionHistory,
        currentPlayerIndex: playedBy,
        statusText: `${players[playedBy].name} resolved ${cardLabel(card.id)}. Select another card from your timeline to swap with a random hidden card from an opponent hand.`,
      }
    }

    return checkEndGame({
      ...game,
      players,
      discardPile,
      phase: 'PLAYER_CHOICE',
      pendingPlay: null,
      pendingDiscard: null,
      pendingActionSelection: null,
      pendingFuturePeek: null,
      reactionHistory: updatedReactionHistory,
      currentPlayerIndex: next,
      statusText: `${players[playedBy].name} resolved ${cardLabel(card.id)}. ${statusSuffix} ${players[next].name}'s turn.`,
    })
  }

  if (!game.pendingPlay.effectOnly) {
    discardPile.push(card.id)
  }
  const actionName = card.actionName

  if (actionName === 'future_peek' && game.pendingFuturePeek) {
    const target = players[game.pendingFuturePeek.targetPlayerIndex]
    return checkEndGame({
      ...game,
      players,
      discardPile,
      phase: 'PLAYER_CHOICE',
      pendingPlay: null,
      pendingDiscard: null,
      pendingActionSelection: null,
      pendingFuturePeek: null,
      lastFutureReveal: {
        sourcePlayerIndex: game.pendingFuturePeek.playedBy,
        targetPlayerIndex: game.pendingFuturePeek.targetPlayerIndex,
        cards: [...target.hand],
      },
      reactionHistory: updatedReactionHistory,
      currentPlayerIndex: game.pendingFuturePeek.nextPlayerIndex,
      statusText: `${players[game.pendingFuturePeek.playedBy].name} revealed ${target.name}'s hand. ${players[game.pendingFuturePeek.nextPlayerIndex].name}'s turn.`,
    })
  }

  if (actionName === 'time_skip') {
    const skippedPlayer = next
    const afterSkipped = nextPlayer(skippedPlayer, players.length)
    const oneVsOne = players.length === 2
    const existingForcedSkips = game.pendingForcedSkips
    const queuedSkips = oneVsOne
      ? {
          playerIndex: skippedPlayer,
          remaining:
            existingForcedSkips && existingForcedSkips.playerIndex === skippedPlayer
              ? existingForcedSkips.remaining + 1
              : 1,
        }
      : existingForcedSkips

    return checkEndGame({
      ...game,
      players,
      discardPile,
      phase: 'PLAYER_CHOICE',
      pendingPlay: null,
      pendingDiscard: null,
      pendingActionSelection: null,
      pendingFuturePeek: null,
      pendingForcedSkips: queuedSkips,
      reactionHistory: updatedReactionHistory,
      currentPlayerIndex: afterSkipped,
      statusText: oneVsOne
        ? `${players[playedBy].name} resolved ${cardLabel(card.id)}. Time Skip: ${players[skippedPlayer].name} skips now and will skip once more. ${players[afterSkipped].name}'s turn.`
        : `${players[playedBy].name} resolved ${cardLabel(card.id)}. Time Skip: ${players[skippedPlayer].name} skips their turn. ${players[afterSkipped].name}'s turn.`,
    })
  }

  if (actionName === 'that_never_happened') {
    return checkEndGame({
      ...game,
      players,
      discardPile,
      phase: 'PLAYER_CHOICE',
      pendingPlay: null,
      pendingDiscard: null,
      pendingActionSelection: null,
      pendingFuturePeek: null,
      reactionHistory: updatedReactionHistory,
      currentPlayerIndex: next,
      statusText: `${players[playedBy].name} resolved ${cardLabel(card.id)}. That Never Happened has no normal-turn effect. ${players[next].name}'s turn.`,
    })
  }

  if (actionName === 'back_in_time') {
    const hasAnyTimeline = players.some((player) => player.timeline.length > 0)
    if (!hasAnyTimeline) {
      return checkEndGame({
        ...game,
        players,
        discardPile,
        phase: 'PLAYER_CHOICE',
        pendingPlay: null,
        pendingDiscard: null,
        pendingActionSelection: null,
        pendingFuturePeek: null,
        reactionHistory: updatedReactionHistory,
        currentPlayerIndex: next,
        statusText: `${players[playedBy].name} resolved ${cardLabel(card.id)}. No timeline card available for Back in Time. ${players[next].name}'s turn.`,
      })
    }
    return {
      ...game,
      players,
      discardPile,
      phase: 'ACTION_SELECTION',
      pendingPlay: null,
      pendingDiscard: null,
      pendingActionSelection: {
        actionName,
        playerIndex: playedBy,
        nextPlayerIndex: next,
        step: 'choose_target',
        sourceCardId: card.id,
      },
      pendingFuturePeek: null,
      reactionHistory: updatedReactionHistory,
      currentPlayerIndex: playedBy,
      statusText: `${players[playedBy].name} played ${cardLabel(card.id)}. Select the last Event card from any timeline to return to its owner's hand.`,
    }
  }

  if (actionName === 'local_reset') {
    const hasTimeline = players.some((player) => player.timeline.length > 0)
    if (!hasTimeline) {
      return checkEndGame({
        ...game,
        players,
        discardPile,
        phase: 'PLAYER_CHOICE',
        pendingPlay: null,
        pendingDiscard: null,
        pendingActionSelection: null,
        pendingFuturePeek: null,
        reactionHistory: updatedReactionHistory,
        currentPlayerIndex: next,
        statusText: `${players[playedBy].name} resolved ${cardLabel(card.id)}. No timeline card available for Local Reset. ${players[next].name}'s turn.`,
      })
    }
    return {
      ...game,
      players,
      discardPile,
      phase: 'ACTION_SELECTION',
      pendingPlay: null,
      pendingDiscard: null,
      pendingActionSelection: {
        actionName,
        playerIndex: playedBy,
        nextPlayerIndex: next,
        step: 'choose_target',
        sourceCardId: card.id,
      },
      pendingFuturePeek: null,
      reactionHistory: updatedReactionHistory,
      currentPlayerIndex: playedBy,
      statusText: `${players[playedBy].name} played ${cardLabel(card.id)}. Select one Event card from any timeline to discard.`,
    }
  }

  if (actionName === 'rewrite_event') {
    if (players[playedBy].timeline.length === 0) {
      return checkEndGame({
        ...game,
        players,
        discardPile,
        phase: 'PLAYER_CHOICE',
        pendingPlay: null,
        pendingDiscard: null,
        pendingActionSelection: null,
        pendingFuturePeek: null,
        reactionHistory: updatedReactionHistory,
        currentPlayerIndex: next,
        statusText: `${players[playedBy].name} resolved ${cardLabel(card.id)}. No card in own timeline to rewrite. ${players[next].name}'s turn.`,
      })
    }

    const hasEventInHand = players[playedBy].hand.some((id) => getCardDefinition(id).kind === 'event')
    if (!hasEventInHand) {
      return checkEndGame({
        ...game,
        players,
        discardPile,
        phase: 'PLAYER_CHOICE',
        pendingPlay: null,
        pendingDiscard: null,
        pendingActionSelection: null,
        pendingFuturePeek: null,
        reactionHistory: updatedReactionHistory,
        currentPlayerIndex: next,
        statusText: `${players[playedBy].name} resolved ${cardLabel(card.id)}. No Event card in hand to replace timeline card. ${players[next].name}'s turn.`,
      })
    }

    return {
      ...game,
      players,
      discardPile,
      phase: 'ACTION_SELECTION',
      pendingPlay: null,
      pendingDiscard: null,
      pendingActionSelection: {
        actionName,
        playerIndex: playedBy,
        nextPlayerIndex: next,
        step: 'choose_target',
        sourceCardId: card.id,
      },
      pendingFuturePeek: null,
      reactionHistory: updatedReactionHistory,
      currentPlayerIndex: playedBy,
      statusText: `${players[playedBy].name} played ${cardLabel(card.id)}. Select one timeline card, then choose an Event card from your hand as replacement.`,
    }
  }

  if (actionName === 'time_swap') {
    const hasOwnCard = players[playedBy].timeline.length > 0
    const hasOtherCard = players.some((player, index) => index !== playedBy && player.timeline.length > 0)
    if (!hasOwnCard || !hasOtherCard) {
      return checkEndGame({
        ...game,
        players,
        discardPile,
        phase: 'PLAYER_CHOICE',
        pendingPlay: null,
        pendingDiscard: null,
        pendingActionSelection: null,
        pendingFuturePeek: null,
        reactionHistory: updatedReactionHistory,
        currentPlayerIndex: next,
        statusText: `${players[playedBy].name} resolved ${cardLabel(card.id)}. Time Swap requires one card in your timeline and one card in another timeline. ${players[next].name}'s turn.`,
      })
    }
    return {
      ...game,
      players,
      discardPile,
      phase: 'ACTION_SELECTION',
      pendingPlay: null,
      pendingDiscard: null,
      pendingActionSelection: {
        actionName,
        playerIndex: playedBy,
        nextPlayerIndex: next,
        step: 'choose_swap_source',
        sourceCardId: card.id,
      },
      pendingFuturePeek: null,
      reactionHistory: updatedReactionHistory,
      currentPlayerIndex: playedBy,
      statusText: `${players[playedBy].name} played ${cardLabel(card.id)}. Select one Event from your timeline.`,
    }
  }

  return game
}

export function discardForPendingEvent(game: GameState, cardId: number): GameState {
  if (game.phase !== 'DISCARD_SELECTION' || !game.pendingDiscard) {
    return game
  }

  const players = clonePlayers(game.players)
  const discardPile = [...game.discardPile]
  const deck = [...game.deck]
  const pending = game.pendingDiscard
  const actingPlayer = players[pending.playerIndex]

  if (!actingPlayer.hand.includes(cardId)) {
    return game
  }

  moveCardFromHandToDiscard(players, pending.playerIndex, cardId, discardPile)
  const drawn = draw(deck)
  if (drawn !== null) {
    actingPlayer.hand.push(drawn)
  }

  return checkEndGame({
    ...game,
    players,
    discardPile,
    deck,
    phase: 'PLAYER_CHOICE',
    pendingPlay: null,
    pendingDiscard: null,
    pendingActionSelection: null,
    pendingFuturePeek: null,
    reactionHistory: game.reactionHistory,
    currentPlayerIndex: pending.nextPlayerIndex,
    statusText: `${actingPlayer.name} discarded ${cardLabel(cardId)} and drew ${drawn ?? 'none'}. ${players[pending.nextPlayerIndex].name}'s turn.`,
  })
}

export function getSelectableActionTargets(game: GameState): number[] {
  const pending = game.pendingActionSelection
  if (!pending) {
    return []
  }

  if (pending.actionName === 'future_peek') {
    return game.players
      .map((_, index) => index)
      .filter((index) => index !== pending.playerIndex)
  }

  if (pending.actionName === 'paradox_swap' && pending.step === 'choose_target') {
    return game.players
      .map((_, index) => index)
      .filter((index) => index !== pending.playerIndex)
      .filter((index) => game.players[index].hand.length > 0)
  }

  if (pending.actionName === 'back_in_time') {
    return game.players
      .map((player) => player.timeline[player.timeline.length - 1])
      .filter((entry) => Boolean(entry))
      .map((entry) => entry.id)
  }

  if (pending.actionName === 'local_reset') {
    return game.players.flatMap((player) => player.timeline.map((entry) => entry.id))
  }

  if (pending.actionName === 'rewrite_event') {
    if (pending.step === 'choose_target') {
      return game.players[pending.playerIndex].timeline.map((entry) => entry.id)
    }
    if (pending.step === 'choose_rewrite_replacement') {
      return game.players[pending.playerIndex].hand.filter((id) => getCardDefinition(id).kind === 'event')
    }
    return []
  }

  if (pending.actionName === 'time_swap' && pending.step === 'choose_swap_source') {
    return game.players[pending.playerIndex].timeline.map((entry) => entry.id)
  }

  if (pending.actionName === 'paradox_swap' && pending.step === 'choose_swap_source') {
    return game.players[pending.playerIndex].timeline
      .filter((entry) => entry.id !== pending.sourceCardId)
      .map((entry) => entry.id)
  }

  return game.players
    .filter((_, index) => index !== pending.playerIndex)
    .flatMap((player) => player.timeline.map((entry) => entry.id))
}

export function selectActionTarget(game: GameState, cardId: number): GameState {
  if (game.phase !== 'ACTION_SELECTION' || !game.pendingActionSelection) {
    return game
  }

  const pending = game.pendingActionSelection
  const players = clonePlayers(game.players)
  const discardPile = [...game.discardPile]
  const deck = [...game.deck]
  const acting = players[pending.playerIndex]
  const next = pending.nextPlayerIndex

  if (pending.actionName === 'paradox_swap') {
    if (pending.step === 'choose_swap_source') {
      if (pending.sourceCardId !== undefined && cardId === pending.sourceCardId) {
        return game
      }
      const sourceTimelineIndex = acting.timeline.findIndex((entry) => entry.id === cardId)
      if (sourceTimelineIndex < 0) {
        return game
      }

      return {
        ...game,
        players,
        discardPile,
        deck,
        phase: 'ACTION_SELECTION',
        pendingPlay: null,
        pendingDiscard: null,
        pendingActionSelection: {
          ...pending,
          step: 'choose_target',
          selectedSourceCardId: cardId,
          selectedSourceTimelineIndex: sourceTimelineIndex,
        },
        pendingFuturePeek: null,
        reactionHistory: game.reactionHistory,
        currentPlayerIndex: pending.playerIndex,
        statusText: `${acting.name} selected ${cardLabel(cardId)} for Paradox swap. Choose an opponent (random hand card, no hand reveal).`,
      }
    }

    const targetPlayerIndex = cardId
    const selectedSourceCardId = pending.selectedSourceCardId
    const selectedSourceTimelineIndex = pending.selectedSourceTimelineIndex
    if (
      selectedSourceCardId === undefined ||
      selectedSourceTimelineIndex === undefined ||
      targetPlayerIndex < 0 ||
      targetPlayerIndex >= players.length ||
      targetPlayerIndex === pending.playerIndex
    ) {
      return game
    }

    if (selectedSourceTimelineIndex < 0 || selectedSourceTimelineIndex >= acting.timeline.length) {
      return game
    }

    const selectedTimelineCard = acting.timeline[selectedSourceTimelineIndex]
    if (!selectedTimelineCard || selectedTimelineCard.id !== selectedSourceCardId) {
      return game
    }

    const target = players[targetPlayerIndex]
    if (target.hand.length === 0) {
      return game
    }

    const sourceTimelineCard = players[pending.playerIndex].timeline.splice(selectedSourceTimelineIndex, 1)[0]
    if (!sourceTimelineCard) {
      return game
    }

    const paradoxEntropySeed =
      game.deck.length * 37 +
      game.discardPile.length * 23 +
      game.currentPlayerIndex * 19 +
      players[targetPlayerIndex].timeline.length * 29 +
      players[pending.playerIndex].timeline.length * 31

    const randomHandIndex = pickDeterministicHandIndex(
      target.hand,
      pending.playerIndex,
      targetPlayerIndex,
      selectedSourceCardId,
      paradoxEntropySeed,
    )
    const stolenCardId = target.hand.splice(randomHandIndex, 1)[0]
    target.hand.push(sourceTimelineCard.id)

    players[pending.playerIndex].hand.push(stolenCardId)

    return checkEndGame({
      ...game,
      players,
      discardPile,
      deck,
      phase: 'PLAYER_CHOICE',
      pendingPlay: null,
      pendingDiscard: null,
      pendingActionSelection: null,
      pendingFuturePeek: null,
      reactionHistory: game.reactionHistory,
      currentPlayerIndex: next,
      statusText: `${acting.name} resolved Paradox: swapped ${cardLabel(sourceTimelineCard.id)} with a random hidden card from ${target.name}'s hand and received ${cardLabel(stolenCardId)} to hand. ${players[next].name}'s turn.`,
    })
  }

  if (pending.actionName === 'back_in_time') {
    const owner = findTimelineOwnerAndIndex(players, cardId)
    if (!owner) {
      return game
    }
    const timeline = players[owner.playerIndex].timeline
    if (owner.index !== timeline.length - 1) {
      return game
    }
    const removed = timeline.pop()
    if (!removed) {
      return game
    }
    players[owner.playerIndex].hand.push(removed.id)

    return checkEndGame({
      ...game,
      players,
      discardPile,
      deck,
      phase: 'PLAYER_CHOICE',
      pendingPlay: null,
      pendingDiscard: null,
      pendingActionSelection: null,
      pendingFuturePeek: null,
      reactionHistory: game.reactionHistory,
      currentPlayerIndex: next,
      statusText: `${acting.name} resolved Back in Time and returned ${cardLabel(removed.id)} from ${players[owner.playerIndex].name}'s timeline to ${players[owner.playerIndex].name}'s hand. ${players[next].name}'s turn.`,
    })
  }

  if (pending.actionName === 'future_peek') {
    const targetPlayerIndex = cardId
    if (targetPlayerIndex < 0 || targetPlayerIndex >= players.length || targetPlayerIndex === pending.playerIndex) {
      return game
    }

    const target = players[targetPlayerIndex]
    const sourceCardId = pending.sourceCardId ?? 0

    if (anyOtherPlayerHasThatNeverHappened(players, pending.playerIndex)) {
      return {
        ...game,
        players,
        discardPile,
        deck,
        phase: 'REACTION_WINDOW',
        pendingPlay: {
          playedBy: pending.playerIndex,
          reactor: targetPlayerIndex,
          card: { id: sourceCardId, kind: 'action', actionName: 'future_peek' },
          cancelChainCount: 0,
          cancelers: [],
          nextResponder: targetPlayerIndex,
          passesSinceLastCancel: 0,
          chainLog: [
            `${acting.name} targeted ${target.name} with ${cardLabel(sourceCardId)} hand peek effect.`,
          ],
          effectOnly: true,
        },
        pendingDiscard: null,
        pendingActionSelection: null,
        pendingFuturePeek: {
          playedBy: pending.playerIndex,
          targetPlayerIndex,
          nextPlayerIndex: pending.nextPlayerIndex,
          eventCardId: sourceCardId,
        },
        reactionHistory: game.reactionHistory,
        currentPlayerIndex: targetPlayerIndex,
        statusText: `${acting.name} targeted ${target.name} with Future Event hand peek. Reaction window opened: any other player may play That Never Happened to cancel this effect.`,
      }
    }

    return checkEndGame({
      ...game,
      players,
      discardPile,
      deck,
      phase: 'PLAYER_CHOICE',
      pendingPlay: null,
      pendingDiscard: null,
      pendingActionSelection: null,
      pendingFuturePeek: null,
      lastFutureReveal: {
        sourcePlayerIndex: pending.playerIndex,
        targetPlayerIndex,
        cards: [...target.hand],
      },
      reactionHistory: game.reactionHistory,
      currentPlayerIndex: pending.nextPlayerIndex,
      statusText: `${acting.name} revealed ${target.name}'s hand. ${players[pending.nextPlayerIndex].name}'s turn.`,
    })
  }

  if (pending.actionName === 'local_reset') {
    const owner = findTimelineOwnerAndIndex(players, cardId)
    if (!owner) {
      return game
    }
    const removed = players[owner.playerIndex].timeline.splice(owner.index, 1)[0]
    if (!removed) {
      return game
    }
    discardPile.push(removed.id)

    return checkEndGame({
      ...game,
      players,
      discardPile,
      deck,
      phase: 'PLAYER_CHOICE',
      pendingPlay: null,
      pendingDiscard: null,
      pendingActionSelection: null,
      pendingFuturePeek: null,
      reactionHistory: game.reactionHistory,
      currentPlayerIndex: next,
      statusText: `${acting.name} resolved Local Reset and discarded ${cardLabel(removed.id)} from ${players[owner.playerIndex].name}'s timeline. ${players[next].name}'s turn.`,
    })
  }

  if (pending.actionName === 'rewrite_event') {
    if (pending.step === 'choose_target') {
      const sourceTimelineIndex = acting.timeline.findIndex((entry) => entry.id === cardId)
      if (sourceTimelineIndex < 0) {
        return game
      }

      return {
        ...game,
        players,
        discardPile,
        deck,
        phase: 'ACTION_SELECTION',
        pendingPlay: null,
        pendingDiscard: null,
        pendingActionSelection: {
          ...pending,
          step: 'choose_rewrite_replacement',
          selectedSourceCardId: cardId,
          selectedSourceTimelineIndex: sourceTimelineIndex,
        },
        pendingFuturePeek: null,
        reactionHistory: game.reactionHistory,
        currentPlayerIndex: pending.playerIndex,
        statusText: `${acting.name} selected ${cardLabel(cardId)} to rewrite. Choose one Event card from your hand as replacement.`,
      }
    }

    const targetId = pending.selectedSourceCardId
    const targetTimelineIndex = pending.selectedSourceTimelineIndex
    if (!targetId || targetTimelineIndex === undefined) {
      return game
    }

    const replacementCardId = cardId
    const replacementDefinition = getCardDefinition(replacementCardId)
    if (replacementDefinition.kind !== 'event') {
      return game
    }

    const replacementHandIndex = acting.hand.indexOf(replacementCardId)
    if (replacementHandIndex < 0) {
      return game
    }

    let resolvedTargetTimelineIndex = targetTimelineIndex
    if (resolvedTargetTimelineIndex < 0 || resolvedTargetTimelineIndex >= acting.timeline.length) {
      resolvedTargetTimelineIndex = -1
    }

    const selectedTimelineCard =
      resolvedTargetTimelineIndex >= 0 ? acting.timeline[resolvedTargetTimelineIndex] : undefined
    if (!selectedTimelineCard || selectedTimelineCard.id !== targetId) {
      const fallbackMatches = acting.timeline
        .map((entry, index) => (entry.id === targetId ? index : -1))
        .filter((index) => index >= 0)

      if (fallbackMatches.length === 1) {
        resolvedTargetTimelineIndex = fallbackMatches[0]
      } else {
        return {
          ...game,
          players,
          discardPile,
          deck,
          phase: 'ACTION_SELECTION',
          pendingPlay: null,
          pendingDiscard: null,
          pendingActionSelection: {
            ...pending,
            step: 'choose_target',
            selectedSourceCardId: undefined,
            selectedSourceTimelineIndex: undefined,
          },
          pendingFuturePeek: null,
          reactionHistory: game.reactionHistory,
          currentPlayerIndex: pending.playerIndex,
          statusText: `${acting.name} rewrite target became invalid. Select a timeline card again.`,
        }
      }
    }

    const removed = acting.timeline.splice(resolvedTargetTimelineIndex, 1)[0]
    if (!removed) {
      return game
    }
    acting.hand.push(removed.id)
    acting.hand.splice(replacementHandIndex, 1)
    insertEventIntoTimeline(
      acting.timeline,
      { id: replacementDefinition.id, era: replacementDefinition.era ?? 'future' },
      pending.playerIndex,
    )

    return checkEndGame({
      ...game,
      players,
      discardPile,
      deck,
      phase: 'PLAYER_CHOICE',
      pendingPlay: null,
      pendingDiscard: null,
      pendingActionSelection: null,
      pendingFuturePeek: null,
      reactionHistory: game.reactionHistory,
      currentPlayerIndex: next,
      statusText: `${acting.name} resolved Rewrite Event: replaced ${cardLabel(removed.id)} with ${cardLabel(replacementDefinition.id)} and returned ${cardLabel(removed.id)} to hand. ${players[next].name}'s turn.`,
    })
  }

  if (pending.actionName === 'time_swap') {
    if (pending.step === 'choose_swap_source') {
      const sourceIndex = acting.timeline.findIndex((entry) => entry.id === cardId)
      if (sourceIndex < 0) {
        return game
      }
      return {
        ...game,
        players,
        discardPile,
        deck,
        phase: 'ACTION_SELECTION',
        pendingPlay: null,
        pendingDiscard: null,
        pendingActionSelection: {
          ...pending,
          step: 'choose_swap_target',
          selectedSourceCardId: cardId,
          selectedSourceTimelineIndex: sourceIndex,
        },
        pendingFuturePeek: null,
        reactionHistory: game.reactionHistory,
        currentPlayerIndex: pending.playerIndex,
        statusText: `${acting.name} selected ${cardLabel(cardId)}. Choose one Event from another player's timeline to complete Time Swap.`,
      }
    }

    const sourceId = pending.selectedSourceCardId
    const sourceTimelineIndex = pending.selectedSourceTimelineIndex
    if (!sourceId || sourceTimelineIndex === undefined) {
      return game
    }

    if (sourceTimelineIndex < 0 || sourceTimelineIndex >= acting.timeline.length) {
      return game
    }

    const sourceTimelineCard = acting.timeline[sourceTimelineIndex]
    if (!sourceTimelineCard || sourceTimelineCard.id !== sourceId) {
      return game
    }

    const targetOwners = players
      .map((player, index) => ({ player, index }))
      .filter(({ index }) => index !== pending.playerIndex)
      .filter(({ player }) => player.timeline.some((entry) => entry.id === cardId))
    if (targetOwners.length !== 1) {
      return game
    }
    const targetOwner = targetOwners[0].player
    const targetIndex = targetOwner.timeline.findIndex((entry) => entry.id === cardId)
    if (targetIndex < 0) {
      return game
    }

    const sourceCard = acting.timeline[sourceTimelineIndex]
    const targetCard = targetOwner.timeline[targetIndex]
    acting.timeline[sourceTimelineIndex] = targetCard
    targetOwner.timeline[targetIndex] = sourceCard

    return checkEndGame({
      ...game,
      players,
      discardPile,
      deck,
      phase: 'PLAYER_CHOICE',
      pendingPlay: null,
      pendingDiscard: null,
      pendingActionSelection: null,
      pendingFuturePeek: null,
      reactionHistory: game.reactionHistory,
      currentPlayerIndex: next,
      statusText: `${acting.name} resolved Time Swap: exchanged ${cardLabel(sourceCard.id)} with ${cardLabel(targetCard.id)} from ${targetOwner.name}. ${players[next].name}'s turn.`,
    })
  }

  return game
}

export function canCurrentReactorCancel(game: GameState): boolean {
  if (!game.pendingPlay || game.phase !== 'REACTION_WINDOW') {
    return false
  }

  const responderIndex = game.currentPlayerIndex
  if (!isEligibleReactionResponder(game, responderIndex)) {
    return false
  }
  const responder = game.players[responderIndex]
  return responder.hand.some((id) => inRange(id, RANGE.actions.that_never_happened))
}

function autoResolveReactionWhenNoCancelers(game: GameState, rules: TemporisRules): GameState {
  let current = game
  let guard = 0

  while (
    current.phase === 'REACTION_WINDOW' &&
    current.pendingPlay &&
    current.players.length > 2 &&
    !hasAnyEligibleReactionCanceler(current) &&
    guard < current.players.length + 2
  ) {
    const next = resolvePendingPlay(current, rules)
    if (next === current) {
      break
    }
    current = next
    guard += 1
  }

  return current
}

export function drawAndEndTurn(game: GameState): GameState {
  if (game.winner) {
    return game
  }

  if (game.phase !== 'PLAYER_CHOICE') {
    return game
  }

  const updatedPlayers = clonePlayers(game.players)
  const current = updatedPlayers[game.currentPlayerIndex]
  const updatedDeck = [...game.deck]
  const drawnCard = draw(updatedDeck)

  if (drawnCard !== null) {
    current.hand.push(drawnCard)
  }

  const next = nextPlayer(game.currentPlayerIndex, updatedPlayers.length)

  return checkEndGame({
    ...game,
    players: updatedPlayers,
    deck: updatedDeck,
    phase: 'PLAYER_CHOICE',
    pendingPlay: null,
    pendingDiscard: null,
    pendingActionSelection: null,
    pendingFuturePeek: null,
    reactionHistory: game.reactionHistory,
    currentPlayerIndex: next,
    statusText:
      drawnCard === null
        ? `${current.name} tried to draw, but the deck is empty. ${updatedPlayers[next].name}'s turn.`
        : `${current.name} drew 1 card. ${updatedPlayers[next].name}'s turn.`,
  })
}

export function applyGameAction(game: GameState, rules: TemporisRules, action: GameAction): GameState {
  const integrityErrorBefore = validateUniquePhysicalCards(game)
  if (integrityErrorBefore) {
    return {
      ...game,
      statusText: `Integrity error: ${integrityErrorBefore}`,
    }
  }

  let nextState: GameState

  if (action.type === 'play_card') {
    const queued = queueCardPlay(game, action.cardId)
    nextState = autoResolveReactionWhenNoCancelers(queued, rules)
  } else if (action.type === 'draw_end_turn') {
    nextState = drawAndEndTurn(game)
  } else if (action.type === 'pass_reaction') {
    const resolved = resolvePendingPlay(game, rules)
    nextState = autoResolveReactionWhenNoCancelers(resolved, rules)
  } else if (action.type === 'cancel_reaction') {
    const canceled = cancelPendingPlay(game, action.playerIndex)
    nextState = autoResolveReactionWhenNoCancelers(canceled, rules)
  } else if (action.type === 'discard_pending_event') {
    nextState = discardForPendingEvent(game, action.cardId)
  } else if (action.type === 'select_future_target') {
    nextState = selectActionTarget(game, action.targetPlayerIndex)
  } else if (action.type === 'select_action_target') {
    nextState = selectActionTarget(game, action.cardId)
  } else {
    nextState = game
  }

  const integrityErrorAfter = validateUniquePhysicalCards(nextState)
  if (integrityErrorAfter) {
    return {
      ...nextState,
      statusText: `Integrity error: ${integrityErrorAfter}`,
    }
  }

  return nextState
}
