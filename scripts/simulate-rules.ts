/// <reference types="node" />

import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import {
  applyGameAction,
  createInitialGame,
  getSelectableActionTargets,
  canCurrentReactorCancel,
} from '../src/game/engine'
import type { GameAction, GameState, TemporisRules, TimelineCard } from '../src/game/types'

function parseArgs() {
  const args = process.argv.slice(2)
  const hasFlag = (name: string) => args.includes(`--${name}`)
  const get = (name: string, fallback: number) => {
    const index = args.findIndex((value: string) => value === `--${name}`)
    if (index < 0 || !args[index + 1]) {
      return fallback
    }
    const parsed = Number(args[index + 1])
    return Number.isFinite(parsed) ? parsed : fallback
  }
  const getText = (name: string, fallback: string) => {
    const index = args.findIndex((value: string) => value === `--${name}`)
    if (index < 0 || !args[index + 1]) {
      return fallback
    }
    return args[index + 1]
  }
  const replaySeedRaw = get('replay-seed', -1)
  return {
    games: Math.max(1, get('games', 300)),
    maxSteps: Math.max(20, get('maxSteps', 500)),
    seed: Math.max(1, get('seed', Date.now() % 1_000_000)),
    report: hasFlag('report'),
    reportFile: getText('report-file', 'reports/sim-rules-report.json'),
    replaySeed: replaySeedRaw > 0 ? replaySeedRaw : null,
  }
}

interface FuzzMetrics {
  matchesPlayed: number
  completedMatches: number
  totalSteps: number
  maxStepsObserved: number
  phaseVisits: Record<string, number>
  actionCounts: Record<string, number>
  winners: Record<string, number>
  playersCountDistribution: Record<string, number>
}

function createEmptyMetrics(): FuzzMetrics {
  return {
    matchesPlayed: 0,
    completedMatches: 0,
    totalSteps: 0,
    maxStepsObserved: 0,
    phaseVisits: {},
    actionCounts: {},
    winners: {},
    playersCountDistribution: {},
  }
}

function countByKey(map: Record<string, number>, key: string) {
  map[key] = (map[key] ?? 0) + 1
}

function actionKey(action: GameAction): string {
  if (action.type === 'play_card') return 'play_card'
  if (action.type === 'draw_end_turn') return 'draw_end_turn'
  if (action.type === 'pass_reaction') return 'pass_reaction'
  if (action.type === 'cancel_reaction') return 'cancel_reaction'
  if (action.type === 'discard_pending_event') return 'discard_pending_event'
  if (action.type === 'select_future_target') return 'select_future_target'
  return 'select_action_target'
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

function pick<T>(items: T[], rng: () => number): T {
  const index = Math.floor(rng() * items.length)
  return items[index]
}

function redactDrawDetails(text: string): string {
  if (!text) {
    return text
  }

  let redacted = text

  redacted = redacted.replace(/\b[Dd]rew\s+none\b/g, (match) =>
    match[0] === 'D' ? 'Draw failed (deck empty)' : 'draw failed (deck empty)',
  )

  redacted = redacted.replace(/\b[Dd]rew\s+([^.\]]+)(?=\.|\]|$)/g, (full, captured: string) => {
    const normalized = captured.trim().toLowerCase()
    if (
      normalized.startsWith('1 card') ||
      normalized.startsWith('and ended turn') ||
      normalized.startsWith('failed (deck empty)')
    ) {
      return full
    }
    return full[0] === 'D' ? 'Drew 1 card' : 'drew 1 card'
  })

  return redacted
}

function sanitizeScenarioResults(results: Array<{ name: string; ok: boolean; error?: string }>) {
  return results.map((entry) => ({
    ...entry,
    error: entry.error ? redactDrawDetails(entry.error) : undefined,
  }))
}

function signature(game: GameState): string {
  return JSON.stringify({
    phase: game.phase,
    currentPlayerIndex: game.currentPlayerIndex,
    deck: game.deck,
    discard: game.discardPile,
    players: game.players.map((player) => ({
      hand: player.hand,
      timeline: player.timeline,
    })),
    pendingPlay: game.pendingPlay
      ? {
          playedBy: game.pendingPlay.playedBy,
          reactor: game.pendingPlay.reactor,
          cardId: game.pendingPlay.card.id,
          cancelChainCount: game.pendingPlay.cancelChainCount,
          nextResponder: game.pendingPlay.nextResponder,
          effectOnly: game.pendingPlay.effectOnly ?? false,
        }
      : null,
    pendingDiscard: game.pendingDiscard,
    pendingActionSelection: game.pendingActionSelection,
    pendingFuturePeek: game.pendingFuturePeek,
    pendingForcedSkips: game.pendingForcedSkips,
    winner: game.winner,
  })
}

function assertCardConservation(game: GameState): string | null {
  const seen = new Set<number>()
  const take = (cardId: number, source: string): string | null => {
    if (cardId < 1 || cardId > 120) {
      return `Invalid card id ${cardId} in ${source}`
    }
    if (seen.has(cardId)) {
      return `Duplicated card id ${cardId} (source: ${source})`
    }
    seen.add(cardId)
    return null
  }

  for (const cardId of game.deck) {
    const error = take(cardId, 'deck')
    if (error) return error
  }
  for (const cardId of game.discardPile) {
    const error = take(cardId, 'discard')
    if (error) return error
  }
  game.players.forEach((player, index) => {
    player.hand.forEach((cardId) => {
      const error = take(cardId, `hand p${index}`)
      if (error) throw new Error(error)
    })
    player.timeline.forEach((entry) => {
      const error = take(entry.id, `timeline p${index}`)
      if (error) throw new Error(error)
    })
  })

  if (game.pendingPlay && !game.pendingPlay.effectOnly) {
    const error = take(game.pendingPlay.card.id, 'pendingPlay')
    if (error) return error
  }

  if (seen.size !== 120) {
    return `Card conservation broken: seen=${seen.size} expected=120`
  }

  return null
}

function getCardContainerSummary(game: GameState): string {
  const hands = game.players.reduce((total, player) => total + player.hand.length, 0)
  const timelines = game.players.reduce((total, player) => total + player.timeline.length, 0)
  const pending = game.pendingPlay && !game.pendingPlay.effectOnly ? 1 : 0
  const total = game.deck.length + game.discardPile.length + hands + timelines + pending
  return `deck=${game.deck.length}, discard=${game.discardPile.length}, hands=${hands}, timelines=${timelines}, pending=${pending}, total=${total}`
}

function getLegalActions(game: GameState): GameAction[] {
  if (game.winner) {
    return []
  }

  if (game.phase === 'PLAYER_CHOICE') {
    const hand = game.players[game.currentPlayerIndex]?.hand ?? []
    const actions: GameAction[] = [{ type: 'draw_end_turn' }]
    for (const cardId of hand) {
      actions.push({ type: 'play_card', cardId })
    }
    return actions
  }

  if (game.phase === 'REACTION_WINDOW') {
    const actions: GameAction[] = [{ type: 'pass_reaction' }]
    if (canCurrentReactorCancel(game)) {
      actions.push({ type: 'cancel_reaction' })
    }
    return actions
  }

  if (game.phase === 'DISCARD_SELECTION') {
    const pending = game.pendingDiscard
    if (!pending) {
      return []
    }
    return game.players[pending.playerIndex].hand.map((cardId) => ({ type: 'discard_pending_event', cardId }))
  }

  if (game.phase === 'ACTION_SELECTION') {
    const pending = game.pendingActionSelection
    if (!pending) {
      return []
    }

    const targets = getSelectableActionTargets(game)
    if (pending.actionName === 'future_peek') {
      return targets.map((targetPlayerIndex) => ({ type: 'select_future_target', targetPlayerIndex }))
    }
    return targets.map((cardId) => ({ type: 'select_action_target', cardId }))
  }

  return []
}

