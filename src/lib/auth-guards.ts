import { auth } from "@/lib/auth"

export type AuthenticatedRequest = {
  session: {
    user?: { id?: unknown; role?: unknown } | null
  }
  userId: string
}

export async function requireUser(): Promise<AuthenticatedRequest | null> {
  const session = await auth()
  const userId = (session?.user as { id?: unknown } | undefined)?.id
  if (!session?.user || typeof userId !== "string" || !userId) return null
  return { session: session as AuthenticatedRequest["session"], userId }
}

export async function requireAdmin(): Promise<AuthenticatedRequest | null> {
  const current = await requireUser()
  if (!current || current.session.user?.role !== "ADMIN") return null
  return current
}
