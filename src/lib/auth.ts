import NextAuth, { CredentialsSignin } from "next-auth"
import Credentials from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"
import { prisma } from "./prisma"
import { clearAttempts, getBlockRemaining, getClientIp, recordFailure } from "./rate-limit"
import { normalizeEmail } from "./validation"

class TooManyAttemptsError extends CredentialsSignin {
  constructor() {
    super()
    this.code = "TooManyAttempts"
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        if (
          typeof credentials?.email !== "string" ||
          typeof credentials?.password !== "string" ||
          !credentials.email ||
          !credentials.password ||
          credentials.password.length > 256
        ) {
          return null
        }

        const email = normalizeEmail(credentials.email)
        if (!email) return null
        const key = `${getClientIp(request)}|${email}`

        if (getBlockRemaining(key) > 0) {
          throw new TooManyAttemptsError()
        }

        let user = null
        try {
          user = await prisma.user.findUnique({
            where: { email },
          })
        } catch (error) {
          // Log the real error so it is distinguishable from wrong credentials.
          // NextAuth wraps any throw/return-null in authorize() as "CredentialsSignin".
          console.error("[auth][authorize] Unexpected error:", error)
          return null
        }

        if (!user) {
          recordFailure(key)
          return null
        }

        const passwordMatch = await bcrypt.compare(
          credentials.password,
          user.password
        )

        if (!passwordMatch) {
          recordFailure(key)
          return null
        }

        clearAttempts(key)

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          sessionVersion: user.sessionVersion,
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.role = (user as any).role
        token.sessionVersion = (user as any).sessionVersion
      }
      return token
    },
    async session({ session, token }) {
      if (!session.user || typeof token.id !== "string" || typeof token.sessionVersion !== "number") {
        return { ...session, user: undefined } as any
      }

      const currentUser = await prisma.user.findUnique({ where: { id: token.id } })
      if (!currentUser || currentUser.sessionVersion !== token.sessionVersion) {
        return { ...session, user: undefined } as any
      }

      ;(session.user as any).id = currentUser.id
      ;(session.user as any).email = currentUser.email
      ;(session.user as any).name = currentUser.name
      ;(session.user as any).role = currentUser.role
      return session
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
})
