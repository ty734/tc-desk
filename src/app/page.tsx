import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { PRESENCE_TTL_MS } from "@/lib/livechat";
import HomeActions from "@/components/HomeActions";

// The customer-service team's front door: Live Chat + the support boards,
// front and center. Board creation still exists via the API; it doesn't
// belong on this screen.
export default async function Home() {
  const user = await getCurrentUser();
  if (!user) {
    const userCount = await db.user.count();
    redirect(userCount === 0 ? "/register" : "/login");
  }

  const [memberships, checkedIn, inboxes, waitingCounts] = await Promise.all([
    db.boardMember.findMany({
      where: { userId: user.id },
      include: {
        board: {
          include: {
            _count: {
              select: { tickets: { where: { archived: false, status: { notIn: ["solved", "closed"] } } } },
            },
            members: { select: { userId: true } },
          },
        },
      },
    }),
    db.agentPresence.count({
      where: { lastSeenAt: { gte: new Date(Date.now() - PRESENCE_TTL_MS) } },
    }),
    db.inbox.findMany({
      select: { id: true, brand: true, name: true, boardId: true, socialBoardId: true },
    }),
    // Waiting/live website chats per inbox — powers the per-brand Live Chat cards.
    db.chatSession.groupBy({
      by: ["inboxId"],
      where: { status: { in: ["waiting", "live"] } },
      _count: { _all: true },
    }),
  ]);
  const socialBoardIds = new Set(inboxes.map((i) => i.socialBoardId).filter(Boolean));
  const memberBoardIds = new Set(memberships.map((m) => m.boardId));
  const waitingByInbox = new Map(waitingCounts.map((w) => [w.inboxId, w._count._all]));
  // One Live Chat card per brand the agent handles (matched by the inbox's primary board).
  const liveInboxes = inboxes
    .filter((i) => memberBoardIds.has(i.boardId))
    .sort((a, b) => a.name.localeCompare(b.name));
  const boards = memberships
    .map((m) => m.board)
    .filter((b) => !b.archived)
    .sort((a, b) => a.position - b.position);

  const firstName = user.name.split(/\s+/)[0];

  return (
    <div className="flex-1 flex flex-col">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon-192.png" alt="Living Well" className="w-12 h-12" />
            <h1 className="text-2xl font-bold tracking-tight">Living Well Desk</h1>
          </div>
          <HomeActions userName={user.name} />
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-6 pt-14 pb-16">
        <h2 className="text-3xl font-bold">Welcome back, {firstName}</h2>
        <p className="text-lg text-gray-500 mt-2 mb-10">
          Where would you like to start today?
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Live Chat — one card per brand. Shared check-in, separate queues. */}
          {liveInboxes.map((inbox) => {
            const brandName = inbox.name.replace(/\s*support\s*$/i, "").trim();
            const waiting = waitingByInbox.get(inbox.id) ?? 0;
            return (
              <Link
                key={inbox.id}
                href={`/live?brand=${inbox.brand}`}
                className="bg-white rounded-2xl border border-gray-200 shadow-sm hover:shadow-lg hover:border-violet-400 hover:-translate-y-0.5 transition-all p-8 group"
              >
                <div className="w-16 h-16 rounded-2xl bg-violet-100 flex items-center justify-center mb-5">
                  <svg width="34" height="34" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M21 12c0 4.418-4.03 8-9 8-1.05 0-2.06-.16-3-.455L4 21l1.5-3.5C4.56 16.13 4 14.63 4 13c0-4.418 4.03-8 9-8s8 2.582 8 7z"
                      fill="#6E9277"
                    />
                    <circle cx="9.5" cy="12.5" r="1.1" fill="#fff" />
                    <circle cx="13" cy="12.5" r="1.1" fill="#fff" />
                    <circle cx="16.5" cy="12.5" r="1.1" fill="#fff" />
                  </svg>
                </div>
                <div className="text-2xl font-bold group-hover:text-violet-700 transition-colors">
                  {brandName} Live Chat
                </div>
                <div className="text-base text-gray-500 mt-1.5">
                  Check in to take website chats live
                </div>
                <div className="mt-4 flex items-center gap-2 text-sm font-medium">
                  <span
                    className={`w-2.5 h-2.5 rounded-full ${checkedIn > 0 ? "bg-green-500" : "bg-gray-300"}`}
                  />
                  <span className={checkedIn > 0 ? "text-violet-800" : "text-gray-400"}>
                    {checkedIn > 0
                      ? `${checkedIn} teammate${checkedIn === 1 ? "" : "s"} checked in`
                      : "No one checked in right now"}
                  </span>
                  {waiting > 0 && <span className="text-amber-700">· {waiting} waiting</span>}
                </div>
              </Link>
            );
          })}

          {/* Support boards */}
          {boards.map((board) => (
            <Link
              key={board.id}
              href={`/boards/${board.id}`}
              className="bg-white rounded-2xl border border-gray-200 shadow-sm hover:shadow-lg hover:border-violet-400 hover:-translate-y-0.5 transition-all p-8 group"
            >
              <div className="w-16 h-16 rounded-2xl bg-violet-100 flex items-center justify-center mb-5">
                {socialBoardIds.has(board.id) ? (
                  // Social board: at-symbol glyph (FB/IG comments + DMs).
                  <svg width="34" height="34" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="8.5" stroke="#6E9277" strokeWidth="2" />
                    <circle cx="12" cy="12" r="3.4" stroke="#2E4959" strokeWidth="2" />
                    <path
                      d="M15.4 12v1.4a2 2 0 0 0 4 0V12"
                      stroke="#6E9277"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                    <circle cx="18.8" cy="6.2" r="2.6" fill="#D6A35D" />
                  </svg>
                ) : (
                  <svg width="34" height="34" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2.5a1.5 1.5 0 0 0 0 5V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2.5a1.5 1.5 0 0 0 0-5V7z"
                      fill="#2E4959"
                    />
                    <path d="M14 6v2m0 3v2m0 3v2" stroke="#EAF0EC" strokeWidth="1.6" strokeLinecap="round" strokeDasharray="1.5 2.5" />
                  </svg>
                )}
              </div>
              <div className="text-2xl font-bold group-hover:text-violet-700 transition-colors">
                {board.name}
              </div>
              <div className="text-base text-gray-500 mt-1.5">
                {socialBoardIds.has(board.id)
                  ? "Facebook & Instagram comments and DMs"
                  : "Email and Amazon tickets, all in one place"}
              </div>
              <div className="mt-4 text-sm font-medium text-violet-800">
                {board._count.tickets} open ticket{board._count.tickets === 1 ? "" : "s"} ·{" "}
                {board.members.length} agent{board.members.length === 1 ? "" : "s"}
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
