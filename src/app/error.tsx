"use client";

import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <div className="text-center max-w-md space-y-4">
        <h1 className="text-2xl font-bold">Something went wrong</h1>
        <p className="text-muted-foreground text-sm">
          A game error occurred. Please try again.
        </p>
        <div className="flex gap-3 justify-center">
          <button onClick={reset} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium">
            Try again
          </button>
          <Link href="/" className="px-4 py-2 rounded-lg border border-input bg-background text-sm font-medium">
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}
