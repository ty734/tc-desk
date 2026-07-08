import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import AuthForm from "@/components/AuthForm";

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const user = await getCurrentUser();
  if (user) redirect("/");

  const { token } = await searchParams;
  const userCount = await db.user.count();
  const firstUser = userCount === 0;

  if (!firstUser && !token) redirect("/login");

  if (token) {
    const invite = await db.invite.findUnique({ where: { token } });
    if (!invite || invite.acceptedAt) {
      return (
        <div className="min-h-screen flex items-center justify-center px-4">
          <div className="text-center">
            <h1 className="text-xl font-bold mb-2">Invite link invalid</h1>
            <p className="text-gray-500">This invite was already used or doesn&apos;t exist. Ask for a new one.</p>
          </div>
        </div>
      );
    }
  }

  return <AuthForm mode="register" inviteToken={token} firstUser={firstUser} />;
}
