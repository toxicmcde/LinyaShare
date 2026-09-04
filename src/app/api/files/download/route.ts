import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getFileByShareId } from "@/lib/upload"
import bcrypt from "bcryptjs"
import { deliverFile } from "@/lib/file-delivery"
import { consumeRateLimit, clearRateLimit, getClientIp } from "@/lib/rate-limit"
import { setShareGrantCookie, verifyShareGrant } from "@/lib/share-access"

export async function POST(request: NextRequest) {
  try {
    const { shareId, password } = await request.json()
    if (typeof shareId !== "string") {
      return NextResponse.json({ error: "File ID is required" }, { status: 400 })
    }

    const file = await getFileByShareId(shareId)
    if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 })
    if (file.status !== "ACTIVE") return NextResponse.json({ error: "File not found" }, { status: 404 })

    const session = await auth()
    const isOwner = !!session?.user && file.userId === (session.user as any).id
    let issueGrant = false
    if (file.password && !isOwner && !verifyShareGrant(request, "file", shareId, file.accessVersion)) {
      const limitKey = `file-password:${shareId}:${getClientIp(request)}`
      const limit = consumeRateLimit(limitKey, 5, 5 * 60 * 1000, 15 * 60 * 1000)
      if (!limit.allowed) {
        return NextResponse.json(
          { error: "Too many attempts" },
          { status: 429, headers: { "Retry-After": limit.retryAfterSeconds.toString() } }
        )
      }
      if (typeof password !== "string" || !password) {
        return NextResponse.json({ error: "Password required", needsPassword: true }, { status: 401 })
      }
      if (!(await bcrypt.compare(password, file.password))) {
        return NextResponse.json({ error: "Invalid password" }, { status: 403 })
      }
      clearRateLimit(limitKey)
      issueGrant = true
    }

    const response = await deliverFile(request, file, { download: true })
    if (issueGrant) setShareGrantCookie(response, "file", shareId, file.accessVersion)
    return response
  } catch (error) {
    console.error("File download error:", error)
    return NextResponse.json({ error: "Unable to download file" }, { status: 500 })
  }
}
