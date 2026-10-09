import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MongoClient } from 'mongodb'

const MATCH_LOG_LIMIT = 500
const CHAT_LOG_LIMIT = 1000
const MONGO_CONNECT_TIMEOUT_MS = 2500

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'data')
const DATA_FILE = path.join(DATA_DIR, 'temporis-db.json')

function toApiStat(entry) {
  return {
    nickname: entry.nickname,
    isBot: Boolean(entry.isBot),
    wins: Number(entry.wins ?? 0),
    losses: Number(entry.losses ?? 0),
    gamesPlayed: Number(entry.gamesPlayed ?? 0),
    botGames: Number(entry.botGames ?? 0),
    humanGames: Number(entry.humanGames ?? 0),
    lastMode: entry.lastMode ?? null,
    lastSeenAt: entry.lastSeenAt ?? null,
  }
}

function sortStatsEntries(entries) {
  return entries.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins
    if (a.losses !== b.losses) return a.losses - b.losses
    if (b.gamesPlayed !== a.gamesPlayed) return b.gamesPlayed - a.gamesPlayed
    return String(a.nickname).localeCompare(String(b.nickname))
  })
}

function applyMatchToStatsMap(statsMap, players, mode, now) {
  for (const player of players) {
    const nicknameLower = player.nickname.toLowerCase()
    const existing = statsMap[nicknameLower] ?? {
      nicknameLower,
      nickname: player.nickname,
      isBot: player.isBot,
      firstSeenAt: now,
      gamesPlayed: 0,
      wins: 0,
      losses: 0,
      botGames: 0,
      humanGames: 0,
    }

    existing.nickname = player.nickname
    existing.isBot = player.isBot
    existing.lastSeenAt = now
    existing.lastMode = mode
    existing.gamesPlayed += 1
    existing.wins += player.won ? 1 : 0
    existing.losses += player.won ? 0 : 1
    existing.botGames += player.isBot ? 1 : 0
    existing.humanGames += player.isBot ? 0 : 1

    statsMap[nicknameLower] = existing
  }
}

function createNullPersistence() {
  return {
    kind: 'none',
    async recordChatMessage() {},
    async recordMatchResult() {},
    async getPlayerStats() {
      return []
    },
    async close() {},
  }
}

