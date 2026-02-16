import { WebSocketServer } from 'ws'
import { MongoClient } from 'mongodb'

const PORT = Number(process.env.LAN_PORT ?? 8787)
const ROOM_SIZE_LIMIT = 6
const MONGO_URI = process.env.MONGO_URI ?? 'mongodb://127.0.0.1:27017'
const MONGO_DB_NAME = process.env.MONGO_DB_NAME ?? 'temporis'

let mongoClient = null
let chatMessagesCollection = null

const rooms = new Map()
const clients = new Map()

async function connectMongo() {
  mongoClient = new MongoClient(MONGO_URI)
  await mongoClient.connect()
  const mongoDb = mongoClient.db(MONGO_DB_NAME)
  chatMessagesCollection = mongoDb.collection('chat_messages')
  await chatMessagesCollection.createIndex({ roomCode: 1, timestamp: -1 })
  console.log(`MongoDB connected on ${MONGO_URI} (db: ${MONGO_DB_NAME})`)
}

async function closeMongo() {
  if (!mongoClient) {
    return
  }
  await mongoClient.close()
  mongoClient = null
  chatMessagesCollection = null
}

function randomId(length = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

function send(socket, payload) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(payload))
  }
}

function createSeed() {
  return Math.floor(Math.random() * 2147483647)
}

function getClientNickname(room, clientId) {
  const player = room.players.find((entry) => entry.clientId === clientId)
  if (player) {
    return player.nickname
  }
  const spectator = room.spectators.find((entry) => entry.clientId === clientId)
  if (spectator) {
    return spectator.nickname
  }
  return 'Player'
}

function roomAudience(room) {
  const connectedPlayers = room.players.filter((player) => Boolean(player.clientId))
  return [...connectedPlayers, ...room.spectators]
}

function clearRematchTimer(room) {
  if (!room?.gameSession?.rematch?.timer) {
    return
  }
  clearTimeout(room.gameSession.rematch.timer)
  room.gameSession.rematch.timer = null
}

function connectedSeatEntries(room) {
  return room.players
    .map((player, index) => ({ player, index }))
    .filter(({ player }) => Boolean(player.connected && player.clientId))
}

function buildRematchVotesPayload(room) {
  if (!room?.gameSession?.rematch?.active) {
    return []
  }

  const votes = room.gameSession.rematch.votes ?? {}
  return connectedSeatEntries(room).map(({ player, index }) => {
    const value = votes[player.clientId]
    return {
      playerIndex: index,
      nickname: player.nickname,
      accept: typeof value === 'boolean' ? value : null,
    }
  })
}

function beginRematchVoting(roomCode) {
  const room = rooms.get(roomCode)
  if (!room?.gameSession) {
    return
  }

  const connectedSeats = connectedSeatEntries(room)
  if (connectedSeats.length < 2) {
    return
  }

  clearRematchTimer(room)
  room.gameSession.rematch = {
    active: true,
    deadlineTs: Date.now() + 15000,
    votes: {},
    timer: null,
  }

  room.gameSession.rematch.timer = setTimeout(() => {
    finalizeRematchVoting(roomCode)
  }, 15000)

  broadcastRoom(roomCode)
}

function finalizeRematchVoting(roomCode) {
  const room = rooms.get(roomCode)
  if (!room?.gameSession?.rematch?.active) {
    return
  }

  const rematch = room.gameSession.rematch
  clearRematchTimer(room)

  const connectedSeats = connectedSeatEntries(room)
  const acceptedSeats = connectedSeats.filter(({ player }) => rematch.votes[player.clientId] === true)

  room.gameSession.rematch.active = false

  if (acceptedSeats.length < 2) {
    room.gameSession.rematch = null
    broadcastRoom(roomCode)
    broadcastToRoom(roomCode, {
      type: 'rematch_result',
      roomCode,
      status: 'not_enough_accepts',
    })
    return
  }

  const acceptedClientIds = new Set(acceptedSeats.map(({ player }) => player.clientId))
  const newPlayers = acceptedSeats.map(({ player }) => ({
    clientId: player.clientId,
    nickname: player.nickname,
    connected: true,
  }))

  const nonAcceptedConnected = connectedSeats.filter(({ player }) => !acceptedClientIds.has(player.clientId))
  nonAcceptedConnected.forEach(({ player }) => {
    if (!room.spectators.some((spectator) => spectator.clientId === player.clientId)) {
      room.spectators.push({ clientId: player.clientId, nickname: player.nickname })
    }
  })

  room.spectators = room.spectators.filter((spectator) => !acceptedClientIds.has(spectator.clientId))
  room.players = newPlayers

  if (!acceptedClientIds.has(room.hostClientId)) {
    room.hostClientId = newPlayers[0]?.clientId ?? null
  }

  const playerRoster = newPlayers.map((player) => ({
    clientId: player.clientId,
    nickname: player.nickname,
  }))

  room.gameSession = {
    playerRoster,
    authoritativeState: null,
    nextStateSeq: 1,
    loading: {
      inProgress: true,
      requiredPlayerIndexes: newPlayers.map((_, index) => index),
      readyPlayerIndexes: [],
    },
    rematch: null,
  }

  rebuildLoadingBarrier(room)
  broadcastRoom(roomCode)
  maybeStartGameAfterAssetsReady(roomCode)
}

