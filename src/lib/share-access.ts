import { createHmac, timingSafeEqual } from "crypto"
import type { NextRequest, NextResponse } from "next/server"

export type ShareKind = "file" | "album"

type ShareGrant = {
  kind: ShareKind
  shareId: string
  version: number
  expiresAt: number
}

const SHARE_GRANT_TTL_SECONDS = 15 * 60

function secret(): string {
  const value = process.env.NEXTAUTH_SECRET
  if (!value || value.length < 32) throw new Error("NEXTAUTH_SECRET must be configured")
  return value
}

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url")
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url")
}

export function shareAccessCookieName(kind: ShareKind, shareId: string): string {
  return `linyashare_${kind}_${shareId}`
}

export function issueShareGrant(kind: ShareKind, shareId: string, version: number): string {
  const grant: ShareGrant = {
    kind,
    shareId,
    version,
    expiresAt: Math.floor(Date.now() / 1000) + SHARE_GRANT_TTL_SECONDS,
  }
  const payload = encode(JSON.stringify(grant))
  return `${payload}.${sign(payload)}`
}

export function verifyShareGrant(
  request: NextRequest,
  kind: ShareKind,
  shareId: string,
  version: number
): boolean {
  const token = request.cookies.get(shareAccessCookieName(kind, shareId))?.value
  if (!token) return false

  const [payload, providedSignature] = token.split(".")
  if (!payload || !providedSignature) return false

  const expectedSignature = sign(payload)
  const provided = Buffer.from(providedSignature, "base64url")
  const expected = Buffer.from(expectedSignature, "base64url")
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return false

  try {
    const grant = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as ShareGrant
    return (
      grant.kind === kind &&
      grant.shareId === shareId &&
      grant.version === version &&
      Number.isSafeInteger(grant.expiresAt) &&
      grant.expiresAt > Math.floor(Date.now() / 1000)
    )
  } catch {
    return false
  }
}

export function setShareGrantCookie(
  response: NextResponse,
  kind: ShareKind,
  shareId: string,
  version: number
): void {
  response.cookies.set({
    name: shareAccessCookieName(kind, shareId),
    value: issueShareGrant(kind, shareId, version),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SHARE_GRANT_TTL_SECONDS,
  })
}
