import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import './App.css'
import CardImage from './components/CardImage'
import {
  applyGameAction,
  canCurrentReactorCancel,
  createInitialGame,
  getSelectableActionTargets,
} from './game/engine'
import type { GameAction, GameState, TemporisRules } from './game/types'
import {
  ALL_CARD_IDS,
  getCardPngUrl,
  getPreferredCardImageUrl,
  handleCardImageError,
  preloadCardImages,
} from './utils/cardAssets'

const BOT_PROFILE = 'balanced'
const BALANCED_DRAW_CHANCE = 0.25
const BALANCED_CANCEL_CHANCE = 0.6
const TABLE_PREVIEW_DURATION_MS = 1300
const ACTION_TABLE_PREVIEW_DURATION_MS = 1800
const PROJECTILE_CLEANUP_MS = 820
const USER_ACTION_LOCK_MS = 900
type Locale = 'en' | 'pt'

function getCardDisplayName(cardId: number, locale: Locale = 'en'): string {
  const label =
    cardId >= 1 && cardId <= 20
      ? locale === 'pt'
        ? 'Evento do Passado'
        : 'Past Event'
      : cardId >= 21 && cardId <= 40
        ? locale === 'pt'
          ? 'Evento do Presente'
          : 'Present Event'
        : cardId >= 41 && cardId <= 60
          ? locale === 'pt'
            ? 'Evento do Futuro'
            : 'Future Event'
          : cardId >= 61 && cardId <= 74
            ? locale === 'pt'
              ? 'Evento Paradoxo'
              : 'Paradox Event'
            : cardId >= 75 && cardId <= 84
              ? locale === 'pt'
                ? 'Volta no Tempo'
                : 'Back in Time'
              : cardId >= 85 && cardId <= 92
                ? locale === 'pt'
                  ? 'Isso Nunca Aconteceu'
                  : 'That Never Happened'
                : cardId >= 93 && cardId <= 98
                  ? locale === 'pt'
                    ? 'Reescrever Evento'
                    : 'Rewrite Event'
                  : cardId >= 99 && cardId <= 106
                    ? locale === 'pt'
                      ? 'Reset Local'
                      : 'Local Reset'
                    : cardId >= 107 && cardId <= 112
                      ? locale === 'pt'
                        ? 'Pular Tempo'
                        : 'Time Skip'
                      : cardId >= 113 && cardId <= 120
                        ? locale === 'pt'
                          ? 'Troca Temporal'
                          : 'Time Swap'
                        : locale === 'pt'
                          ? 'Carta'
                          : 'Card'

  return `${label} (#${cardId})`
}

function getCardGroupKey(cardId: number): string {
  if (cardId >= 1 && cardId <= 20) return 'past'
  if (cardId >= 21 && cardId <= 40) return 'present'
  if (cardId >= 41 && cardId <= 60) return 'future'
  if (cardId >= 61 && cardId <= 74) return 'paradox'
  if (cardId >= 75 && cardId <= 84) return 'back_in_time'
  if (cardId >= 85 && cardId <= 92) return 'that_never_happened'
  if (cardId >= 93 && cardId <= 98) return 'rewrite_event'
  if (cardId >= 99 && cardId <= 106) return 'local_reset'
  if (cardId >= 107 && cardId <= 112) return 'time_skip'
  if (cardId >= 113 && cardId <= 120) return 'time_swap'
  return 'other'
}

const CARD_GROUP_ORDER: Record<string, number> = {
  past: 0,
  present: 1,
  future: 2,
  paradox: 3,
  back_in_time: 4,
  that_never_happened: 5,
  rewrite_event: 6,
  local_reset: 7,
  time_skip: 8,
  time_swap: 9,
  other: 10,
}

function getEraPoints(game: GameState, playerIndex: number) {
  return game.players[playerIndex].timeline.filter((entry) => entry.era !== 'paradox').length
}

function getActionSelectionPrompt(game: GameState, locale: Locale): string {
  const pending = game.pendingActionSelection
  if (!pending) {
    return ''
  }

  if (pending.actionName === 'back_in_time') {
    return locale === 'pt'
      ? 'Selecione a última carta de Evento de qualquer timeline para devolver à mão do dono.'
      : 'Select the last Event card from any timeline to return it to the owner hand.'
  }
  if (pending.actionName === 'local_reset') {
    return locale === 'pt'
      ? 'Selecione uma carta de Evento de qualquer timeline para descartar.'
      : 'Select one Event card from any timeline to discard.'
  }
  if (pending.actionName === 'future_peek') {
    return locale === 'pt'
      ? 'Selecione um oponente para revelar a mão (qualquer outro jogador pode reagir com Isso Nunca Aconteceu).'
      : 'Select one opponent to reveal hand (any other player may react with That Never Happened).'
  }
  if (pending.actionName === 'paradox_swap' && pending.step === 'choose_swap_source') {
    return locale === 'pt'
      ? 'Selecione uma carta da sua timeline para trocar.'
      : 'Select one card from your timeline to swap.'
  }
  if (pending.actionName === 'paradox_swap' && pending.step === 'choose_target') {
    return locale === 'pt'
      ? 'Selecione um oponente. Uma carta oculta aleatória da mão dele será trocada.'
      : 'Select one opponent. One random hidden card from their hand will be swapped.'
  }
  if (pending.actionName === 'rewrite_event' && pending.step === 'choose_target') {
    return locale === 'pt'
      ? 'Selecione uma carta de Evento da sua timeline para reescrever.'
      : 'Select one Event card from your timeline to rewrite.'
  }
  if (pending.actionName === 'rewrite_event' && pending.step === 'choose_rewrite_replacement') {
    return locale === 'pt'
      ? 'Selecione uma carta de Evento da sua mão para substituir.'
      : 'Select one Event card from your hand as replacement.'
  }
  if (pending.actionName === 'time_swap' && pending.step === 'choose_swap_source') {
    return locale === 'pt' ? 'Selecione uma carta de Evento da sua timeline.' : 'Select one Event card from your timeline.'
  }
  return locale === 'pt'
    ? 'Selecione uma carta de Evento da timeline de outro jogador.'
    : 'Select one Event card from another player timeline.'
}