function applyValidAction(game: GameState, rules: TemporisRules, action: GameAction): GameState | null {
  const before = signature(game)
  const next = applyGameAction(game, rules, action)
  if (signature(next) === before) {
    return null
  }
  return next
}

function loadRules(): TemporisRules {
  const currentFile = fileURLToPath(import.meta.url)
  const currentDir = dirname(currentFile)
  const defaultPath = resolve(currentDir, '..', 'public', 'temporis_rules_v1.json')
  const raw = readFileSync(defaultPath, 'utf-8')
  return JSON.parse(raw) as TemporisRules
}

function runScenarioTimeSkipThenWin(rules: TemporisRules): string | null {
  const baseTimeline: TimelineCard[] = [
    { id: 1, era: 'past' },
    { id: 2, era: 'past' },
    { id: 21, era: 'present' },
    { id: 22, era: 'present' },
    { id: 41, era: 'future' },
    { id: 61, era: 'paradox' },
  ]

  let game: GameState = {
    timelineTarget: 7,
    deck: [45, 46, 47, 48],
    discardPile: [],
    players: [
      {
        id: 0,
        name: 'You',
        isBot: false,
        hand: [107, 42],
        timeline: baseTimeline,
      },
      {
        id: 1,
        name: 'Bot 1',
        isBot: true,
        hand: [3, 4],
        timeline: [],
      },
    ],
    currentPlayerIndex: 0,
    phase: 'PLAYER_CHOICE',
    pendingPlay: null,
    pendingDiscard: null,
    pendingActionSelection: null,
    pendingFuturePeek: null,
    pendingForcedSkips: null,
    lastFutureReveal: null,
    reactionHistory: [],
    statusText: 'Scenario setup',
    winner: null,
  }

  const playSkip = applyValidAction(game, rules, { type: 'play_card', cardId: 107 })
  if (!playSkip) return 'Scenario failed: Time Skip could not be played.'
  game = playSkip

  const passSkipReaction = applyValidAction(game, rules, { type: 'pass_reaction' })
  if (!passSkipReaction) return 'Scenario failed: could not resolve Time Skip reaction.'
  game = passSkipReaction

  const playFuture = applyValidAction(game, rules, { type: 'play_card', cardId: 42 })
  if (!playFuture) return 'Scenario failed: Future card could not be played after Time Skip.'
  game = playFuture

  const passFutureReaction = applyValidAction(game, rules, { type: 'pass_reaction' })
  if (!passFutureReaction) return 'Scenario failed: could not resolve Future reaction.'
  game = passFutureReaction

  if (game.phase !== 'ACTION_SELECTION') {
    return `Scenario failed: expected ACTION_SELECTION after Future play, got ${game.phase}.`
  }

  const chooseTarget = applyValidAction(game, rules, { type: 'select_future_target', targetPlayerIndex: 1 })
  if (!chooseTarget) return 'Scenario failed: selecting future target failed.'
  game = chooseTarget

  if (!game.winner) {
    return 'Scenario failed: winner was not declared after reaching valid timeline target.'
  }

  return null
}

function runScenarioRewriteBlocked(rules: TemporisRules): string | null {
  const game: GameState = {
    timelineTarget: 7,
    deck: [50, 51],
    discardPile: [],
    players: [
      { id: 0, name: 'You', isBot: false, hand: [93, 1], timeline: [] },
      { id: 1, name: 'Bot 1', isBot: true, hand: [2, 3], timeline: [] },
    ],
    currentPlayerIndex: 0,
    phase: 'PLAYER_CHOICE',
    pendingPlay: null,
    pendingDiscard: null,
    pendingActionSelection: null,
    pendingFuturePeek: null,
    pendingForcedSkips: null,
    lastFutureReveal: null,
    reactionHistory: [],
    statusText: 'Scenario setup',
    winner: null,
  }

  const next = applyGameAction(game, rules, { type: 'play_card', cardId: 93 })
  if (
    next.players[0].hand.length !== game.players[0].hand.length ||
    !next.players[0].hand.includes(93) ||
    next.phase !== 'PLAYER_CHOICE' ||
    next.currentPlayerIndex !== game.currentPlayerIndex ||
    next.pendingPlay !== null
  ) {
    return 'Scenario failed: Rewrite Event should be blocked without consuming card or ending turn when own timeline is empty.'
  }
  return null
}

function runScenarioPresentBlockedWithoutDiscard(rules: TemporisRules): string | null {
  const game: GameState = {
    timelineTarget: 7,
    deck: [50, 51, 52],
    discardPile: [],
    players: [
      { id: 0, name: 'You', isBot: false, hand: [21], timeline: [] },
      { id: 1, name: 'Bot 1', isBot: true, hand: [2, 3], timeline: [] },
    ],
    currentPlayerIndex: 0,
    phase: 'PLAYER_CHOICE',
    pendingPlay: null,
    pendingDiscard: null,
    pendingActionSelection: null,
    pendingFuturePeek: null,
    pendingForcedSkips: null,
    lastFutureReveal: null,
    reactionHistory: [],
    statusText: 'Scenario setup',
    winner: null,
  }

  const next = applyGameAction(game, rules, { type: 'play_card', cardId: 21 })
  if (
    next.players[0].hand.length !== game.players[0].hand.length ||
    !next.players[0].hand.includes(21) ||
    next.phase !== 'PLAYER_CHOICE' ||
    next.pendingPlay !== null
  ) {
    return 'Scenario failed: Present Event should be blocked when there is no extra card to discard.'
  }
  return null
}

function runScenarioParadoxBlockedWithoutTimeline(rules: TemporisRules): string | null {
  const game: GameState = {
    timelineTarget: 7,
    deck: [41, 42],
    discardPile: [],
    players: [
      { id: 0, name: 'You', isBot: false, hand: [61], timeline: [] },
      { id: 1, name: 'Bot 1', isBot: true, hand: [2, 3], timeline: [] },
    ],
    currentPlayerIndex: 0,
    phase: 'PLAYER_CHOICE',
    pendingPlay: null,
    pendingDiscard: null,
    pendingActionSelection: null,
    pendingFuturePeek: null,
    pendingForcedSkips: null,
    lastFutureReveal: null,
    reactionHistory: [],
    statusText: 'Scenario setup',
    winner: null,
  }

  const attempted = applyGameAction(game, rules, { type: 'play_card', cardId: 61 })
  if (signature(attempted) !== signature(game)) {
    return 'Scenario failed: Paradox should be blocked when own timeline has no replaceable card.'
  }

  return null
}

