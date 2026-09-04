import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-guards"
import { prisma } from "@/lib/prisma"

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const settings = await prisma.setting.findMany({
    where: { NOT: { key: { startsWith: "__security_" } } },
  })
  const settingsMap: Record<string, string> = {}
  settings.forEach((s) => {
    settingsMap[s.key] = s.value
  })

  // Stats
  const userCount = await prisma.user.count()
  const adminCount = await prisma.user.count({ where: { role: "ADMIN" } })
  const fileCount = await prisma.file.count()
  const unclaimedCount = await prisma.file.count({ where: { status: "IMPORT" } })
  const totalSize = await prisma.file.aggregate({ _sum: { size: true } })

  return NextResponse.json({
    settings: settingsMap,
    stats: {
      users: userCount,
      admins: adminCount,
      files: fileCount,
      unclaimed: unclaimedCount,
      totalSize: totalSize._sum.size || 0,
    },
  })
}

export async function PUT(request: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = await request.json()

    // Bulk-Update: { settings: [{ key, value }, ...] }
    if (Array.isArray(body?.settings)) {
      await prisma.$transaction(
        body.settings.map((s: { key: string; value: string }) =>
          prisma.setting.upsert({
            where: { key: s.key },
            update: { value: s.value },
            create: { key: s.key, value: s.value },
          })
        )
      )
      return NextResponse.json({ success: true })
    }

    // Single update: { key, value }
    const { key, value } = body

    await prisma.setting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: "Update failed" }, { status: 500 })
  }
}

export async function DELETE() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    // Delete all settings to reset to defaults
    await prisma.setting.deleteMany()
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: "Reset failed" }, { status: 500 })
  }
}
