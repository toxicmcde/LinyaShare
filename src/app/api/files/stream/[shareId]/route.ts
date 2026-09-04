import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getFileByShareId } from "@/lib/upload"
import { verifyShareGrant } from "@/lib/share-access"
import { deliverFile } from "@/lib/file-delivery"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ shareId: string }> }
) {
  try {
    const { shareId } = await params
    const file = await getFileByShareId(shareId)
    if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 })
    if (file.status !== "ACTIVE") return NextResponse.json({ error: "File not found" }, { status: 404 })

    const session = await auth()
    const isOwner = !!session?.user && file.userId === (session.user as any).id
    const hasShareAccess = !file.password || isOwner || verifyShareGrant(request, "file", shareId, file.accessVersion)
    if (!hasShareAccess) {
      return NextResponse.json({ error: "Password required" }, { status: 401 })
    }
    if (request.nextUrl.searchParams.has("password")) {
      return NextResponse.json({ error: "Password query parameters are not supported" }, { status: 400 })
    }

    return deliverFile(request, file, {
      download: request.nextUrl.searchParams.get("download") === "1",
    })
  } catch (error) {
    console.error("File stream error:", error)
    return NextResponse.json({ error: "Unable to deliver file" }, { status: 500 })
  }
}