function runScenarioTimeSwapBlockedWithoutOwnTimeline(rules: TemporisRules): string | null {
  const game: GameState = {
    timelineTarget: 7,
    deck: [50, 51, 52],
    discardPile: [],
    players: [
      { id: 0, name: 'You', isBot: false, hand: [113], timeline: [] },
      { id: 1, name: 'Bot 1', isBot: true, hand: [2, 3], timeline: [{ id: 1, era: 'past' }] },
    ],
    currentPlayerIndex: 0,
    phase: 'PLAYER_CHOICE',
    pendingPlay: null,
    pendingDiscard: null,
    pendingActionSelection: null,
    pendingFuturePeek: null,
    pendingForcedSkips: null,
    lastFutureReveal: null,
    reactionHistory: [],
    statusText: 'Scenario setup',
    winner: null,
  }

  const next = applyGameAction(game, rules, { type: 'play_card', cardId: 113 })
  if (
    next.players[0].hand.length !== game.players[0].hand.length ||
    !next.players[0].hand.includes(113) ||
    next.phase !== 'PLAYER_CHOICE' ||
    next.pendingPlay !== null
  ) {
    return 'Scenario failed: Time Swap should be blocked when player has no own timeline card.'
  }
  return null
}

function runScenarioRewriteFlowReturnsTargetToHand(rules: TemporisRules): string | null {
  let game: GameState = {
    timelineTarget: 7,
    deck: [60, 59],
    discardPile: [],
    players: [
      { id: 0, name: 'You', isBot: false, hand: [93, 41], timeline: [{ id: 1, era: 'past' }] },
      { id: 1, name: 'Bot 1', isBot: true, hand: [2, 3], timeline: [] },
    ],
    currentPlayerIndex: 0,
    phase: 'PLAYER_CHOICE',
    pendingPlay: null,
    pendingDiscard: null,
    pendingActionSelection: null,
    pendingFuturePeek: null,
    pendingForcedSkips: null,
    lastFutureReveal: null,
    reactionHistory: [],
    statusText: 'Scenario setup',
    winner: null,
  }

  const playRewrite = applyValidAction(game, rules, { type: 'play_card', cardId: 93 })
  if (!playRewrite) return 'Scenario failed: Rewrite Event could not be played in valid setup.'
  game = playRewrite

  const passReaction = applyValidAction(game, rules, { type: 'pass_reaction' })
  if (!passReaction) return 'Scenario failed: Rewrite reaction resolution failed.'
  game = passReaction

  if (game.phase !== 'ACTION_SELECTION') {
    return `Scenario failed: expected ACTION_SELECTION after Rewrite resolution, got ${game.phase}.`
  }

  const chooseTarget = applyValidAction(game, rules, { type: 'select_action_target', cardId: 1 })
  if (!chooseTarget) return 'Scenario failed: selecting rewrite target failed.'
  game = chooseTarget

  const chooseReplacement = applyValidAction(game, rules, { type: 'select_action_target', cardId: 41 })
  if (!chooseReplacement) return 'Scenario failed: selecting rewrite replacement failed.'
  game = chooseReplacement

  const self = game.players[0]
  if (!self.timeline.some((entry) => entry.id === 41)) {
    return 'Scenario failed: Rewrite replacement card not present in timeline after resolution.'
  }
  if (!self.hand.includes(1)) {
    return 'Scenario failed: Rewritten timeline target card was not returned to hand.'
  }
  if (self.hand.includes(93)) {
    return 'Scenario failed: Rewrite Event action card should be consumed after use.'
  }

  return null
}

function runScenarioOneVsOneTimeSkipForcesExtraSkip(rules: TemporisRules): string | null {
  let game: GameState = {
    timelineTarget: 7,
    deck: [55, 56, 57],
    discardPile: [],
    players: [
      { id: 0, name: 'You', isBot: false, hand: [107], timeline: [] },
      { id: 1, name: 'Bot 1', isBot: true, hand: [2, 3], timeline: [] },
    ],
    currentPlayerIndex: 0,
    phase: 'PLAYER_CHOICE',
    pendingPlay: null,
    pendingDiscard: null,
    pendingActionSelection: null,
    pendingFuturePeek: null,
    pendingForcedSkips: null,
    lastFutureReveal: null,
    reactionHistory: [],
    statusText: 'Scenario setup',
    winner: null,
  }

  const playSkip = applyValidAction(game, rules, { type: 'play_card', cardId: 107 })
  if (!playSkip) return 'Scenario failed: Time Skip could not be played.'
  game = playSkip

  const passReaction = applyValidAction(game, rules, { type: 'pass_reaction' })
  if (!passReaction) return 'Scenario failed: Time Skip reaction resolution failed.'
  game = passReaction

  if (game.currentPlayerIndex !== 0 || game.pendingForcedSkips?.playerIndex !== 1) {
    return 'Scenario failed: Time Skip in 1v1 should immediately return turn to player and queue forced skip for opponent.'
  }

  const drawEndTurn = applyValidAction(game, rules, { type: 'draw_end_turn' })
  if (!drawEndTurn) return 'Scenario failed: draw_end_turn after Time Skip should progress game.'
  game = drawEndTurn

  if (game.currentPlayerIndex !== 0 || game.pendingForcedSkips !== null) {
    return 'Scenario failed: opponent forced skip should trigger on next turn pass and then clear.'
  }

  return null
}

function runScenarioTnhDoubleChainResolvesOriginal(rules: TemporisRules): string | null {
  let game: GameState = {
    timelineTarget: 7,
    deck: [44, 45, 46],
    discardPile: [],
    players: [
      { id: 0, name: 'You', isBot: false, hand: [1], timeline: [] },
      { id: 1, name: 'Bot 1', isBot: true, hand: [85, 2], timeline: [] },
      { id: 2, name: 'Bot 2', isBot: true, hand: [86, 3], timeline: [] },
    ],
    currentPlayerIndex: 0,
    phase: 'PLAYER_CHOICE',
    pendingPlay: null,
    pendingDiscard: null,
    pendingActionSelection: null,
    pendingFuturePeek: null,
    pendingForcedSkips: null,
    lastFutureReveal: null,
    reactionHistory: [],
    statusText: 'Scenario setup',
    winner: null,
  }

  const playEvent = applyValidAction(game, rules, { type: 'play_card', cardId: 1 })
  if (!playEvent) return 'Scenario failed: opening event play failed.'
  game = playEvent

  const firstCancel = applyValidAction(game, rules, { type: 'cancel_reaction' })
  if (!firstCancel) return 'Scenario failed: first TNH cancel failed.'
  game = firstCancel

  const secondCancel = applyValidAction(game, rules, { type: 'cancel_reaction', playerIndex: 2 })
  if (!secondCancel) return 'Scenario failed: second TNH cancel failed.'
  game = secondCancel

  if (game.phase === 'REACTION_WINDOW') {
    const passChain = applyValidAction(game, rules, { type: 'pass_reaction' })
    if (!passChain) return 'Scenario failed: pass after TNH chain failed.'
    game = passChain
  }

  if (!game.players[0].timeline.some((entry) => entry.id === 1)) {
    return 'Scenario failed: original event should resolve after even TNH chain length.'
  }
  if (!game.discardPile.includes(85) || !game.discardPile.includes(86)) {
    return 'Scenario failed: both TNH cards should be in discard after chain.'
  }

  return null
}

