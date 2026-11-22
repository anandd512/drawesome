import { BlobServiceClient, ContainerClient, RestError } from '@azure/storage-blob'
import { DefaultAzureCredential } from '@azure/identity'

// Each drawing is one JSON blob: scenes/<userId>/<sceneId>.json. Blob writes cost the
// same whatever the size, which suits scenes with pasted images far better than Cosmos
// (billed by document size). The user id in the path always comes from the session,
// never from client input. Listing uses blob metadata (name, updatedAt, deleted), so
// the scenes list never downloads a drawing.
//
// A deleted scene leaves a tiny tombstone blob behind so other devices learn about the
// deletion instead of uploading their copy again. Tombstones are pruned after a while.
//
// In Azure the Function App reaches the account with its managed identity (no key);
// locally SCENES_STORAGE_CONNECTION_STRING can point at Azurite.
const TOMBSTONE_MAX_AGE_MS = 180 * 24 * 60 * 60_000
const MAX_NAME_LENGTH = 120

let container: ContainerClient | null = null
let ensured = false

function getContainer(): ContainerClient {
  if (!container) {
    const conn = process.env.SCENES_STORAGE_CONNECTION_STRING
    const account = process.env.SCENES_STORAGE_ACCOUNT_NAME
    let service: BlobServiceClient
    if (conn) service = BlobServiceClient.fromConnectionString(conn)
    else if (account) service = new BlobServiceClient(`https://${account}.blob.core.windows.net`, new DefaultAzureCredential())
    else throw new Error('SCENES_STORAGE_ACCOUNT_NAME (or SCENES_STORAGE_CONNECTION_STRING) is not configured')
    container = service.getContainerClient('scenes')
  }
  return container
}

async function scenes(): Promise<ContainerClient> {
  const c = getContainer()
  if (!ensured) {
    await c.createIfNotExists()
    ensured = true
  }
  return c
}

export const SCENE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

const blobName = (userId: string, sceneId: string): string => `${userId}/${sceneId}.json`

export interface SceneMeta {
  id: string
  name: string
  updatedAt: number // ms epoch, assigned by the client that made the edit
  deleted: boolean
}

export interface StoredScene {
  id: string
  name: string
  updatedAt: number
  elements: unknown[]
}

/** Raised when the stored copy is the same age or newer than the one being written. */
export class SceneConflict extends Error {
  constructor(public remote: SceneMeta) {
    super('Scene changed on another device')
  }
}

function metaFrom(id: string, metadata: Record<string, string> | undefined): SceneMeta {
  let name = 'Untitled'
  try {
    if (metadata?.name) name = decodeURIComponent(metadata.name)
  } catch {
    /* keep the default */
  }
  return { id, name, updatedAt: Number(metadata?.updatedat) || 0, deleted: metadata?.deleted === '1' }
}

function metadataFor(meta: SceneMeta): Record<string, string> {
  // Metadata values must be ASCII, so the name is percent-encoded.
  const out: Record<string, string> = {
    name: encodeURIComponent(meta.name.slice(0, MAX_NAME_LENGTH)),
    updatedat: String(meta.updatedAt)
  }
  if (meta.deleted) out.deleted = '1'
  return out
}

export async function listScenes(userId: string): Promise<SceneMeta[]> {
  const c = await scenes()
  const prefix = `${userId}/`
  const out: SceneMeta[] = []
  const stale: string[] = []
  for await (const blob of c.listBlobsFlat({ prefix, includeMetadata: true })) {
    const id = blob.name.slice(prefix.length).replace(/\.json$/, '')
    const meta = metaFrom(id, blob.metadata)
    if (meta.deleted && Date.now() - meta.updatedAt > TOMBSTONE_MAX_AGE_MS) stale.push(blob.name)
    else out.push(meta)
  }
  await Promise.all(stale.map((name) => c.getBlockBlobClient(name).deleteIfExists()))
  return out
}

async function currentMeta(userId: string, sceneId: string): Promise<{ meta: SceneMeta; etag: string } | null> {
  const blob = (await scenes()).getBlockBlobClient(blobName(userId, sceneId))
  try {
    const props = await blob.getProperties()
    return { meta: metaFrom(sceneId, props.metadata), etag: props.etag ?? '' }
  } catch (err) {
    if (err instanceof RestError && err.statusCode === 404) return null
    throw err
  }
}

export async function readScene(userId: string, sceneId: string): Promise<StoredScene | null> {
  const blob = (await scenes()).getBlockBlobClient(blobName(userId, sceneId))
  try {
    const buf = await blob.downloadToBuffer()
    const parsed = JSON.parse(buf.toString('utf8')) as Partial<StoredScene> & { deleted?: boolean }
    if (parsed.deleted || !Array.isArray(parsed.elements)) return null
    return {
      id: sceneId,
      name: typeof parsed.name === 'string' ? parsed.name : 'Untitled',
      updatedAt: Number(parsed.updatedAt) || 0,
      elements: parsed.elements
    }
  } catch (err) {
    if (err instanceof RestError && err.statusCode === 404) return null
    throw err
  }
}

/**
 * Writes `body` under `meta`, but only if the stored copy is older (last write wins on
 * the client's edit time). The ETag condition closes the gap between the check and the
 * write, so two devices saving at once can't both "win".
 */
async function conditionalWrite(userId: string, meta: SceneMeta, body: string): Promise<void> {
  const existing = await currentMeta(userId, meta.id)
  if (existing && existing.meta.updatedAt >= meta.updatedAt) throw new SceneConflict(existing.meta)
  const blob = (await scenes()).getBlockBlobClient(blobName(userId, meta.id))
  try {
    await blob.upload(body, Buffer.byteLength(body), {
      blobHTTPHeaders: { blobContentType: 'application/json' },
      metadata: metadataFor(meta),
      conditions: existing ? { ifMatch: existing.etag } : { ifNoneMatch: '*' }
    })
  } catch (err) {
    if (err instanceof RestError && (err.statusCode === 412 || err.statusCode === 409)) {
      const now = await currentMeta(userId, meta.id)
      throw new SceneConflict(now?.meta ?? meta)
    }
    throw err
  }
}

export async function writeScene(userId: string, scene: StoredScene): Promise<void> {
  const meta: SceneMeta = { id: scene.id, name: scene.name, updatedAt: scene.updatedAt, deleted: false }
  await conditionalWrite(userId, meta, JSON.stringify(scene))
}

/** Replaces the scene with a tombstone dated `deletedAt` (unless it was edited later). */
export async function deleteScene(userId: string, sceneId: string, deletedAt: number): Promise<void> {
  const existing = await currentMeta(userId, sceneId)
  if (existing?.meta.deleted) return
  const meta: SceneMeta = { id: sceneId, name: existing?.meta.name ?? 'Untitled', updatedAt: deletedAt, deleted: true }
  await conditionalWrite(userId, meta, JSON.stringify({ id: sceneId, deleted: true, updatedAt: deletedAt }))
}

/** Removes every blob for the user (account deletion). */
export async function deleteAllScenes(userId: string): Promise<void> {
  const c = await scenes()
  const names: string[] = []
  for await (const blob of c.listBlobsFlat({ prefix: `${userId}/` })) names.push(blob.name)
  await Promise.all(names.map((name) => c.getBlockBlobClient(name).deleteIfExists()))
}