async function createFilePersistence() {
  await mkdir(DATA_DIR, { recursive: true })

  let data = { chatMessages: [], matchLogs: [], playerStats: {} }
  try {
    const raw = await readFile(DATA_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    data = {
      chatMessages: Array.isArray(parsed.chatMessages) ? parsed.chatMessages : [],
      matchLogs: Array.isArray(parsed.matchLogs) ? parsed.matchLogs : [],
      playerStats: parsed.playerStats && typeof parsed.playerStats === 'object' ? parsed.playerStats : {},
    }
  } catch {
    // No previous data file (or corrupted) — start fresh.
  }

  let saveTimer = null
  let savePromise = Promise.resolve()

  async function flush() {
    const snapshot = JSON.stringify(data, null, 2)
    const tmpFile = `${DATA_FILE}.tmp`
    await writeFile(tmpFile, snapshot, 'utf8')
    await rename(tmpFile, DATA_FILE)
  }

  function scheduleSave() {
    if (saveTimer) {
      return
    }
    saveTimer = setTimeout(() => {
      saveTimer = null
      savePromise = savePromise.then(() => flush()).catch((error) => {
        console.error('Failed to write JSON persistence file:', error)
      })
    }, 250)
  }

  return {
    kind: 'file',

    async recordChatMessage(entry) {
      data.chatMessages.push(entry)
      if (data.chatMessages.length > CHAT_LOG_LIMIT) {
        data.chatMessages = data.chatMessages.slice(-CHAT_LOG_LIMIT)
      }
      scheduleSave()
    },

    async recordMatchResult(document, players) {
      data.matchLogs.push(document)
      if (data.matchLogs.length > MATCH_LOG_LIMIT) {
        data.matchLogs = data.matchLogs.slice(-MATCH_LOG_LIMIT)
      }
      applyMatchToStatsMap(data.playerStats, players, document.mode, new Date().toISOString())
      // Match results flush immediately (not debounced) so a finished game is never lost.
      if (saveTimer) {
        clearTimeout(saveTimer)
        saveTimer = null
      }
      savePromise = savePromise.then(() => flush()).catch((error) => {
        console.error('Failed to write JSON persistence file:', error)
      })
      await savePromise
    },

    async getPlayerStats(limit) {
      const sorted = sortStatsEntries(Object.values(data.playerStats))
      return sorted.slice(0, limit).map(toApiStat)
    },

    async close() {
      if (saveTimer) {
        clearTimeout(saveTimer)
        saveTimer = null
        await flush()
      }
      await savePromise
    },
  }
}

async function createMongoPersistence(mongoUri, mongoDbName) {
  const mongoClient = new MongoClient(mongoUri, { serverSelectionTimeoutMS: MONGO_CONNECT_TIMEOUT_MS })
  await mongoClient.connect()

  const mongoDb = mongoClient.db(mongoDbName)
  const chatMessagesCollection = mongoDb.collection('chat_messages')
  const matchLogsCollection = mongoDb.collection('match_logs')
  const playerStatsCollection = mongoDb.collection('player_stats')

  await chatMessagesCollection.createIndex({ roomCode: 1, timestamp: -1 })
  await matchLogsCollection.createIndex({ createdAt: -1 })
  await matchLogsCollection.createIndex({ mode: 1, createdAt: -1 })
  await playerStatsCollection.createIndex({ nicknameLower: 1 }, { unique: true })
  await playerStatsCollection.createIndex({ wins: -1, losses: 1 })

  return {
    kind: 'mongo',

    async recordChatMessage(entry) {
      await chatMessagesCollection.insertOne(entry)
    },

    async recordMatchResult(document, players) {
      await matchLogsCollection.insertOne(document)

      const now = new Date()
      const updates = players.map((player) => {
        const nicknameLower = player.nickname.toLowerCase()
        return {
          updateOne: {
            filter: { nicknameLower },
            update: {
              $setOnInsert: {
                nicknameLower,
                firstSeenAt: now,
              },
              $set: {
                nickname: player.nickname,
                lastSeenAt: now,
                lastMode: document.mode,
                isBot: player.isBot,
              },
              $inc: {
                gamesPlayed: 1,
                wins: player.won ? 1 : 0,
                losses: player.won ? 0 : 1,
                botGames: player.isBot ? 1 : 0,
                humanGames: player.isBot ? 0 : 1,
              },
            },
            upsert: true,
          },
        }
      })

      if (updates.length > 0) {
        try {
          await playerStatsCollection.bulkWrite(updates, { ordered: false })
        } catch (error) {
          console.error('Failed to update player stats after saving match log:', error)
        }
      }
    },

    async getPlayerStats(limit) {
      const stats = await playerStatsCollection
        .find({})
        .sort({ wins: -1, losses: 1, gamesPlayed: -1, nickname: 1 })
        .limit(limit)
        .toArray()
      return stats.map(toApiStat)
    },

    async close() {
      await mongoClient.close()
    },
  }
}

/**
 * Creates the persistence layer for the LAN server.
 *
 * DB_MODE values:
 * - 'auto'  (default): try MongoDB, fall back to a local JSON file on failure
 * - 'mongo': require MongoDB (throws if unavailable)
 * - 'file' : JSON file at server/data/temporis-db.json
 * - 'none' : persistence disabled (APIs respond with empty data)
 */
export async function createPersistence() {
  const mode = String(process.env.DB_MODE ?? 'auto').toLowerCase()
  const mongoUri = process.env.MONGO_URI ?? 'mongodb://127.0.0.1:27017'
  const mongoDbName = process.env.MONGO_DB_NAME ?? 'temporis'

  if (mode === 'none') {
    return createNullPersistence()
  }

  if (mode === 'file') {
    return createFilePersistence()
  }

  if (mode === 'mongo') {
    return createMongoPersistence(mongoUri, mongoDbName)
  }

  try {
    return await createMongoPersistence(mongoUri, mongoDbName)
  } catch (error) {
    console.warn(`MongoDB unavailable (${error?.message ?? error}). Using JSON file persistence: ${DATA_FILE}`)
    return createFilePersistence()
  }
}
