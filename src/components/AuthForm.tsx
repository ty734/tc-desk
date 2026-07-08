"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AuthForm({
  mode,
  inviteToken,
  firstUser,
}: {
  mode: "login" | "register";
  inviteToken?: string;
  firstUser?: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/auth/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        mode === "login" ? { email, password } : { name, email, password, token: inviteToken }
      ),
    });
    if (res.ok) {
      router.push("/");
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-violet-700 text-white text-2xl font-bold mb-3">
            D
          </div>
          <h1 className="text-2xl font-bold">
            {mode === "login" ? "Log in to TC Desk" : firstUser ? "Set up your account" : "Join TC Desk"}
          </h1>
          {mode === "register" && firstUser && (
            <p className="text-sm text-gray-500 mt-1">You&apos;re the first user — this becomes the admin account.</p>
          )}
        </div>
        <form onSubmit={submit} className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-4">
          {mode === "register" && (
            <div>
              <label className="block text-sm font-medium mb-1">Name</label>
              <input
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-500"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Tyler Coles"
                required
              />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input
              type="email"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-500"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Password</label>
            <input
              type="password"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-500"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "register" ? "At least 8 characters" : "Your password"}
              required
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            disabled={busy}
            className="w-full bg-violet-700 hover:bg-violet-800 disabled:opacity-50 text-white font-semibold rounded-lg py-2.5 transition-colors"
          >
            {busy ? "One moment…" : mode === "login" ? "Log in" : "Create account"}
          </button>
        </form>
        {mode === "login" && (
          <div className="text-center text-sm text-gray-500 mt-4 space-y-1">
            <p>
              <a href="/forgot" className="text-violet-700 hover:underline">
                Forgot your password?
              </a>
            </p>
            <p>No account? Ask a teammate for an invite link.</p>
          </div>
        )}
      </div>
    </div>
  );
}
