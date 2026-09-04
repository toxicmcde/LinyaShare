import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-guards"
import { prisma } from "@/lib/prisma"
import bcrypt from "bcryptjs"
import { logStatEvent } from "@/lib/stats"
import { removeFileFromDisk } from "@/lib/file-storage"
import { normalizeEmail, parseNonNegativeNumber, parseRole, validatePassword } from "@/lib/validation"

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      maxSize: true,
      _count: { select: { files: true } },
      createdAt: true,
    },
  })

  return NextResponse.json({ users })
}

export async function PUT(request: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const { userId, name, role, maxSize } = await request.json()
    if (typeof userId !== "string" || !userId) {
      return NextResponse.json({ error: "User ID is required" }, { status: 400 })
    }
    const updateData: any = {}

    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim()) {
        return NextResponse.json({ error: "Name is invalid" }, { status: 400 })
      }
      updateData.name = name.trim().slice(0, 100)
    }
    if (role !== undefined) {
      const cleanRole = parseRole(role)
      if (!cleanRole) return NextResponse.json({ error: "Role is invalid" }, { status: 400 })
      updateData.role = cleanRole
      updateData.sessionVersion = { increment: 1 }
    }
    if (maxSize !== undefined) {
      const cleanMaxSize = parseNonNegativeNumber(maxSize)
      if (cleanMaxSize === null) return NextResponse.json({ error: "Storage limit is invalid" }, { status: 400 })
      updateData.maxSize = cleanMaxSize
    }
    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "No changes provided" }, { status: 400 })
    }

    await prisma.user.update({
      where: { id: userId },
      data: updateData,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: "Update failed" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const { userId } = await request.json()
    
    // Delete files from disk (central path logic, incl. user folder)
    const files = await prisma.file.findMany({ where: { userId } })

    for (const file of files) {
      try {
        await removeFileFromDisk(file)
      } catch {}
    }

    await prisma.user.delete({ where: { id: userId } })
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: "Deletion failed" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const { name, email, password, role, maxSize } = await request.json()
    const normalizedEmail = normalizeEmail(email)
    const cleanPassword = validatePassword(password)
    const cleanRole = role === undefined ? "USER" : parseRole(role)
    const cleanMaxSize = maxSize === undefined ? 524288000 : parseNonNegativeNumber(maxSize)

    if (typeof name !== "string" || !name.trim() || !normalizedEmail || !cleanPassword || !cleanRole || cleanMaxSize === null) {
      return NextResponse.json({ error: "Invalid user data" }, { status: 400 })
    }

    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } })
    if (existing) {
      return NextResponse.json({ error: "Email already exists" }, { status: 400 })
    }

    const hashedPassword = await bcrypt.hash(cleanPassword, 12)
    const user = await prisma.user.create({
      data: {
        name: name.trim().slice(0, 100),
        email: normalizedEmail,
        password: hashedPassword,
        role: cleanRole,
        maxSize: cleanMaxSize,
      },
    })

    // Log statistics event (fire-and-forget)
    logStatEvent("REGISTER", { userId: user.id })

    return NextResponse.json({ success: true, user: { id: user.id, name: user.name, email: user.email } })
  } catch (error) {
    return NextResponse.json({ error: "Creation failed" }, { status: 500 })
  }
}
