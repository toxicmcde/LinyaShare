import fs from "fs"
import { NextRequest, NextResponse } from "next/server"
import { findFileOnDisk } from "@/lib/file-storage"
import { logStatEvent } from "@/lib/stats"
import { nodeStreamToWeb } from "@/lib/node-stream"
import { buildContentDisposition, buildFileHeaders, getDeliveryDisposition } from "@/lib/file-security"
import { parseByteRange, RangeNotSatisfiableError } from "@/lib/range"

type DeliverableFile = {
  id: string
  name: string
  originalName: string
  type: string
  status: string
  userId: string | null
  downloads: number
}

export async function deliverFile(
  request: NextRequest,
  file: DeliverableFile,
  options: { download?: boolean; extraHeaders?: Record<string, string> } = {}
): Promise<NextResponse> {
  if (file.status !== "ACTIVE") {
    return NextResponse.json({ error: "File not found" }, { status: 404 })
  }

  const filePath = findFileOnDisk(file)
  if (!filePath) return NextResponse.json({ error: "File not found on disk" }, { status: 404 })

  let stat: fs.Stats
  try {
    stat = fs.statSync(filePath)
  } catch {
    return NextResponse.json({ error: "File not found on disk" }, { status: 404 })
  }
  const fileSize = stat.size
  let range: { start: number; end: number } | null
  try {
    range = parseByteRange(request.headers.get("range"), fileSize)
  } catch (error) {
    if (!(error instanceof RangeNotSatisfiableError)) throw error
    return new NextResponse(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${fileSize}`, "Accept-Ranges": "bytes" },
    })
  }

  const isDownload = !!options.download
  if (isDownload) {
    const { prisma } = await import("@/lib/prisma")
    await prisma.file.update({
      where: { id: file.id },
      data: { downloads: { increment: 1 } },
    }).catch(() => {})
    logStatEvent("DOWNLOAD", { fileId: file.id, userId: file.userId || undefined, size: fileSize })
  }

  const start = range?.start ?? 0
  const end = range?.end ?? Math.max(0, fileSize - 1)
  const contentLength = fileSize === 0 ? 0 : end - start + 1
  const disposition = getDeliveryDisposition(
    file.type || "application/octet-stream",
    file.originalName || file.name,
    isDownload
  )
  const contentDisposition = buildContentDisposition(file.originalName || file.name, disposition)
  const stream = fileSize === 0
    ? fs.createReadStream(filePath, { highWaterMark: 64 * 1024 })
    : fs.createReadStream(filePath, { start, end, highWaterMark: 64 * 1024 })

  return new NextResponse(nodeStreamToWeb(stream), {
    status: range ? 206 : 200,
    headers: buildFileHeaders(
      file.type || "application/octet-stream",
      contentLength,
      contentDisposition,
      {
        "Cache-Control": "no-cache, no-transform",
        ...(range ? { "Content-Range": `bytes ${start}-${end}/${fileSize}` } : {}),
        ...(options.extraHeaders || {}),
      }
    ),
  })
}