function runScenarioMultiplayerTnhFromAnyPlayer(rules: TemporisRules): string | null {
  let game: GameState = {
    timelineTarget: 7,
    deck: [44, 45, 46],
    discardPile: [],
    players: [
      { id: 0, name: 'You', isBot: false, hand: [1], timeline: [] },
      { id: 1, name: 'Bot 1', isBot: true, hand: [2], timeline: [] },
      { id: 2, name: 'Bot 2', isBot: true, hand: [85, 3], timeline: [] },
    ],
    currentPlayerIndex: 0,
    phase: 'PLAYER_CHOICE',
    pendingPlay: null,
    pendingDiscard: null,
    pendingActionSelection: null,
    pendingFuturePeek: null,
    pendingForcedSkips: null,
    lastFutureReveal: null,
    reactionHistory: [],
    statusText: 'Scenario setup',
    winner: null,
  }

  const playEvent = applyValidAction(game, rules, { type: 'play_card', cardId: 1 })
  if (!playEvent) return 'Scenario failed: opening event play failed for multiplayer TNH test.'
  game = playEvent

  const thirdPlayerCancel = applyValidAction(game, rules, { type: 'cancel_reaction', playerIndex: 2 })
  if (!thirdPlayerCancel) return 'Scenario failed: non-next player with TNH should be able to cancel.'
  game = thirdPlayerCancel

  if (game.phase === 'REACTION_WINDOW') {
    const closeReactionWindow = applyValidAction(game, rules, { type: 'pass_reaction' })
    if (!closeReactionWindow) return 'Scenario failed: pass should close reaction window after multiplayer TNH cancel.'
    game = closeReactionWindow
  }

  if (game.players[0].timeline.some((entry) => entry.id === 1)) {
    return 'Scenario failed: original event should stay canceled after odd TNH chain in multiplayer.'
  }
  if (!game.discardPile.includes(1) || !game.discardPile.includes(85)) {
    return 'Scenario failed: canceled event and TNH should both be in discard pile.'
  }

  return null
}

function runScenarioOwnerCannotCancelOwnPlay(rules: TemporisRules): string | null {
  let game: GameState = {
    timelineTarget: 7,
    deck: [44, 45, 46],
    discardPile: [],
    players: [
      { id: 0, name: 'You', isBot: false, hand: [1, 85], timeline: [] },
      { id: 1, name: 'Bot 1', isBot: true, hand: [2, 3], timeline: [] },
      { id: 2, name: 'Bot 2', isBot: true, hand: [4, 5], timeline: [] },
    ],
    currentPlayerIndex: 0,
    phase: 'PLAYER_CHOICE',
    pendingPlay: null,
    pendingDiscard: null,
    pendingActionSelection: null,
    pendingFuturePeek: null,
    pendingForcedSkips: null,
    lastFutureReveal: null,
    reactionHistory: [],
    statusText: 'Scenario setup',
    winner: null,
  }

  const playEvent = applyValidAction(game, rules, { type: 'play_card', cardId: 1 })
  if (!playEvent) return 'Scenario failed: opening event play failed for owner-cancel test.'
  game = playEvent

  const ownerCancelAttempt = applyValidAction(game, rules, { type: 'cancel_reaction', playerIndex: 0 })
  if (ownerCancelAttempt) {
    return 'Scenario failed: card owner should not be allowed to TNH-cancel own just-played card.'
  }

  return null
}

function runScenarioSamePlayerCannotDoubleCancel(rules: TemporisRules): string | null {
  let game: GameState = {
    timelineTarget: 7,
    deck: [44, 45, 46],
    discardPile: [],
    players: [
      { id: 0, name: 'You', isBot: false, hand: [1], timeline: [] },
      { id: 1, name: 'Bot 1', isBot: true, hand: [85, 86, 2], timeline: [] },
      { id: 2, name: 'Bot 2', isBot: true, hand: [3, 4], timeline: [] },
    ],
    currentPlayerIndex: 0,
    phase: 'PLAYER_CHOICE',
    pendingPlay: null,
    pendingDiscard: null,
    pendingActionSelection: null,
    pendingFuturePeek: null,
    pendingForcedSkips: null,
    lastFutureReveal: null,
    reactionHistory: [],
    statusText: 'Scenario setup',
    winner: null,
  }

  const playEvent = applyValidAction(game, rules, { type: 'play_card', cardId: 1 })
  if (!playEvent) return 'Scenario failed: opening event play failed for double-cancel test.'
  game = playEvent

  const firstCancel = applyValidAction(game, rules, { type: 'cancel_reaction', playerIndex: 1 })
  if (!firstCancel) return 'Scenario failed: first TNH cancel by player should succeed.'
  game = firstCancel

  const secondCancelSamePlayer = applyValidAction(game, rules, { type: 'cancel_reaction', playerIndex: 1 })
  if (secondCancelSamePlayer) {
    return 'Scenario failed: same player should not be able to TNH-cancel twice in same reaction window.'
  }

  return null
}

function runScenarioFuturePeekCanceledByTnh(rules: TemporisRules): string | null {
  let game: GameState = {
    timelineTarget: 7,
    deck: [58, 59, 60],
    discardPile: [],
    players: [
      { id: 0, name: 'You', isBot: false, hand: [41], timeline: [] },
      { id: 1, name: 'Bot 1', isBot: true, hand: [85, 2, 3], timeline: [] },
    ],
    currentPlayerIndex: 0,
    phase: 'PLAYER_CHOICE',
    pendingPlay: null,
    pendingDiscard: null,
    pendingActionSelection: null,
    pendingFuturePeek: null,
    pendingForcedSkips: null,
    lastFutureReveal: null,
    reactionHistory: [],
    statusText: 'Scenario setup',
    winner: null,
  }

  const playFuture = applyValidAction(game, rules, { type: 'play_card', cardId: 41 })
  if (!playFuture) return 'Scenario failed: Future event play failed.'
  game = playFuture

  const passInitialReaction = applyValidAction(game, rules, { type: 'pass_reaction' })
  if (!passInitialReaction) return 'Scenario failed: initial Future reaction pass failed.'
  game = passInitialReaction

  const selectTarget = applyValidAction(game, rules, { type: 'select_future_target', targetPlayerIndex: 1 })
  if (!selectTarget) return 'Scenario failed: choosing Future Peek target failed.'
  game = selectTarget

  const cancelPeek = applyValidAction(game, rules, { type: 'cancel_reaction' })
  if (!cancelPeek) return 'Scenario failed: target TNH cancel on Future Peek failed.'
  game = cancelPeek

  const passAfterCancel = applyValidAction(game, rules, { type: 'pass_reaction' })
  if (!passAfterCancel) return 'Scenario failed: pass after Future Peek cancel failed.'
  game = passAfterCancel

  if (game.lastFutureReveal !== null) {
    return 'Scenario failed: Future Peek reveal should be null when canceled by TNH.'
  }

  return null
}

