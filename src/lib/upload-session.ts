import { randomUUID } from "crypto"
import { mkdir, open, readdir, readFile, unlink } from "fs/promises"
import { existsSync } from "fs"
import path from "path"
import { prisma } from "@/lib/prisma"
import { CHUNK_SIZE, UPLOAD_DIR } from "@/lib/constants"
import { validatePassword } from "@/lib/validation"
import { finalizeUserUpload } from "@/lib/upload"

const SESSION_TTL_MS = 60 * 60 * 1000
const MAX_OPEN_SESSIONS_PER_USER = 3
const MAX_UPLOAD_SIZE = parsePositiveInt(process.env.MAX_UPLOAD_SIZE_BYTES, 5 * 1024 * 1024 * 1024)
const UPLOAD_SESSION_DIR = path.join(UPLOAD_DIR, ".sessions")
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type UploadSessionMetadata = {
  id: string
  originalName: string
  mimeType: string
  expectedSize: number
  receivedBytes: number
  nextChunk: number
  expiresAt: Date
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = value ? Number(value) : NaN
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

function assertUploadId(uploadId: string): void {
  if (!UUID_RE.test(uploadId)) throw new Error("Invalid upload ID")
}

function resolveSessionFile(name: string): string {
  const base = path.resolve(UPLOAD_SESSION_DIR)
  const candidate = path.resolve(base, name)
  if (path.dirname(candidate) !== base) throw new Error("Invalid upload path")
  return candidate
}

function resolveTempPath(uploadId: string): string {
  assertUploadId(uploadId)
  const base = path.resolve(UPLOAD_DIR)
  const candidate = path.resolve(base, `${uploadId}.tmp`)
  if (path.dirname(candidate) !== base) throw new Error("Invalid upload path")
  return candidate
}

function chunkPath(uploadId: string, index: number): string {
  assertUploadId(uploadId)
  if (!Number.isSafeInteger(index) || index < 0) throw new Error("Invalid chunk index")
  return resolveSessionFile(`${uploadId}.${index}.part`)
}

function validateFileName(value: unknown): string {
  if (typeof value !== "string") throw new Error("Filename is required")
  if (!value || value.length > 255 || /[\u0000\r\n\\/]/.test(value)) {
    throw new Error("Invalid filename")
  }
  return value
}

function metadataFromSession(session: {
  id: string
  originalName: string
  mimeType: string
  expectedSize: number
  receivedBytes: number
  nextChunk: number
  expiresAt: Date
}): UploadSessionMetadata {
  return {
    id: session.id,
    originalName: session.originalName,
    mimeType: session.mimeType,
    expectedSize: session.expectedSize,
    receivedBytes: session.receivedBytes,
    nextChunk: session.nextChunk,
    expiresAt: session.expiresAt,
  }
}

export async function createUploadSession(
  userId: string,
  metadata: { originalName: unknown; mimeType: unknown; expectedSize: unknown }
): Promise<UploadSessionMetadata & { chunkSize: number }> {
  const originalName = validateFileName(metadata.originalName)
  const mimeType = typeof metadata.mimeType === "string" && metadata.mimeType.length <= 200
    ? metadata.mimeType
    : "application/octet-stream"
  const expectedSize = typeof metadata.expectedSize === "number"
    ? metadata.expectedSize
    : Number(metadata.expectedSize)

  if (!Number.isSafeInteger(expectedSize) || expectedSize < 0 || expectedSize > MAX_UPLOAD_SIZE) {
    throw new Error("Invalid or oversized upload")
  }

  await mkdir(UPLOAD_DIR, { recursive: true })
  await mkdir(UPLOAD_SESSION_DIR, { recursive: true })

  const id = randomUUID()
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)

  const session = await prisma.$transaction(async (tx) => {
    // Updating the user row first serializes quota reservations for the same user
    // across SQLite, MySQL, and PostgreSQL transactions.
    const user = await tx.user.findUnique({ where: { id: userId } })
    if (!user) throw new Error("User not found")
    await tx.user.update({ where: { id: userId }, data: { maxSize: user.maxSize } })

    const currentUser = await tx.user.findUnique({ where: { id: userId } })
    if (!currentUser) throw new Error("User not found")
    const used = await tx.file.aggregate({ where: { userId, status: "ACTIVE" }, _sum: { size: true } })
    const reserved = await tx.uploadSession.aggregate({
      where: { userId, status: "OPEN", expiresAt: { gt: new Date() } },
      _sum: { reservedBytes: true },
    })
    const totalReserved = reserved._sum.reservedBytes || 0
    const totalUsed = used._sum.size || 0
    const openSessionCount = await tx.uploadSession.count({
      where: { userId, status: "OPEN", expiresAt: { gt: new Date() } },
    })
    if (openSessionCount >= MAX_OPEN_SESSIONS_PER_USER) {
      throw new Error("Too many concurrent uploads")
    }
    if (totalUsed + totalReserved + expectedSize > (currentUser.maxSize || 0)) {
      throw new Error("Storage limit exceeded")
    }

    return tx.uploadSession.create({
      data: {
        id,
        userId,
        originalName,
        mimeType,
        expectedSize,
        reservedBytes: expectedSize,
        expiresAt,
      },
    })
  })

  return { ...metadataFromSession(session), chunkSize: CHUNK_SIZE }
}

