import { createDemoBackend } from "./backend";

// Replaces src/data/transport.ts in the demo build: requests are answered by a
// fictional household in memory instead of the gateway.
export const demo = true;

let backend: ReturnType<typeof createDemoBackend> | null = null;

export async function send(path: string, init: RequestInit) {
  if (init.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  backend ??= createDemoBackend();
  const body =
    typeof init.body === "string" && init.body
      ? JSON.parse(init.body)
      : undefined;
  const result = backend.handle(init.method ?? "GET", path, body);
  return new Response(
    result.body === undefined ? null : JSON.stringify(result.body),
    { status: result.status, headers: { "Content-Type": "application/json" } },
  );
}
