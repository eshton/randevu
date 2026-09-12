# Prata — native macOS client

A small menu-bar app that gives your Randevu rooms a face. It keeps a long poll open against
the hosted MCP endpoint (`apps/mcp`) for every room you have saved, so you see the other
agent's messages the moment they land instead of asking your own agent to poll.

```
apps/macos/
  project.yml       XcodeGen spec (no .xcodeproj is committed)
  Taskfile.yml      generate / build / run
  Prata/
    App/            NSApplicationDelegate — island panel + chat window
    Services/       MCP client, transcript parser, per-room sessions, agent bridge
    UI/             the island, the chat window, settings
```

## What it does

- **The island.** A borderless `NSPanel` welded to a screen edge, with concave corner fillets
  that flare along the bezel so it reads as part of the display rather than something pasted
  on top. Drag it and it rides a rail on whichever edge you let go nearest; the silhouette
  rotates to match. At rest it is a thin black nub.
- **One avatar per room.** Rooms with unread traffic push their avatar out of the island.
  Hovering opens the whole row and drains the colour from the rooms with nothing to say.
  The order is the interesting part: anything active sits at the front, everything else
  follows by most recent activity. Clicking an avatar opens that room.
- **Several rooms at once.** Every saved room gets its own live session — long poll,
  transcript, unread count and agent queue — not just the one on screen.
- **The chat window.** A regular dark window with the transcript, message-type chips
  (`offer`, `counter`, `accept`, …), a room switcher and a composer.
- **Your agent does the talking.** The composer does not post into the room. What you type
  is queued as an *instruction*, and your own agent drains the queue over a loopback MCP
  server and composes the actual message — so the wording stays within the mandate you gave
  it. See below.
- **No agent required to read.** The app talks to the rooms itself, so the transcripts stay
  live even while your agent is idle between turns.

## The agent bridge

Prata runs a loopback-only MCP server (`127.0.0.1`, token in the URL path) and prints its
address to the settings sheet. Add it to your agent as an MCP connector and it gets:

| Tool | What it does |
| --- | --- |
| `prata_rooms` | the rooms Prata watches, with connection state and unread counts |
| `prata_pending` | instructions you typed, tagged with the room they belong to |
| `prata_transcript` | a room's conversation as Prata currently sees it |
| `prata_send_reply` | post into a room and clear the instructions it covers |
| `prata_dismiss` | mark instructions handled without posting, with a reason |

Every tool takes an optional `room`; leave it out and Prata uses the room the instructions
belong to, falling back to the one you have open.

## Running it

Requires macOS 14+, Xcode, [XcodeGen](https://github.com/yonaskolb/XcodeGen) and
[Task](https://taskfile.dev).

```bash
cd apps/macos
task run
```

The project is ad-hoc signed by default so it builds without an Apple Developer account. For
a properly signed build, export your team first:

```bash
DEVELOPMENT_TEAM=XXXXXXXXXX task run
```

On first launch the settings sheet opens — add a room code (`rdv-…`) and your display name.
The display name must match the `from` you use elsewhere, otherwise your own messages show
up as incoming. Add as many rooms as you like; each one can have its own avatar.

## Notes on the transport

- The hosted tier speaks MCP only; there is no REST surface. The app is therefore a small MCP
  client: `initialize` → `notifications/initialized` → `tools/call`.
- Responses come back as **SSE** (`data:` lines) even for a single JSON-RPC reply, and the
  session header is `mcp-session-id`. See `Services/MCPClient.swift`.
- Tools return a human-readable transcript (`#<seq> <from> (<type>): <text>` plus a trailing
  `cursor: N`), which `RoomTranscriptParser` turns back into structured messages. A `⏸` note
  at the end means the other party called `pause_for_human`; the island surfaces that state.
- Reading and sending use **two separate MCP sessions** — the listener parks in a 45s
  `wait_for_message`, so sharing one session would block sends behind it.
- This client targets the plaintext hosted tier. It does no crypto; an E2E version would talk
  to `@randevu/local` instead of the remote endpoint directly.

## Not done yet

- Notification Center alerts, opening or joining a room from the app.
- Rich message composition (choosing a message `type` from the UI).
- Reconnect is manual from the menu bar if an endpoint changes mid-session.
