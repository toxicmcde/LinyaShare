import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getAlbumByShareId } from "@/lib/albums"
import { verifyShareGrant } from "@/lib/share-access"
import { deliverFile } from "@/lib/file-delivery"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ shareId: string; fileShareId: string }> }
) {
  try {
    const { shareId, fileShareId } = await params
    const album = await getAlbumByShareId(shareId)
    if (!album) return NextResponse.json({ error: "Album not found" }, { status: 404 })

    const session = await auth()
    const isOwner = !!session?.user && album.userId === (session.user as any).id
    if (album.password && !isOwner && !verifyShareGrant(request, "album", shareId, album.accessVersion)) {
      return NextResponse.json({ error: "Password required" }, { status: 401 })
    }

    const item = album.items.find((entry) => entry.file.shareId === fileShareId)
    if (!item) return NextResponse.json({ error: "File not found in album" }, { status: 404 })

    if (item.file.password && !isOwner && !verifyShareGrant(request, "file", fileShareId, item.file.accessVersion)) {
      return NextResponse.json({ error: "File password required" }, { status: 401 })
    }
    if (request.nextUrl.searchParams.has("password")) {
      return NextResponse.json({ error: "Password query parameters are not supported" }, { status: 400 })
    }

    return deliverFile(request, item.file, {
      download: request.nextUrl.searchParams.get("download") === "1",
    })
  } catch (error) {
    console.error("Album file delivery error:", error)
    return NextResponse.json({ error: "Unable to deliver album file" }, { status: 500 })
  }
}
