interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

interface D1Result<T = unknown> {
  success: boolean;
  results: T[];
  meta?: Record<string, unknown>;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run<T = unknown>(): Promise<D1Result<T>>;
  all<T = unknown>(): Promise<D1Result<T>>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

declare module "cloudflare:workers" {
  export const env: {
    DB?: D1Database;
    INGEST_TOKEN?: string;
    GMAIL_ADDRESS?: string;
    GMAIL_APP_PASSWORD?: string;
  };
}

declare module "cloudflare:sockets" {
  export function connect(
    address: { hostname: string; port: number },
    options?: { secureTransport?: "off" | "on" | "starttls" },
  ): { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array>; close(): Promise<void> };
}