function broadcastRoom(roomCode) {
  const room = rooms.get(roomCode)
  if (!room) {
    return
  }

  const loading = room.gameSession?.loading ?? {
    inProgress: false,
    requiredPlayerIndexes: [],
    readyPlayerIndexes: [],
  }

  const payload = {
    type: 'room_update',
    roomCode,
    hostClientId: room.hostClientId,
    players: room.players,
    spectators: room.spectators,
    gameInProgress: Boolean(room.gameSession),
    loadingInProgress: Boolean(loading.inProgress),
    loadingRequiredPlayerIndexes: loading.requiredPlayerIndexes,
    loadingReadyPlayerIndexes: loading.readyPlayerIndexes,
    rematchActive: Boolean(room.gameSession?.rematch?.active),
    rematchDeadlineTs: room.gameSession?.rematch?.deadlineTs ?? null,
    rematchVotes: buildRematchVotesPayload(room),
  }

  roomAudience(room).forEach((player) => {
    const client = clients.get(player.clientId)
    if (client) {
      send(client.socket, payload)
    }
  })
}

function rebuildLoadingBarrier(room) {
  if (!room?.gameSession?.loading?.inProgress) {
    return
  }

  const requiredPlayerIndexes = room.players
    .map((player, index) => ({ player, index }))
    .filter(({ player }) => Boolean(player.connected && player.clientId))
    .map(({ index }) => index)

  const requiredSet = new Set(requiredPlayerIndexes)
  room.gameSession.loading.requiredPlayerIndexes = requiredPlayerIndexes
  room.gameSession.loading.readyPlayerIndexes = room.gameSession.loading.readyPlayerIndexes.filter((index) =>
    requiredSet.has(index),
  )
}

function maybeStartGameAfterAssetsReady(roomCode) {
  const room = rooms.get(roomCode)
  if (!room?.gameSession?.loading?.inProgress) {
    return
  }

  rebuildLoadingBarrier(room)
  const required = room.gameSession.loading.requiredPlayerIndexes
  const ready = room.gameSession.loading.readyPlayerIndexes
  if (required.length < 2) {
    return
  }

  const readySet = new Set(ready)
  const allReady = required.every((index) => readySet.has(index))
  if (!allReady) {
    return
  }

  const playerRoster = required
    .map((index) => room.players[index])
    .filter((player) => Boolean(player?.clientId && player.connected))
    .map((player) => ({
      clientId: player.clientId,
      nickname: player.nickname,
    }))

  if (playerRoster.length < 2) {
    return
  }

  room.gameSession.playerRoster = playerRoster
  room.gameSession.loading.inProgress = false

  broadcastRoom(roomCode)
  broadcastToRoom(roomCode, {
    type: 'game_started',
    roomCode,
    payload: {
      playerRoster,
      hostClientId: room.hostClientId,
    },
  })
}

function broadcastToRoom(roomCode, payload) {
  const room = rooms.get(roomCode)
  if (!room) {
    return
  }
  roomAudience(room).forEach((player) => {
    const client = clients.get(player.clientId)
    if (client) {
      send(client.socket, payload)
    }
  })
}

function getPlayerIndexByClientId(room, clientId) {
  return room.players.findIndex((player) => player.clientId === clientId)
}