function runScenarioFuturePeekRevealsWithoutTnh(rules: TemporisRules): string | null {
  let game: GameState = {
    timelineTarget: 7,
    deck: [58, 59, 60],
    discardPile: [],
    players: [
      { id: 0, name: 'You', isBot: false, hand: [41], timeline: [] },
      { id: 1, name: 'Bot 1', isBot: true, hand: [2, 3], timeline: [] },
    ],
    currentPlayerIndex: 0,
    phase: 'PLAYER_CHOICE',
    pendingPlay: null,
    pendingDiscard: null,
    pendingActionSelection: null,
    pendingFuturePeek: null,
    pendingForcedSkips: null,
    lastFutureReveal: null,
    reactionHistory: [],
    statusText: 'Scenario setup',
    winner: null,
  }

  const playFuture = applyValidAction(game, rules, { type: 'play_card', cardId: 41 })
  if (!playFuture) return 'Scenario failed: Future event play failed.'
  game = playFuture

  const passInitialReaction = applyValidAction(game, rules, { type: 'pass_reaction' })
  if (!passInitialReaction) return 'Scenario failed: initial Future reaction pass failed.'
  game = passInitialReaction

  const selectTarget = applyValidAction(game, rules, { type: 'select_future_target', targetPlayerIndex: 1 })
  if (!selectTarget) return 'Scenario failed: choosing Future Peek target failed.'
  game = selectTarget

  if (!game.lastFutureReveal || game.lastFutureReveal.targetPlayerIndex !== 1) {
    return 'Scenario failed: Future Peek should reveal target hand when TNH is absent.'
  }
  if (game.lastFutureReveal.cards.length !== 2) {
    return 'Scenario failed: Future Peek revealed hand size does not match target hand.'
  }

  return null
}

function runScenarioParadoxSwapHappyPath(rules: TemporisRules): string | null {
  let game: GameState = {
    timelineTarget: 7,
    deck: [57, 58],
    discardPile: [],
    players: [
      { id: 0, name: 'You', isBot: false, hand: [61], timeline: [{ id: 1, era: 'past' }] },
      { id: 1, name: 'Bot 1', isBot: true, hand: [22, 23], timeline: [] },
    ],
    currentPlayerIndex: 0,
    phase: 'PLAYER_CHOICE',
    pendingPlay: null,
    pendingDiscard: null,
    pendingActionSelection: null,
    pendingFuturePeek: null,
    pendingForcedSkips: null,
    lastFutureReveal: null,
    reactionHistory: [],
    statusText: 'Scenario setup',
    winner: null,
  }

  const playParadox = applyValidAction(game, rules, { type: 'play_card', cardId: 61 })
  if (!playParadox) return 'Scenario failed: Paradox event play failed.'
  game = playParadox

  const passReaction = applyValidAction(game, rules, { type: 'pass_reaction' })
  if (!passReaction) return 'Scenario failed: Paradox reaction pass failed.'
  game = passReaction

  const chooseSource = applyValidAction(game, rules, { type: 'select_action_target', cardId: 1 })
  if (!chooseSource) return 'Scenario failed: choosing Paradox source card failed.'
  game = chooseSource

  const chooseTargetPlayer = applyValidAction(game, rules, { type: 'select_action_target', cardId: 1 })
  if (!chooseTargetPlayer) return 'Scenario failed: choosing Paradox target player failed.'
  game = chooseTargetPlayer

  if (game.players[0].timeline.some((entry) => entry.id === 1)) {
    return 'Scenario failed: selected source timeline card should be removed from acting player timeline.'
  }
  if (!game.players[1].hand.includes(1)) {
    return 'Scenario failed: target player should receive swapped timeline card into hand.'
  }

  return null
}

function runScenarioBackInTimeOnlyLastTargetable(rules: TemporisRules): string | null {
  const game: GameState = {
    timelineTarget: 7,
    deck: [55],
    discardPile: [],
    players: [
      { id: 0, name: 'You', isBot: false, hand: [], timeline: [] },
      { id: 1, name: 'Bot 1', isBot: true, hand: [], timeline: [{ id: 1, era: 'past' }, { id: 2, era: 'past' }] },
    ],
    currentPlayerIndex: 0,
    phase: 'ACTION_SELECTION',
    pendingPlay: null,
    pendingDiscard: null,
    pendingActionSelection: {
      actionName: 'back_in_time',
      playerIndex: 0,
      nextPlayerIndex: 1,
      step: 'choose_target',
      sourceCardId: 75,
    },
    pendingFuturePeek: null,
    pendingForcedSkips: null,
    lastFutureReveal: null,
    reactionHistory: [],
    statusText: 'Scenario setup',
    winner: null,
  }

  const before = signature(game)
  const tryNonLast = applyGameAction(game, rules, { type: 'select_action_target', cardId: 1 })
  if (signature(tryNonLast) !== before) {
    return 'Scenario failed: Back in Time should reject non-last timeline target.'
  }

  const useLast = applyValidAction(game, rules, { type: 'select_action_target', cardId: 2 })
  if (!useLast) {
    return 'Scenario failed: Back in Time should accept last timeline target.'
  }
  if (!useLast.players[1].hand.includes(2)) {
    return 'Scenario failed: Back in Time should move last timeline card to owner hand.'
  }

  return null
}

function runScenarioLocalResetHappyPath(rules: TemporisRules): string | null {
  let game: GameState = {
    timelineTarget: 7,
    deck: [55, 56],
    discardPile: [],
    players: [
      { id: 0, name: 'You', isBot: false, hand: [99], timeline: [] },
      { id: 1, name: 'Bot 1', isBot: true, hand: [2], timeline: [{ id: 41, era: 'future' }] },
    ],
    currentPlayerIndex: 0,
    phase: 'PLAYER_CHOICE',
    pendingPlay: null,
    pendingDiscard: null,
    pendingActionSelection: null,
    pendingFuturePeek: null,
    pendingForcedSkips: null,
    lastFutureReveal: null,
    reactionHistory: [],
    statusText: 'Scenario setup',
    winner: null,
  }

  const playReset = applyValidAction(game, rules, { type: 'play_card', cardId: 99 })
  if (!playReset) return 'Scenario failed: Local Reset play failed.'
  game = playReset

  const passReaction = applyValidAction(game, rules, { type: 'pass_reaction' })
  if (!passReaction) return 'Scenario failed: Local Reset reaction pass failed.'
  game = passReaction

  const selectTarget = applyValidAction(game, rules, { type: 'select_action_target', cardId: 41 })
  if (!selectTarget) return 'Scenario failed: Local Reset target selection failed.'
  game = selectTarget

  if (game.players[1].timeline.some((entry) => entry.id === 41)) {
    return 'Scenario failed: Local Reset target should be removed from timeline.'
  }
  if (!game.discardPile.includes(41)) {
    return 'Scenario failed: Local Reset target should be in discard pile.'
  }

  return null
}

