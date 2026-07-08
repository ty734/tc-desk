import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import ChangePasswordForm from "@/components/ChangePasswordForm";

export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="flex-1">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-2xl mx-auto px-6 py-4 flex items-center gap-4">
          <Link href="/" className="text-gray-400 hover:text-gray-700 font-medium text-sm">
            ← Boards
          </Link>
          <h1 className="text-lg font-bold">Account</h1>
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-6 py-10 space-y-6">
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
          <div className="font-semibold">{user.name}</div>
          <div className="text-sm text-gray-500">{user.email}</div>
        </div>
        <ChangePasswordForm />
      </main>
    </div>
  );
}
