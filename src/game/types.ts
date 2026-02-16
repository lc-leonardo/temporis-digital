export interface SetupRules {
  standard: {
    starting_hand: number
    starting_timeline: number
  }
}

export type EventEra = 'past' | 'present' | 'future' | 'paradox'
export type CardKind = 'event' | 'action'
export type ActionName =
  | 'back_in_time'
  | 'that_never_happened'
  | 'rewrite_event'
  | 'local_reset'
  | 'time_skip'
  | 'time_swap'
  | 'paradox_swap'
  | 'future_peek'
export type ActionSelectionStep = 'choose_target' | 'choose_swap_source' | 'choose_swap_target' | 'choose_rewrite_replacement'
export type GamePhase =
  | 'PLAYER_CHOICE'
  | 'REACTION_WINDOW'
  | 'DISCARD_SELECTION'
  | 'ACTION_SELECTION'
  | 'GAME_OVER'

export interface CardDefinition {
  id: number
  kind: CardKind
  era?: EventEra
  actionName?: ActionName
}

export interface TimelineCard {
  id: number
  era: EventEra
}

export interface TemporisRules {
  game: {
    name: string
    version: string
    description: string
  }
  setup: SetupRules
  event_resolution: {
    past: { on_play: string[] }
    present: { on_play: string[] }
    future: { on_play: string[] }
    paradox: {
      on_play: string[]
      counts_as_era: boolean
    }
  }
  paradox_rules: {
    scores_points: boolean
  }
  turn_structure: {
    options: {
      play_card: { description: string }
      draw_card: { description: string }
    }
  }
}

export interface PlayerState {
  id: number
  name: string
  isBot: boolean
  hand: number[]
  timeline: TimelineCard[]
}

export interface GameSetupOptions {
  startingHand: number
  startingTimeline?: number
  totalPlayers: number
  botCount: number
  seed?: number
  playerRoster?: Array<{
    name: string
    isBot: boolean
  }>
}

export interface PendingPlay {
  playedBy: number
  reactor: number
  card: CardDefinition
  cancelChainCount: number
  cancelers: number[]
  nextResponder: number
  passesSinceLastCancel: number
  chainLog: string[]
  effectOnly?: boolean
}

export interface PendingDiscard {
  playerIndex: number
  nextPlayerIndex: number
  sourceEra: 'past' | 'present'
}

export interface PendingActionSelection {
  actionName: Exclude<ActionName, 'that_never_happened' | 'time_skip'>
  playerIndex: number
  nextPlayerIndex: number
  step: ActionSelectionStep
  selectedSourceCardId?: number
  sourceCardId?: number
}

export interface PendingFuturePeek {
  playedBy: number
  targetPlayerIndex: number
  nextPlayerIndex: number
  eventCardId: number
}

export interface LastFutureReveal {
  sourcePlayerIndex: number
  targetPlayerIndex: number
  cards: number[]
}

export interface PendingForcedSkips {
  playerIndex: number
  remaining: number
}

export type GameAction =
  | { type: 'play_card'; cardId: number }
  | { type: 'draw_end_turn' }
  | { type: 'pass_reaction'; playerIndex?: number }
  | { type: 'cancel_reaction'; playerIndex?: number }
  | { type: 'discard_pending_event'; cardId: number }
  | { type: 'select_future_target'; targetPlayerIndex: number }
  | { type: 'select_action_target'; cardId: number }

export interface GameState {
  timelineTarget: number
  deck: number[]
  discardPile: number[]
  players: PlayerState[]
  currentPlayerIndex: number
  phase: GamePhase
  pendingPlay: PendingPlay | null
  pendingDiscard: PendingDiscard | null
  pendingActionSelection: PendingActionSelection | null
  pendingFuturePeek: PendingFuturePeek | null
  pendingForcedSkips: PendingForcedSkips | null
  lastFutureReveal: LastFutureReveal | null
  reactionHistory: string[]
  statusText: string
  winner: string | null
}
