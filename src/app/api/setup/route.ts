import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"
import { logStatEvent } from "@/lib/stats"
import { normalizeEmail, validatePassword } from "@/lib/validation"

export async function GET() {
  try {
    const adminCount = await prisma.user.count({
      where: { role: "ADMIN" },
    })

    return NextResponse.json({
      needsSetup: adminCount === 0,
    })
  } catch {
    return NextResponse.json({ needsSetup: true })
  }
}

export async function POST(request: NextRequest) {
  try {
    const { name, email, password } = await request.json()

    const normalizedEmail = normalizeEmail(email)
    const cleanPassword = validatePassword(password)
    if (typeof name !== "string" || !name.trim() || typeof email !== "string" || password === undefined) {
      return NextResponse.json({ error: "All fields are required" }, { status: 400 })
    }

    if (!normalizedEmail) {
      return NextResponse.json({ error: "Invalid email address" }, { status: 400 })
    }

    if (!cleanPassword) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 })
    }

    const hashedPassword = await bcrypt.hash(cleanPassword, 12)

    const admin = await prisma.$transaction(async (tx) => {
      // Serialize first-run setup with registration so two concurrent setup
      // requests cannot both observe an empty admin table.
      await tx.setting.upsert({
        where: { key: "__security_user_write_lock" },
        update: { value: "1" },
        create: { key: "__security_user_write_lock", value: "1" },
      })
      if (await tx.user.count({ where: { role: "ADMIN" } }) > 0) {
        throw new Error("SETUP_ALREADY_COMPLETED")
      }

      const createdAdmin = await tx.user.create({
        data: {
          name: name.trim().slice(0, 100),
          email: normalizedEmail,
          password: hashedPassword,
          role: "ADMIN",
          maxSize: 1073741824,
        },
      })

      await tx.setting.upsert({
        where: { key: "allowRegistration" },
        update: {},
        create: { key: "allowRegistration", value: "true" },
      })
      await tx.setting.upsert({
        where: { key: "defaultMaxSize" },
        update: {},
        create: { key: "defaultMaxSize", value: "524288000" },
      })

      return createdAdmin
    })

    // Statistik-Event loggen (fire-and-forget)
    logStatEvent("REGISTER", { userId: admin.id })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    if (error?.message === "SETUP_ALREADY_COMPLETED") {
      return NextResponse.json({ error: "Setup already completed" }, { status: 400 })
    }
    console.error("Setup error:", error)
    return NextResponse.json({ error: "Setup failed. Is the database connected?" }, { status: 500 })
  }
}
