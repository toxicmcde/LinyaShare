import { NextRequest, NextResponse } from "next/server"
import { requireUser } from "@/lib/auth-guards"
import { finalizeUploadSession } from "@/lib/upload-session"

export async function POST(request: NextRequest) {
  const current = await requireUser()
  if (!current) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { userId } = current

  try {
    const body = await request.json()
    if (typeof body?.uploadId !== "string") {
      return NextResponse.json({ error: "Upload ID is required" }, { status: 400 })
    }
    const result = await finalizeUploadSession(userId, body.uploadId, body.password)
    const file = result.file as Record<string, unknown>
    return NextResponse.json({
      success: true,
      file: {
        id: file.id,
        shareId: file.shareId,
        originalName: file.originalName,
        type: file.type,
        size: file.size,
        hasPassword: !!file.password,
      },
      // Returned only once in the creation response; never read back from DB.
      password: result.password,
    })
  } catch (error) {
    console.error("Upload finalization error:", error)
    return NextResponse.json({ error: "Unable to finalize upload" }, { status: 400 })
  }
}