function runScenarioTimeSwapHappyPath(rules: TemporisRules): string | null {
  let game: GameState = {
    timelineTarget: 7,
    deck: [55, 56],
    discardPile: [],
    players: [
      { id: 0, name: 'You', isBot: false, hand: [113], timeline: [{ id: 1, era: 'past' }] },
      { id: 1, name: 'Bot 1', isBot: true, hand: [2], timeline: [{ id: 41, era: 'future' }] },
    ],
    currentPlayerIndex: 0,
    phase: 'PLAYER_CHOICE',
    pendingPlay: null,
    pendingDiscard: null,
    pendingActionSelection: null,
    pendingFuturePeek: null,
    pendingForcedSkips: null,
    lastFutureReveal: null,
    reactionHistory: [],
    statusText: 'Scenario setup',
    winner: null,
  }

  const playSwap = applyValidAction(game, rules, { type: 'play_card', cardId: 113 })
  if (!playSwap) return 'Scenario failed: Time Swap play failed.'
  game = playSwap

  const passReaction = applyValidAction(game, rules, { type: 'pass_reaction' })
  if (!passReaction) return 'Scenario failed: Time Swap reaction pass failed.'
  game = passReaction

  const chooseSource = applyValidAction(game, rules, { type: 'select_action_target', cardId: 1 })
  if (!chooseSource) return 'Scenario failed: Time Swap source selection failed.'
  game = chooseSource

  const chooseTarget = applyValidAction(game, rules, { type: 'select_action_target', cardId: 41 })
  if (!chooseTarget) return 'Scenario failed: Time Swap target selection failed.'
  game = chooseTarget

  if (!game.players[0].timeline.some((entry) => entry.id === 41) || !game.players[1].timeline.some((entry) => entry.id === 1)) {
    return 'Scenario failed: Time Swap should exchange the selected timeline cards between players.'
  }

  return null
}

function runScenarioPresentDiscardThenDrawFlow(rules: TemporisRules): string | null {
  let game: GameState = {
    timelineTarget: 7,
    deck: [44, 45],
    discardPile: [],
    players: [
      { id: 0, name: 'You', isBot: false, hand: [21, 5], timeline: [] },
      { id: 1, name: 'Bot 1', isBot: true, hand: [2], timeline: [] },
    ],
    currentPlayerIndex: 0,
    phase: 'PLAYER_CHOICE',
    pendingPlay: null,
    pendingDiscard: null,
    pendingActionSelection: null,
    pendingFuturePeek: null,
    pendingForcedSkips: null,
    lastFutureReveal: null,
    reactionHistory: [],
    statusText: 'Scenario setup',
    winner: null,
  }

  const playPresent = applyValidAction(game, rules, { type: 'play_card', cardId: 21 })
  if (!playPresent) return 'Scenario failed: Present Event play failed.'
  game = playPresent

  const passReaction = applyValidAction(game, rules, { type: 'pass_reaction' })
  if (!passReaction) return 'Scenario failed: Present Event reaction pass failed.'
  game = passReaction

  if (game.phase !== 'DISCARD_SELECTION') {
    return `Scenario failed: expected DISCARD_SELECTION after Present resolution, got ${game.phase}.`
  }

  const discardCard = applyValidAction(game, rules, { type: 'discard_pending_event', cardId: 5 })
  if (!discardCard) return 'Scenario failed: Present discard step failed.'
  game = discardCard

  if (!game.players[0].timeline.some((entry) => entry.id === 21)) {
    return 'Scenario failed: Present card should be in timeline after resolution.'
  }
  if (!game.discardPile.includes(5)) {
    return 'Scenario failed: discarded card should be in discard pile after Present flow.'
  }

  return null
}

function runScenarioDeckEmptyWinnerByTieBreak(rules: TemporisRules): string | null {
  const game: GameState = {
    timelineTarget: 7,
    deck: [],
    discardPile: [],
    players: [
      {
        id: 0,
        name: 'You',
        isBot: false,
        hand: [5],
        timeline: [
          { id: 1, era: 'past' },
          { id: 21, era: 'present' },
        ],
      },
      {
        id: 1,
        name: 'Bot 1',
        isBot: true,
        hand: [],
        timeline: [
          { id: 2, era: 'past' },
          { id: 22, era: 'present' },
          { id: 61, era: 'paradox' },
        ],
      },
    ],
    currentPlayerIndex: 0,
    phase: 'PLAYER_CHOICE',
    pendingPlay: null,
    pendingDiscard: null,
    pendingActionSelection: null,
    pendingFuturePeek: null,
    pendingForcedSkips: null,
    lastFutureReveal: null,
    reactionHistory: [],
    statusText: 'Scenario setup',
    winner: null,
  }

  const resolved = applyValidAction(game, rules, { type: 'draw_end_turn' })
  if (!resolved) {
    return 'Scenario failed: draw_end_turn should trigger endgame evaluation when deck is empty.'
  }
  if (resolved.phase !== 'GAME_OVER' || resolved.winner !== 'Bot 1') {
    return `Scenario failed: expected deck-depletion winner Bot 1 by larger timeline, got phase=${resolved.phase} winner=${resolved.winner ?? 'none'}.`
  }

  return null
}

function runScenarioAllHandsEmptyDeckHasCardsContinues(rules: TemporisRules): string | null {
  const game: GameState = {
    timelineTarget: 7,
    deck: [41, 42, 43],
    discardPile: [],
    players: [
      {
        id: 0,
        name: 'You',
        isBot: false,
        hand: [],
        timeline: [
          { id: 1, era: 'past' },
          { id: 21, era: 'present' },
        ],
      },
      {
        id: 1,
        name: 'Bot 1',
        isBot: true,
        hand: [],
        timeline: [
          { id: 2, era: 'past' },
          { id: 22, era: 'present' },
        ],
      },
    ],
    currentPlayerIndex: 0,
    phase: 'PLAYER_CHOICE',
    pendingPlay: null,
    pendingDiscard: null,
    pendingActionSelection: null,
    pendingFuturePeek: null,
    pendingForcedSkips: null,
    lastFutureReveal: null,
    reactionHistory: [],
    statusText: 'Scenario setup',
    winner: null,
  }

  const resolved = applyValidAction(game, rules, { type: 'draw_end_turn' })
  if (!resolved) {
    return 'Scenario failed: draw_end_turn should resolve when all hands are empty but deck still has cards.'
  }
  if (resolved.phase === 'GAME_OVER' || resolved.winner) {
    return `Scenario failed: game should continue while deck has cards. Got phase=${resolved.phase} winner=${resolved.winner ?? 'none'}.`
  }

  const totalCardsInHands = resolved.players.reduce((total, player) => total + player.hand.length, 0)
  if (totalCardsInHands <= 0) {
    return 'Scenario failed: expected at least one drawn card in hand after draw_end_turn with non-empty deck.'
  }

  return null
}

