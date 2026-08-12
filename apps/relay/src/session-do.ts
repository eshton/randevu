/**
 * SessionDurableObject — one Durable Object per Randevu session.
 *
 * Why a DO per session (see docs/STACK.md):
 *  - serialized writes → monotonic `seq` for free (no locks, no sequence contention)
 *  - per-session SQLite holds members, public keys, wrapped group keys, ciphertext
 *  - WebSocket hibernation makes push (RDV-16) nearly free
 *
 * The DO stays BLIND: it stores only ciphertext + public keys, never plaintext
 * or private keys.
 *
 * Stub: session lifecycle (RDV-3), key registry (RDV-4), append-only log +
 * monotonic seq (RDV-5), join tokens + lock (RDV-6), poll cursor (RDV-7).
 */
export class SessionDurableObject implements DurableObject {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: unknown,
  ) {
    void this.state;
    void this.env;
  }

  async fetch(_request: Request): Promise<Response> {
    return Response.json(
      { error: "not_implemented", tickets: ["RDV-3", "RDV-4", "RDV-5", "RDV-6", "RDV-7"] },
      { status: 501 },
    );
  }
}
