import { NextRequest, NextResponse } from "next/server"
import { getFileByShareId } from "@/lib/upload"
import bcrypt from "bcryptjs"
import { consumeRateLimit, clearRateLimit, getClientIp } from "@/lib/rate-limit"
import { setShareGrantCookie } from "@/lib/share-access"

const MAX_ATTEMPTS = 5
const WINDOW_MS = 5 * 60 * 1000
const BLOCK_MS = 15 * 60 * 1000

// Pure password verification (no download, no counter increment).
// Called by the share page to unlock the preview
// without increasing the download counter.
export async function POST(request: NextRequest) {
  try {
    const { shareId, password } = await request.json()

    const file = await getFileByShareId(shareId)
    if (!file) {
      return NextResponse.json({ error: "File not found" }, { status: 404 })
    }
    if (file.status !== "ACTIVE") {
      return NextResponse.json({ error: "File not found" }, { status: 404 })
    }

    if (file.password) {
      const limitKey = `file-password:${shareId}:${getClientIp(request)}`
      const limit = consumeRateLimit(limitKey, MAX_ATTEMPTS, WINDOW_MS, BLOCK_MS)
      if (!limit.allowed) {
        return NextResponse.json(
          { error: "Too many attempts" },
          { status: 429, headers: { "Retry-After": limit.retryAfterSeconds.toString() } }
        )
      }
      if (!password) {
        return NextResponse.json({ error: "Password required", needsPassword: true }, { status: 401 })
      }
      const valid = await bcrypt.compare(password, file.password)
      if (!valid) {
        return NextResponse.json({ error: "Invalid password" }, { status: 403 })
      }
      clearRateLimit(limitKey)
    }

    const response = NextResponse.json({ ok: true })
    if (file.password) setShareGrantCookie(response, "file", shareId, file.accessVersion)
    return response
  } catch (error) {
    console.error("File verification error:", error)
    return NextResponse.json({ error: "Unable to verify file" }, { status: 500 })
  }
}
