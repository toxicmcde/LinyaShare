import { NextRequest, NextResponse } from "next/server"
import { requireUser } from "@/lib/auth-guards"
import { prisma } from "@/lib/prisma"
import { deleteFile } from "@/lib/upload"
import { MAX_EMBED_SIZE } from "@/lib/constants"
import bcrypt from "bcryptjs"
import { validatePassword } from "@/lib/validation"

export async function GET() {
  const current = await requireUser()
  if (!current) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const files = await prisma.file.findMany({
    where: { userId: current.userId, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      originalName: true,
      type: true,
      size: true,
      shareId: true,
      downloads: true,
      views: true,
      password: true,
      createdAt: true,
      embedUrl: true,
      isMediaEmbed: true,
    },
  })

  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000"

  return NextResponse.json({
    files: files.map((f) => {
      // Direct media link with file extension (ends with .mp4 etc.) for Discord & co.
      // Only for files under 50MB – larger files get no embed link.
      const embedUrl = f.isMediaEmbed && !f.password && f.size < MAX_EMBED_SIZE
        ? `${baseUrl}/api/files/embed/${f.shareId}/${encodeURIComponent(f.originalName)}`
        : undefined

      return {
        id: f.id,
        originalName: f.originalName,
        type: f.type,
        size: f.size,
        shareId: f.shareId,
        downloads: f.downloads,
        views: f.views,
        createdAt: f.createdAt,
        isMediaEmbed: f.isMediaEmbed,
        hasPassword: !!f.password,
        shareUrl: `${baseUrl}/s/${f.shareId}`,
        embedUrl,
      }
    }),
  })
}

export async function PUT(request: NextRequest) {
  const current = await requireUser()
  if (!current) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const { fileId, password } = await request.json()
    if (typeof fileId !== "string" || !fileId) {
      return NextResponse.json({ error: "File ID is required" }, { status: 400 })
    }
    
    const file = await prisma.file.findUnique({
      where: { id: fileId },
    })

    if (!file || file.userId !== current.userId) {
      return NextResponse.json({ error: "File not found" }, { status: 404 })
    }

    const cleanPassword = password === undefined || password === null || password === ""
      ? undefined
      : validatePassword(password)
    if (password !== undefined && password !== null && password !== "" && !cleanPassword) {
      return NextResponse.json({ error: "Password must be between 8 and 256 characters" }, { status: 400 })
    }
    const hashedPassword = cleanPassword ? await bcrypt.hash(cleanPassword, 12) : null
    
    const updatedFile = await prisma.file.update({
      where: { id: fileId },
      data: { password: hashedPassword, accessVersion: { increment: 1 } },
    })

    return NextResponse.json({ 
      success: true,
      hasPassword: !!updatedFile.password,
      password: cleanPassword,
    })
  } catch (error) {
    console.error("File password update error:", error)
    return NextResponse.json({ error: "Unable to update file" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const current = await requireUser()
  if (!current) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const { fileId, fileIds } = await request.json()
    const ids = fileIds && Array.isArray(fileIds) ? fileIds : fileId ? [fileId] : []

    if (ids.length === 0) {
      return NextResponse.json({ error: "No file IDs provided" }, { status: 400 })
    }

    const results = await Promise.allSettled(
      ids.map((id: string) => deleteFile(id, current.userId))
    )
    const deleted = results.filter((r) => r.status === "fulfilled").length

    return NextResponse.json({ success: deleted > 0, deleted })
  } catch (error) {
    console.error("File deletion error:", error)
    return NextResponse.json({ error: "Unable to delete file" }, { status: 500 })
  }
}
