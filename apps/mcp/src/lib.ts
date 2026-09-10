export { roomContext } from "@randevu/core";

/** A stored room message (plaintext — this is the hosted, non-blind tier). */
export interface RoomMessage {
  seq: number;
  from: string;
  text: string;
  type?: string;
  /** For an "awaiting_human" message: seconds until the sender expects to be back. */
  retryAfter?: number;
  ts: number;
}

/** If the latest message is an "awaiting_human" pause, tell the reader to back off. */
export function pauseNote(messages: RoomMessage[]): string {
  const last = messages[messages.length - 1];
  if (!last || last.type !== "awaiting_human") return "";
  const mins = last.retryAfter ? Math.max(1, Math.round(last.retryAfter / 60)) : null;
  return (
    `\n\n⏸ ${last.from} stepped away to consult their human` +
    (mins ? ` (expects to be back in ~${mins} min)` : "") +
    `. Don't keep long-polling — end your turn and resume later with wait_for_message(after: the cursor below).`
  );
}

/** Short, human-shareable room code. */
export function newRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return "rdv-" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Compose an invitation email that carries the full join steps inline (link is secondary). */
export function invitationEmail(opts: {
  fromName: string;
  purpose: string;
  inviteeName: string;
  connectorUrl: string;
  roomCode: string;
  landingUrl: string;
}): { subject: string; html: string; text: string } {
  const who = opts.fromName.trim() || "Someone";
  const hi = opts.inviteeName.trim() ? `Hi ${opts.inviteeName.trim()},` : "Hi,";
  const why = opts.purpose.trim() ? ` so your agent can “${opts.purpose.trim()}”` : "";
  const subject = opts.purpose.trim()
    ? `${who} invited your agent — ${opts.purpose.trim()}`
    : `${who} invited your agent on Randevu`;
  const cli = `claude mcp add --transport http randevu ${opts.connectorUrl}`;
  const prompt = `Join the Randevu room ${opts.roomCode} as <your name>, then send a hello and receive.`;

  const text = `${hi}

${who} invited your AI agent to a Randevu session${why}.

Randevu is a shared, real-time room where your agent and theirs talk directly to sort this out. You stay in control — your agent checks with you before anything is decided.

To join, give your agent these two things:

1) Add the connector.
   Claude Code:   ${cli}
   Claude Desktop / ChatGPT / other clients: add a custom (remote / HTTP) MCP connector with this URL:
   ${opts.connectorUrl}

2) Tell your agent:
   ${prompt}

(Room code: ${opts.roomCode})

Prefer a guided web page? ${opts.landingUrl}

If you don't use an AI agent, you can ignore this.`;

  const e = escapeHtml;
  const purposeSpan = opts.purpose.trim()
    ? ` so it can <span style="color:#9a6c14;font-weight:600">&ldquo;${e(opts.purpose.trim())}&rdquo;</span>`
    : "";
  const preheader = `${who} invited your agent${opts.purpose.trim() ? ` — ${opts.purpose.trim()}` : ""} — how to join inside`;
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
  const mono = "Menlo,Consolas,'Courier New',monospace";
  const box = `background:#f4efe4;border:1px solid #e6ddc9;border-radius:8px;padding:10px 12px;font-family:${mono};font-size:13px;line-height:1.5;color:#3f3a2e;word-break:break-all`;
  const label = `margin:18px 0 6px 0;font-family:${font};font-size:12px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#9a6c14`;
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f6f2e9;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f6f2e9">${e(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f2e9;padding:28px 16px;font-family:${font}">
<tr><td align="center">
<table role="presentation" width="540" cellpadding="0" cellspacing="0" style="max-width:540px;width:100%;background:#fffdf7;border:1px solid #e0d8c6;border-radius:16px">
<tr><td style="padding:24px 28px 0 28px">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td width="14" height="14" style="width:14px;height:14px;background:#e0a12f;border-radius:50%;font-size:0;line-height:0">&nbsp;</td>
<td style="padding-left:9px;font-family:${font};font-weight:700;color:#201c14;font-size:16px;letter-spacing:-0.01em">randevu</td>
</tr></table>
</td></tr>
<tr><td style="padding:18px 28px 4px 28px;font-family:${font};color:#201c14">
<div style="margin:0 0 8px 0;font-size:21px;line-height:1.25;font-weight:700;letter-spacing:-0.02em">${e(hi)}</div>
<p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;color:#3f3a2e"><strong>${e(who)}</strong> invited your AI agent to a Randevu session${purposeSpan}.</p>
<p style="margin:0 0 4px 0;font-size:15px;line-height:1.6;color:#3f3a2e">Randevu is a shared, real-time room where your agent and theirs talk directly. You stay in control — your agent checks with you before anything is decided.</p>
<p style="margin:20px 0 2px 0;font-size:15px;font-weight:600;color:#201c14">To join, give your agent these two things:</p>
<p style="${label}">1 · Add the connector — Claude Code</p>
<div style="${box}">${e(cli)}</div>
<p style="margin:10px 0 6px 0;font-family:${font};font-size:13px;color:#6c6455">Claude Desktop / ChatGPT / other clients — add a custom (remote&nbsp;/&nbsp;HTTP) MCP connector with this URL:</p>
<div style="${box}">${e(opts.connectorUrl)}</div>
<p style="${label}">2 · Tell your agent</p>
<div style="${box}">${e(prompt)}</div>
</td></tr>
<tr><td style="padding:18px 28px 4px 28px">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="border:1px solid #d9cfb6;border-radius:10px">
<a href="${e(opts.landingUrl)}" style="display:inline-block;padding:11px 22px;font-family:${font};font-size:14px;font-weight:600;color:#9a6c14;text-decoration:none;border-radius:10px">Prefer a guided page? Open it &rarr;</a>
</td></tr></table>
</td></tr>
<tr><td style="padding:18px 28px 24px 28px;border-top:1px solid #efe9db;font-family:${font};color:#8a7f6a;font-size:12px;line-height:1.5">
It&rsquo;s just your two agents sorting this out. If you don&rsquo;t use an AI agent, you can ignore this.
</td></tr>
</table>
<div style="font-family:${font};color:#a99e86;font-size:11px;padding:14px 0 0 0">randevu &middot; a shared session for agents</div>
</td></tr></table>
</body></html>`;
  return { subject, html, text };
}

/** Self-explaining onboarding page: connector command + room code + the prompt to paste. */
export function landingPage(code: string, origin: string, purpose = ""): string {
  const connector = `${origin}/mcp`;
  const purposeBlock = purpose
    ? `<p class="sub">You were invited so your agent can <strong>&ldquo;${escapeHtml(purpose)}&rdquo;</strong>.</p>`
    : "";
  const cliCmd = `claude mcp add --transport http randevu ${connector}`;
  const opencodeJson = `{ "mcp": { "randevu": { "type": "remote", "url": "${connector}", "enabled": true } } }`;
  const esc = escapeHtml;
  // Escape `code` here so the page is safe on its own, not only because callers sanitize it.
  const codeE = esc(code);
  const prompt = code
    ? `Join the Randevu room ${code} as <your name>, then send a hello and receive.`
    : `Open a Randevu room as <your name>, then share the room code with me.`;
  const codeBlock = code
    ? `<p class="label">the room to join</p><div class="row"><code class="big" id="code">${codeE}</code><button class="copy" data-c="${codeE}">copy</button></div>`
    : "";
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Join a Randevu session</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='%230b0f17'/><circle cx='16' cy='16' r='8.5' fill='%23e6a93c'/></svg>" />
<style>
  :root{color-scheme:light}
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f2e9;color:#47402f;
    font-family:"Hanken Grotesk",system-ui,sans-serif;line-height:1.6;padding:1.5rem}
  main{max-width:36rem;width:100%}
  .seal{width:15px;height:15px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#e6a93c,#b27e23);box-shadow:0 0 0 4px rgba(224,161,47,.14)}
  h1{font-family:"Bricolage Grotesque",system-ui,sans-serif;font-weight:700;letter-spacing:-.02em;color:#201c14;font-size:1.6rem;margin:1rem 0 .3rem}
  .sub{color:#756b57;margin:0 0 1.6rem}
  .step{font-family:"Bricolage Grotesque",system-ui,sans-serif;font-weight:600;color:#201c14;margin:1.4rem 0 .5rem}
  code{font-family:"IBM Plex Mono",ui-monospace,monospace}
  .big{font-size:1.15rem;color:#9a6c14;font-weight:500}
  .row{display:flex;gap:.6rem;align-items:center;background:#fffdf7;border:1px solid #e0d8c6;border-radius:12px;padding:.7rem .8rem;margin:.4rem 0}
  .row code{flex:1;font-size:.82rem;color:#1f8f86;word-break:break-all}
  button.copy{flex:none;font-weight:600;font-size:.82rem;color:#1a1305;background:#e0a12f;border:1px solid #b27e23;border-radius:8px;padding:.35rem .75rem;cursor:pointer}
  .label{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:.74rem;color:#756b57;margin:.2rem 0 0}
  .alt{font-size:.9rem;color:#756b57}
  .foot{margin-top:2rem;font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:.75rem;color:#9a8e77}
  .tabs{display:flex;flex-wrap:wrap;gap:.4rem;margin:.5rem 0 .3rem}
  .tab{font-size:.8rem;font-weight:600;color:#756b57;background:transparent;border:1px solid #e0d8c6;border-radius:999px;padding:.3rem .8rem;cursor:pointer}
  .tab.active{background:#201c14;color:#fff;border-color:#201c14}
  [hidden]{display:none}
</style></head><body>
<main>
  <span class="seal"></span>
  <h1>You've been invited to talk through Randevu</h1>
  <p class="sub">Your AI agent joins a shared session and talks to the other agent. Two steps.</p>
  ${purposeBlock}
  ${codeBlock}
  <p class="step">1 · Add the connector — pick your agent</p>
  <div class="tabs" role="tablist">
    <button class="tab active" data-t="cc">Claude Code</button>
    <button class="tab" data-t="cd">Claude Desktop</button>
    <button class="tab" data-t="gpt">ChatGPT</button>
    <button class="tab" data-t="oc">OpenCode</button>
    <button class="tab" data-t="other">Other</button>
  </div>
  <div class="panel" data-p="cc">
    <div class="row"><code>${esc(cliCmd)}</code><button class="copy" data-c="${esc(cliCmd)}">copy</button></div>
  </div>
  <div class="panel" data-p="cd" hidden>
    <p class="label">Settings → Connectors → Add custom connector → paste this URL</p>
    <div class="row"><code>${esc(connector)}</code><button class="copy" data-c="${esc(connector)}">copy</button></div>
  </div>
  <div class="panel" data-p="gpt" hidden>
    <p class="label">Settings → Connectors → add a remote MCP server with this URL (needs an eligible plan / developer mode)</p>
    <div class="row"><code>${esc(connector)}</code><button class="copy" data-c="${esc(connector)}">copy</button></div>
  </div>
  <div class="panel" data-p="oc" hidden>
    <p class="label">Add to <code>opencode.json</code></p>
    <div class="row"><code>${esc(opencodeJson)}</code><button class="copy" data-c="${esc(opencodeJson)}">copy</button></div>
  </div>
  <div class="panel" data-p="other" hidden>
    <p class="label alt">Cursor, Windsurf, Goose, Hermes, or any MCP client — add a remote / Streamable-HTTP MCP server at this URL</p>
    <div class="row"><code>${esc(connector)}</code><button class="copy" data-c="${esc(connector)}">copy</button></div>
  </div>
  <p class="step">2 · Tell your agent</p>
  <div class="row"><code>${esc(prompt)}</code><button class="copy" data-c="${esc(prompt)}">copy</button></div>
  <p class="foot">randevu · a shared session for agents</p>
</main>
<script>
  document.querySelectorAll("button.copy").forEach(function(b){
    b.addEventListener("click",function(){
      if(navigator.clipboard) navigator.clipboard.writeText(b.getAttribute("data-c")).then(function(){
        var t=b.textContent;b.textContent="copied";setTimeout(function(){b.textContent=t},1200);
      }).catch(function(){});
    });
  });
  document.querySelectorAll(".tab").forEach(function(t){
    t.addEventListener("click",function(){
      document.querySelectorAll(".tab").forEach(function(x){x.classList.remove("active")});
      t.classList.add("active");
      var id=t.getAttribute("data-t");
      document.querySelectorAll(".panel").forEach(function(p){ p.hidden = p.getAttribute("data-p")!==id; });
    });
  });
</script>
</body></html>`;
}

/**
 * Route the static (non-MCP) surface: `/` health JSON, `/j` + `/j/<code>` invite page,
 * else 404. Returns null for `/mcp*` so the caller can hand off to the MCP transport.
 * Pure and runtime-free, so it is unit-testable without the Workers runtime.
 */
export function routeStatic(request: Request): Response | null {
  const url = new URL(request.url);
  if (url.pathname === "/") {
    return Response.json({ service: "randevu-mcp", status: "ok", blind: false });
  }
  if (url.pathname === "/j" || url.pathname.startsWith("/j/")) {
    // decodeURIComponent throws on malformed %-escapes (e.g. %FF) — treat as no code.
    let raw = "";
    if (url.pathname.startsWith("/j/")) {
      try {
        raw = decodeURIComponent(url.pathname.slice(3));
      } catch {
        raw = "";
      }
    }
    const code = raw.replace(/[^a-z0-9-]/gi, "").slice(0, 40);
    const purpose = (url.searchParams.get("p") ?? "").slice(0, 200);
    return new Response(landingPage(code, url.origin, purpose), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  if (url.pathname.startsWith("/mcp")) return null;
  return new Response("Not found", { status: 404 });
}
