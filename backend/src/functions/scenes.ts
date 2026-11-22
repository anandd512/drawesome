import { app, HttpRequest } from '@azure/functions'
import { HttpError, readJson, route } from '../lib/http'
import { requireUserId } from '../lib/session'
import { requireUser } from '../lib/accounts'
import { deleteScene, listScenes, readScene, SCENE_ID_RE, SceneConflict, writeScene } from '../lib/scenes'

// Drawing sync. The browser stays the source of truth for editing; these endpoints let
// it back scenes up and pick up edits made on other devices.
//   GET    /scenes        → { scenes: [{ id, name, updatedAt, deleted }] }
//   GET    /scenes/{id}   → { scene: { id, name, updatedAt, elements } }
//   PUT    /scenes/{id}   { name, updatedAt, elements } → { updatedAt }
//   DELETE /scenes/{id}?deletedAt=<ms>
// PUT and DELETE answer 409 { remote } when the stored copy is newer (edited on another
// device); the client then downloads that copy instead.
const MAX_CLOCK_AHEAD_MS = 24 * 60 * 60_000

function sceneId(request: HttpRequest): string {
  const id = request.params.id ?? ''
  if (!SCENE_ID_RE.test(id)) throw new HttpError(400, 'Invalid scene id')
  return id
}

function editTime(value: unknown): number {
  const t = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(t) || t <= 0 || t > Date.now() + MAX_CLOCK_AHEAD_MS) throw new HttpError(400, 'Invalid timestamp')
  return Math.floor(t)
}

function conflict(err: unknown): never {
  if (err instanceof SceneConflict) throw new HttpError(409, err.message, { remote: err.remote })
  throw err
}

app.http('scenesList', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'scenes',
  handler: route('scenesList', async (request) => {
    const userId = await requireUserId(request)
    return { status: 200, jsonBody: { scenes: await listScenes(userId) } }
  })
})

app.http('sceneGet', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'scenes/{id}',
  handler: route('sceneGet', async (request) => {
    const userId = await requireUserId(request)
    const scene = await readScene(userId, sceneId(request))
    if (!scene) throw new HttpError(404, 'This drawing was deleted')
    return { status: 200, jsonBody: { scene } }
  })
})

app.http('scenePut', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'scenes/{id}',
  handler: route('scenePut', async (request) => {
    // Checks the account still exists, so a device holding an old session can't
    // recreate drawings for a deleted account.
    const user = await requireUser(request)
    const id = sceneId(request)
    const body = await readJson<{ name?: unknown; updatedAt?: unknown; elements?: unknown }>(request)
    if (!Array.isArray(body.elements)) throw new HttpError(400, 'elements must be an array')
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 200) : 'Untitled'
    const updatedAt = editTime(body.updatedAt)
    try {
      await writeScene(user.id, { id, name, updatedAt, elements: body.elements })
    } catch (err) {
      conflict(err)
    }
    return { status: 200, jsonBody: { updatedAt } }
  })
})

app.http('sceneDelete', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'scenes/{id}',
  handler: route('sceneDelete', async (request) => {
    const userId = await requireUserId(request)
    const id = sceneId(request)
    const deletedAt = editTime(request.query.get('deletedAt') ?? Date.now())
    try {
      await deleteScene(userId, id, deletedAt)
    } catch (err) {
      conflict(err)
    }
    return { status: 200, jsonBody: { ok: true } }
  })
})
