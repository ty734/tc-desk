"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function HomeActions({ userName }: { userName: string }) {
  const router = useRouter();
  return (
    <div className="flex items-center gap-4">
      <Link href="/my-tickets" className="text-sm font-medium text-violet-700 hover:underline">
        My Tickets
      </Link>
      <Link href="/account" className="text-sm text-gray-600 hover:text-gray-900" title="Account settings">
        {userName}
      </Link>
      <button
        onClick={async () => {
          await fetch("/api/auth/logout", { method: "POST" });
          router.push("/login");
          router.refresh();
        }}
        className="text-sm text-gray-500 hover:text-gray-800"
      >
        Log out
      </button>
    </div>
  );
}

export function CreateBoardCard() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const res = await fetch("/api/boards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      const { board } = await res.json();
      router.push(`/boards/${board.id}`);
      router.refresh();
    } else {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-xl border-2 border-dashed border-gray-300 hover:border-violet-400 hover:bg-violet-50 transition-colors p-5 text-gray-500 hover:text-violet-700 font-medium text-left min-h-[120px] flex items-center justify-center"
      >
        + Create board
      </button>
    );
  }

  return (
    <form
      onSubmit={create}
      className="rounded-xl border border-violet-300 bg-white shadow-sm p-5 min-h-[120px] flex flex-col gap-3"
    >
      <input
        autoFocus
        className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
        placeholder="Board name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <div className="flex gap-2">
        <button
          disabled={busy}
          className="bg-violet-700 hover:bg-violet-800 disabled:opacity-50 text-white text-sm font-semibold rounded-lg px-4 py-1.5"
        >
          Create
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm text-gray-500 hover:text-gray-800 px-2"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
