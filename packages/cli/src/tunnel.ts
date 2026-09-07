import { spawn } from "node:child_process";

export interface Tunnel {
  url: string;
  close(): void;
}

/**
 * Best-effort public tunnel via `cloudflared` if it's on PATH (a free quick tunnel,
 * no account needed). Returns null when cloudflared is missing or no URL appears in
 * time — the caller then falls back to the local URL. Kept dependency-free on purpose:
 * no bundled tunnel service, no account.
 */
export function openTunnel(port: number, timeoutMs = 20_000): Promise<Tunnel | null> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn("cloudflared", ["tunnel", "--url", `http://127.0.0.1:${port}`], {
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      resolve(null);
      return;
    }

    let settled = false;
    const finish = (t: Tunnel | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(t);
    };

    const onData = (buf: Buffer) => {
      const m = buf.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m) finish({ url: m[0], close: () => child.kill() });
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("error", () => finish(null));
    child.on("exit", () => finish(null));

    const timer = setTimeout(() => {
      // Couldn't get a URL — leave the process for the caller? No: kill and fall back.
      if (!settled) child.kill();
      finish(null);
    }, timeoutMs);
  });
}
