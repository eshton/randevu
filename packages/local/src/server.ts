import { generateIdentityKeyPair, generateAgreementKeyPair, fingerprint } from "@randevu/core";
import { RelayClient } from "@randevu/relay-client";

export interface RandevuServerOptions {
  /** Relay base URL. */
  relayUrl: string;
}

export interface RandevuServer {
  readonly name: string;
  readonly relay: RelayClient;
  /** This party's identity fingerprint (from a freshly generated keypair — key storage lands in RDV-8). */
  readonly memberId: string;
}

/**
 * Create the Randevu Local server.
 *
 * This is the trusted, key-holding half of Randevu. It generates the party's
 * keypairs, encrypts/signs before anything hits the network, and talks to the
 * blind relay via @randevu/relay-client.
 *
 * Stub: real key storage (RDV-8), handshake (RDV-9), group keys (RDV-10),
 * message crypto (RDV-11), and MCP tool registration via
 * @modelcontextprotocol/sdk (RDV-13) are pending. For now it wires the pieces
 * together and exposes an identity so the scaffold is exercised end-to-end.
 */
export function createRandevuServer(options: RandevuServerOptions): RandevuServer {
  const identity = generateIdentityKeyPair();
  // Agreement keypair will be used for group-key wrapping (RDV-10).
  void generateAgreementKeyPair();

  return {
    name: "randevu-local",
    relay: new RelayClient({ baseUrl: options.relayUrl }),
    memberId: fingerprint(identity.publicKey),
  };
}
