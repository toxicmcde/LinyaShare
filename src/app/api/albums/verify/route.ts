import { NextRequest, NextResponse } from "next/server";
import { getAlbumByShareId, verifyAlbumPassword } from "@/lib/albums";
import { consumeRateLimit, clearRateLimit, getClientIp } from "@/lib/rate-limit";
import { setShareGrantCookie } from "@/lib/share-access";

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 5 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;

export async function POST(request: NextRequest) {
  try {
    const { shareId, password } = await request.json();

    if (!shareId) {
      return NextResponse.json({ error: "Missing album id" }, { status: 400 });
    }

    const album = await getAlbumByShareId(shareId);
    if (!album) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 });
    }

    const limitKey = `album-password:${shareId}:${getClientIp(request)}`;
    const limit = consumeRateLimit(limitKey, MAX_ATTEMPTS, WINDOW_MS, BLOCK_MS);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Too many attempts" },
        { status: 429, headers: { "Retry-After": limit.retryAfterSeconds.toString() } }
      );
    }

    const valid = await verifyAlbumPassword(album, password || "");
    if (!valid) {
      return NextResponse.json({ error: "Invalid password" }, { status: 403 });
    }

    clearRateLimit(limitKey);
    const response = NextResponse.json({ success: true });
    if (album.password) setShareGrantCookie(response, "album", shareId, album.accessVersion);
    return response;
  } catch (error) {
    console.error("Album verification error:", error);
    return NextResponse.json({ error: "Unable to verify album" }, { status: 500 });
  }
}
