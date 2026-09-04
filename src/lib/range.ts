export type ByteRange = { start: number; end: number }

export class RangeNotSatisfiableError extends Error {
  constructor() {
    super("Range not satisfiable")
    this.name = "RangeNotSatisfiableError"
  }
}

/** Parse one RFC 9110 byte range. Multiple ranges are intentionally unsupported. */
export function parseByteRange(header: string | null, size: number): ByteRange | null {
  if (!header) return null
  if (!Number.isSafeInteger(size) || size < 0 || !/^bytes=\s*[^,]+\s*$/.test(header)) {
    throw new RangeNotSatisfiableError()
  }

  const value = header.replace(/^bytes=/, "").trim()
  const parts = value.split("-").map((part) => part.trim())
  if (parts.length !== 2) throw new RangeNotSatisfiableError()
  const [rawStart, rawEnd] = parts
  if (rawStart === "" && rawEnd === "") throw new RangeNotSatisfiableError()

  if (size === 0) throw new RangeNotSatisfiableError()

  if (rawStart === "") {
    if (!/^\d+$/.test(rawEnd)) throw new RangeNotSatisfiableError()
    const suffixLength = Number(rawEnd)
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) throw new RangeNotSatisfiableError()
    return { start: Math.max(size - suffixLength, 0), end: size - 1 }
  }

  if (!/^\d+$/.test(rawStart)) throw new RangeNotSatisfiableError()
  const start = Number(rawStart)
  if (!Number.isSafeInteger(start) || start >= size) throw new RangeNotSatisfiableError()

  if (rawEnd === "") return { start, end: size - 1 }
  if (!/^\d+$/.test(rawEnd)) throw new RangeNotSatisfiableError()
  const requestedEnd = Number(rawEnd)
  if (!Number.isSafeInteger(requestedEnd) || requestedEnd < start) {
    throw new RangeNotSatisfiableError()
  }

  return { start, end: Math.min(requestedEnd, size - 1) }
}