function runScenarioGuidedTutorialFullSequence(rules: TemporisRules): string | null {
  const playerHand = [1, 21, 22, 41, 42, 61, 75, 85, 93, 99, 107, 113]
  const botHand = [2, 23, 43, 86]
  const usedCards = new Set<number>([...playerHand, ...botHand, 24])
  const deck = Array.from({ length: 120 }, (_, index) => index + 1).filter((cardId) => !usedCards.has(cardId))

  let game: GameState = {
    timelineTarget: 7,
    deck,
    discardPile: [],
    players: [
      { id: 0, name: 'You', isBot: false, hand: [...playerHand], timeline: [] },
      { id: 1, name: 'Bot 1', isBot: true, hand: [...botHand], timeline: [{ id: 24, era: 'present' }] },
    ],
    currentPlayerIndex: 0,
    phase: 'PLAYER_CHOICE',
    pendingPlay: null,
    pendingDiscard: null,
    pendingActionSelection: null,
    pendingFuturePeek: null,
    pendingForcedSkips: null,
    lastFutureReveal: null,
    reactionHistory: [],
    statusText: 'Scenario setup',
    winner: null,
  }

  const steps: Array<{ actor: 'player' | 'bot'; action: GameAction }> = [
    { actor: 'player', action: { type: 'play_card', cardId: 1 } },
    { actor: 'bot', action: { type: 'pass_reaction' } },
    { actor: 'bot', action: { type: 'play_card', cardId: 23 } },
    { actor: 'player', action: { type: 'cancel_reaction' } },
    { actor: 'bot', action: { type: 'pass_reaction' } },
    { actor: 'player', action: { type: 'play_card', cardId: 21 } },
    { actor: 'bot', action: { type: 'pass_reaction' } },
    { actor: 'player', action: { type: 'discard_pending_event', cardId: 22 } },
    { actor: 'bot', action: { type: 'draw_end_turn' } },
    { actor: 'player', action: { type: 'play_card', cardId: 41 } },
    { actor: 'bot', action: { type: 'pass_reaction' } },
    { actor: 'player', action: { type: 'select_future_target', targetPlayerIndex: 1 } },
    { actor: 'bot', action: { type: 'pass_reaction' } },
    { actor: 'bot', action: { type: 'play_card', cardId: 2 } },
    { actor: 'player', action: { type: 'pass_reaction' } },
    { actor: 'player', action: { type: 'play_card', cardId: 61 } },
    { actor: 'bot', action: { type: 'pass_reaction' } },
    { actor: 'player', action: { type: 'select_action_target', cardId: 1 } },
    { actor: 'player', action: { type: 'select_future_target', targetPlayerIndex: 1 } },
    { actor: 'bot', action: { type: 'draw_end_turn' } },
    { actor: 'player', action: { type: 'play_card', cardId: 93 } },
    { actor: 'bot', action: { type: 'pass_reaction' } },
    { actor: 'player', action: { type: 'select_action_target', cardId: 21 } },
    { actor: 'player', action: { type: 'select_action_target', cardId: 42 } },
    { actor: 'bot', action: { type: 'draw_end_turn' } },
    { actor: 'player', action: { type: 'play_card', cardId: 113 } },
    { actor: 'bot', action: { type: 'pass_reaction' } },
    { actor: 'player', action: { type: 'select_action_target', cardId: 42 } },
    { actor: 'player', action: { type: 'select_action_target', cardId: 24 } },
    { actor: 'bot', action: { type: 'draw_end_turn' } },
    { actor: 'player', action: { type: 'play_card', cardId: 75 } },
    { actor: 'bot', action: { type: 'pass_reaction' } },
    { actor: 'player', action: { type: 'select_action_target', cardId: 42 } },
    { actor: 'bot', action: { type: 'draw_end_turn' } },
    { actor: 'player', action: { type: 'play_card', cardId: 99 } },
    { actor: 'bot', action: { type: 'pass_reaction' } },
    { actor: 'player', action: { type: 'select_action_target', cardId: 2 } },
    { actor: 'bot', action: { type: 'draw_end_turn' } },
    { actor: 'player', action: { type: 'play_card', cardId: 107 } },
    { actor: 'bot', action: { type: 'pass_reaction' } },
  ]

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]
    const expectedActorIndex = step.actor === 'player' ? 0 : 1
    if (game.currentPlayerIndex !== expectedActorIndex) {
      return `Scenario failed: tutorial step ${index + 1} expected actor ${step.actor} but currentPlayerIndex=${game.currentPlayerIndex} in phase=${game.phase}.`
    }

    const updated = applyValidAction(game, rules, step.action)
    if (!updated) {
      return `Scenario failed: tutorial step ${index + 1} action ${JSON.stringify(step.action)} had no effect (phase=${game.phase}, status=${game.statusText}).`
    }

    const conservation = assertCardConservation(updated)
    if (conservation) {
      return `Scenario failed: tutorial step ${index + 1} broke card conservation: ${conservation}.`
    }

    game = updated
  }

  if (game.phase !== 'PLAYER_CHOICE' || game.currentPlayerIndex !== 0) {
    return `Scenario failed: tutorial should end on player turn in PLAYER_CHOICE. Got phase=${game.phase} currentPlayerIndex=${game.currentPlayerIndex}.`
  }
  if (game.pendingPlay || game.pendingDiscard || game.pendingActionSelection || game.pendingFuturePeek) {
    return 'Scenario failed: tutorial ended with unresolved pending state.'
  }

  return null
}

function runFuzz(
  rules: TemporisRules,
  games: number,
  maxSteps: number,
  seed: number,
  options?: {
    replaySeed?: number | null
  },
): { error: string | null; metrics: FuzzMetrics } {
  const rng = createSeededRng(seed)
  const metrics = createEmptyMetrics()
  const totalMatches = options?.replaySeed ? 1 : games

  for (let gameIndex = 0; gameIndex < totalMatches; gameIndex += 1) {
    const matchSeed = options?.replaySeed ?? Math.floor(rng() * 1_000_000_000)
    const players = 2 + Math.floor(rng() * 5)
    const botCount = Math.max(1, players - 1)
    metrics.matchesPlayed += 1
    countByKey(metrics.playersCountDistribution, String(players))

    let game = createInitialGame({
      startingHand: 5,
      startingTimeline: 7,
      totalPlayers: players,
      botCount,
      seed: matchSeed,
    })

    const seenStates = new Map<string, number>()
    const actionTrace: string[] = []

    for (let step = 0; step < maxSteps; step += 1) {
      metrics.totalSteps += 1
      if (step + 1 > metrics.maxStepsObserved) {
        metrics.maxStepsObserved = step + 1
      }
      countByKey(metrics.phaseVisits, game.phase)

      const conservation = assertCardConservation(game)
      if (conservation) {
        return {
          error: `Fuzz failed [match ${gameIndex}, step ${step}, seed ${matchSeed}]: ${conservation}. ${getCardContainerSummary(game)}. Recent actions: ${actionTrace.slice(-8).join(' | ') || 'none'}`,
          metrics,
        }
      }

      if (game.winner) {
        metrics.completedMatches += 1
        countByKey(metrics.winners, game.winner)
        break
      }

      const stateSig = signature(game)
      const seenCount = (seenStates.get(stateSig) ?? 0) + 1
      seenStates.set(stateSig, seenCount)
      if (seenCount > 6) {
        return {
          error: `Fuzz failed [match ${gameIndex}, step ${step}, seed ${matchSeed}]: repeated game state loop detected. Recent actions: ${actionTrace.slice(-8).join(' | ') || 'none'}`,
          metrics,
        }
      }

      const legalActions = getLegalActions(game)
      const before = signature(game)
      const evaluatedActions: Array<{ action: GameAction; next: GameState }> = []

      for (const action of legalActions) {
        const originalBefore = signature(game)
        const next = applyGameAction(game, rules, action)
        const originalAfter = signature(game)

        if (originalAfter !== originalBefore) {
          return {
            error: `Fuzz failed [match ${gameIndex}, step ${step}, seed ${matchSeed}]: action mutates original game state (${JSON.stringify(action)}).`,
            metrics,
          }
        }

        if (signature(next) === before) {
          continue
        }

        const nextConservation = assertCardConservation(next)
        if (nextConservation) {
          return {
            error: `Fuzz failed [match ${gameIndex}, step ${step}, seed ${matchSeed}]: action causes card loss (${JSON.stringify(action)}): ${nextConservation}. ${getCardContainerSummary(next)}`,
            metrics,
          }
        }

        evaluatedActions.push({ action, next })
      }

      if (evaluatedActions.length === 0) {
        return {
          error: `Fuzz failed [match ${gameIndex}, step ${step}, seed ${matchSeed}]: no valid actions available in phase ${game.phase}. Recent actions: ${actionTrace.slice(-8).join(' | ') || 'none'}`,
          metrics,
        }
      }

      const picked = pick(evaluatedActions, rng)
      countByKey(metrics.actionCounts, actionKey(picked.action))
      actionTrace.push(JSON.stringify(picked.action))
      const next = picked.next
      if (signature(next) === before) {
        return {
          error: `Fuzz failed [match ${gameIndex}, step ${step}, seed ${matchSeed}]: selected action had no effect (${JSON.stringify(picked.action)}). Recent actions: ${actionTrace.slice(-8).join(' | ') || 'none'}`,
          metrics,
        }
      }
      game = next
    }

    if (!game.winner) {
      return {
        error: `Fuzz failed [match ${gameIndex}, seed ${matchSeed}]: did not finish within maxSteps=${maxSteps}.`,
        metrics,
      }
    }
  }

  return { error: null, metrics }
}

function run() {
  const rules = loadRules()
  const { games, maxSteps, seed, report, reportFile, replaySeed } = parseArgs()

  const scenarios = [
    { name: 'time_skip_then_win', run: () => runScenarioTimeSkipThenWin(rules) },
    { name: 'rewrite_blocked_without_timeline', run: () => runScenarioRewriteBlocked(rules) },
    { name: 'present_blocked_without_discard_card', run: () => runScenarioPresentBlockedWithoutDiscard(rules) },
    { name: 'paradox_blocked_without_timeline', run: () => runScenarioParadoxBlockedWithoutTimeline(rules) },
    { name: 'time_swap_blocked_without_own_timeline', run: () => runScenarioTimeSwapBlockedWithoutOwnTimeline(rules) },
    { name: 'rewrite_flow_returns_target_to_hand', run: () => runScenarioRewriteFlowReturnsTargetToHand(rules) },
    { name: 'one_vs_one_time_skip_forces_extra_skip', run: () => runScenarioOneVsOneTimeSkipForcesExtraSkip(rules) },
    { name: 'tnh_double_chain_resolves_original', run: () => runScenarioTnhDoubleChainResolvesOriginal(rules) },
    { name: 'multiplayer_tnh_from_any_player', run: () => runScenarioMultiplayerTnhFromAnyPlayer(rules) },
    { name: 'owner_cannot_cancel_own_play', run: () => runScenarioOwnerCannotCancelOwnPlay(rules) },
    { name: 'same_player_cannot_double_cancel', run: () => runScenarioSamePlayerCannotDoubleCancel(rules) },
    { name: 'future_peek_canceled_by_tnh', run: () => runScenarioFuturePeekCanceledByTnh(rules) },
    { name: 'future_peek_reveals_without_tnh', run: () => runScenarioFuturePeekRevealsWithoutTnh(rules) },
    { name: 'paradox_swap_happy_path', run: () => runScenarioParadoxSwapHappyPath(rules) },
    { name: 'back_in_time_only_last_targetable', run: () => runScenarioBackInTimeOnlyLastTargetable(rules) },
    { name: 'local_reset_happy_path', run: () => runScenarioLocalResetHappyPath(rules) },
    { name: 'time_swap_happy_path', run: () => runScenarioTimeSwapHappyPath(rules) },
    { name: 'present_discard_then_draw_flow', run: () => runScenarioPresentDiscardThenDrawFlow(rules) },
    { name: 'deck_empty_winner_by_tiebreak', run: () => runScenarioDeckEmptyWinnerByTieBreak(rules) },
    { name: 'all_hands_empty_deck_has_cards_continues', run: () => runScenarioAllHandsEmptyDeckHasCardsContinues(rules) },
    { name: 'guided_tutorial_full_sequence', run: () => runScenarioGuidedTutorialFullSequence(rules) },
  ]

  console.log('Running deterministic rule scenarios...')
  const scenarioResults: Array<{ name: string; ok: boolean; error?: string }> = []
  for (const scenario of scenarios) {
    const result = scenario.run()
    if (result) {
      const safeResult = redactDrawDetails(result)
      scenarioResults.push({ name: scenario.name, ok: false, error: safeResult })
      console.error(`✗ ${scenario.name}: ${safeResult}`)
      process.exit(1)
    }
    scenarioResults.push({ name: scenario.name, ok: true })
    console.log(`✓ ${scenario.name}`)
  }

  const fuzzGames = replaySeed ? 1 : games
  const fuzzSeedLabel = replaySeed ? `seed=${seed}, replaySeed=${replaySeed}` : `seed=${seed}`
  console.log(`Running fuzz simulation (${fuzzGames} games, maxSteps=${maxSteps}, ${fuzzSeedLabel})...`)
  const fuzzResult = runFuzz(rules, fuzzGames, maxSteps, seed, { replaySeed })
  if (fuzzResult.error) {
    const safeFuzzError = redactDrawDetails(fuzzResult.error)
    console.error(`✗ fuzz: ${safeFuzzError}`)

    if (report) {
      const targetPath = resolve(process.cwd(), reportFile)
      mkdirSync(dirname(targetPath), { recursive: true })
      const reportData = {
        generatedAt: new Date().toISOString(),
        config: { games: fuzzGames, maxSteps, seed, replaySeed },
        scenarios: sanitizeScenarioResults(scenarioResults),
        fuzz: {
          ok: false,
          error: safeFuzzError,
          metrics: fuzzResult.metrics,
        },
      }
      writeFileSync(targetPath, JSON.stringify(reportData, null, 2), 'utf-8')
      console.log(`Report written: ${targetPath}`)
    }

    process.exit(1)
  }

  console.log('✓ fuzz')

  if (report) {
    const targetPath = resolve(process.cwd(), reportFile)
    mkdirSync(dirname(targetPath), { recursive: true })
    const reportData = {
      generatedAt: new Date().toISOString(),
      config: { games: fuzzGames, maxSteps, seed, replaySeed },
      scenarios: sanitizeScenarioResults(scenarioResults),
      fuzz: {
        ok: true,
        metrics: fuzzResult.metrics,
      },
    }
    writeFileSync(targetPath, JSON.stringify(reportData, null, 2), 'utf-8')
    console.log(`Report written: ${targetPath}`)
  }

  console.log('All simulations passed.')
}

run()
