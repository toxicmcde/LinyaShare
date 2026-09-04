import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-guards"
import { prisma } from "@/lib/prisma"
import { removeFileFromDisk } from "@/lib/file-storage"

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const files = await prisma.file.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      originalName: true,
      type: true,
      size: true,
      shareId: true,
      userId: true,
      downloads: true,
      views: true,
      status: true,
      category: true,
      isExecutable: true,
      storageLocation: true,
      createdAt: true,
      password: true,
      user: {
        select: { name: true, email: true },
      },
    },
  })

  return NextResponse.json({
    files: files.map(({ password, ...file }) => ({ ...file, hasPassword: !!password })),
  })
}

export async function DELETE(request: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const { fileId } = await request.json()
    
    const file = await prisma.file.findUnique({ where: { id: fileId } })
    if (!file) {
      return NextResponse.json({ error: "File not found" }, { status: 404 })
    }

    // Delete from disk (central path logic, incl. user folder)
    await removeFileFromDisk(file)

    await prisma.file.delete({ where: { id: fileId } })
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: "Deletion failed" }, { status: 500 })
  }
}
