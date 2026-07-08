import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import HomeActions, { CreateBoardCard } from "@/components/HomeActions";

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) {
    const userCount = await db.user.count();
    redirect(userCount === 0 ? "/register" : "/login");
  }

  const memberships = await db.boardMember.findMany({
    where: { userId: user.id },
    include: {
      board: {
        include: {
          columns: { select: { id: true } },
          _count: {
            select: { tickets: { where: { status: { notIn: ["solved", "closed"] } } } },
          },
          members: { include: { user: { select: { name: true } } } },
        },
      },
    },
  });
  const boards = memberships
    .map((m) => m.board)
    .filter((b) => !b.archived)
    .sort((a, b) => a.position - b.position);

  return (
    <div className="flex-1">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon-192.png" alt="Living Well" className="w-9 h-9" />
            <h1 className="text-lg font-bold">Living Well Desk</h1>
          </div>
          <HomeActions userName={user.name} />
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">
          Your inboxes
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {boards.map((board) => (
            <Link
              key={board.id}
              href={`/boards/${board.id}`}
              className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md hover:border-violet-300 transition-all p-5 group"
            >
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 mb-3" />
              <div className="font-semibold group-hover:text-violet-700 transition-colors">
                {board.name}
              </div>
              <div className="text-sm text-gray-500 mt-1">
                {board._count.tickets} open ticket{board._count.tickets === 1 ? "" : "s"} ·{" "}
                {board.members.length} agent{board.members.length === 1 ? "" : "s"}
              </div>
            </Link>
          ))}
          <CreateBoardCard />
        </div>
      </main>
    </div>
  );
}
