import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, isBoardOwner } from "@/lib/auth";

async function authorize(fieldId: string) {
  const user = await getCurrentUser();
  if (!user) return { error: NextResponse.json({ error: "Not logged in." }, { status: 401 }) };
  const field = await db.customField.findUnique({ where: { id: fieldId } });
  if (!field) return { error: NextResponse.json({ error: "Field not found." }, { status: 404 }) };
  if (!(await isBoardOwner(user.id, field.boardId))) {
    return { error: NextResponse.json({ error: "Only the board owner can manage custom fields." }, { status: 403 }) };
  }
  return { user, field };
}

// PATCH accepts { name?, options?: [{ id?, label, color }] } and reconciles
// options: existing ids are updated, missing ids are deleted, new ones created.
export async function PATCH(req: Request, { params }: { params: Promise<{ fieldId: string }> }) {
  const { fieldId } = await params;
  const auth = await authorize(fieldId);
  if (auth.error) return auth.error;

  const body = await req.json();
  if (body.name !== undefined) {
    await db.customField.update({ where: { id: fieldId }, data: { name: String(body.name).trim() } });
  }

  if (Array.isArray(body.options)) {
    const incoming = body.options.filter((o: { label?: string }) => o?.label?.trim());
    const existing = await db.fieldOption.findMany({ where: { fieldId } });
    const incomingIds = new Set(incoming.map((o: { id?: string }) => o.id).filter(Boolean));

    for (const opt of existing) {
      if (!incomingIds.has(opt.id)) await db.fieldOption.delete({ where: { id: opt.id } });
    }
    let pos = 1;
    for (const opt of incoming) {
      if (opt.id && existing.some((e) => e.id === opt.id)) {
        await db.fieldOption.update({
          where: { id: opt.id },
          data: { label: opt.label.trim(), color: opt.color ?? "gray", position: pos },
        });
      } else {
        await db.fieldOption.create({
          data: { fieldId, label: opt.label.trim(), color: opt.color ?? "gray", position: pos },
        });
      }
      pos++;
    }
  }

  const field = await db.customField.findUnique({
    where: { id: fieldId },
    include: { options: { orderBy: { position: "asc" } } },
  });
  return NextResponse.json({ field });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ fieldId: string }> }) {
  const { fieldId } = await params;
  const auth = await authorize(fieldId);
  if (auth.error) return auth.error;
  await db.customField.delete({ where: { id: fieldId } });
  return NextResponse.json({ ok: true });
}
