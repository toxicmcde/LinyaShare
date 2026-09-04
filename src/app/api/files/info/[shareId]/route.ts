import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { verifyShareGrant } from "@/lib/share-access"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ shareId: string }> }
) {
  const { shareId } = await params

  const file = await prisma.file.findUnique({
    where: { shareId },
    select: {
      id: true,
      userId: true,
      originalName: true,
      type: true,
      size: true,
      downloads: true,
      views: true,
      password: true,
      accessVersion: true,
      status: true,
      user: {
        select: { name: true },
      },
    },
  })

  if (!file) {
    return NextResponse.json({ exists: false })
  }

  if (file.status !== "ACTIVE") {
    return NextResponse.json({ exists: false })
  }

  const session = await auth()
  const isOwner = session?.user && file.userId === (session.user as any).id
  if (file.password && !isOwner && !verifyShareGrant(request, "file", shareId, file.accessVersion)) {
    return NextResponse.json({ exists: true, hasPassword: true })
  }

  return NextResponse.json({
    exists: true,
    name: file.originalName,
    type: file.type,
    size: file.size,
    downloads: file.downloads,
    views: file.views,
    hasPassword: !!file.password,
    uploader: file.user?.name || "Unknown",
  })
}
