import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"
import { logStatEvent } from "@/lib/stats"
import { normalizeEmail, validatePassword } from "@/lib/validation"

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

    // Re-check settings, capacity, and uniqueness in the same write transaction.
    // This prevents two concurrent registrations from bypassing maxUsers.
    const user = await prisma.$transaction(async (tx) => {
      // A singleton upsert serializes this check-and-create section on SQLite,
      // MySQL, and PostgreSQL, where a plain COUNT() can otherwise race.
      await tx.setting.upsert({
        where: { key: "__security_user_write_lock" },
        update: { value: "1" },
        create: { key: "__security_user_write_lock", value: "1" },
      })
      const setting = await tx.setting.findUnique({ where: { key: "allowRegistration" } })
      if (setting && setting.value === "false") throw new Error("REGISTRATION_DISABLED")

      const maxUsersSetting = await tx.setting.findUnique({ where: { key: "maxUsers" } })
      const maxUsers = parseInt(maxUsersSetting?.value || "-1")
      if (maxUsers > -1 && await tx.user.count() >= maxUsers) throw new Error("MAX_USERS_REACHED")

      const existing = await tx.user.findUnique({ where: { email: normalizedEmail } })
      if (existing) throw new Error("EMAIL_IN_USE")

      return tx.user.create({
        data: {
          name: name.trim().slice(0, 100),
          email: normalizedEmail,
          password: hashedPassword,
          role: "USER",
        },
      })
    })

    // Statistik-Event loggen (fire-and-forget)
    logStatEvent("REGISTER", { userId: user.id })

    return NextResponse.json({
      success: true,
      user: { id: user.id, name: user.name, email: user.email },
    })
  } catch (error) {
    const code = error instanceof Error ? error.message : ""
    if (code === "REGISTRATION_DISABLED") return NextResponse.json({ error: "Registration is currently disabled" }, { status: 403 })
    if (code === "MAX_USERS_REACHED") return NextResponse.json({ error: "Maximum user limit reached" }, { status: 403 })
    if (code === "EMAIL_IN_USE") return NextResponse.json({ error: "Email is already in use" }, { status: 400 })
    console.error("Register error:", error)
    return NextResponse.json({ error: "Registration failed" }, { status: 500 })
  }
}
