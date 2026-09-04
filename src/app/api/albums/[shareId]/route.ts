import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireUser } from "@/lib/auth-guards";
import { getAlbumByShareId, updateAlbum, deleteAlbum, incrementAlbumViews } from "@/lib/albums";
import { isEmbeddableMedia } from "@/lib/utils";
import { MAX_EMBED_SIZE } from "@/lib/constants";
import { verifyShareGrant } from "@/lib/share-access";
import { validatePassword } from "@/lib/validation";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ shareId: string }> }
) {
  const { shareId } = await params;
  const album = await getAlbumByShareId(shareId);

  if (!album) {
    return NextResponse.json({ exists: false });
  }

  const session = await auth();
  const isOwner = !!session?.user && album.userId === (session.user as any).id;
  if (album.password && !isOwner && !verifyShareGrant(request, "album", shareId, album.accessVersion)) {
    return NextResponse.json({ exists: true, shareId, hasPassword: true });
  }

  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";

  const files = album.items.filter((i) => i.file.status === "ACTIVE").map((i) => {
    const file = i.file;
    const embedUrl =
      !album.password && file.isMediaEmbed && !file.password && file.size < MAX_EMBED_SIZE
        ? `${baseUrl}/api/files/embed/${file.shareId}/${encodeURIComponent(file.originalName)}`
        : undefined;
    return {
      id: file.id,
      shareId: file.shareId,
      originalName: file.originalName,
      type: file.type,
      size: file.size,
      downloads: file.downloads,
      views: file.views,
      hasPassword: !!file.password,
      embedUrl,
      streamUrl: `/api/albums/${album.shareId}/files/${file.shareId}`,
      // Do not expose a direct public file link for unprotected files inside
      // a protected album; the album-scoped route is the access boundary.
      shareUrl: !album.password ? `${baseUrl}/s/${file.shareId}` : undefined,
    };
  });

  const cover = files.find((f) => isEmbeddableMedia({ type: f.type, originalName: f.originalName })) || null;

  // View counter (fire-and-forget) – skipped at ?count=0 (browser cache of clients)
  if (request.nextUrl.searchParams.get("count") !== "0") {
    incrementAlbumViews(shareId);
  }

  return NextResponse.json({
    exists: true,
    id: album.id,
    shareId: album.shareId,
    name: album.name,
    description: album.description,
    hasPassword: !!album.password,
    uploader: album.user?.name || "Unknown",
    views: album.views,
    downloads: album.downloads,
    createdAt: album.createdAt,
    fileCount: files.length,
    totalSize: files.reduce((sum, f) => sum + f.size, 0),
    publicFileCount: files.filter((f) => !f.hasPassword).length,
    protectedFileCount: files.filter((f) => f.hasPassword).length,
    shareUrl: `${baseUrl}/a/${shareId}`,
    cover,
    files,
  });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ shareId: string }> }) {
  const current = await requireUser();
  if (!current) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { shareId } = await params;
    const body = await request.json();
    const cleanPassword = body.password === undefined || body.password === null || body.password === ""
      ? body.password === undefined ? undefined : null
      : validatePassword(body.password)
    if (body.password !== undefined && body.password !== null && body.password !== "" && !cleanPassword) {
      return NextResponse.json({ error: "Password must be between 8 and 256 characters" }, { status: 400 });
    }

    const album = await updateAlbum(shareId, current.userId, {
      name: body.name !== undefined ? String(body.name).trim().slice(0, 100) : undefined,
      description:
        body.description !== undefined
          ? body.description === null || String(body.description).trim() === ""
            ? null
            : String(body.description).slice(0, 500)
          : undefined,
      password: body.password !== undefined ? cleanPassword : undefined,
      addFileIds: Array.isArray(body.addFileIds) ? body.addFileIds : undefined,
      removeFileIds: Array.isArray(body.removeFileIds) ? body.removeFileIds : undefined,
    });

    return NextResponse.json({
      success: true,
      fileCount: album.items.length,
      password: cleanPassword,
    });
  } catch (error) {
    console.error("Album update error:", error);
    return NextResponse.json({ error: "Unable to update album" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ shareId: string }> }
) {
  const current = await requireUser();
  if (!current) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { shareId } = await params;
    await deleteAlbum(shareId, current.userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Album deletion error:", error);
    return NextResponse.json({ error: "Unable to delete album" }, { status: 500 });
  }
}
