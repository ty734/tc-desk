import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, isBoardOwner } from "@/lib/auth";

export async function POST(req: Request, { params }: { params: Promise<{ boardId: string }> }) {
  const { boardId } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  if (!(await isBoardOwner(user.id, boardId))) {
    return NextResponse.json({ error: "Only the board owner can manage custom fields." }, { status: 403 });
  }

  const { name, options } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: "Field name is required." }, { status: 400 });

  const last = await db.customField.findFirst({ where: { boardId }, orderBy: { position: "desc" } });
  const field = await db.customField.create({
    data: {
      boardId,
      name: name.trim(),
      type: "select",
      position: (last?.position ?? 0) + 1,
      options: {
        create: (Array.isArray(options) ? options : [])
          .filter((o: { label?: string }) => o?.label?.trim())
          .map((o: { label: string; color?: string }, i: number) => ({
            label: o.label.trim(),
            color: o.color ?? "gray",
            position: i + 1,
          })),
      },
    },
    include: { options: { orderBy: { position: "asc" } } },
  });
  return NextResponse.json({ field });
}