export async function acceptUploadChunk(
  userId: string,
  uploadId: string,
  chunkIndex: number,
  bytes: Uint8Array
): Promise<UploadSessionMetadata> {
  assertUploadId(uploadId)
  if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0) throw new Error("Invalid chunk index")
  if (bytes.byteLength > CHUNK_SIZE) throw new Error("Chunk too large")

  const session = await prisma.uploadSession.findUnique({ where: { id: uploadId } })
  if (!session || session.userId !== userId || session.status !== "OPEN") {
    throw new Error("Upload session not found")
  }
  if (session.expiresAt.getTime() <= Date.now()) throw new Error("Upload session expired")
  if (session.nextChunk !== chunkIndex) throw new Error("Unexpected chunk index")
  if (session.receivedBytes + bytes.byteLength > session.expectedSize) {
    throw new Error("Upload exceeds declared size")
  }

  const part = chunkPath(uploadId, chunkIndex)
  await mkdir(UPLOAD_SESSION_DIR, { recursive: true })
  const handle = await open(part, "wx")
  try {
    await handle.write(bytes)
  } finally {
    await handle.close()
  }

  const updated = await prisma.uploadSession.updateMany({
    where: { id: uploadId, userId, status: "OPEN", nextChunk: chunkIndex, expiresAt: { gt: new Date() } },
    data: {
      nextChunk: { increment: 1 },
      receivedBytes: { increment: bytes.byteLength },
    },
  })

  if (updated.count !== 1) {
    await unlink(part).catch(() => {})
    throw new Error("Upload session changed")
  }

  const current = await prisma.uploadSession.findUnique({ where: { id: uploadId } })
  if (!current) throw new Error("Upload session not found")
  return metadataFromSession(current)
}

async function assembleChunks(session: UploadSessionMetadata): Promise<void> {
  const tempPath = resolveTempPath(session.id)
  const totalChunks = Math.max(1, Math.ceil(session.expectedSize / CHUNK_SIZE))
  const target = await open(tempPath, "wx")
  try {
    for (let index = 0; index < totalChunks; index += 1) {
      const part = chunkPath(session.id, index)
      const data = await readFile(part)
      await target.write(data)
      await unlink(part)
    }
  } catch (error) {
    await target.close()
    await unlink(tempPath).catch(() => {})
    throw error
  }
  await target.close()
}

export async function finalizeUploadSession(
  userId: string,
  uploadId: string,
  password?: unknown
) {
  assertUploadId(uploadId)
  const session = await prisma.uploadSession.findUnique({ where: { id: uploadId } })
  if (!session || session.userId !== userId || session.status !== "OPEN") {
    throw new Error("Upload session not found")
  }
  if (session.expiresAt.getTime() <= Date.now()) throw new Error("Upload session expired")

  const expectedChunks = Math.max(1, Math.ceil(session.expectedSize / CHUNK_SIZE))
  if (session.nextChunk !== expectedChunks || session.receivedBytes !== session.expectedSize) {
    throw new Error("Upload incomplete")
  }

  const cleanPassword = password === undefined || password === null || password === ""
    ? undefined
    : validatePassword(password)
  if (password !== undefined && password !== null && password !== "" && !cleanPassword) {
    throw new Error("Password must be between 8 and 256 characters")
  }

  await assembleChunks(metadataFromSession(session))

  try {
    const file = await finalizeUserUpload(
      session.id,
      session.originalName,
      session.mimeType,
      userId,
      cleanPassword
    )
    await prisma.uploadSession.deleteMany({ where: { id: uploadId, userId } })
    return { file, password: cleanPassword }
  } catch (error) {
    // Keep the database session for cleanup/retry diagnostics; never expose its
    // metadata to an unauthenticated caller.
    throw error
  }
}

export async function cleanupExpiredUploadSessions(): Promise<number> {
  const expired = await prisma.uploadSession.findMany({
    where: { status: "OPEN", expiresAt: { lte: new Date() } },
    select: { id: true },
  })
  if (expired.length === 0) return 0

  const names = existsSync(UPLOAD_SESSION_DIR) ? await readdir(UPLOAD_SESSION_DIR) : []
  const expiredIds = new Set(expired.map((session) => session.id))
  for (const name of names) {
    const match = /^([0-9a-f-]{36})(?:\.\d+\.part)?$/i.exec(name)
    if (match && expiredIds.has(match[1])) {
      await unlink(resolveSessionFile(name)).catch(() => {})
    }
  }
  await prisma.uploadSession.deleteMany({ where: { id: { in: expired.map((session) => session.id) } } })
  return expired.length
}