function cloneState(state) {
  return JSON.parse(JSON.stringify(state))
}

function buildMaskedStateForViewer(gameState, viewerPlayerIndex) {
  const state = cloneState(gameState)

  if (Array.isArray(state.players)) {
    state.players = state.players.map((player, index) => {
      if (index === viewerPlayerIndex) {
        return player
      }
      return {
        ...player,
        hand: Array.from({ length: player.hand.length }, () => 0),
      }
    })
  }

  if (Array.isArray(state.deck)) {
    state.deck = Array.from({ length: state.deck.length }, () => 0)
  }

  if (state.lastFutureReveal && state.lastFutureReveal.sourcePlayerIndex !== viewerPlayerIndex) {
    state.lastFutureReveal = {
      ...state.lastFutureReveal,
      cards: [],
    }
  }

  return state
}

function sendMaskedStateUpdateToRoom(roomCode, options = {}) {
  const room = rooms.get(roomCode)
  if (!room?.gameSession?.authoritativeState) {
    return
  }

  const seq = Number(options.seq ?? room.gameSession.nextStateSeq - 1)
  roomAudience(room).forEach((audienceMember) => {
    const client = clients.get(audienceMember.clientId)
    if (!client) {
      return
    }

    const isHostViewer = audienceMember.clientId === room.hostClientId
    const viewerIndex = getPlayerIndexByClientId(room, audienceMember.clientId)
    const maskedState = isHostViewer
      ? cloneState(room.gameSession.authoritativeState)
      : buildMaskedStateForViewer(room.gameSession.authoritativeState, viewerIndex)
    send(client.socket, {
      type: 'state_update',
      roomCode,
      seq,
      state: maskedState,
      lastAction: options.lastAction ?? null,
    })
  })
}

function removeFromRoom(clientId, options = { preserveSeatOnDisconnect: false }) {
  const client = clients.get(clientId)
  if (!client?.roomCode) {
    return
  }

  const roomCode = client.roomCode

  const room = rooms.get(roomCode)
  if (!room) {
    return
  }

  const spectatorIndex = room.spectators.findIndex((spectator) => spectator.clientId === clientId)
  if (spectatorIndex >= 0) {
    room.spectators.splice(spectatorIndex, 1)
  }

  const playerIndex = room.players.findIndex((player) => player.clientId === clientId)
  if (playerIndex >= 0) {
    if (room.gameSession && options.preserveSeatOnDisconnect) {
      room.players[playerIndex].clientId = null
      room.players[playerIndex].connected = false
    } else {
      room.players.splice(playerIndex, 1)
    }
  }

  const hasConnectedAudience = roomAudience(room).length > 0
  if (!hasConnectedAudience) {
    clearRematchTimer(room)
    rooms.delete(roomCode)
    return
  }

  if (room.hostClientId === clientId) {
    const firstConnected = room.players.find((player) => Boolean(player.clientId))
    room.hostClientId = firstConnected?.clientId ?? null
  }

  rebuildLoadingBarrier(room)
  maybeStartGameAfterAssetsReady(roomCode)

  client.roomCode = null
  broadcastRoom(roomCode)
}

const wss = new WebSocketServer({ port: PORT })

