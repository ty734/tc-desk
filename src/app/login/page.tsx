import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import AuthForm from "@/components/AuthForm";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/");
  const userCount = await db.user.count();
  if (userCount === 0) redirect("/register");
  return <AuthForm mode="login" />;
}
