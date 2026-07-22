import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getCurrentUser, isKbTrainer } from "@/lib/auth";
import AskPanel from "@/components/AskPanel";
import TrainerPanel from "@/components/TrainerPanel";
import LiveChatWatcher from "@/components/LiveChatWatcher";
import Softphone from "@/components/Softphone";

export const metadata: Metadata = {
  title: "Living Well Desk",
  description: "Living Well customer support desk",
  appleWebApp: {
    capable: true,
    title: "Living Well Desk",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#6E9277",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Only mount the internal copilot for logged-in agents.
  const user = await getCurrentUser();
  const canTrain = isKbTrainer(user?.email);
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        {children}
        {user && <AskPanel />}
        {/* KB Trainer is write-access — only the KB_TRAINER_EMAILS allow-list sees it. */}
        {user && canTrain && <TrainerPanel />}
        {user && <LiveChatWatcher />}
        {user && <Softphone />}
      </body>
    </html>
  );
}
