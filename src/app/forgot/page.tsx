"use client";

import { useState } from "react";
import Link from "next/link";

export default function ForgotPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    await fetch("/api/auth/forgot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setSent(true);
    setBusy(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-violet-700 text-white text-2xl font-bold mb-3">
            B
          </div>
          <h1 className="text-2xl font-bold">Reset your password</h1>
        </div>
        {sent ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 text-center">
            <p className="text-sm text-gray-700">
              If an account exists for <b>{email}</b>, a reset link is on its way. Check your inbox —
              the link works once and expires in an hour.
            </p>
            <Link href="/login" className="inline-block mt-4 text-sm text-violet-700 hover:underline">
              Back to login
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Email</label>
              <input
                type="email"
                required
                autoFocus
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-500"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <button
              disabled={busy}
              className="w-full bg-violet-700 hover:bg-violet-800 disabled:opacity-50 text-white font-semibold rounded-lg py-2.5"
            >
              {busy ? "Sending…" : "Email me a reset link"}
            </button>
            <p className="text-center">
              <Link href="/login" className="text-sm text-gray-500 hover:text-gray-800">
                Back to login
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
