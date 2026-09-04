import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-guards"
import { getUnclaimedFiles, claimFile, claimOrphanedFile, deleteFile, deleteOrphanedFile } from "@/lib/upload"

function fileResponse(file: any) {
  return {
    id: file.id,
    name: file.name,
    originalName: file.originalName,
    type: file.type,
    size: file.size,
    shareId: file.shareId,
    userId: file.userId,
    status: file.status,
    createdAt: file.createdAt,
    hasPassword: !!file.password,
  }
}

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const result = await getUnclaimedFiles()
    return NextResponse.json(result)
  } catch (error) {
    console.error("Failed to fetch unclaimed files:", error)
    return NextResponse.json({ error: "Unable to load import files" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const { fileId, fileName, userId } = await request.json()

    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 })
    }

    if (fileId) {
      // Assign the existing DB import entry
      const file = await claimFile(fileId, userId)
      return NextResponse.json({ success: true, file: fileResponse(file) })
    } else if (fileName) {
      // Assign orphaned disk file (new DB entry)
      const file = await claimOrphanedFile(fileName, userId)
      return NextResponse.json({ success: true, file: fileResponse(file) })
    } else {
      return NextResponse.json({ error: "fileId or fileName is required" }, { status: 400 })
    }
  } catch (error) {
    console.error("Claim file failed:", error)
    return NextResponse.json({ error: "Unable to assign import file" }, { status: 400 })
  }
}

export async function DELETE(request: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const { fileId, fileName } = await request.json()

    if (fileId) {
      // Delete the DB entry (with disk cleanup)
      await deleteFile(fileId)
    } else if (fileName) {
      // Only delete the orphaned file on disk
      await deleteOrphanedFile(fileName)
    } else {
      return NextResponse.json({ error: "fileId or fileName required" }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Delete failed:", error)
    return NextResponse.json({ error: "Unable to delete import file" }, { status: 400 })
  }
}