function redactDrawDetails(text: string): string {
  if (!text) {
    return text
  }

  let redacted = text

  redacted = redacted.replace(/\b[Dd]rew\s+none\b/g, (match) =>
    match[0] === 'D' ? 'Draw failed (deck empty)' : 'draw failed (deck empty)',
  )

  redacted = redacted.replace(/\b[Dd]rew\s+([^\.\]]+)(?=\.|\]|$)/g, (full, captured: string) => {
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

type PlayerActivityKind = 'play' | 'reaction' | 'discard' | 'timeline' | 'target'

function isTimelineActionSelection(pending: GameState['pendingActionSelection']): boolean {
  return (
    pending !== null &&
    !(pending.actionName === 'future_peek') &&
    !(pending.actionName === 'paradox_swap' && pending.step === 'choose_target') &&
    !(pending.actionName === 'rewrite_event' && pending.step === 'choose_rewrite_replacement')
  )
}

function getPlayerActivityKind(game: GameState, playerIndex: number): PlayerActivityKind | null {
  if (game.phase === 'PLAYER_CHOICE' && game.currentPlayerIndex === playerIndex) {
    return 'play'
  }

  if (game.phase === 'REACTION_WINDOW' && game.pendingPlay?.nextResponder === playerIndex) {
    return 'reaction'
  }

  if (game.phase === 'DISCARD_SELECTION' && game.pendingDiscard?.playerIndex === playerIndex) {
    return 'discard'
  }

  if (game.phase === 'ACTION_SELECTION' && game.pendingActionSelection?.playerIndex === playerIndex) {
    return isTimelineActionSelection(game.pendingActionSelection) ? 'timeline' : 'target'
  }

  return null
}

function getPlayerActivityLabel(game: GameState, playerIndex: number, locale: Locale): string | null {
  const activityKind = getPlayerActivityKind(game, playerIndex)
  if (!activityKind) {
    return null
  }

  if (activityKind === 'play') return locale === 'pt' ? 'Jogando agora' : 'Playing now'
  if (activityKind === 'reaction') return locale === 'pt' ? 'Reagindo agora' : 'Reacting now'
  if (activityKind === 'discard') return locale === 'pt' ? 'Escolhendo descarte' : 'Choosing discard'
  if (activityKind === 'timeline') return locale === 'pt' ? 'Escolhendo timeline' : 'Choosing timeline'
  if (activityKind === 'target') return locale === 'pt' ? 'Escolhendo alvo' : 'Choosing target'

  return null
}

function getTablePrompt(
  game: GameState,
  locale: Locale,
): { iconKey: 'reaction' | 'discard' | 'target' | 'timeline' | 'main' | 'compass'; title: string; hint: string } {
  if (game.phase === 'REACTION_WINDOW' && game.pendingPlay) {
    return {
      iconKey: 'reaction',
      title: locale === 'pt' ? 'Janela de Reação' : 'Reaction Window',
      hint:
        locale === 'pt'
          ? `Qualquer outro jogador elegível pode usar TNH em ${getCardDisplayName(game.pendingPlay.card.id, locale)}.`
          : `Any other eligible player may use TNH on ${getCardDisplayName(game.pendingPlay.card.id, locale)}.`,
    }
  }

  if (game.phase === 'DISCARD_SELECTION' && game.pendingDiscard) {
    return {
      iconKey: 'discard',
      title: locale === 'pt' ? 'Descarte' : 'Discard',
      hint:
        locale === 'pt'
          ? `${game.players[game.pendingDiscard.playerIndex].name} descarta 1 carta (${game.pendingDiscard.sourceEra}).`
          : `${game.players[game.pendingDiscard.playerIndex].name} discards 1 card (${game.pendingDiscard.sourceEra}).`,
    }
  }

  if (game.phase === 'ACTION_SELECTION') {
    const isTimelineSelection = isTimelineActionSelection(game.pendingActionSelection)

    return {
      iconKey: isTimelineSelection ? 'timeline' : 'target',
      title: locale === 'pt' ? 'Seleção de Alvo' : 'Target Selection',
      hint: getActionSelectionPrompt(game, locale),
    }
  }

  if (game.phase === 'PLAYER_CHOICE') {
    return {
      iconKey: 'main',
      title: locale === 'pt' ? 'Fase Principal' : 'Main Phase',
      hint:
        locale === 'pt'
          ? `${game.players[game.currentPlayerIndex]?.name ?? 'Jogador'} escolhe jogar ou comprar.`
          : `${game.players[game.currentPlayerIndex]?.name ?? 'Player'} chooses play or draw.`,
    }
  }

  return {
    iconKey: 'compass',
    title: game.phase,
    hint: redactDrawDetails(game.statusText),
  }
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getActionLogTag(text: string): 'PLAY' | 'DRAW' | 'REACT' | 'SELECT' | 'DISCARD' | 'INFO' {
  const lower = text.toLowerCase()
  if (lower.includes('played')) return 'PLAY'
  if (lower.includes('drew')) return 'DRAW'
  if (lower.includes('passed reaction') || lower.includes('that never happened')) return 'REACT'
  if (lower.includes('selected')) return 'SELECT'
  if (lower.includes('discarded')) return 'DISCARD'
  return 'INFO'
}

function detectDrawnCardId(
  gameBefore: GameState | null | undefined,
  gameAfter: GameState | null | undefined,
  playerIndex: number,
): number | null {
  if (!gameBefore || !gameAfter || playerIndex < 0) {
    return null
  }

  const beforeHand = gameBefore.players[playerIndex]?.hand ?? []
  const afterHand = gameAfter.players[playerIndex]?.hand ?? []
  if (afterHand.length <= beforeHand.length) {
    return null
  }

  const beforeCounts = new Map<number, number>()
  for (const cardId of beforeHand) {
    beforeCounts.set(cardId, (beforeCounts.get(cardId) ?? 0) + 1)
  }

  for (const cardId of afterHand) {
    const count = beforeCounts.get(cardId) ?? 0
    if (count > 0) {
      beforeCounts.set(cardId, count - 1)
      continue
    }
    return cardId > 0 ? cardId : null
  }

  return null
}

function isThatNeverHappened(cardId: number): boolean {
  return cardId >= 85 && cardId <= 92
}

function isPresentEvent(cardId: number): boolean {
  return cardId >= 21 && cardId <= 40
}

function isTimeSwap(cardId: number): boolean {
  return cardId >= 113 && cardId <= 120
}

function isRewriteEvent(cardId: number): boolean {
  return cardId >= 93 && cardId <= 98
}

function isParadoxEvent(cardId: number): boolean {
  return cardId >= 61 && cardId <= 74
}

function isEventCard(cardId: number): boolean {
  return cardId >= 1 && cardId <= 74
}

function canPlayCardFromHand(cardId: number, hand: number[], game?: GameState, playerIndex?: number): boolean {
  if (isThatNeverHappened(cardId)) {
    return false
  }
  if (isPresentEvent(cardId) && hand.length <= 1) {
    return false
  }
  if (
    isParadoxEvent(cardId) &&
    game &&
    playerIndex !== undefined &&
    (playerIndex < 0 || playerIndex >= game.players.length || game.players[playerIndex].timeline.length === 0)
  ) {
    return false
  }
  if (
    isTimeSwap(cardId) &&
    game &&
    playerIndex !== undefined &&
    (playerIndex < 0 ||
      playerIndex >= game.players.length ||
      game.players[playerIndex].timeline.length === 0 ||
      !game.players.some((player, index) => index !== playerIndex && player.timeline.length > 0))
  ) {
    return false
  }
  if (
    isRewriteEvent(cardId) &&
    game &&
    playerIndex !== undefined &&
    (playerIndex < 0 ||
      playerIndex >= game.players.length ||
      game.players[playerIndex].timeline.length === 0 ||
      !hand.some((id) => isEventCard(id)))
  ) {
    return false
  }
  return true
}

function fallbackActionCardId(actionName: string): number | null {
  if (actionName === 'back_in_time') return 75
  if (actionName === 'local_reset') return 99
  if (actionName === 'rewrite_event') return 93
  if (actionName === 'time_swap') return 113
  if (actionName === 'future_peek') return 41
  return null
}

function describeAction(action: GameAction): string {
  if (action.type === 'play_card') {
    return `played ${getCardDisplayName(action.cardId)}`
  }
  if (action.type === 'draw_end_turn') {
    return 'drew and ended turn'
  }
  if (action.type === 'cancel_reaction') {
    return 'played That Never Happened'
  }
  if (action.type === 'pass_reaction') {
    return 'passed reaction'
  }
  if (action.type === 'discard_pending_event') {
    return `discarded ${getCardDisplayName(action.cardId)}`
  }
  if (action.type === 'select_future_target') {
    return `selected target player ${action.targetPlayerIndex + 1}`
  }
  return `selected target #${action.cardId}`
}

function maskFutureRevealForViewer(game: GameState, viewerPlayerIndex: number): GameState {
  if (!game.lastFutureReveal) {
    return game
  }

  if (viewerPlayerIndex >= 0 && game.lastFutureReveal.sourcePlayerIndex === viewerPlayerIndex) {
    return game
  }

  return {
    ...game,
    lastFutureReveal: {
      ...game.lastFutureReveal,
      cards: [],
    },
  }
}

function App() {
  const [language, setLanguage] = useState<Locale>(() => {
    if (typeof window === 'undefined') {
      return 'en'
    }
    const saved = window.localStorage.getItem('temporis_language')
    return saved === 'pt' ? 'pt' : 'en'
  })
  const [rules, setRules] = useState<TemporisRules | null>(null)
  const [game, setGame] = useState<GameState | null>(null)
  const [totalPlayers, setTotalPlayers] = useState<number>(2)
  const [serverUrl, setServerUrl] = useState<string>('ws://localhost:8787')
  const [nickname, setNickname] = useState<string>('You')
  const [roomCodeInput, setRoomCodeInput] = useState<string>('')
  const [networkClientId, setNetworkClientId] = useState<string | null>(null)
  const [networkStatus, setNetworkStatus] = useState<string>('Disconnected')
  const [networkError, setNetworkError] = useState<string>('')
  const [networkSocket, setNetworkSocket] = useState<WebSocket | null>(null)
  const [networkMatchActive, setNetworkMatchActive] = useState<boolean>(false)
  const [networkLoadingBarrierActive, setNetworkLoadingBarrierActive] = useState<boolean>(false)
  const [didReportAssetsReadyForBarrier, setDidReportAssetsReadyForBarrier] = useState<boolean>(false)
  const [localPlayerIndex, setLocalPlayerIndex] = useState<number>(0)
  const [lastAppliedActionSeq, setLastAppliedActionSeq] = useState<number>(0)
  const [cardAssetsReady, setCardAssetsReady] = useState<boolean>(false)
  const [cardAssetsLoadProgress, setCardAssetsLoadProgress] = useState<number>(0)
  const [timelineEntryFlashKey, setTimelineEntryFlashKey] = useState<string | null>(null)
  const [timelineRemovalFlashPlayerIndex, setTimelineRemovalFlashPlayerIndex] = useState<number | null>(null)
  const [recentPlayerAction, setRecentPlayerAction] = useState<
    | {
        playerIndex: number
        text: string
      }
    | null
  >(null)
  const [tableCardPreview, setTableCardPreview] = useState<
    | {
        playerIndex: number
        cardId: number
        isActionCard: boolean
        emphasis?: 'normal' | 'tnh'
        headline?: string
      }
    | null
  >(null)
  const [timelineTargetCue, setTimelineTargetCue] = useState<
    | {
        sourcePlayerIndex: number
        sourceCardId: number
        targetPlayerIndex: number
        targetCardId: number
        direction: 'incoming' | 'outgoing' | 'self' | 'neutral'
      }
    | null
  >(null)
  const [timelineActionProjectile, setTimelineActionProjectile] = useState<
    | {
        sourceCardId: number
        fromX: number
        fromY: number
        toX: number
        toY: number
        direction: 'incoming' | 'outgoing' | 'self' | 'neutral'
      }
    | null
  >(null)
  const [timelineActionProjectileActive, setTimelineActionProjectileActive] = useState<boolean>(false)
  const [resourceFlowCue, setResourceFlowCue] = useState<
    | {
        playerIndex: number
        type: 'draw' | 'discard'
        cardId: number | null
      }
    | null
  >(null)
  const [resourceFlowProjectile, setResourceFlowProjectile] = useState<
    | {
        type: 'draw' | 'discard'
        cardId: number | null
        fromX: number
        fromY: number
        toX: number
        toY: number
      }
    | null
  >(null)
  const [resourceFlowProjectileActive, setResourceFlowProjectileActive] = useState<boolean>(false)
  const tableBoardRef = useRef<HTMLDivElement | null>(null)
  const discardPileRef = useRef<HTMLDivElement | null>(null)
  const [reactionSecondsLeft, setReactionSecondsLeft] = useState<number | null>(null)
  const [showFutureReveal, setShowFutureReveal] = useState<boolean>(false)
  const [futureRevealSecondsLeft, setFutureRevealSecondsLeft] = useState<number | null>(null)
  const [futureRevealCycle, setFutureRevealCycle] = useState<number>(0)
  const [showGameOverCelebration, setShowGameOverCelebration] = useState<boolean>(false)
  const [actionTurnLog, setActionTurnLog] = useState<Array<{ id: string; turn: number; text: string; timestamp: number }>>([])
  const [chatMessages, setChatMessages] = useState<Array<{ id: string; sender: string; text: string; timestamp: number }>>([])
  const [chatInput, setChatInput] = useState<string>('')
  const [isChatOpen, setIsChatOpen] = useState<boolean>(false)
  const [isLogOpen, setIsLogOpen] = useState<boolean>(false)
  const [isFocusMode, setIsFocusMode] = useState<boolean>(false)
  const [isDiscardCascadeOpen, setIsDiscardCascadeOpen] = useState<boolean>(false)
  const [drawnCardFlashId, setDrawnCardFlashId] = useState<number | null>(null)
  const [rematchSecondsLeft, setRematchSecondsLeft] = useState<number | null>(null)
  const [localRematchDecision, setLocalRematchDecision] = useState<'accept' | 'decline' | null>(null)
  const [logFilter, setLogFilter] = useState<'current' | 'all'>('current')
  const [unreadChatCount, setUnreadChatCount] = useState<number>(0)
  const [chatNotification, setChatNotification] = useState<string | null>(null)
  const previousTimelineTailByPlayer = useRef<Record<number, string>>({})
  const gameRef = useRef<GameState | null>(null)
  const lastFutureRevealSignatureRef = useRef<string>('')
  const lastWinnerRef = useRef<string | null>(null)
  const turnCounterRef = useRef<number>(1)
  const previousTurnPlayerRef = useRef<number | null>(null)
  const previousChatCountRef = useRef<number>(0)
  const chatToastTimeoutRef = useRef<number | null>(null)
  const userActionLockRef = useRef<boolean>(false)
  const userActionLockTimeoutRef = useRef<number | null>(null)
  const pendingLanIntentRef = useRef<
    | {
        type: 'host'
        nickname: string
      }
    | {
        type: 'join'
        nickname: string
        roomCode: string
      }
    | null
  >(null)
  const [roomInfo, setRoomInfo] = useState<{
    roomCode: string
    hostClientId: string | null
    players: Array<{ clientId: string | null; nickname: string; connected: boolean }>
    spectators: Array<{ clientId: string; nickname: string }>
    gameInProgress: boolean
    loadingInProgress: boolean
    loadingRequiredPlayerIndexes: number[]
    loadingReadyPlayerIndexes: number[]
    rematchActive: boolean
    rematchDeadlineTs: number | null
    rematchVotes: Array<{ playerIndex: number; nickname: string; accept: boolean | null }>
  } | null>(null)
  const roomInfoRef = useRef<typeof roomInfo>(null)

  useEffect(() => {
    window.localStorage.setItem('temporis_language', language)
    document.documentElement.lang = language
  }, [language])

  useEffect(() => {
    const loadRules = async () => {
      const response = await fetch('/temporis_rules_v1.json')
      const data = (await response.json()) as TemporisRules
      setRules(data)
    }

    loadRules().catch((error) => {
      console.error(error)
    })
  }, [])

  useEffect(() => {
    if (!rules) {
      return
    }

    let cancelled = false
    setCardAssetsReady(false)
    setCardAssetsLoadProgress(0)

    preloadCardImages(ALL_CARD_IDS, (loaded, total) => {
      if (cancelled) {
        return
      }
      if (total <= 0) {
        setCardAssetsLoadProgress(100)
        return
      }
      setCardAssetsLoadProgress(Math.min(100, Math.round((loaded / total) * 100)))
    })
      .then(() => {
        if (cancelled) {
          return
        }
        setCardAssetsLoadProgress(100)
        setCardAssetsReady(true)
      })
      .catch(() => {
        if (cancelled) {
          return
        }
        setCardAssetsReady(true)
      })

    return () => {
      cancelled = true
    }
  }, [rules])

  useEffect(() => {
    gameRef.current = game
  }, [game])

  useEffect(() => {
    roomInfoRef.current = roomInfo
  }, [roomInfo])

  const connectLan = () => {
    if (networkSocket && networkSocket.readyState === WebSocket.OPEN) {
      return
    }

    if (networkSocket && networkSocket.readyState === WebSocket.CONNECTING) {
      setNetworkStatus('Connecting...')
      return
    }

    setNetworkError('')
    setNetworkStatus('Connecting...')
    const socket = new WebSocket(serverUrl)
    let sessionClientId: string | null = null
    let sessionIsHost = false
    let sessionLocalPlayerIndex = -1
    let socketLastSeq = 0

    socket.onopen = () => {
      setNetworkStatus('Connected')

      const pendingIntent = pendingLanIntentRef.current
      if (pendingIntent && socket.readyState === WebSocket.OPEN) {
        if (pendingIntent.type === 'host') {
          socket.send(
            JSON.stringify({
              type: 'host_room',
              nickname: pendingIntent.nickname,
            }),
          )
        } else {
          socket.send(
            JSON.stringify({
              type: 'join_room',
              roomCode: pendingIntent.roomCode,
              nickname: pendingIntent.nickname,
            }),
          )
        }
        pendingLanIntentRef.current = null
      }
    }

    socket.onclose = () => {
      setNetworkStatus('Disconnected')
      setNetworkClientId(null)
      setRoomInfo(null)
      setNetworkMatchActive(false)
      setNetworkLoadingBarrierActive(false)
      setDidReportAssetsReadyForBarrier(false)
      setLocalPlayerIndex(0)
      setLastAppliedActionSeq(0)
      setNetworkSocket(null)
      pendingLanIntentRef.current = null
      resetMatchUiState()
    }

    socket.onerror = () => {
      setNetworkStatus('Connection error')
      setNetworkError('Could not connect to LAN server. Check IP/port and firewall.')
    }

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data))
        if (payload.type === 'welcome') {
          sessionClientId = payload.clientId
          setNetworkClientId(payload.clientId)
          return
        }
        if (payload.type === 'room_hosted' || payload.type === 'room_joined') {
          setRoomCodeInput(payload.roomCode)
          return
        }
        if (payload.type === 'room_update') {
          const loadingInProgress = Boolean(payload.loadingInProgress)
          const requiredIndexes = Array.isArray(payload.loadingRequiredPlayerIndexes)
            ? payload.loadingRequiredPlayerIndexes
                .filter((value: unknown) => Number.isInteger(value))
                .map((value: unknown) => Number(value))
            : []
          const readyIndexes = Array.isArray(payload.loadingReadyPlayerIndexes)
            ? payload.loadingReadyPlayerIndexes
                .filter((value: unknown) => Number.isInteger(value))
                .map((value: unknown) => Number(value))
            : []
          const rematchVotes = Array.isArray(payload.rematchVotes)
            ? payload.rematchVotes
                .filter(
                  (entry: unknown) =>
                    typeof entry === 'object' &&
                    entry !== null &&
                    Number.isInteger((entry as { playerIndex?: unknown }).playerIndex),
                )
                .map((entry: any) => ({
                  playerIndex: Number(entry.playerIndex),
                  nickname: String(entry.nickname ?? 'Player'),
                  accept: typeof entry.accept === 'boolean' ? entry.accept : null,
                }))
            : []

          setRoomInfo({
            roomCode: payload.roomCode,
            hostClientId: payload.hostClientId,
            players: payload.players,
            spectators: payload.spectators ?? [],
            gameInProgress: Boolean(payload.gameInProgress),
            loadingInProgress,
            loadingRequiredPlayerIndexes: requiredIndexes,
            loadingReadyPlayerIndexes: readyIndexes,
            rematchActive: Boolean(payload.rematchActive),
            rematchDeadlineTs: Number.isFinite(Number(payload.rematchDeadlineTs)) ? Number(payload.rematchDeadlineTs) : null,
            rematchVotes,
          })
          setNetworkLoadingBarrierActive(loadingInProgress)
          if (loadingInProgress) {
            setNetworkMatchActive(false)
            setGame(null)
          }
          if (!loadingInProgress) {
            setDidReportAssetsReadyForBarrier(false)
          }
          return
        }
        if (payload.type === 'room_left') {
          setRoomInfo(null)
          setNetworkMatchActive(false)
          setNetworkLoadingBarrierActive(false)
          setDidReportAssetsReadyForBarrier(false)
          setLastAppliedActionSeq(0)
          setLocalRematchDecision(null)
          setRematchSecondsLeft(null)
          return
        }
        if (payload.type === 'game_started') {
          const startPayload = payload.payload as
            | { playerRoster: Array<{ clientId: string; nickname: string }>; hostClientId: string | null }
            | undefined
          if (!rules || !startPayload || !startPayload.playerRoster || startPayload.playerRoster.length < 2) {
            return
          }

          const youIndex = startPayload.playerRoster.findIndex(
            (entry) => entry.clientId === (sessionClientId ?? networkClientId),
          )
          const myIndex = youIndex
          sessionIsHost = startPayload.hostClientId === (sessionClientId ?? networkClientId)
          sessionLocalPlayerIndex = myIndex
          setNetworkLoadingBarrierActive(false)
          setDidReportAssetsReadyForBarrier(false)
          setLocalPlayerIndex(myIndex)
          setTotalPlayers(startPayload.playerRoster.length)
          setNetworkMatchActive(true)
          socketLastSeq = 0
          setLastAppliedActionSeq(0)
          resetMatchUiState()
          setLocalRematchDecision(null)
          setRematchSecondsLeft(null)
          setGame(null)

          if (sessionIsHost) {
            const hostInitialGame = createInitialGame({
              startingHand: rules.setup.standard.starting_hand,
              startingTimeline: rules.setup.standard.starting_timeline,
              totalPlayers: startPayload.playerRoster.length,
              botCount: 0,
              playerRoster: startPayload.playerRoster.map((entry) => ({
                name: entry.nickname,
                isBot: false,
              })),
            })

            if (socket.readyState === WebSocket.OPEN) {
              socket.send(
                JSON.stringify({
                  type: 'host_state_update',
                  state: hostInitialGame,
                  lastAction: null,
                }),
              )
            }
          }
          return
        }

        if (payload.type === 'host_action_request') {
          if (!sessionIsHost || !rules) {
            return
          }

          const action = payload.action as GameAction | undefined
          if (!action) {
            return
          }

          const roomSnapshot = roomInfoRef.current
          const actorIndexFromClient =
            roomSnapshot?.players.findIndex((player) => player.clientId === (payload.fromClientId ?? null)) ?? -1
          const normalizedAction: GameAction =
            (action.type === 'cancel_reaction' || action.type === 'pass_reaction') && actorIndexFromClient >= 0
              ? { ...action, playerIndex: actorIndexFromClient }
              : action

          const currentGame = gameRef.current
          if (!currentGame) {
            return
          }

          const updated = applyGameAction(currentGame, rules, normalizedAction)
          gameRef.current = updated
          setGame(maskFutureRevealForViewer(updated, sessionLocalPlayerIndex))

          if (socket.readyState === WebSocket.OPEN) {
            socket.send(
              JSON.stringify({
                type: 'host_state_update',
                state: updated,
                lastAction: {
                  fromClientId: payload.fromClientId ?? null,
                  actorPlayerIndex:
                    (normalizedAction.type === 'cancel_reaction' || normalizedAction.type === 'pass_reaction') &&
                    typeof normalizedAction.playerIndex === 'number'
                      ? normalizedAction.playerIndex
                      : currentGame.currentPlayerIndex,
                  action: normalizedAction,
                  meta: payload.meta ?? null,
                },
              }),
            )
          }
          return
        }

        if (payload.type === 'state_update') {
          const seq = Number(payload.seq ?? 0)
          const nextState = payload.state as GameState | undefined
          if (!nextState || !seq) {
            return
          }

          if (seq <= socketLastSeq) {
            return
          }

          if (socketLastSeq > 0 && seq > socketLastSeq + 1) {
            sendLanMessage({ type: 'request_snapshot' })
            return
          }

          const lastAction = payload.lastAction as
            | {
                fromClientId?: string | null
                actorPlayerIndex?: number
                action?: GameAction
                meta?: { proxyNickname?: string } | null
              }
            | null

          setGame((current) => {
            if (current && lastAction?.action) {
              const currentRoomInfo = roomInfoRef.current
              const actorIndexFromPayload = Number.isInteger(lastAction.actorPlayerIndex)
                ? Number(lastAction.actorPlayerIndex)
                : -1
              const actorIndexFromClient =
                currentRoomInfo?.players.findIndex((player) => player.clientId === (lastAction.fromClientId ?? null)) ?? -1
              const actorIndex =
                actorIndexFromPayload >= 0 && actorIndexFromPayload < current.players.length
                  ? actorIndexFromPayload
                  : actorIndexFromClient >= 0
                    ? actorIndexFromClient
                    : current.currentPlayerIndex
              const actorName =
                actorIndex >= 0 && current.players[actorIndex]
                  ? current.players[actorIndex].name
                  : (lastAction.meta?.proxyNickname as string | undefined) ?? 'Player'
              if (actorIndex >= 0) {
                markRecentAction(actorIndex, lastAction.action, current, nextState)
              }
              pushTurnLog(current, lastAction.action, actorName, nextState)
            }

            return maskFutureRevealForViewer(nextState, sessionLocalPlayerIndex)
          })

          socketLastSeq = seq
          setLastAppliedActionSeq(seq)
          return
        }
        if (payload.type === 'rematch_result') {
          if (payload.status === 'not_enough_accepts') {
            setNetworkError(
              language === 'pt'
                ? 'Rematch cancelada: aceitações insuficientes para iniciar nova partida.'
                : 'Rematch canceled: not enough accepts to start a new match.',
            )
          }
          return
        }
        if (payload.type === 'error') {
          setNetworkError(payload.message ?? 'Unknown server error')
          return
        }
        if (payload.type === 'chat_message') {
          const sender = String(payload.sender ?? 'Player')
          const text = String(payload.text ?? '')
          const timestamp = Number(payload.timestamp ?? Date.now())
          pushChatMessage(sender, text, Number.isFinite(timestamp) ? timestamp : Date.now())
          return
        }
      } catch {
        setNetworkError('Invalid message from server.')
      }
    }

    setNetworkSocket(socket)
  }

  const sendLanMessage = (message: Record<string, unknown>) => {
    if (!networkSocket || networkSocket.readyState !== WebSocket.OPEN) {
      setNetworkError('Connect to the LAN server first.')
      return
    }
    networkSocket.send(JSON.stringify(message))
  }

  const requestSnapshot = () => {
    if (!networkMatchActive) {
      return
    }
    sendLanMessage({ type: 'request_snapshot' })
  }

  const hostLanRoom = () => {
    const trimmedNickname = nickname.trim()
    if (!trimmedNickname) {
      setNetworkError('Nickname is required.')
      return
    }

    if (networkSocket && networkSocket.readyState === WebSocket.OPEN) {
      sendLanMessage({ type: 'host_room', nickname: trimmedNickname })
      return
    }

    pendingLanIntentRef.current = {
      type: 'host',
      nickname: trimmedNickname,
    }
    connectLan()
  }

  const joinLanRoom = () => {
    const trimmedNickname = nickname.trim()
    if (!trimmedNickname) {
      setNetworkError('Nickname is required.')
      return
    }

    const roomCode = roomCodeInput.trim().toUpperCase()
    if (!roomCode) {
      setNetworkError('Room code is required.')
      return
    }

    if (networkSocket && networkSocket.readyState === WebSocket.OPEN) {
      sendLanMessage({ type: 'join_room', roomCode, nickname: trimmedNickname })
      return
    }

    pendingLanIntentRef.current = {
      type: 'join',
      nickname: trimmedNickname,
      roomCode,
    }
    connectLan()
  }

  const leaveLanRoom = () => {
    sendLanMessage({ type: 'leave_room' })
  }

  const activePlayer = useMemo(() => {
    if (!game) {
      return null
    }
    return game.players[game.currentPlayerIndex]
  }, [game])

  const isLocalController =
    game ? !networkMatchActive || (localPlayerIndex >= 0 && game.currentPlayerIndex === localPlayerIndex) : false

  const isDisconnectedSeatTurn =
    Boolean(game && roomInfo && roomInfo.players[game.currentPlayerIndex]) &&
    Boolean(roomInfo && game && !roomInfo.players[game.currentPlayerIndex].connected)

  const isLocalHost = Boolean(roomInfo && networkClientId && roomInfo.hostClientId === networkClientId)
  const isFutureRevealWindowActive = showFutureReveal && futureRevealSecondsLeft !== null
  const canViewFutureReveal = Boolean(
    game?.lastFutureReveal && localPlayerIndex >= 0 && game.lastFutureReveal.sourcePlayerIndex === localPlayerIndex,
  )
  const isReactionWindowActive = Boolean(game && game.phase === 'REACTION_WINDOW' && game.pendingPlay)
  const isLocalReactionEligible = Boolean(
    game &&
      game.pendingPlay &&
      localPlayerIndex >= 0 &&
      localPlayerIndex < game.players.length &&
      localPlayerIndex !== game.pendingPlay.playedBy &&
      !game.pendingPlay.cancelers.includes(localPlayerIndex) &&
      (game.pendingPlay.effectOnly ? localPlayerIndex === game.pendingPlay.reactor : true),
  )
  const canLocalCancelReactionNow = Boolean(
    game &&
      isLocalReactionEligible &&
      game.players[localPlayerIndex]?.hand.some((cardId) => isThatNeverHappened(cardId)),
  )
  const isReactionTimerOwner = Boolean(game && isReactionWindowActive && (!networkMatchActive || isLocalHost))
  const reactionCardId = game?.phase === 'REACTION_WINDOW' && game.pendingPlay ? game.pendingPlay.card.id : null
  const reactionWindowVisualKey =
    game?.phase === 'REACTION_WINDOW' && game.pendingPlay
      ? `${game.pendingPlay.playedBy}-${game.pendingPlay.card.id}-${game.pendingPlay.cancelChainCount}-${game.pendingPlay.passesSinceLastCancel}`
      : 'no-reaction'

  useEffect(() => {
    if (!networkLoadingBarrierActive || !cardAssetsReady || didReportAssetsReadyForBarrier) {
      return
    }

    if (!networkSocket || networkSocket.readyState !== WebSocket.OPEN || !roomInfo) {
      return
    }

    const playerIndex = roomInfo.players.findIndex((player) => player.clientId === networkClientId)
    if (playerIndex < 0 || !roomInfo.loadingRequiredPlayerIndexes.includes(playerIndex)) {
      return
    }

    networkSocket.send(
      JSON.stringify({
        type: 'client_assets_ready',
      }),
    )
    setDidReportAssetsReadyForBarrier(true)
  }, [
    networkLoadingBarrierActive,
    cardAssetsReady,
    didReportAssetsReadyForBarrier,
    networkSocket,
    roomInfo,
    networkClientId,
  ])

  const resetMatchUiState = () => {
    setActionTurnLog([])
    setChatMessages([])
    setChatInput('')
    setIsChatOpen(false)
    setIsLogOpen(false)
    setUnreadChatCount(0)
    setChatNotification(null)
    if (chatToastTimeoutRef.current !== null) {
      window.clearTimeout(chatToastTimeoutRef.current)
      chatToastTimeoutRef.current = null
    }
    turnCounterRef.current = 1
    previousChatCountRef.current = 0
    previousTurnPlayerRef.current = null
    setShowFutureReveal(false)
    setFutureRevealSecondsLeft(null)
    setReactionSecondsLeft(null)
    setShowGameOverCelebration(false)
    setTimelineTargetCue(null)
    setTimelineActionProjectile(null)
    setTimelineActionProjectileActive(false)
    setResourceFlowCue(null)
    setResourceFlowProjectile(null)
    setResourceFlowProjectileActive(false)
    setIsDiscardCascadeOpen(false)
    lastWinnerRef.current = null
    userActionLockRef.current = false
    if (userActionLockTimeoutRef.current !== null) {
      window.clearTimeout(userActionLockTimeoutRef.current)
      userActionLockTimeoutRef.current = null
    }
  }

  const pushTurnLog = (
    gameBefore: GameState | null,
    action: GameAction,
    actorNameOverride?: string,
    gameAfter?: GameState,
  ) => {
    if (!gameBefore) {
      return
    }
    const actorName = actorNameOverride ?? gameBefore.players[gameBefore.currentPlayerIndex]?.name ?? 'Player'
    const timestamp = Date.now()
    const outcome = gameAfter
      ? ` → ${gameAfter.statusText} [${gameBefore.phase} → ${gameAfter.phase}]`
      : ''
    const line = `T${turnCounterRef.current} • ${actorName} ${describeAction(action)}${outcome}`
    const id = `${timestamp}-${Math.random().toString(36).slice(2, 7)}`
    setActionTurnLog((prev) => [{ id, turn: turnCounterRef.current, text: line, timestamp }, ...prev].slice(0, 80))
  }

  const pushChatMessage = (sender: string, text: string, timestamp: number = Date.now()) => {
    const message = text.trim()
    if (!message) {
      return
    }
    const id = `${timestamp}-${Math.random().toString(36).slice(2, 7)}`
    setChatMessages((prev) => [...prev.slice(-79), { id, sender, text: message, timestamp }])
  }

  const markRecentAction = (
    playerIndex: number,
    action: GameAction,
    gameBefore?: GameState | null,
    gameAfter?: GameState | null,
  ) => {
    let text = describeAction(action)
    if (action.type === 'cancel_reaction') {
      text = 'played That Never Happened'
    }
    setRecentPlayerAction({ playerIndex, text })

    if (action.type === 'play_card') {
      const cardName = getCardDisplayName(action.cardId, language)
      setTableCardPreview({
        playerIndex,
        cardId: action.cardId,
        isActionCard: action.cardId >= 75,
        emphasis: 'normal',
        headline: cardName,
      })
    }

    if (action.type === 'draw_end_turn') {
      const drawnCardId = detectDrawnCardId(gameBefore ?? null, gameAfter ?? null, playerIndex)
      setResourceFlowCue({
        playerIndex,
        type: 'draw',
        cardId: null,
      })
      const expectedSelfIndex = networkMatchActive && localPlayerIndex >= 0 ? localPlayerIndex : 0
      if (drawnCardId !== null && playerIndex === expectedSelfIndex) {
        setDrawnCardFlashId(drawnCardId)
      }
    }

    if (action.type === 'discard_pending_event') {
      setResourceFlowCue({
        playerIndex,
        type: 'discard',
        cardId: action.cardId,
      })
    }

    if (action.type === 'cancel_reaction') {
      setTableCardPreview({
        playerIndex,
        cardId: 85,
        isActionCard: true,
        emphasis: 'tnh',
        headline: 'THAT NEVER HAPPENED!',
      })
      return
    }

    if (!gameBefore) {
      return
    }

    const pendingSelection = gameBefore.pendingActionSelection
    const sourceActionCardId = pendingSelection?.sourceCardId
    if (!pendingSelection || !sourceActionCardId) {
      return
    }

    if (action.type === 'select_future_target' && pendingSelection.actionName === 'future_peek') {
      const isTargetingLocal = localPlayerIndex >= 0 && action.targetPlayerIndex === localPlayerIndex
      const targetLabel = isTargetingLocal ? 'YOU' : gameBefore.players[action.targetPlayerIndex]?.name ?? 'target'
      setTableCardPreview({
        playerIndex,
        cardId: sourceActionCardId,
        isActionCard: true,
        emphasis: 'normal',
        headline: `${getCardDisplayName(sourceActionCardId, language)} → ${targetLabel}`,
      })
      return
    }

    if (action.type !== 'select_action_target') {
      return
    }

    const targetsTimelineCard =
      pendingSelection.actionName === 'back_in_time' ||
      pendingSelection.actionName === 'local_reset' ||
      pendingSelection.actionName === 'rewrite_event' ||
      pendingSelection.actionName === 'time_swap'

    if (!targetsTimelineCard) {
      return
    }

    const targetedPlayerIndex = gameBefore.players.findIndex((player) =>
      player.timeline.some((entry) => entry.id === action.cardId),
    )
    if (targetedPlayerIndex < 0) {
      return
    }

    const visualActionCardId = sourceActionCardId ?? fallbackActionCardId(pendingSelection.actionName)
    if (visualActionCardId !== null) {
      const isTargetingLocal = localPlayerIndex >= 0 && targetedPlayerIndex === localPlayerIndex
      const targetLabel = isTargetingLocal ? 'YOU' : gameBefore.players[targetedPlayerIndex]?.name ?? 'target'
      setTableCardPreview({
        playerIndex,
        cardId: visualActionCardId,
        isActionCard: visualActionCardId >= 75,
        emphasis: 'normal',
        headline: `${getCardDisplayName(visualActionCardId, language)} → ${targetLabel}`,
      })
    }

    const direction: 'incoming' | 'outgoing' | 'self' | 'neutral' =
      localPlayerIndex < 0
        ? 'neutral'
        : playerIndex === localPlayerIndex && targetedPlayerIndex === localPlayerIndex
          ? 'self'
          : playerIndex === localPlayerIndex
            ? 'outgoing'
            : targetedPlayerIndex === localPlayerIndex
              ? 'incoming'
              : 'neutral'

    setTimelineTargetCue({
      sourcePlayerIndex: playerIndex,
      sourceCardId: visualActionCardId ?? sourceActionCardId,
      targetPlayerIndex: targetedPlayerIndex,
      targetCardId: action.cardId,
      direction,
    })
  }

  useEffect(() => {
    if (!recentPlayerAction) {
      return
    }
    const timeoutId = window.setTimeout(() => {
      setRecentPlayerAction(null)
    }, 1700)
    return () => window.clearTimeout(timeoutId)
  }, [recentPlayerAction])

  useEffect(() => {
    if (!tableCardPreview) {
      return
    }

    const previewDuration = tableCardPreview.isActionCard
      ? ACTION_TABLE_PREVIEW_DURATION_MS
      : TABLE_PREVIEW_DURATION_MS

    const timeoutId = window.setTimeout(() => {
      setTableCardPreview(null)
    }, previewDuration)

    return () => window.clearTimeout(timeoutId)
  }, [tableCardPreview])

  useEffect(() => {
    if (drawnCardFlashId === null) {
      return
    }
    const timeoutId = window.setTimeout(() => {
      setDrawnCardFlashId(null)
    }, 760)
    return () => window.clearTimeout(timeoutId)
  }, [drawnCardFlashId])

  useEffect(() => {
    if (!tableBoardRef.current || !game) {
      return
    }

    const board = tableBoardRef.current
    const timelineContainers = board.querySelectorAll<HTMLElement>('.seat-timeline, .self-timeline')
    timelineContainers.forEach((container) => {
      container.scrollLeft = container.scrollWidth
    })
  }, [game?.players.map((player) => player.timeline.length).join('|')])

  useEffect(() => {
    if (!timelineTargetCue) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setTimelineTargetCue(null)
    }, 1200)

    return () => window.clearTimeout(timeoutId)
  }, [timelineTargetCue])

  useEffect(() => {
    if (!resourceFlowCue || !tableBoardRef.current) {
      return
    }

    const board = tableBoardRef.current
    const boardRect = board.getBoundingClientRect()
    const seatElement = board.querySelector<HTMLElement>(`[data-seat-player='${resourceFlowCue.playerIndex}']`)
    const deckAnchor = board.querySelector<HTMLElement>("[data-resource-anchor='deck']")
    const discardAnchor = board.querySelector<HTMLElement>("[data-resource-anchor='discard']")
    if (!seatElement || !deckAnchor || !discardAnchor) {
      return
    }

    const seatRect = seatElement.getBoundingClientRect()
    const selfHandRow = seatElement.querySelector<HTMLElement>('.self-hand-row')
    const deckRect = deckAnchor.getBoundingClientRect()
    const discardRect = discardAnchor.getBoundingClientRect()

    const seatX = seatRect.left + seatRect.width / 2 - boardRect.left
    const seatY = seatRect.top + seatRect.height / 2 - boardRect.top
    const deckX = deckRect.left + deckRect.width / 2 - boardRect.left
    const deckY = deckRect.top + deckRect.height / 2 - boardRect.top
    const discardX = discardRect.left + discardRect.width / 2 - boardRect.left
    const discardY = discardRect.top + discardRect.height / 2 - boardRect.top

    const fromX = resourceFlowCue.type === 'draw' ? deckX : seatX
    const fromY = resourceFlowCue.type === 'draw' ? deckY : seatY
    const toX =
      resourceFlowCue.type === 'draw'
        ? selfHandRow
          ? selfHandRow.getBoundingClientRect().right - boardRect.left - 90
          : seatX
        : discardX
    const toY =
      resourceFlowCue.type === 'draw'
        ? selfHandRow
          ? selfHandRow.getBoundingClientRect().top - boardRect.top + 70
          : seatY
        : discardY

    setResourceFlowProjectile({
      type: resourceFlowCue.type,
      cardId: resourceFlowCue.cardId,
      fromX,
      fromY,
      toX,
      toY,
    })
    setResourceFlowProjectileActive(false)

    const frameId = window.requestAnimationFrame(() => {
      setResourceFlowProjectileActive(true)
    })

    const timeoutId = window.setTimeout(() => {
      setResourceFlowProjectile(null)
      setResourceFlowProjectileActive(false)
      setResourceFlowCue(null)
    }, PROJECTILE_CLEANUP_MS)

    return () => {
      window.cancelAnimationFrame(frameId)
      window.clearTimeout(timeoutId)
    }
  }, [resourceFlowCue])

  useEffect(() => {
    if (!timelineTargetCue || !tableBoardRef.current) {
      return
    }

    const board = tableBoardRef.current
    const boardRect = board.getBoundingClientRect()
    const sourceElement = board.querySelector<HTMLElement>(`[data-seat-player='${timelineTargetCue.sourcePlayerIndex}']`)
    const targetElement = board.querySelector<HTMLElement>(
      `[data-timeline-card-player='${timelineTargetCue.targetPlayerIndex}'][data-timeline-card-id='${timelineTargetCue.targetCardId}']`,
    )

    if (!sourceElement || !targetElement) {
      return
    }

    const sourceRect = sourceElement.getBoundingClientRect()
    const targetRect = targetElement.getBoundingClientRect()
    const fromX = sourceRect.left + sourceRect.width / 2 - boardRect.left
    const fromY = sourceRect.top + sourceRect.height / 2 - boardRect.top
    const toX = targetRect.left + targetRect.width / 2 - boardRect.left
    const toY = targetRect.top + targetRect.height / 2 - boardRect.top

    setTimelineActionProjectile({
      sourceCardId: timelineTargetCue.sourceCardId,
      fromX,
      fromY,
      toX,
      toY,
      direction: timelineTargetCue.direction,
    })
    setTimelineActionProjectileActive(false)

    const frameId = window.requestAnimationFrame(() => {
      setTimelineActionProjectileActive(true)
    })

    const timeoutId = window.setTimeout(() => {
      setTimelineActionProjectile(null)
      setTimelineActionProjectileActive(false)
    }, PROJECTILE_CLEANUP_MS)

    return () => {
      window.cancelAnimationFrame(frameId)
      window.clearTimeout(timeoutId)
    }
  }, [timelineTargetCue])

  useEffect(() => {
    if (isChatOpen) {
      setUnreadChatCount(0)
      setChatNotification(null)
      previousChatCountRef.current = chatMessages.length
      return
    }

    if (chatMessages.length > previousChatCountRef.current) {
      const newCount = chatMessages.length - previousChatCountRef.current
      const latest = chatMessages[chatMessages.length - 1]
      setUnreadChatCount((value) => value + newCount)
      setChatNotification(`${latest.sender}: ${latest.text}`)
      if (chatToastTimeoutRef.current !== null) {
        window.clearTimeout(chatToastTimeoutRef.current)
      }
      chatToastTimeoutRef.current = window.setTimeout(() => {
        setChatNotification(null)
      }, 2600)
    }

    previousChatCountRef.current = chatMessages.length
  }, [chatMessages, isChatOpen])

  useEffect(() => {
    return () => {
      if (chatToastTimeoutRef.current !== null) {
        window.clearTimeout(chatToastTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!isDiscardCascadeOpen) {
      return
    }

    const handleOutside = (event: PointerEvent) => {
      if (!discardPileRef.current) {
        return
      }
      const target = event.target as Node | null
      if (target && !discardPileRef.current.contains(target)) {
        setIsDiscardCascadeOpen(false)
      }
    }

    window.addEventListener('pointerdown', handleOutside)
    return () => window.removeEventListener('pointerdown', handleOutside)
  }, [isDiscardCascadeOpen])

  useEffect(() => {
    if (!game || game.discardPile.length === 0) {
      setIsDiscardCascadeOpen(false)
    }
  }, [game])

  useEffect(() => {
    const winner = game?.winner ?? null
    if (!winner) {
      setShowGameOverCelebration(false)
      lastWinnerRef.current = null
      return
    }

    if (winner !== lastWinnerRef.current) {
      lastWinnerRef.current = winner
      setShowGameOverCelebration(true)
      const timeoutId = window.setTimeout(() => {
        setShowGameOverCelebration(false)
      }, 2600)
      return () => window.clearTimeout(timeoutId)
    }

    return
  }, [game?.winner])

  useEffect(() => {
    if (!networkMatchActive || !roomInfo?.rematchActive || !roomInfo.rematchDeadlineTs) {
      setRematchSecondsLeft(null)
      return
    }

    const deadlineTs = roomInfo.rematchDeadlineTs

    const update = () => {
      const remaining = Math.max(0, deadlineTs - Date.now())
      setRematchSecondsLeft(Math.ceil(remaining / 1000))
    }

    update()
    const intervalId = window.setInterval(update, 500)
    return () => window.clearInterval(intervalId)
  }, [networkMatchActive, roomInfo?.rematchActive, roomInfo?.rematchDeadlineTs])

  useEffect(() => {
    if (!roomInfo?.rematchActive) {
      setLocalRematchDecision(null)
    }
    if (!game?.winner) {
      setLocalRematchDecision(null)
    }
  }, [roomInfo?.rematchActive, game?.winner])

  useEffect(() => {
    if (!game) {
      return
    }

    if (previousTurnPlayerRef.current === null) {
      previousTurnPlayerRef.current = game.currentPlayerIndex
      return
    }

    if (game.currentPlayerIndex !== previousTurnPlayerRef.current) {
      turnCounterRef.current += 1
      previousTurnPlayerRef.current = game.currentPlayerIndex
    }
  }, [game?.currentPlayerIndex])

  useEffect(() => {
    if (!game?.lastFutureReveal) {
      setShowFutureReveal(false)
      setFutureRevealSecondsLeft(null)
      lastFutureRevealSignatureRef.current = ''
      return
    }

    const signature = `${game.lastFutureReveal.sourcePlayerIndex}-${game.lastFutureReveal.targetPlayerIndex}-${game.lastFutureReveal.cards.join(',')}`
    if (signature === lastFutureRevealSignatureRef.current) {
      return
    }

    lastFutureRevealSignatureRef.current = signature
    setShowFutureReveal(true)
    setFutureRevealSecondsLeft(5)
    setFutureRevealCycle((value) => value + 1)
  }, [game?.lastFutureReveal])

  useEffect(() => {
    if (!showFutureReveal) {
      setFutureRevealSecondsLeft(null)
      return
    }

    setFutureRevealSecondsLeft(5)
    const startedAt = Date.now()
    const intervalId = window.setInterval(() => {
      const elapsed = Date.now() - startedAt
      const remaining = Math.max(0, 5000 - elapsed)
      setFutureRevealSecondsLeft(Math.ceil(remaining / 1000))
    }, 1000)

    const timeoutId = window.setTimeout(() => {
      setShowFutureReveal(false)
      setFutureRevealSecondsLeft(null)
    }, 5000)

    return () => {
      window.clearInterval(intervalId)
      window.clearTimeout(timeoutId)
    }
  }, [showFutureReveal, futureRevealCycle])

  useEffect(() => {
    if (!game || !rules) {
      setReactionSecondsLeft(null)
      return
    }

    if (isFutureRevealWindowActive) {
      setReactionSecondsLeft(null)
      return
    }

    if (game.phase !== 'REACTION_WINDOW' || !game.pendingPlay) {
      setReactionSecondsLeft(null)
      return
    }

    if (!isReactionTimerOwner) {
      setReactionSecondsLeft(null)
      return
    }

    const canCancel = game.players.some(
      (player, index) =>
        index !== game.pendingPlay?.playedBy &&
        !game.pendingPlay?.cancelers.includes(index) &&
        (game.pendingPlay?.effectOnly ? index === game.pendingPlay.reactor : true) &&
        player.hand.some((cardId) => isThatNeverHappened(cardId)),
    )
    const totalMs = canCancel ? 5000 : 250
    const startedAt = Date.now()

    if (canCancel) {
      setReactionSecondsLeft(5)
    } else {
      setReactionSecondsLeft(null)
    }

    const intervalId = canCancel
      ? window.setInterval(() => {
          const elapsed = Date.now() - startedAt
          const remaining = Math.max(0, totalMs - elapsed)
          setReactionSecondsLeft(Math.ceil(remaining / 1000))
        }, 1000)
      : null

    const timeoutId = window.setTimeout(() => {
      setReactionSecondsLeft(null)
      dispatchGameAction({ type: 'pass_reaction' }, { bypassUserInputLock: true })
    }, totalMs)

    return () => {
      if (intervalId !== null) {
        window.clearInterval(intervalId)
      }
      window.clearTimeout(timeoutId)
    }
  }, [game, rules, isReactionTimerOwner, isFutureRevealWindowActive])

  useEffect(() => {
    if (!game) {
      return
    }

    const currentTail: Record<number, string> = {}
    let newFlashKey: string | null = null
    let removalFlashIndex: number | null = null

    game.players.forEach((player, index) => {
      const lastEntry = player.timeline[player.timeline.length - 1]
      const signature = `${player.timeline.length}:${lastEntry?.id ?? 'none'}`
      currentTail[index] = signature

      const previous = previousTimelineTailByPlayer.current[index]
      if (previous) {
        const previousLength = Number(previous.split(':')[0] ?? 0)
        if (player.timeline.length < previousLength) {
          removalFlashIndex = index
        }
      }

      if (previous && previous !== signature && lastEntry) {
        newFlashKey = `${index}-${lastEntry.id}`
      }
    })

    if (isFutureRevealWindowActive) {
      previousTimelineTailByPlayer.current = currentTail
      return
    }

    previousTimelineTailByPlayer.current = currentTail

    if (newFlashKey || removalFlashIndex !== null) {
      if (removalFlashIndex !== null) {
        setTimelineRemovalFlashPlayerIndex(removalFlashIndex)
      }

      setTimelineEntryFlashKey(newFlashKey)
      const timeoutId = window.setTimeout(() => {
        setTimelineEntryFlashKey(null)
        setTimelineRemovalFlashPlayerIndex(null)
      }, 700)
      return () => window.clearTimeout(timeoutId)
    }
  }, [game, isFutureRevealWindowActive])

  const dispatchGameAction = (
    action: GameAction,
    options?: {
      proxyNickname?: string
      bypassUserInputLock?: boolean
    },
  ) => {
    if (!rules) {
      return
    }

    if (isFutureRevealWindowActive) {
      return
    }

    const bypassUserInputLock = Boolean(options?.bypassUserInputLock)
    const unlockUserActionInput = () => {
      userActionLockRef.current = false
      if (userActionLockTimeoutRef.current !== null) {
        window.clearTimeout(userActionLockTimeoutRef.current)
        userActionLockTimeoutRef.current = null
      }
    }

    if (!bypassUserInputLock && userActionLockRef.current) {
      return
    }

    if (!bypassUserInputLock) {
      userActionLockRef.current = true
      if (userActionLockTimeoutRef.current !== null) {
        window.clearTimeout(userActionLockTimeoutRef.current)
      }
      userActionLockTimeoutRef.current = window.setTimeout(() => {
        userActionLockRef.current = false
        userActionLockTimeoutRef.current = null
      }, USER_ACTION_LOCK_MS)
    }

    const networkAction: GameAction =
      (action.type === 'cancel_reaction' || action.type === 'pass_reaction') && localPlayerIndex >= 0
        ? { ...action, playerIndex: localPlayerIndex }
        : action

    if (networkMatchActive && roomInfo) {
      const canHostProxyDisconnectedSeat = isLocalHost && isDisconnectedSeatTurn
      const canIssueReactionCancel = action.type === 'cancel_reaction' && canLocalCancelReactionNow
      const canIssueReactionPass = action.type === 'pass_reaction' && isReactionTimerOwner
      if (!isLocalController && !canHostProxyDisconnectedSeat && !canIssueReactionCancel && !canIssueReactionPass) {
        if (!bypassUserInputLock) {
          unlockUserActionInput()
        }
        return
      }
      sendLanMessage({ type: 'game_action_request', action: networkAction, meta: options ?? null })
      return
    }

    setGame((current) => {
      if (!current) {
        if (!bypassUserInputLock) {
          unlockUserActionInput()
        }
        return current
      }
      const updated = applyGameAction(current, rules, networkAction)
      if (updated === current && !bypassUserInputLock) {
        unlockUserActionInput()
      }
      markRecentAction(current.currentPlayerIndex, networkAction, current, updated)
      pushTurnLog(current, networkAction, undefined, updated)
      return updated
    })
  }

  useEffect(() => {
    if (!userActionLockRef.current) {
      return
    }
    userActionLockRef.current = false
    if (userActionLockTimeoutRef.current !== null) {
      window.clearTimeout(userActionLockTimeoutRef.current)
      userActionLockTimeoutRef.current = null
    }
  }, [game])

  useEffect(() => {
    return () => {
      if (userActionLockTimeoutRef.current !== null) {
        window.clearTimeout(userActionLockTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!game || !rules || !activePlayer || game.winner || !activePlayer.isBot || networkMatchActive || isFutureRevealWindowActive) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setGame((current) => {
        if (!current || !rules) {
          return current
        }

        const actorIndex = current.currentPlayerIndex
        const currentPlayer = current.players[current.currentPlayerIndex]
        if (!currentPlayer?.isBot || current.winner) {
          return current
        }

        if (current.phase === 'PLAYER_CHOICE') {
          const playableCards = currentPlayer.hand.filter((cardId) =>
            canPlayCardFromHand(cardId, currentPlayer.hand, current, current.currentPlayerIndex),
          )
          if (playableCards.length === 0) {
            const action: GameAction = { type: 'draw_end_turn' }
            const updated = applyGameAction(current, rules, action)
            markRecentAction(actorIndex, action, current, updated)
            pushTurnLog(current, action, currentPlayer.name, updated)
            return updated
          }
          const shouldDraw = Math.random() < BALANCED_DRAW_CHANCE
          if (shouldDraw) {
            const action: GameAction = { type: 'draw_end_turn' }
            const updated = applyGameAction(current, rules, action)
            markRecentAction(actorIndex, action, current, updated)
            pushTurnLog(current, action, currentPlayer.name, updated)
            return updated
          }
          const chosenCard = playableCards[Math.floor(Math.random() * playableCards.length)]
          const action: GameAction = { type: 'play_card', cardId: chosenCard }
          const updated = applyGameAction(current, rules, action)
          markRecentAction(actorIndex, action, current, updated)
          pushTurnLog(current, action, currentPlayer.name, updated)
          return updated
        }

        if (current.phase === 'REACTION_WINDOW' && current.pendingPlay?.nextResponder === current.currentPlayerIndex) {
          const canCancel = canCurrentReactorCancel(current)
          if (canCancel && Math.random() < BALANCED_CANCEL_CHANCE) {
            const action: GameAction = { type: 'cancel_reaction' }
            const updated = applyGameAction(current, rules, action)
            markRecentAction(actorIndex, action, current, updated)
            pushTurnLog(current, action, currentPlayer.name, updated)
            return updated
          }
          const action: GameAction = { type: 'pass_reaction' }
          const updated = applyGameAction(current, rules, action)
          markRecentAction(actorIndex, action, current, updated)
          pushTurnLog(current, action, currentPlayer.name, updated)
          return updated
        }

        if (current.phase === 'DISCARD_SELECTION' && current.pendingDiscard?.playerIndex === current.currentPlayerIndex) {
          const hand = currentPlayer.hand
          if (hand.length === 0) {
            return current
          }
          const chosenDiscard = hand[Math.floor(Math.random() * hand.length)]
          const action: GameAction = { type: 'discard_pending_event', cardId: chosenDiscard }
          const updated = applyGameAction(current, rules, action)
          markRecentAction(actorIndex, action, current, updated)
          pushTurnLog(current, action, currentPlayer.name, updated)
          return updated
        }

        if (current.phase === 'ACTION_SELECTION') {
          const targets = getSelectableActionTargets(current)
          if (targets.length === 0) {
            return current
          }
          const chosenTarget = targets[Math.floor(Math.random() * targets.length)]
          if (current.pendingActionSelection?.actionName === 'future_peek') {
            const action: GameAction = { type: 'select_future_target', targetPlayerIndex: chosenTarget }
            const updated = applyGameAction(current, rules, action)
            markRecentAction(actorIndex, action, current, updated)
            pushTurnLog(current, action, currentPlayer.name, updated)
            return updated
          }
          const action: GameAction = { type: 'select_action_target', cardId: chosenTarget }
          const updated = applyGameAction(current, rules, action)
          markRecentAction(actorIndex, action, current, updated)
          pushTurnLog(current, action, currentPlayer.name, updated)
          return updated
        }

        return current
      })
    }, 950)

    return () => window.clearTimeout(timeoutId)
  }, [game, rules, activePlayer, networkMatchActive, isFutureRevealWindowActive])

  useEffect(() => {
    if (!game || !rules || !networkMatchActive || !roomInfo || game.winner || isFutureRevealWindowActive) {
      return
    }

    if (!isLocalHost || !isDisconnectedSeatTurn) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      const proxyNickname = roomInfo.players[game.currentPlayerIndex]?.nickname ?? 'Disconnected player'
      if (game.phase === 'PLAYER_CHOICE') {
        const seatHand = game.players[game.currentPlayerIndex]?.hand ?? []
        const playableCards = seatHand.filter((cardId) =>
          canPlayCardFromHand(cardId, seatHand, game, game.currentPlayerIndex),
        )
        if (playableCards.length === 0) {
          dispatchGameAction({ type: 'draw_end_turn' }, { proxyNickname, bypassUserInputLock: true })
          return
        }

        const shouldDraw = Math.random() < BALANCED_DRAW_CHANCE
        if (shouldDraw) {
          dispatchGameAction({ type: 'draw_end_turn' }, { proxyNickname, bypassUserInputLock: true })
          return
        }

        const chosenCard = playableCards[Math.floor(Math.random() * playableCards.length)]
        dispatchGameAction({ type: 'play_card', cardId: chosenCard }, { proxyNickname, bypassUserInputLock: true })
        return
      }

      if (game.phase === 'REACTION_WINDOW' && game.pendingPlay?.nextResponder === game.currentPlayerIndex) {
        const canCancel = canCurrentReactorCancel(game)
        if (canCancel && Math.random() < BALANCED_CANCEL_CHANCE) {
          dispatchGameAction({ type: 'cancel_reaction' }, { proxyNickname, bypassUserInputLock: true })
          return
        }
        dispatchGameAction({ type: 'pass_reaction' }, { proxyNickname, bypassUserInputLock: true })
        return
      }

      if (game.phase === 'DISCARD_SELECTION' && game.pendingDiscard?.playerIndex === game.currentPlayerIndex) {
        const hand = game.players[game.currentPlayerIndex]?.hand ?? []
        if (hand.length === 0) {
          return
        }
        const chosenDiscard = hand[Math.floor(Math.random() * hand.length)]
        dispatchGameAction({ type: 'discard_pending_event', cardId: chosenDiscard }, { proxyNickname, bypassUserInputLock: true })
        return
      }

      if (game.phase === 'ACTION_SELECTION') {
        const targets = getSelectableActionTargets(game)
        if (targets.length === 0) {
          return
        }
        const chosenTarget = targets[Math.floor(Math.random() * targets.length)]
        if (game.pendingActionSelection?.actionName === 'future_peek') {
          dispatchGameAction({ type: 'select_future_target', targetPlayerIndex: chosenTarget }, { proxyNickname, bypassUserInputLock: true })
          return
        }
        dispatchGameAction({ type: 'select_action_target', cardId: chosenTarget }, { proxyNickname, bypassUserInputLock: true })
      }
    }, 1100)

    return () => window.clearTimeout(timeoutId)
  }, [game, rules, networkMatchActive, roomInfo, isLocalHost, isDisconnectedSeatTurn, isFutureRevealWindowActive])

  if (!rules) {
    return (
      <main className="app-shell app-home">
        <section className="home-hero home-loading">
          <div className="home-hero-copy">
            <h1>Temporis</h1>
            <p>{language === 'pt' ? 'Preparando experiência de jogo...' : 'Preparing game experience...'}</p>
          </div>
        </section>
      </main>
    )
  }

  if (networkLoadingBarrierActive && roomInfo) {
    const requiredCount = roomInfo.loadingRequiredPlayerIndexes.length
    const readyCount = roomInfo.loadingReadyPlayerIndexes.length

    return (
      <main className="app-shell app-home">
        <section className="home-hero">
          <div className="home-hero-copy">
            <h1>{rules.game.name}</h1>
            <p>{language === 'pt' ? 'Sala em preparação' : 'Room preparing'}</p>
          </div>
          <div className="home-hero-badges">
            <span className="home-chip">
              <span className="ui-icon chip-status" aria-hidden="true" />
              {language === 'pt' ? 'Rede' : 'Network'}: {networkStatus}
            </span>
          </div>
        </section>

        <section className="home-grid single">
          <article className="status-panel setup-card">
            <div className="setup-card-title-row">
              <h2>{language === 'pt' ? 'Sincronização de assets' : 'Asset synchronization'}</h2>
            </div>
            <div className="setup-stat-grid compact">
              <div className="setup-stat-tile">
                <span>{language === 'pt' ? 'Seu preload' : 'Your preload'}</span>
                <strong>{cardAssetsLoadProgress}% {cardAssetsReady ? '✅' : '⏳'}</strong>
              </div>
              <div className="setup-stat-tile">
                <span>{language === 'pt' ? 'Prontos' : 'Ready players'}</span>
                <strong>{readyCount}/{requiredCount}</strong>
              </div>
            </div>
            <ol className="room-list players" style={{ marginTop: '0.55rem' }}>
            {roomInfo.loadingRequiredPlayerIndexes.map((playerIndex) => {
              const player = roomInfo.players[playerIndex]
              if (!player) {
                return null
              }
              const isReady = roomInfo.loadingReadyPlayerIndexes.includes(playerIndex)
              return (
                <li key={`${player.nickname}-${playerIndex}`}>
                  {player.nickname} {isReady ? (language === 'pt' ? '✅ pronto' : '✅ ready') : language === 'pt' ? '⏳ carregando' : '⏳ loading'}
                </li>
              )
            })}
            </ol>
          </article>
        </section>
      </main>
    )
  }

  if (!game || !activePlayer) {
    if (networkMatchActive) {
      return (
        <main className="app-shell app-home">
          <section className="home-hero">
            <div className="home-hero-copy">
              <h1>{rules.game.name}</h1>
              <p>{language === 'pt' ? 'Sincronizando partida online' : 'Synchronizing online match'}</p>
            </div>
            <div className="home-hero-badges">
              <span className="home-chip">
                <span className="ui-icon chip-sync" aria-hidden="true" />
                Seq: {lastAppliedActionSeq}
              </span>
            </div>
          </section>

          <section className="home-grid single">
            <article className="status-panel setup-card">
              <div className="setup-card-title-row">
                <h2>{language === 'pt' ? 'Aguardando host' : 'Waiting for host'}</h2>
              </div>
              <div className="setup-stat-grid compact">
                <div className="setup-stat-tile">
                  <span>{language === 'pt' ? 'Status' : 'Status'}</span>
                  <strong>{language === 'pt' ? 'Aguardando snapshot do host' : 'Waiting for host snapshot'}</strong>
                </div>
                <div className="setup-stat-tile">
                  <span>{language === 'pt' ? 'Rede' : 'Network'}</span>
                  <strong>{networkStatus}</strong>
                </div>
              </div>
            {networkError && (
              <div className="setup-error-line" style={{ marginTop: '0.5rem' }}>
                <strong>{language === 'pt' ? 'Erro:' : 'Error:'}</strong> {networkError}
              </div>
            )}
            </article>
          </section>
        </main>
      )
    }

    return (
      <main className="app-shell app-home">
        <section className="home-hero">
          <div className="home-hero-copy">
            <h1>{rules.game.name}</h1>
            <p>{language === 'pt' ? 'Experiência digital de estratégia temporal' : 'Digital time-strategy experience'}</p>
          </div>
          <div className="home-hero-badges">
            <span className="home-chip">
              <span className="ui-icon chip-players" aria-hidden="true" />
              {language === 'pt' ? 'Jogadores' : 'Players'}: {totalPlayers}
            </span>
            <span className="home-chip">
              <span className="ui-icon chip-status" aria-hidden="true" />
              {cardAssetsLoadProgress}%
            </span>
          </div>
        </section>

        <section className="home-grid">
          <article className="status-panel setup-card local">
            <div className="setup-card-title-row">
              <h2>{language === 'pt' ? 'Partida Local' : 'Local Match'}</h2>
              <span className="setup-card-pill">AI</span>
            </div>

            <div className="setup-form-grid two">
              <label>
                <span>{language === 'pt' ? 'Idioma' : 'Language'}</span>
                <select value={language} onChange={(event) => setLanguage(event.target.value as Locale)}>
                  <option value="en">English</option>
                  <option value="pt">Português</option>
                </select>
              </label>
              <label>
                <span>{language === 'pt' ? 'Total de jogadores' : 'Total players'}</span>
                <select value={totalPlayers} onChange={(event) => setTotalPlayers(Number(event.target.value))}>
                  {[2, 3, 4, 5, 6].map((count) => (
                    <option key={count} value={count}>
                      {count}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="setup-stat-grid">
              <div className="setup-stat-tile">
                <span>{language === 'pt' ? 'Humanos' : 'Humans'}</span>
                <strong>1 ({language === 'pt' ? 'Você' : 'You'})</strong>
              </div>
              <div className="setup-stat-tile">
                <span>Bots</span>
                <strong>{totalPlayers - 1}</strong>
              </div>
              <div className="setup-stat-tile">
                <span>{language === 'pt' ? 'Recursos' : 'Assets'}</span>
                <strong>{cardAssetsLoadProgress}% {cardAssetsReady ? '✅' : '⏳'}</strong>
              </div>
            </div>

            <div className="actions" style={{ marginTop: '0.75rem' }}>
              <button
                type="button"
                onClick={() => {
                  resetMatchUiState()
                  setGame(
                    createInitialGame({
                      startingHand: rules.setup.standard.starting_hand,
                      startingTimeline: rules.setup.standard.starting_timeline,
                      totalPlayers,
                      botCount: totalPlayers - 1,
                    }),
                  )
                }}
              >
                {language === 'pt' ? 'Iniciar Partida' : 'Start Match'}
              </button>
            </div>
          </article>

          <article className="status-panel setup-card lan">
            <div className="setup-card-title-row">
              <h2>LAN Lobby (Radmin VPN)</h2>
              <span className="setup-card-pill">WS</span>
            </div>

            <div className="setup-form-grid">
              <label>
                <span>Server WS URL</span>
                <div className="inline-input-row">
                  <input value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} />
                  <button type="button" onClick={connectLan}>
                    {language === 'pt' ? 'Conectar' : 'Connect'}
                  </button>
                </div>
              </label>
              <label>
                <span>{language === 'pt' ? 'Apelido' : 'Nickname'}</span>
                <input value={nickname} onChange={(event) => setNickname(event.target.value)} maxLength={20} />
              </label>
            </div>

            <div className="setup-stat-grid compact">
              <div className="setup-stat-tile">
                <span>{language === 'pt' ? 'Status de rede' : 'Network status'}</span>
                <strong>{networkStatus}</strong>
              </div>
              <div className="setup-stat-tile">
                <span>{language === 'pt' ? 'Recursos' : 'Assets'}</span>
                <strong>{cardAssetsLoadProgress}% {cardAssetsReady ? '✅' : '⏳'}</strong>
              </div>
            </div>

            <div className="actions" style={{ marginTop: '0.65rem' }}>
              <button type="button" onClick={hostLanRoom}>
                {language === 'pt' ? 'Hospedar Sala' : 'Host Room'}
              </button>
              <input
                placeholder={language === 'pt' ? 'Código da sala' : 'Room code'}
                value={roomCodeInput}
                onChange={(event) => setRoomCodeInput(event.target.value.toUpperCase())}
                maxLength={6}
              />
              <button type="button" onClick={joinLanRoom}>
                {language === 'pt' ? 'Entrar na Sala' : 'Join Room'}
              </button>
              {roomInfo && (
                <button type="button" onClick={leaveLanRoom}>
                  {language === 'pt' ? 'Sair da Sala' : 'Leave Room'}
                </button>
              )}
            </div>

            {networkError && (
              <div className="setup-error-line" style={{ marginTop: '0.5rem' }}>
                <strong>{language === 'pt' ? 'Erro:' : 'Error:'}</strong> {networkError}
              </div>
            )}

            {roomInfo && (
              <div className="room-block" style={{ marginTop: '0.75rem' }}>
                <div className="room-line">
                  <strong>{language === 'pt' ? 'Sala:' : 'Room:'}</strong> {roomInfo.roomCode}
                </div>
                <div className="room-line">
                  <strong>{language === 'pt' ? 'Jogadores' : 'Players'} ({roomInfo.players.length}/6):</strong>
                </div>
                <ol className="room-list players">
                  {roomInfo.players.map((player, index) => (
                    <li key={`${player.nickname}-${index}`}>
                      {player.nickname}
                      {player.clientId !== null ? '' : language === 'pt' ? ' (Desconectado)' : ' (Disconnected)'}
                      {player.clientId !== null && player.clientId === roomInfo.hostClientId ? language === 'pt' ? ' (Host)' : ' (Host)' : ''}
                      {player.clientId !== null && player.clientId === networkClientId ? language === 'pt' ? ' (Você)' : ' (You)' : ''}
                      {roomInfo.loadingInProgress && roomInfo.loadingRequiredPlayerIndexes.includes(index)
                        ? roomInfo.loadingReadyPlayerIndexes.includes(index)
                          ? language === 'pt'
                            ? ' · ✅ Recursos prontos'
                            : ' · ✅ Assets ready'
                          : language === 'pt'
                            ? ' · ⏳ Carregando recursos'
                            : ' · ⏳ Loading assets'
                        : ''}
                    </li>
                  ))}
                </ol>

                {roomInfo.spectators.length > 0 && (
                  <>
                    <div className="room-line" style={{ marginTop: '0.45rem' }}>
                      <strong>{language === 'pt' ? 'Espectadores' : 'Spectators'} ({roomInfo.spectators.length}):</strong>
                    </div>
                    <ol className="room-list spectators">
                      {roomInfo.spectators.map((spectator) => (
                        <li key={spectator.clientId}>
                          {spectator.nickname}
                          {spectator.clientId === networkClientId ? (language === 'pt' ? ' (Você)' : ' (You)') : ''}
                        </li>
                      ))}
                    </ol>
                  </>
                )}

                {roomInfo.hostClientId === networkClientId && (
                  <div className="actions" style={{ marginTop: '0.7rem' }}>
                    <button
                      type="button"
                      onClick={() => {
                        const roster = roomInfo.players
                          .filter((player) => player.connected && player.clientId)
                          .slice(0, 6)
                          .map((player) => ({
                            clientId: player.clientId as string,
                            nickname: player.nickname,
                          }))
                        if (roster.length < 2) {
                          setNetworkError(
                            language === 'pt'
                              ? 'Você precisa de pelo menos 2 jogadores conectados para iniciar.'
                              : 'Need at least 2 connected players to start.',
                          )
                          return
                        }
                        sendLanMessage({ type: 'start_game', payload: { playerRoster: roster } })
                      }}
                    >
                      {language === 'pt' ? 'Iniciar partida com jogadores da sala' : 'Start Match with Room Players'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </article>
        </section>
      </main>
    )
  }

  const onPlayCard = (cardId: number) => {
    dispatchGameAction({ type: 'play_card', cardId })
  }

  const onDrawCard = () => {
    dispatchGameAction({ type: 'draw_end_turn' })
  }

  const onRestart = () => {
    resetMatchUiState()
    setGame(
      createInitialGame({
        startingHand: rules.setup.standard.starting_hand,
        startingTimeline: rules.setup.standard.starting_timeline,
        totalPlayers,
        botCount: totalPlayers - 1,
      }),
    )
  }

  const onPlayAgain = () => {
    if (!networkMatchActive) {
      onRestart()
      return
    }

    if (!roomInfo || roomInfo.hostClientId !== networkClientId) {
      return
    }

    sendLanMessage({ type: 'restart_game' })
  }

  const onRematchVote = (accept: boolean) => {
    if (!networkMatchActive) {
      if (accept) {
        onPlayAgain()
      }
      return
    }

    setLocalRematchDecision(accept ? 'accept' : 'decline')
    sendLanMessage({ type: 'rematch_vote', accept })
  }

  const onSendChat = () => {
    const text = chatInput.trim()
    if (!text) {
      return
    }

    if (networkMatchActive) {
      sendLanMessage({ type: 'chat_message', text })
    } else {
      pushChatMessage(nickname || (language === 'pt' ? 'Você' : 'You'), text)
    }
    setChatInput('')
  }

  const visibleActionLog =
    logFilter === 'all'
      ? actionTurnLog
      : actionTurnLog.filter((entry) => entry.turn === turnCounterRef.current)

  const onResolvePending = () => {
    dispatchGameAction({ type: 'pass_reaction' })
  }

  const onCancelPending = () => {
    dispatchGameAction({ type: 'cancel_reaction' })
  }

  const onDiscardForEvent = (cardId: number) => {
    dispatchGameAction({ type: 'discard_pending_event', cardId })
  }

  const onSelectActionTarget = (cardId: number) => {
    dispatchGameAction({ type: 'select_action_target', cardId })
  }

  const onSelectFutureTarget = (targetPlayerIndex: number) => {
    dispatchGameAction({ type: 'select_future_target', targetPlayerIndex })
  }

  const canControlPendingDiscard = !networkMatchActive || game.pendingDiscard?.playerIndex === localPlayerIndex
  const canControlPendingActionSelection =
    !networkMatchActive || game.pendingActionSelection?.playerIndex === localPlayerIndex
  const selectableActionCardIds = canControlPendingActionSelection ? getSelectableActionTargets(game) : []
  const selfPlayerIndex = networkMatchActive && localPlayerIndex >= 0 ? localPlayerIndex : 0
  const hasSelfPanel = selfPlayerIndex >= 0 && selfPlayerIndex < game.players.length
  const opponentIndices = hasSelfPanel
    ? Array.from({ length: Math.max(0, game.players.length - 1) }, (_, offset) =>
        (selfPlayerIndex + offset + 1) % game.players.length,
      )
    : game.players.map((_, index) => index)

  const selfPlayer = hasSelfPanel ? game.players[selfPlayerIndex] : null
  const localRematchVote =
    networkMatchActive && localPlayerIndex >= 0
      ? roomInfo?.rematchVotes.find((entry) => entry.playerIndex === localPlayerIndex)?.accept ?? null
      : null
  const isLocalSeatTurn = localPlayerIndex >= 0 && game.currentPlayerIndex === localPlayerIndex
  const isYourTurn = !game.winner && (!networkMatchActive ? game.currentPlayerIndex === 0 : isLocalSeatTurn)
  const activeTurnName = game.players[game.currentPlayerIndex]?.name ?? (language === 'pt' ? 'Jogador' : 'Player')
  const selfActivityLabel = hasSelfPanel ? getPlayerActivityLabel(game, selfPlayerIndex, language) : null
  const selfActivityKind = hasSelfPanel ? getPlayerActivityKind(game, selfPlayerIndex) : null
  const tablePrompt = getTablePrompt(game, language)
  const isPlayerTargetSelection =
    game.phase === 'ACTION_SELECTION' &&
    Boolean(game.pendingActionSelection) &&
    canControlPendingActionSelection &&
    (game.pendingActionSelection?.actionName === 'future_peek' ||
      (game.pendingActionSelection?.actionName === 'paradox_swap' &&
        game.pendingActionSelection?.step === 'choose_target'))
  const isCardTargetSelection =
    game.phase === 'ACTION_SELECTION' && Boolean(game.pendingActionSelection) && canControlPendingActionSelection && !isPlayerTargetSelection
  const isSelfPlayWindow =
    selfPlayerIndex === game.currentPlayerIndex &&
    !game.winner &&
    game.phase === 'PLAYER_CHOICE' &&
    selfPlayer !== null &&
    !selfPlayer.isBot &&
    (!networkMatchActive || selfPlayerIndex === localPlayerIndex)
  const isSelfDiscardWindow =
    game.phase === 'DISCARD_SELECTION' &&
    game.pendingDiscard?.playerIndex === selfPlayerIndex &&
    canControlPendingDiscard
  const isSelfHandTargetSelection =
    game.phase === 'ACTION_SELECTION' &&
    isCardTargetSelection &&
    canControlPendingActionSelection &&
    game.pendingActionSelection?.playerIndex === selfPlayerIndex &&
    selfPlayer !== null &&
    selfPlayer.hand.some((cardId) => selectableActionCardIds.includes(cardId))
  const showSelfHandRow = selfPlayer !== null
  const isTimelineSelectionActive = isCardTargetSelection && isLocalController && !isFutureRevealWindowActive
  const latestDiscardCardId = game.discardPile.length > 0 ? game.discardPile[game.discardPile.length - 1] : null
  const discardCascadeCards = game.discardPile.slice(-5).reverse()
  const safeStatusText = redactDrawDetails(game.statusText)

  const displayedSelfHand: Array<{ cardId: number; groupKey: string }> = selfPlayer
    ? [...selfPlayer.hand]
        .sort((left, right) => {
          const leftGroup = getCardGroupKey(left)
          const rightGroup = getCardGroupKey(right)
          const groupDiff = (CARD_GROUP_ORDER[leftGroup] ?? 99) - (CARD_GROUP_ORDER[rightGroup] ?? 99)
          if (groupDiff !== 0) {
            return groupDiff
          }
          return left - right
        })
        .map((cardId) => ({ cardId, groupKey: getCardGroupKey(cardId) }))
    : []

  const getHandLayoutMetrics = (total: number): { cardWidth: number; overlapSame: string; overlapDiff: string } => {
    if (total <= 7) {
      return { cardWidth: 132, overlapSame: '-36px', overlapDiff: '-22px' }
    }
    if (total <= 10) {
      return { cardWidth: 120, overlapSame: '-52px', overlapDiff: '-40px' }
    }
    if (total <= 13) {
      return { cardWidth: 108, overlapSame: '-64px', overlapDiff: '-54px' }
    }
    if (total <= 16) {
      return { cardWidth: 96, overlapSame: '-74px', overlapDiff: '-64px' }
    }
    return { cardWidth: 88, overlapSame: '-80px', overlapDiff: '-72px' }
  }

  const selfHandLayout = getHandLayoutMetrics(displayedSelfHand.length)

  const getOpponentSeatPlacement = (seatOrder: number, total: number): { left: number; top: number } => {
    const layouts: Record<number, Array<{ left: number; top: number }>> = {
      1: [{ left: 50, top: 18 }],
      2: [
        { left: 30, top: 18 },
        { left: 70, top: 18 },
      ],
      3: [
        { left: 18, top: 24 },
        { left: 50, top: 14 },
        { left: 82, top: 24 },
      ],
      4: [
        { left: 14, top: 32 },
        { left: 33, top: 14 },
        { left: 67, top: 14 },
        { left: 86, top: 32 },
      ],
      5: [
        { left: 12, top: 39 },
        { left: 25, top: 16 },
        { left: 50, top: 10 },
        { left: 75, top: 16 },
        { left: 88, top: 39 },
      ],
    }

    const fallback = { left: 50, top: 18 }
    const seat = layouts[total]?.[seatOrder] ?? fallback
    return seat
  }

  const getFanTransformStyle = (index: number, total: number): CSSProperties => {
    if (total <= 1) {
      return { ['--fan-transform' as any]: 'translateY(0px) rotate(0deg)', ['--fan-z' as any]: 2 }
    }

    const center = (total - 1) / 2
    const distanceFromCenter = index - center
    const rotation = Math.max(-18, Math.min(18, distanceFromCenter * 3.1))
    const drop = Math.min(20, Math.abs(distanceFromCenter) * 2.4)
    return {
      ['--fan-transform' as any]: `translateY(${drop}px) rotate(${rotation}deg)`,
      ['--fan-z' as any]: Math.round(100 - Math.abs(distanceFromCenter) * 5),
    }
  }

  const renderPromptSub = (
    kind: 'timer' | 'discard' | 'player' | 'hand' | 'timeline' | 'future',
    text: string,
  ) => (
    <div className={`table-prompt-sub ${kind}`}>
      <span className={`ui-icon prompt-${kind}`} aria-hidden="true" />
      {text}
    </div>
  )

  const renderOpponentSeat = (index: number, seatOrder: number) => {
    const player = game.players[index]
    const activityLabel = getPlayerActivityLabel(game, index, language)
    const activityKind = getPlayerActivityKind(game, index)
    const isActing = Boolean(activityLabel)
    const seatPlacement = getOpponentSeatPlacement(seatOrder, opponentIndices.length)
    const isSeatTargetable = isPlayerTargetSelection && selectableActionCardIds.includes(index)
    const canClickSeatTarget = isSeatTargetable && isLocalController && !isFutureRevealWindowActive

    const canSelectTimelineCardsFromSeat = isTimelineSelectionActive

    return (
      <div
        key={`seat-${player.id}`}
        className={`seat-node ${isActing ? 'active' : ''} ${isSeatTargetable ? 'targetable' : ''}`}
        data-seat-player={index}
        style={{
          ['--seat-left' as any]: `${seatPlacement.left}%`,
          ['--seat-top' as any]: `${seatPlacement.top}%`,
        }}
        onClick={canClickSeatTarget ? () => onSelectFutureTarget(index) : undefined}
      >
        <div className="seat-chip">
          <div className="seat-name-row">
            <strong>{player.name}</strong>
            {activityLabel && <span className={`turn-badge ${activityKind ? `activity-${activityKind}` : ''}`}>{activityLabel}</span>}
          </div>
          <div className="seat-meta">
            {player.hand.length} {language === 'pt' ? 'cartas' : 'cards'} · {getEraPoints(game, index)}{' '}
            {language === 'pt' ? 'era' : 'era'}
          </div>
          <div
            className={`seat-timeline ${player.timeline.length === 0 ? 'empty' : ''} ${timelineRemovalFlashPlayerIndex === index ? 'timeline-removal-pulse' : ''} ${timelineTargetCue?.targetPlayerIndex === index ? `timeline-target-zone ${timelineTargetCue.direction}` : ''} ${canSelectTimelineCardsFromSeat ? 'selection-active' : ''}`}
            data-empty-label={language === 'pt' ? 'Timeline vazia' : 'Empty timeline'}
          >
            {player.timeline.map((entry) => (
              (() => {
                const isSelectableTimelineCard = canSelectTimelineCardsFromSeat && selectableActionCardIds.includes(entry.id)
                return (
              <img
                key={`${entry.id}-${entry.era}`}
                data-timeline-card-player={index}
                data-timeline-card-id={entry.id}
                className={`timeline-card ${timelineEntryFlashKey === `${index}-${entry.id}` ? 'timeline-entry-enter' : ''} ${isSelectableTimelineCard ? 'targetable-card' : ''} ${timelineTargetCue?.targetPlayerIndex === index && timelineTargetCue?.targetCardId === entry.id ? `timeline-target-hit ${timelineTargetCue.direction}` : ''}`}
                src={getPreferredCardImageUrl(entry.id)}
                data-fallback-src={getCardPngUrl(entry.id)}
                alt={`Timeline card ${entry.id}`}
                title={isSelectableTimelineCard ? (language === 'pt' ? 'Clique para escolher esta carta da timeline' : 'Click to target this timeline card') : undefined}
                onError={handleCardImageError}
                onClick={
                  isSelectableTimelineCard
                    ? () => onSelectActionTarget(entry.id)
                    : undefined
                }
              />
                )
              })()
            ))}
          </div>
          {recentPlayerAction && recentPlayerAction.playerIndex === index && (
            <div className="player-action-cue">{recentPlayerAction.text}</div>
          )}
        </div>
      </div>
    )
  }

  return (
    <main className={`app-shell ${isFocusMode ? 'focus-mode' : ''}`}>
      {!isFocusMode && (
      <>
      <header className="top-bar">
        <div>
          <h1>{rules.game.name} — {language === 'pt' ? 'Protótipo Digital' : 'Digital Prototype'}</h1>
          <p>{rules.game.description}</p>
        </div>
        <div className="actions">
          {networkMatchActive && (
            <button type="button" onClick={requestSnapshot}>
              {language === 'pt' ? 'Ressincronizar Snapshot' : 'Resync Snapshot'}
            </button>
          )}
          <button type="button" onClick={onRestart} disabled={networkMatchActive}>
            {language === 'pt' ? 'Nova Partida' : 'New Match'}
          </button>
          <button type="button" onClick={() => setIsFocusMode(true)}>
            {language === 'pt' ? 'Foco na mesa' : 'Focus table'}
          </button>
        </div>
      </header>

      <section className="status-panel compact-hud">
        <div className="hud-primary-row">
          <span className={`hud-turn-pill ${isYourTurn ? 'self' : ''}`}>
            <span className={`ui-icon ${isYourTurn ? 'turn-self' : 'turn-other'}`} aria-hidden="true" />
            {isYourTurn
              ? language === 'pt'
                ? 'Sua vez'
                : 'Your turn'
              : language === 'pt'
                ? `Vez de ${activeTurnName}`
                : `${activeTurnName}'s turn`}
          </span>
          <span className="hud-chip" data-kind="phase">
            <span className="ui-icon chip-phase" aria-hidden="true" />
            <strong>{language === 'pt' ? 'Fase:' : 'Phase:'}</strong> {game.phase}
          </span>
          <span className="hud-chip" data-kind="deck">
            <span className="ui-icon chip-deck" aria-hidden="true" />
            <strong>{language === 'pt' ? 'Baralho:' : 'Deck:'}</strong> {game.deck.length}
          </span>
        </div>
        <div className="hud-status-line" title={safeStatusText}>
          <span className="ui-icon chip-status" aria-hidden="true" />
          <strong>{language === 'pt' ? 'Status:' : 'Status:'}</strong> {safeStatusText}
        </div>
        {isFutureRevealWindowActive && (
          <div className="global-lock-banner" style={{ marginTop: '0.55rem' }}>
            {language === 'pt'
              ? `Revelação do Futuro em andamento. Próxima ação libera em ${futureRevealSecondsLeft}s.`
              : `Future reveal in progress. Next action unlocks in ${futureRevealSecondsLeft}s.`}
          </div>
        )}
        <div className="hud-chip-row hud-secondary-row">
          <span className="hud-chip" data-kind="players">
            <span className="ui-icon chip-players" aria-hidden="true" />
            <strong>{language === 'pt' ? 'Jogadores:' : 'Players:'}</strong> {game.players.length}
          </span>
          <span className="hud-chip" data-kind="discard">
            <span className="ui-icon chip-discard" aria-hidden="true" />
            <strong>{language === 'pt' ? 'Descarte:' : 'Discard:'}</strong> {game.discardPile.length}
          </span>
          {networkMatchActive && (
            <span className="hud-chip" data-kind="sync">
              <span className="ui-icon chip-sync" aria-hidden="true" />
              <strong>Sync:</strong> {lastAppliedActionSeq}
            </span>
          )}
          {game.winner && (
            <span className="hud-chip" data-kind="winner">
              <span className="ui-icon chip-winner" aria-hidden="true" />
              <strong>{language === 'pt' ? 'Vencedor:' : 'Winner:'}</strong> {game.winner}
            </span>
          )}
        </div>
        {networkMatchActive && isDisconnectedSeatTurn && game && roomInfo && (
          <div className="hud-warning-line">
            <span className="ui-icon chip-warning" aria-hidden="true" />
            <strong>{language === 'pt' ? 'Bot proxy:' : 'Proxy bot:'}</strong>{' '}
            {language === 'pt'
              ? `${roomInfo.players[game.currentPlayerIndex]?.nickname} está desconectado. O host está jogando automaticamente este turno (perfil: ${BOT_PROFILE}).`
              : `${roomInfo.players[game.currentPlayerIndex]?.nickname} is disconnected. Host is auto-playing this turn (profile: ${BOT_PROFILE}).`}
          </div>
        )}
      </section>
      </>
      )}

      <section className={`table-layout table-mode ${game.winner ? 'game-over-dim' : ''}`}>
        <div ref={tableBoardRef} className={`table-board count-${opponentIndices.length}`}>
          {isFocusMode && (
            <button type="button" className="focus-toggle-floating" onClick={() => setIsFocusMode(false)}>
              {language === 'pt' ? 'Sair do foco' : 'Exit focus'}
            </button>
          )}
          <div
            className={`resource-pile deck ${game.deck.length > 2 ? 'stack-deep' : game.deck.length > 1 ? 'stack-mid' : ''}`}
          >
            <div className="resource-count">{game.deck.length}</div>
            <div
              className="resource-card-shell facedown"
              data-resource-anchor="deck"
              title={language === 'pt' ? 'Topo do baralho (virada para baixo)' : 'Top of deck (face down)'}
            >
              <img src="/ui-skins/card_back.webp" alt={language === 'pt' ? 'Carta virada para baixo' : 'Face-down card'} />
            </div>
            <div className="resource-label">
              <span className="ui-icon anchor-deck" aria-hidden="true" />
              Deck
            </div>
          </div>
          <div
            ref={discardPileRef}
            className={`resource-pile discard ${game.discardPile.length > 2 ? 'stack-deep' : game.discardPile.length > 1 ? 'stack-mid' : ''}`}
          >
            <button
              type="button"
              className={`resource-discard-trigger ${isDiscardCascadeOpen ? 'open' : ''}`}
              onClick={() => setIsDiscardCascadeOpen((value) => !value)}
              aria-expanded={isDiscardCascadeOpen}
              aria-label={
                language === 'pt'
                  ? 'Mostrar últimas cartas do descarte'
                  : 'Show latest discarded cards'
              }
              disabled={game.discardPile.length === 0}
            >
              <div className="resource-count">{game.discardPile.length}</div>
              <div
                className="resource-card-shell"
                data-resource-anchor="discard"
                title={language === 'pt' ? 'Carta mais recente no descarte' : 'Most recent discarded card'}
              >
                {latestDiscardCardId !== null ? (
                  <img
                    src={getPreferredCardImageUrl(latestDiscardCardId)}
                    data-fallback-src={getCardPngUrl(latestDiscardCardId)}
                    alt={language === 'pt' ? `Última carta descartada ${latestDiscardCardId}` : `Last discarded card ${latestDiscardCardId}`}
                    onError={handleCardImageError}
                  />
                ) : (
                  <img src="/ui-skins/card_back.webp" alt={language === 'pt' ? 'Descarte vazio' : 'Empty discard pile'} className="empty" />
                )}
              </div>
              <div className="resource-label">
                <span className="ui-icon anchor-discard" aria-hidden="true" />
                Discard
              </div>
            </button>

            <div className={`discard-cascade-panel ${isDiscardCascadeOpen ? 'open' : ''}`} aria-hidden={!isDiscardCascadeOpen}>
              {discardCascadeCards.map((cardId, index) => (
                <img
                  key={`discard-cascade-${cardId}-${index}`}
                  className="discard-cascade-card"
                  style={{ ['--cascade-index' as any]: index } as CSSProperties}
                  src={getPreferredCardImageUrl(cardId)}
                  data-fallback-src={getCardPngUrl(cardId)}
                  alt={language === 'pt' ? `Carta descartada ${cardId}` : `Discarded card ${cardId}`}
                  onError={handleCardImageError}
                />
              ))}
            </div>
          </div>
          <div className="table-center-glow" />

          {timelineActionProjectile && (
            <div
              className={`timeline-action-projectile ${timelineActionProjectile.direction} ${timelineActionProjectileActive ? 'active' : ''}`}
              style={{
                ['--from-x' as any]: `${timelineActionProjectile.fromX}px`,
                ['--from-y' as any]: `${timelineActionProjectile.fromY}px`,
                ['--to-x' as any]: `${timelineActionProjectile.toX}px`,
                ['--to-y' as any]: `${timelineActionProjectile.toY}px`,
              }}
            >
              <img
                src={getPreferredCardImageUrl(timelineActionProjectile.sourceCardId)}
                data-fallback-src={getCardPngUrl(timelineActionProjectile.sourceCardId)}
                alt={`Action card ${timelineActionProjectile.sourceCardId}`}
                onError={handleCardImageError}
              />
            </div>
          )}

          {resourceFlowProjectile && (
            <div
              className={`resource-flow-projectile ${resourceFlowProjectile.type} ${resourceFlowProjectile.cardId ? 'with-card' : 'generic'} ${resourceFlowProjectileActive ? 'active' : ''}`}
              style={{
                ['--from-x' as any]: `${resourceFlowProjectile.fromX}px`,
                ['--from-y' as any]: `${resourceFlowProjectile.fromY}px`,
                ['--to-x' as any]: `${resourceFlowProjectile.toX}px`,
                ['--to-y' as any]: `${resourceFlowProjectile.toY}px`,
              }}
            >
              {resourceFlowProjectile.cardId ? (
                <img
                  src={getPreferredCardImageUrl(resourceFlowProjectile.cardId)}
                  data-fallback-src={getCardPngUrl(resourceFlowProjectile.cardId)}
                  alt={`Flow card ${resourceFlowProjectile.cardId}`}
                  onError={handleCardImageError}
                />
              ) : null}
            </div>
          )}

          {tableCardPreview && (
            <div
              className={`table-card-preview ${tableCardPreview.isActionCard ? 'action' : 'event'} ${tableCardPreview.emphasis === 'tnh' ? 'tnh' : ''}`}
            >
              <img
                src={getPreferredCardImageUrl(tableCardPreview.cardId)}
                data-fallback-src={getCardPngUrl(tableCardPreview.cardId)}
                alt={`Played card ${tableCardPreview.cardId}`}
                onError={handleCardImageError}
              />
              <div className="table-card-preview-label">
                {(game.players[tableCardPreview.playerIndex]?.name ?? (language === 'pt' ? 'Jogador' : 'Player'))}{' '}
                {language === 'pt' ? 'jogou' : 'played'} {tableCardPreview.headline ?? getCardDisplayName(tableCardPreview.cardId, language)}
              </div>
            </div>
          )}

          {game.winner && (
            <div className={`table-result-overlay ${showGameOverCelebration ? 'celebrate' : ''}`}>
              <div className="table-result-title">
                <span className="ui-icon trophy" aria-hidden="true" />
                {language === 'pt' ? 'Fim de Jogo' : 'Game Over'}
              </div>
              <div className="table-result-subtitle">
                {(language === 'pt' ? 'Vencedor' : 'Winner')}: {game.winner}
              </div>
              <div className="table-result-scores">
                {game.players.map((player, index) => (
                  <span key={`table-result-score-${player.id}`} className="game-over-score-chip">
                    {player.name}: {getEraPoints(game, index)}
                  </span>
                ))}
              </div>

              {networkMatchActive && roomInfo?.rematchActive ? (
                <>
                  <div className="table-result-subtitle" style={{ marginTop: '0.55rem' }}>
                    {language === 'pt'
                      ? `Partida seguinte em ${rematchSecondsLeft ?? 0}s. Jogadores que aceitarem continuam.`
                      : `Next match in ${rematchSecondsLeft ?? 0}s. Players who accept continue.`}
                  </div>
                  <div className="table-result-votes">
                    {roomInfo.rematchVotes.map((vote) => (
                      <span key={`rematch-vote-${vote.playerIndex}`} className="table-result-vote-chip">
                        {vote.nickname}:{' '}
                        {vote.accept === true
                          ? language === 'pt'
                            ? 'Aceitou'
                            : 'Accepted'
                          : vote.accept === false
                            ? language === 'pt'
                              ? 'Recusou'
                              : 'Declined'
                            : language === 'pt'
                              ? 'Pendente'
                              : 'Pending'}
                        <span
                          className={`ui-icon vote-${
                            vote.accept === true ? 'accept' : vote.accept === false ? 'decline' : 'pending'
                          }`}
                          aria-hidden="true"
                        />
                      </span>
                    ))}
                  </div>
                  <div className="actions" style={{ marginTop: '0.65rem' }}>
                    <button
                      type="button"
                      onClick={() => onRematchVote(true)}
                      disabled={localRematchVote === true || localRematchDecision === 'accept'}
                    >
                      {language === 'pt' ? 'Aceitar próxima' : 'Accept next'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onRematchVote(false)}
                      disabled={localRematchVote === false || localRematchDecision === 'decline'}
                    >
                      {language === 'pt' ? 'Recusar' : 'Decline'}
                    </button>
                  </div>
                </>
              ) : (
                <div className="actions" style={{ marginTop: '0.65rem' }}>
                  <button
                    type="button"
                    onClick={onPlayAgain}
                    disabled={networkMatchActive && roomInfo?.hostClientId !== networkClientId}
                  >
                    {language === 'pt' ? 'Jogar Novamente' : 'Play Again'}
                  </button>
                </div>
              )}
            </div>
          )}

          {(game.phase === 'REACTION_WINDOW' || game.phase === 'DISCARD_SELECTION' || game.phase === 'ACTION_SELECTION' || (showFutureReveal && game.lastFutureReveal && canViewFutureReveal)) && (
            <div className="table-action-hud">
              <div className="table-phase-pill">
                <span className={`ui-icon phase-${tablePrompt.iconKey}`} aria-hidden="true" />
                {tablePrompt.title}
              </div>
              <div className="table-prompt-text" title={tablePrompt.hint}>{tablePrompt.hint}</div>
              {game.phase === 'REACTION_WINDOW' && reactionCardId !== null && (
                <div key={reactionWindowVisualKey} className="reaction-card-ui">
                  <div className="reaction-card-top-row">
                    {isReactionTimerOwner && (
                      <button
                        type="button"
                        className="reaction-skip-button"
                        onClick={onResolvePending}
                        disabled={isFutureRevealWindowActive}
                      >
                        {language === 'pt' ? 'Pular' : 'Skip'}
                      </button>
                    )}
                  </div>
                  <div
                    className={`reaction-card-highlight ${canLocalCancelReactionNow ? 'active' : ''}`}
                    aria-label={language === 'pt' ? 'Contexto da carta em reação' : 'Reaction card context'}
                  >
                    <span className="reaction-card-timer" aria-hidden="true" />
                    <img
                      src={getPreferredCardImageUrl(reactionCardId)}
                      data-fallback-src={getCardPngUrl(reactionCardId)}
                      alt={`Reaction window card ${reactionCardId}`}
                      onError={handleCardImageError}
                    />
                    <span className="reaction-card-caption">{language === 'pt' ? 'Carta em reação' : 'Card in reaction'}</span>
                  </div>
                </div>
              )}
              {game.phase === 'REACTION_WINDOW' && isReactionTimerOwner && reactionSecondsLeft !== null && (
                renderPromptSub(
                  'timer',
                  language === 'pt'
                    ? `A janela de reação fecha em ${reactionSecondsLeft}s.`
                    : `Reaction window closes in ${reactionSecondsLeft}s.`,
                )
              )}
              {isSelfDiscardWindow &&
                renderPromptSub(
                  'discard',
                  language === 'pt' ? 'Clique em uma carta da sua mão para descartar.' : 'Click a card in your hand to discard.',
                )}
              {isPlayerTargetSelection &&
                renderPromptSub('player', language === 'pt' ? 'Clique no assento de um jogador.' : 'Click a player seat.')}
              {isSelfHandTargetSelection &&
                renderPromptSub(
                  'hand',
                  language === 'pt' ? 'Clique em uma carta destacada na sua mão.' : 'Click a highlighted card in your hand.',
                )}
              {isCardTargetSelection &&
                !isSelfHandTargetSelection &&
                renderPromptSub(
                  'timeline',
                  language === 'pt' ? 'Clique em uma carta destacada da timeline.' : 'Click a highlighted timeline card.',
                )}

              {showFutureReveal && game.lastFutureReveal && canViewFutureReveal && (
                <div className="future-reveal-panel">
                  <div className="table-prompt-sub future">
                    <span className="ui-icon prompt-future" aria-hidden="true" />
                    {language === 'pt'
                      ? `Revelação do Futuro: ${game.players[game.lastFutureReveal.sourcePlayerIndex]?.name} viu a mão de ${game.players[game.lastFutureReveal.targetPlayerIndex]?.name}.`
                      : `Future Reveal: ${game.players[game.lastFutureReveal.sourcePlayerIndex]?.name} saw ${game.players[game.lastFutureReveal.targetPlayerIndex]?.name}'s hand.`}
                    {futureRevealSecondsLeft !== null &&
                      (language === 'pt' ? ` Fecha em ${futureRevealSecondsLeft}s.` : ` Closing in ${futureRevealSecondsLeft}s.`)}
                  </div>
                  <div className="future-reveal-cards">
                    {game.lastFutureReveal.cards.length === 0 ? (
                      <span className="panel-lock-note">{language === 'pt' ? 'Mão vazia' : 'Empty hand'}</span>
                    ) : (
                      game.lastFutureReveal.cards.map((cardId, index) => (
                        <CardImage key={`future-reveal-${index}-${cardId}`} id={cardId} locale={language} disabled />
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {opponentIndices.map((index, seatOrder) => renderOpponentSeat(index, seatOrder))}
          {selfPlayer && (
            <div data-seat-player={selfPlayerIndex} className={`self-area ${selfActivityLabel ? 'active' : ''} ${showSelfHandRow ? 'with-hand' : ''}`}>
              <div className="self-name-tag">
                <strong>{selfPlayer.name}</strong>
                {selfActivityLabel && <span className={`turn-badge ${selfActivityKind ? `activity-${selfActivityKind}` : ''}`}>{selfActivityLabel}</span>}
              </div>

              <aside className="self-timeline-panel">
                <div
                  className={`timeline-strip self-timeline compact ${selfPlayer.timeline.length === 0 ? 'empty' : ''} ${timelineRemovalFlashPlayerIndex === selfPlayerIndex ? 'timeline-removal-pulse' : ''} ${timelineTargetCue?.targetPlayerIndex === selfPlayerIndex ? `timeline-target-zone ${timelineTargetCue.direction}` : ''} ${isTimelineSelectionActive ? 'selection-active' : ''}`}
                  data-empty-label={language === 'pt' ? 'Sua timeline está vazia' : 'Your timeline is empty'}
                >
                  {selfPlayer.timeline.map((entry) => (
                    (() => {
                      const isSelectableTimelineCard = isTimelineSelectionActive && selectableActionCardIds.includes(entry.id)
                      return (
                    <img
                      key={`${entry.id}-${entry.era}`}
                      data-timeline-card-player={selfPlayerIndex}
                      data-timeline-card-id={entry.id}
                      className={`timeline-card ${timelineEntryFlashKey === `${selfPlayerIndex}-${entry.id}` ? 'timeline-entry-enter' : ''} ${isSelectableTimelineCard ? 'targetable-card' : ''} ${timelineTargetCue?.targetPlayerIndex === selfPlayerIndex && timelineTargetCue?.targetCardId === entry.id ? `timeline-target-hit ${timelineTargetCue.direction}` : ''}`}
                      src={getPreferredCardImageUrl(entry.id)}
                      data-fallback-src={getCardPngUrl(entry.id)}
                      alt={`Timeline card ${entry.id}`}
                      title={isSelectableTimelineCard ? 'Click to target this timeline card' : undefined}
                      onError={handleCardImageError}
                      onClick={
                        isSelectableTimelineCard
                          ? () => onSelectActionTarget(entry.id)
                          : undefined
                      }
                    />
                      )
                    })()
                  ))}
                </div>
              </aside>

              {showSelfHandRow && (
                <div className="self-hand-row">
                  {isSelfDiscardWindow && <div className="discard-inline-hint">{language === 'pt' ? 'Descarte 1 carta destacada da sua mão.' : 'Discard 1 highlighted card from your hand.'}</div>}
                  {isSelfPlayWindow && (
                    <button
                      type="button"
                      className="draw-button-dock"
                      onClick={onDrawCard}
                      disabled={Boolean(game.winner) || !isLocalController || isFutureRevealWindowActive}
                    >
                      {language === 'pt' ? 'Comprar' : 'Draw'}
                    </button>
                  )}
                  <div
                    className={`hand-grid hand-fan ${isFutureRevealWindowActive ? 'blocked' : ''}`}
                    style={{ ['--hand-card-width' as any]: `${selfHandLayout.cardWidth}px` }}
                  >
                    {displayedSelfHand.map((entry, cardIndex) => {
                      const previousGroup = cardIndex > 0 ? displayedSelfHand[cardIndex - 1].groupKey : null
                      const overlap =
                        previousGroup === entry.groupKey ? selfHandLayout.overlapSame : selfHandLayout.overlapDiff
                      const isCardTargetInHand = isSelfHandTargetSelection && selectableActionCardIds.includes(entry.cardId)
                      const isDiscardableCard = isSelfDiscardWindow
                      const isReactionTnhCard = isReactionWindowActive && canLocalCancelReactionNow && isThatNeverHappened(entry.cardId)
                      const isPlayableCard =
                        isSelfPlayWindow && selfPlayer !== null
                          ? canPlayCardFromHand(entry.cardId, selfPlayer.hand, game, selfPlayerIndex)
                          : true
                      const handCardClassName = isReactionTnhCard
                        ? 'reaction-tnh-card'
                        : isCardTargetInHand
                          ? 'targetable-card'
                          : isDiscardableCard
                            ? 'discardable-card'
                            : undefined
                      const combinedHandCardClassName = `${handCardClassName ?? ''} ${drawnCardFlashId === entry.cardId ? 'newly-drawn-card' : ''}`.trim()
                      return (
                        <CardImage
                          key={`${entry.cardId}-${cardIndex}`}
                          id={entry.cardId}
                          locale={language}
                          className={combinedHandCardClassName || undefined}
                          onClick={() =>
                            isReactionTnhCard
                              ? onCancelPending()
                              : isSelfHandTargetSelection
                              ? isCardTargetInHand
                                ? onSelectActionTarget(entry.cardId)
                                : undefined
                              : isSelfDiscardWindow
                                ? onDiscardForEvent(entry.cardId)
                                : isPlayableCard
                                  ? onPlayCard(entry.cardId)
                                  : undefined
                          }
                          disabled={
                            isFutureRevealWindowActive ||
                            (!isSelfPlayWindow && !isSelfDiscardWindow && !isSelfHandTargetSelection && !isReactionTnhCard) ||
                            (isSelfHandTargetSelection && !isCardTargetInHand) ||
                            (isReactionWindowActive && !isReactionTnhCard) ||
                            (isSelfPlayWindow && !isPlayableCard)
                          }
                          style={{
                            ...getFanTransformStyle(cardIndex, displayedSelfHand.length),
                            ['--fan-overlap' as any]: overlap,
                          }}
                        />
                      )
                    })}
                  </div>
                </div>
              )}

            {selfPlayerIndex === game.currentPlayerIndex && !game.winner && game.phase === 'PLAYER_CHOICE' && selfPlayer.isBot && (
              <p className="bot-thinking">{language === 'pt' ? 'Bot está pensando...' : 'Bot is thinking...'}</p>
            )}

            {selfPlayerIndex === game.currentPlayerIndex && !game.winner && game.phase === 'PLAYER_CHOICE' && networkMatchActive && selfPlayerIndex !== localPlayerIndex && !selfPlayer.isBot && (
              <p className="bot-thinking">{language === 'pt' ? `Aguardando ${selfPlayer.name}...` : `Waiting for ${selfPlayer.name}...`}</p>
            )}
            </div>
          )}
        </div>
      </section>

      {chatNotification && !isChatOpen && (
        <div className="floating-chat-toast">
          <span className="ui-icon chat" aria-hidden="true" />
          {chatNotification}
        </div>
      )}

      <div className="floating-overlay-stack">
        {isLogOpen ? (
          <section className="floating-panel">
            <div className="floating-panel-header">
              <strong>{language === 'pt' ? 'Log de Turnos' : 'Turn Log'}</strong>
              <button type="button" className="popup-close-button" onClick={() => setIsLogOpen(false)} aria-label="Close log">
                ×
              </button>
            </div>
            <div className="actions" style={{ marginTop: '0.45rem' }}>
              <button type="button" onClick={() => setLogFilter('current')} disabled={logFilter === 'current'}>
                {language === 'pt' ? 'Turno Atual' : 'Current Turn'}
              </button>
              <button type="button" onClick={() => setLogFilter('all')} disabled={logFilter === 'all'}>
                {language === 'pt' ? 'Todos' : 'All'}
              </button>
            </div>
            <ol className="action-log-list">
              {visibleActionLog.length === 0 ? (
                <li className="action-log-empty">
                  <span className="ui-icon log" aria-hidden="true" />
                  {language === 'pt' ? 'Nenhuma ação para este filtro.' : 'No actions for this filter.'}
                </li>
              ) : (
                visibleActionLog.map((entry) => {
                  const actionTag = getActionLogTag(entry.text)
                  return (
                  <li key={entry.id} className="action-log-item">
                    <span className={`action-log-tag ${actionTag.toLowerCase()}`}>{actionTag}</span>{' '}
                    <span className="chat-time">[{formatTime(entry.timestamp)}]</span> {redactDrawDetails(entry.text)}
                  </li>
                  )
                })
              )}
            </ol>
          </section>
        ) : (
          <button type="button" className="floating-bubble" onClick={() => setIsLogOpen(true)}>
            <span className="ui-icon log" aria-hidden="true" />
            {language === 'pt' ? 'Log' : 'Log'}
          </button>
        )}

        {isChatOpen ? (
          <section className="floating-panel">
            <div className="floating-panel-header">
              <strong>{language === 'pt' ? 'Chat' : 'Chat'}</strong>
              <button type="button" className="popup-close-button" onClick={() => setIsChatOpen(false)} aria-label="Close chat">
                ×
              </button>
            </div>
            <div className="chat-messages">
              {chatMessages.length === 0 ? (
                <div className="chat-empty">
                  <span className="ui-icon chat" aria-hidden="true" />
                  {language === 'pt' ? 'Ainda não há mensagens.' : 'No messages yet.'}
                </div>
              ) : (
                chatMessages.map((entry) => (
                  <div key={entry.id} className="chat-line">
                    <span className="chat-time">[{formatTime(entry.timestamp)}]</span> <strong>{entry.sender}:</strong>{' '}
                    {entry.text}
                  </div>
                ))
              )}
            </div>
            <div className="actions" style={{ marginTop: '0.55rem' }}>
              <input
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    onSendChat()
                  }
                }}
                placeholder={
                  networkMatchActive
                    ? language === 'pt'
                      ? 'Digite uma mensagem para a sala...'
                      : 'Type a message to room...'
                    : language === 'pt'
                      ? 'Digite uma nota local...'
                      : 'Type a local note...'
                }
                maxLength={160}
                style={{ width: '100%' }}
              />
              <button type="button" onClick={onSendChat}>
                {language === 'pt' ? 'Enviar' : 'Send'}
              </button>
            </div>
          </section>
        ) : (
          <button
            type="button"
            className="floating-bubble"
            onClick={() => {
              setIsChatOpen(true)
              setUnreadChatCount(0)
            }}
          >
            <span className="ui-icon chat" aria-hidden="true" />
            {language === 'pt' ? 'Chat' : 'Chat'} {unreadChatCount > 0 ? `(${unreadChatCount})` : ''}
          </button>
        )}
      </div>
    </main>
  )
}

export default App
