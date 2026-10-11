import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <div className="text-center max-w-md space-y-4">
        <h1 className="text-2xl font-bold">Page not found</h1>
        <p className="text-muted-foreground text-sm">
          This page doesn&apos;t exist or has been removed.
        </p>
        <div className="flex gap-3 justify-center">
          <Link href="/" className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium">
            Go home
          </Link>
          <Link href="/play" className="px-4 py-2 rounded-lg border border-input bg-background text-sm font-medium">
            Play game
          </Link>
        </div>
      </div>
    </div>
  );
}
