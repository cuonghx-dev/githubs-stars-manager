export function App() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-2 bg-background p-6 text-center text-foreground">
      <h1 className="text-2xl font-semibold">Stars Graph</h1>
      <p className="text-muted-foreground">
        No graph yet. Run <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm">pnpm data</code> to build it.
      </p>
    </main>
  );
}
