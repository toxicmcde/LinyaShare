const MIN_PASSWORD_LENGTH = 8
const MAX_PASSWORD_LENGTH = 256

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null
  const email = value.normalize("NFKC").trim().toLowerCase()
  if (!email || email.length > 320 || !/^[^@\s]+@[^@\s]+$/.test(email)) return null
  return email
}

export function validatePassword(value: unknown): string | null {
  if (typeof value !== "string") return null
  if (value.length < MIN_PASSWORD_LENGTH || value.length > MAX_PASSWORD_LENGTH) return null
  return value
}

export function parseNonNegativeNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) return null
  return parsed
}

export function parseRole(value: unknown): "USER" | "ADMIN" | null {
  return value === "USER" || value === "ADMIN" ? value : null
}

export { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH }
