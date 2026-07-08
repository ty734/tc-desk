"use client";

import { useState } from "react";
import type { FieldData, Member } from "@/lib/types";
import { COLOR_NAMES, optionColor, autoColor } from "@/lib/colors";
import { Chip } from "@/components/ui";

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto py-16 px-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 pt-5 pb-2">
          <h3 className="text-lg font-bold">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl">×</button>
        </div>
        <div className="px-6 pb-6">{children}</div>
      </div>
    </div>
  );
}

/* ---------------- Invite ---------------- */

export function InviteModal({
  boardId,
  onClose,
  onAdded,
}: {
  boardId: string;
  onClose: () => void;
  onAdded: (member: Member) => void;
}) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/boards/${boardId}/invites`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Something went wrong.");
      return;
    }
    if (data.added) {
      onAdded({ ...data.added, role: "member" });
      setMessage(`${data.added.name} was added to the board.`);
    } else {
      setMessage(`Invite email sent to ${data.invited}.`);
    }
    setEmail("");
  }

  return (
    <ModalShell title="Invite to board" onClose={onClose}>
      <p className="text-sm text-gray-500 mb-4">
        If they already have an account they&apos;re added instantly; otherwise they get an email with a
        sign-up link that drops them straight onto this board.
      </p>
      <form onSubmit={invite} className="flex gap-2">
        <input
          type="email"
          required
          autoFocus
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
          placeholder="teammate@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button
          disabled={busy}
          className="bg-violet-700 hover:bg-violet-800 disabled:opacity-50 text-white text-sm font-semibold rounded-lg px-4"
        >
          {busy ? "Sending…" : "Invite"}
        </button>
      </form>
      {message && <p className="text-sm text-green-700 mt-3">{message}</p>}
      {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
    </ModalShell>
  );
}

/* ---------------- Custom fields ---------------- */

export function FieldsModal({
  boardId,
  fields,
  onClose,
  onChange,
}: {
  boardId: string;
  fields: FieldData[];
  onClose: () => void;
  onChange: (fields: FieldData[]) => void;
}) {
  const [editing, setEditing] = useState<FieldData | "new" | null>(null);

  async function deleteField(field: FieldData) {
    if (!confirm(`Delete field "${field.name}"? Values on tickets will be removed.`)) return;
    onChange(fields.filter((f) => f.id !== field.id));
    await fetch(`/api/fields/${field.id}`, { method: "DELETE" });
  }

  if (editing) {
    return (
      <FieldEditor
        boardId={boardId}
        field={editing === "new" ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={(saved) => {
          if (editing === "new") onChange([...fields, saved]);
          else onChange(fields.map((f) => (f.id === saved.id ? saved : f)));
          setEditing(null);
        }}
      />
    );
  }

  return (
    <ModalShell title="Custom fields" onClose={onClose}>
      {fields.length === 0 && (
        <p className="text-sm text-gray-500 mb-4">
          No fields yet. Add dropdowns like Priority, Business, or Effort Level — they show as colored
          chips on tickets.
        </p>
      )}
      <div className="space-y-2 mb-4">
        {fields.map((f) => (
          <div key={f.id} className="border border-gray-200 rounded-lg px-4 py-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm">{f.name}</div>
              <div className="flex flex-wrap gap-1 mt-1">
                {f.options.slice(0, 6).map((o) => (
                  <Chip key={o.id} label={o.label} color={o.color} />
                ))}
                {f.options.length > 6 && (
                  <span className="text-xs text-gray-400">+{f.options.length - 6} more</span>
                )}
              </div>
            </div>
            <button onClick={() => setEditing(f)} className="text-sm text-violet-700 hover:underline">
              Edit
            </button>
            <button onClick={() => deleteField(f)} className="text-sm text-gray-400 hover:text-red-600">
              Delete
            </button>
          </div>
        ))}
      </div>
      <button
        onClick={() => setEditing("new")}
        className="w-full border-2 border-dashed border-gray-300 hover:border-violet-400 hover:bg-violet-50 rounded-lg py-2.5 text-sm font-medium text-gray-500 hover:text-violet-700"
      >
        + Add field
      </button>
    </ModalShell>
  );
}

function FieldEditor({
  boardId,
  field,
  onClose,
  onSaved,
}: {
  boardId: string;
  field: FieldData | null;
  onClose: () => void;
  onSaved: (field: FieldData) => void;
}) {
  const [name, setName] = useState(field?.name ?? "");
  const [options, setOptions] = useState<{ id?: string; label: string; color: string }[]>(
    field?.options.map((o) => ({ id: o.id, label: o.label, color: o.color })) ?? [
      { label: "", color: "gray" },
    ]
  );
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const cleaned = options
      .filter((o) => o.label.trim())
      .map((o) => ({ ...o, label: o.label.trim() }));
    const res = field
      ? await fetch(`/api/fields/${field.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, options: cleaned }),
        })
      : await fetch(`/api/boards/${boardId}/fields`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, options: cleaned }),
        });
    setBusy(false);
    if (res.ok) {
      const data = await res.json();
      onSaved(data.field);
    }
  }

  return (
    <ModalShell title={field ? `Edit "${field.name}"` : "New field"} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Field name</label>
          <input
            autoFocus={!field}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            placeholder="e.g. Priority"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-2">Options</label>
          <div className="space-y-2">
            {options.map((opt, i) => (
              <div key={opt.id ?? `new-${i}`} className="flex items-center gap-2">
                <input
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                  placeholder="Option label"
                  value={opt.label}
                  onChange={(e) =>
                    setOptions((os) =>
                      os.map((o, j) =>
                        j === i
                          ? { ...o, label: e.target.value, color: o.label ? o.color : autoColor(e.target.value) }
                          : o
                      )
                    )
                  }
                />
                <select
                  className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                  value={opt.color}
                  onChange={(e) => setOptions((os) => os.map((o, j) => (j === i ? { ...o, color: e.target.value } : o)))}
                  style={{ background: optionColor(opt.color).bg }}
                >
                  {COLOR_NAMES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setOptions((os) => os.filter((_, j) => j !== i))}
                  className="text-gray-400 hover:text-red-600 px-1"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setOptions((os) => [...os, { label: "", color: "gray" }])}
            className="text-sm text-violet-700 hover:underline mt-2"
          >
            + Add option
          </button>
        </div>
        <div className="flex gap-2 pt-2">
          <button
            disabled={busy || !name.trim()}
            className="bg-violet-700 hover:bg-violet-800 disabled:opacity-50 text-white text-sm font-semibold rounded-lg px-5 py-2"
          >
            {busy ? "Saving…" : "Save field"}
          </button>
          <button type="button" onClick={onClose} className="text-sm text-gray-500 hover:text-gray-800 px-3">
            Back
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
