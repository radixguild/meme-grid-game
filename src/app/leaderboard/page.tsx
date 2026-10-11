"use client";
import LeaderboardTable from "@/components/LeaderboardTable";

export default function LeaderboardPage() {
  return (
    <div className="max-w-2xl lg:max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6 neon-glow">Leaderboard</h1>
      <LeaderboardTable />
    </div>
  );
}
