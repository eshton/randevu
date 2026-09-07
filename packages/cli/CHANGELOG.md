# @randevu/cli

## 0.1.0

### Minor Changes

- Initial public release.

  - `@randevu/core` — crypto + protocol + schemas (Ed25519/X25519, group keys, signed transcript, invites + join links). Isomorphic, zero I/O.
  - `@randevu/relay-client` — typed REST client for the blind relay (ciphertext + public keys only).
  - `@randevu/local` — the trusted, key-holding half: stdio MCP server + embeddable API.
  - `@randevu/cli` — `randevu start` (hosted relay) and `randevu start local` (self-host a blind relay, no hosted service in the loop; `--tunnel` to bridge the internet via cloudflared). Prints a shareable join link.

### Patch Changes

- Updated dependencies
  - @randevu/core@0.1.0
  - @randevu/local@0.1.0
