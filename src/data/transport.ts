// The gateway holds the owner's API key; the browser only sends same-origin
// requests. The public demo build swaps this module for src/demo/transport.ts
// (see vite.config.ts), so the household build never contains demo data.
export const demo = false;

export const send = (path: string, init: RequestInit) =>
  fetch(`/api/v1/money_dashboard${path}`, init);
