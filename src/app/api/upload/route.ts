import { NextRequest, NextResponse } from "next/server"
import { requireUser } from "@/lib/auth-guards"
import { acceptUploadChunk } from "@/lib/upload-session"
import { CHUNK_SIZE } from "@/lib/constants"

async function readChunk(request: NextRequest): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array()
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      total += result.value.byteLength
      if (total > CHUNK_SIZE) throw new Error("Chunk too large")
      chunks.push(result.value)
    }
  } finally {
    reader.releaseLock()
  }

  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

export async function POST(request: NextRequest) {
  const current = await requireUser()
  if (!current) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { userId } = current

  const uploadId = request.headers.get("x-upload-id");
  const rawChunkIndex = request.headers.get("x-chunk-index");
  if (!uploadId || !rawChunkIndex || !/^\d+$/.test(rawChunkIndex)) {
    return NextResponse.json({ error: "Invalid upload metadata" }, { status: 400 });
  }

  try {
    const bytes = await readChunk(request)
    const result = await acceptUploadChunk(userId, uploadId, Number(rawChunkIndex), bytes)
    return NextResponse.json({
      success: true,
      receivedBytes: result.receivedBytes,
      nextChunk: result.nextChunk,
      expiresAt: result.expiresAt,
    })
  } catch (error) {
    console.error("Upload chunk error:", error)
    const status = error instanceof Error && error.message === "Chunk too large" ? 413 : 400
    return NextResponse.json({ error: status === 413 ? "Chunk too large" : "Upload failed" }, { status })
  }
}
