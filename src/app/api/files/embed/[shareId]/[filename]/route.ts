import { NextRequest, NextResponse } from "next/server"
import { getFileByShareId } from "@/lib/upload"
import { isSafeInlineType } from "@/lib/file-security"
import { deliverFile } from "@/lib/file-delivery"

// Path sanitization for shareId
function isValidShareId(shareId: string): boolean {
  // UUID format: only alphanumeric characters and hyphens
  return /^[a-zA-Z0-9-]+$/.test(shareId) && shareId.length >= 8 && shareId.length <= 50
}

// The [filename] segment turns the URL into a "direct link"
// that ends with the file extension (e.g. .../embed/{shareId}/video.mp4).
// Discord & co. only recognize video/audio/image files by such URLs.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ shareId: string; filename: string }> }
) {
  try {
    const { shareId } = await params

    // Path sanitization
    if (!isValidShareId(shareId)) {
      return NextResponse.json({ error: "Invalid share ID" }, { status: 400 })
    }

    // Get the file from the DB
    const file = await getFileByShareId(shareId)
    if (!file) {
      return NextResponse.json({ error: "File not found" }, { status: 404 })
    }
    if (file.status !== "ACTIVE") {
      return NextResponse.json({ error: "File not found" }, { status: 404 })
    }
    if (request.nextUrl.searchParams.has("password")) {
      return NextResponse.json({ error: "Password query parameters are not supported" }, { status: 400 })
    }

    // Password check: embed not available for password-protected files
    const session = await import("@/lib/auth").then(m => m.auth())
    const isOwner = session?.user && file.userId === (session.user as any).id

    if (file.password && !isOwner) {
      return NextResponse.json({ error: "Password protected" }, { status: 401 })
    }

    const mimeType = file.type || "application/octet-stream"
    const rawName = file.originalName || file.name

    // Never deliver active content (SVG, HTML, JS, XML, etc.) as embed
    if (!isSafeInlineType(mimeType, rawName)) {
      return NextResponse.json({ error: "Blocked" }, { status: 403 })
    }

    return deliverFile(request, file, {
      extraHeaders: {
        "Cache-Control": "public, max-age=3600",
        "Access-Control-Allow-Origin": "*",
        "Content-Security-Policy": "sandbox",
      }
    })
  } catch (error) {
    console.error("File embed error:", error)
    return NextResponse.json({ error: "Unable to deliver file" }, { status: 500 })
  }
}
