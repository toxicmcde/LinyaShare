import { NextRequest, NextResponse } from "next/server"
import { requireUser } from "@/lib/auth-guards"
import { cleanupExpiredUploadSessions, createUploadSession } from "@/lib/upload-session"
import { consumeRateLimit } from "@/lib/rate-limit"

export async function POST(request: NextRequest) {
  const current = await requireUser()
  if (!current) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { userId } = current

  const limit = consumeRateLimit(`upload-session:${userId}`, 10, 60_000, 60_000)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many upload requests" },
      { status: 429, headers: { "Retry-After": limit.retryAfterSeconds.toString() } }
    )
  }

  try {
    const body = await request.json()
    await cleanupExpiredUploadSessions()
    const upload = await createUploadSession(userId, {
      originalName: body?.name,
      mimeType: body?.type,
      expectedSize: body?.size,
    })
    return NextResponse.json({
      success: true,
      uploadId: upload.id,
      chunkSize: upload.chunkSize,
      expiresAt: upload.expiresAt,
    })
  } catch (error) {
    console.error("Upload session error:", error)
    const message = error instanceof Error ? error.message : ""
    const status = message === "Storage limit exceeded" ? 413 : message === "Too many concurrent uploads" ? 429 : 400
    const errorMessage = status === 413
      ? "Storage limit exceeded"
      : status === 429
        ? "Too many concurrent uploads"
        : "Unable to create upload session"
    return NextResponse.json({ error: errorMessage }, { status })
  }
}