wss.on('connection', (socket) => {
  const clientId = randomId(10)
  clients.set(clientId, { socket, roomCode: null })
  send(socket, { type: 'welcome', clientId })

  socket.on('message', (rawMessage) => {
    let message
    try {
      message = JSON.parse(String(rawMessage))
    } catch {
      send(socket, { type: 'error', message: 'Invalid JSON payload.' })
      return
    }

    if (!message?.type) {
      send(socket, { type: 'error', message: 'Missing message type.' })
      return
    }

    if (message.type === 'host_room') {
      const nickname = String(message.nickname ?? '').trim().slice(0, 20)
      if (!nickname) {
        send(socket, { type: 'error', message: 'Nickname is required.' })
        return
      }

      removeFromRoom(clientId)

      let roomCode = randomId(6)
      while (rooms.has(roomCode)) {
        roomCode = randomId(6)
      }

      const room = {
        roomCode,
        hostClientId: clientId,
        players: [{ clientId, nickname, connected: true }],
        spectators: [],
        gameSession: null,
      }
      rooms.set(roomCode, room)
      clients.get(clientId).roomCode = roomCode
      send(socket, { type: 'room_hosted', roomCode })
      broadcastRoom(roomCode)
      return
    }

    if (message.type === 'join_room') {
      const roomCode = String(message.roomCode ?? '').toUpperCase().trim()
      const nickname = String(message.nickname ?? '').trim().slice(0, 20)

      if (!roomCode || !nickname) {
        send(socket, { type: 'error', message: 'Room code and nickname are required.' })
        return
      }

      const room = rooms.get(roomCode)
      if (!room) {
        send(socket, { type: 'error', message: 'Room not found.' })
        return
      }

      removeFromRoom(clientId)

      let joinedAs = 'spectator'
      const reconnectSeat = room.players.find(
        (player) => !player.connected && player.nickname.toLowerCase() === nickname.toLowerCase(),
      )

      if (reconnectSeat) {
        reconnectSeat.clientId = clientId
        reconnectSeat.connected = true
        joinedAs = 'player'
      } else if (!room.gameSession && room.players.length < ROOM_SIZE_LIMIT) {
        room.players.push({ clientId, nickname, connected: true })
        joinedAs = 'player'
      } else if (!room.gameSession && room.players.length >= ROOM_SIZE_LIMIT) {
        send(socket, { type: 'error', message: 'Room is full (max 6 players).' })
        return
      } else {
        room.spectators.push({ clientId, nickname })
        joinedAs = 'spectator'
      }

      rebuildLoadingBarrier(room)

      clients.get(clientId).roomCode = roomCode
      send(socket, { type: 'room_joined', roomCode, joinedAs })
      broadcastRoom(roomCode)
      maybeStartGameAfterAssetsReady(roomCode)

      if (room.gameSession?.authoritativeState) {
        send(socket, {
          type: 'game_started',
          roomCode,
          payload: {
            playerRoster: room.gameSession.playerRoster,
            hostClientId: room.hostClientId,
          },
        })
        const viewerIndex = getPlayerIndexByClientId(room, clientId)
        send(socket, {
          type: 'state_update',
          roomCode,
          seq: room.gameSession.nextStateSeq - 1,
          state: buildMaskedStateForViewer(room.gameSession.authoritativeState, viewerIndex),
          lastAction: null,
        })
      }
      return
    }

    if (message.type === 'leave_room') {
      const client = clients.get(clientId)
      if (client) {
        removeFromRoom(clientId)
        client.roomCode = null
      }
      send(socket, { type: 'room_left' })
      return
    }

    if (message.type === 'start_game') {
      const client = clients.get(clientId)
      if (!client?.roomCode) {
        send(socket, { type: 'error', message: 'You are not in a room.' })
        return
      }

      const room = rooms.get(client.roomCode)
      if (!room) {
        send(socket, { type: 'error', message: 'Room not found.' })
        return
      }

      if (room.hostClientId !== clientId) {
        send(socket, { type: 'error', message: 'Only host can start the game.' })
        return
      }

      if (room.gameSession) {
        send(socket, { type: 'error', message: 'Game already started.' })
        return
      }

      const connectedPlayers = room.players.filter((player) => player.connected && player.clientId)
      const playerRoster = connectedPlayers.map((player) => ({
        clientId: player.clientId,
        nickname: player.nickname,
      }))

      room.gameSession = {
        playerRoster,
        authoritativeState: null,
        nextStateSeq: 1,
        loading: {
          inProgress: true,
          requiredPlayerIndexes: connectedPlayers.map((_, index) => index),
          readyPlayerIndexes: [],
        },
        rematch: null,
      }

      rebuildLoadingBarrier(room)
      broadcastRoom(client.roomCode)
      maybeStartGameAfterAssetsReady(client.roomCode)
      return
    }

    if (message.type === 'restart_game') {
      const client = clients.get(clientId)
      if (!client?.roomCode) {
        send(socket, { type: 'error', message: 'You are not in a room.' })
        return
      }

      const room = rooms.get(client.roomCode)
      if (!room) {
        send(socket, { type: 'error', message: 'Room not found.' })
        return
      }

      if (room.hostClientId !== clientId) {
        send(socket, { type: 'error', message: 'Only host can restart the game.' })
        return
      }

      const connectedPlayers = room.players.filter((player) => player.connected && player.clientId)
      if (connectedPlayers.length < 2) {
        send(socket, { type: 'error', message: 'Need at least 2 connected players to restart.' })
        return
      }

      const playerRoster = connectedPlayers.map((player) => ({
        clientId: player.clientId,
        nickname: player.nickname,
      }))

      room.gameSession = {
        playerRoster,
        authoritativeState: null,
        nextStateSeq: 1,
        loading: {
          inProgress: true,
          requiredPlayerIndexes: connectedPlayers.map((_, index) => index),
          readyPlayerIndexes: [],
        },
        rematch: null,
      }

      rebuildLoadingBarrier(room)
      broadcastRoom(client.roomCode)
      maybeStartGameAfterAssetsReady(client.roomCode)
      return
    }

    if (message.type === 'client_assets_ready') {
      const client = clients.get(clientId)
      if (!client?.roomCode) {
        send(socket, { type: 'error', message: 'You are not in a room.' })
        return
      }

      const room = rooms.get(client.roomCode)
      if (!room?.gameSession?.loading?.inProgress) {
        return
      }

      const playerIndex = getPlayerIndexByClientId(room, clientId)
      if (playerIndex < 0) {
        return
      }

      rebuildLoadingBarrier(room)
      if (!room.gameSession.loading.requiredPlayerIndexes.includes(playerIndex)) {
        return
      }

      if (!room.gameSession.loading.readyPlayerIndexes.includes(playerIndex)) {
        room.gameSession.loading.readyPlayerIndexes.push(playerIndex)
      }

      broadcastRoom(client.roomCode)
      maybeStartGameAfterAssetsReady(client.roomCode)
      return
    }

    if (message.type === 'chat_message') {
      const client = clients.get(clientId)
      if (!client?.roomCode) {
        send(socket, { type: 'error', message: 'You are not in a room.' })
        return
      }

      const room = rooms.get(client.roomCode)
      if (!room) {
        send(socket, { type: 'error', message: 'Room not found.' })
        return
      }

      const text = String(message.text ?? '').trim().slice(0, 160)
      if (!text) {
        return
      }

      const chatMessage = {
        type: 'chat_message',
        roomCode: client.roomCode,
        fromClientId: clientId,
        sender: getClientNickname(room, clientId),
        text,
        timestamp: Date.now(),
      }

      broadcastToRoom(client.roomCode, chatMessage)
      if (chatMessagesCollection) {
        void chatMessagesCollection
          .insertOne({
            roomCode: chatMessage.roomCode,
            fromClientId: chatMessage.fromClientId,
            sender: chatMessage.sender,
            text: chatMessage.text,
            timestamp: chatMessage.timestamp,
          })
          .catch((error) => {
            console.error('Failed to persist chat message:', error)
          })
      }
      return
    }

    if (message.type === 'game_action_request') {
      const client = clients.get(clientId)
      if (!client?.roomCode) {
        send(socket, { type: 'error', message: 'You are not in a room.' })
        return
      }

      const room = rooms.get(client.roomCode)
      if (!room?.gameSession) {
        send(socket, { type: 'error', message: 'No active game session.' })
        return
      }

      const isConnectedPlayer = room.players.some((player) => player.clientId === clientId && player.connected)
      if (!isConnectedPlayer) {
        send(socket, { type: 'error', message: 'Only active players can send game actions.' })
        return
      }

      const hostClient = room.hostClientId ? clients.get(room.hostClientId) : null
      if (!hostClient) {
        send(socket, { type: 'error', message: 'Host is unavailable.' })
        return
      }

      send(hostClient.socket, {
        type: 'host_action_request',
        roomCode: client.roomCode,
        fromClientId: clientId,
        action: message.action,
        meta: message.meta ?? null,
      })
      return
    }

    if (message.type === 'host_state_update') {
      const client = clients.get(clientId)
      if (!client?.roomCode) {
        send(socket, { type: 'error', message: 'You are not in a room.' })
        return
      }

      const room = rooms.get(client.roomCode)
      if (!room?.gameSession) {
        send(socket, { type: 'error', message: 'No active game session.' })
        return
      }

      if (room.hostClientId !== clientId) {
        send(socket, { type: 'error', message: 'Only host can publish game state.' })
        return
      }

      if (!message.state || typeof message.state !== 'object') {
        send(socket, { type: 'error', message: 'Invalid state payload.' })
        return
      }

      room.gameSession.authoritativeState = message.state

      const winner = message.state?.winner
      if (winner && !room.gameSession.rematch?.active) {
        beginRematchVoting(client.roomCode)
      } else if (!winner && room.gameSession.rematch?.active) {
        clearRematchTimer(room)
        room.gameSession.rematch = null
        broadcastRoom(client.roomCode)
      }

      const seq = room.gameSession.nextStateSeq
      room.gameSession.nextStateSeq += 1

      const incomingLastAction = message.lastAction && typeof message.lastAction === 'object' ? message.lastAction : null
      const actorIndexFromClient = incomingLastAction
        ? getPlayerIndexByClientId(room, incomingLastAction.fromClientId)
        : -1
      const normalizedLastAction = incomingLastAction
        ? {
            ...incomingLastAction,
            actorPlayerIndex:
              Number.isInteger(incomingLastAction.actorPlayerIndex) &&
              incomingLastAction.actorPlayerIndex >= 0 &&
              incomingLastAction.actorPlayerIndex < room.players.length
                ? incomingLastAction.actorPlayerIndex
                : actorIndexFromClient >= 0
                  ? actorIndexFromClient
                  : null,
          }
        : null

      sendMaskedStateUpdateToRoom(client.roomCode, {
        seq,
        lastAction: normalizedLastAction,
      })
      return
    }

    if (message.type === 'rematch_vote') {
      const client = clients.get(clientId)
      if (!client?.roomCode) {
        send(socket, { type: 'error', message: 'You are not in a room.' })
        return
      }

      const room = rooms.get(client.roomCode)
      if (!room?.gameSession?.rematch?.active) {
        return
      }

      const seat = room.players.find((player) => player.clientId === clientId && player.connected)
      if (!seat) {
        send(socket, { type: 'error', message: 'Only active players can vote for rematch.' })
        return
      }

      room.gameSession.rematch.votes[clientId] = Boolean(message.accept)
      broadcastRoom(client.roomCode)

      const connectedSeats = connectedSeatEntries(room)
      const everyoneResponded = connectedSeats.every(({ player }) =>
        typeof room.gameSession.rematch.votes[player.clientId] === 'boolean',
      )
      if (everyoneResponded) {
        finalizeRematchVoting(client.roomCode)
      }
      return
    }

    if (message.type === 'request_snapshot') {
      const client = clients.get(clientId)
      if (!client?.roomCode) {
        send(socket, { type: 'error', message: 'You are not in a room.' })
        return
      }

      const room = rooms.get(client.roomCode)
      if (!room?.gameSession) {
        send(socket, { type: 'error', message: 'No active game session.' })
        return
      }

      if (!room.gameSession.authoritativeState) {
        send(socket, { type: 'error', message: 'Snapshot not available yet.' })
        return
      }

      const viewerIndex = getPlayerIndexByClientId(room, clientId)
      send(socket, {
        type: 'state_update',
        roomCode: client.roomCode,
        seq: room.gameSession.nextStateSeq - 1,
        state: buildMaskedStateForViewer(room.gameSession.authoritativeState, viewerIndex),
        lastAction: null,
      })
      return
    }

    send(socket, { type: 'error', message: `Unknown message type: ${message.type}` })
  })

  socket.on('close', () => {
    removeFromRoom(clientId, { preserveSeatOnDisconnect: true })
    clients.delete(clientId)
  })
})

try {
  await connectMongo()
} catch (error) {
  console.error('Failed to connect to MongoDB:', error)
  process.exit(1)
}

let shuttingDown = false

async function shutdown(signal) {
  if (shuttingDown) {
    return
  }
  shuttingDown = true

  console.log(`Received ${signal}. Shutting down LAN server...`)

  clients.forEach(({ socket }) => {
    try {
      socket.close()
    } catch {
      // ignore socket close errors during shutdown
    }
  })

  await new Promise((resolve) => {
    wss.close(() => resolve())
  })
  await closeMongo()
  process.exit(0)
}

process.on('SIGINT', () => {
  void shutdown('SIGINT')
})

process.on('SIGTERM', () => {
  void shutdown('SIGTERM')
})

console.log(`LAN lobby server running on ws://0.0.0.0:${PORT}`)
