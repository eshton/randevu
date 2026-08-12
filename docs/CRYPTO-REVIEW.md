# Crypto Review Pass (RDV-2)

Adversarial review of the implemented crypto/protocol as of 2026-08-12 (`@randevu/core`,
`@randevu/local`, relay). Scope: primitives, key handling, message auth, transcript chain,
keystore. **Not a substitute for an external audit** before production — recommended (see
"Recommended follow-ups").

## Primitives — sound
- **X25519** ECDH, **Ed25519** signatures, **XChaCha20-Poly1305** AEAD, **HKDF-SHA256**,
  **BLAKE2b** fingerprints, all via audited `@noble/*`. No custom primitives.
- **Sealed box** (encrypt-to-pubkey): fresh ephemeral X25519 per seal → ECDH → HKDF(salt =
  ephPub‖recipPub) → AEAD with nonce = BLAKE2b(ephPub‖recipPub). Nonce is unique per seal
  because the ephemeral key is fresh; key binds both public keys. ✅
- **Message AEAD**: fresh random 24-byte XChaCha nonce per message (collision negligible);
  associated data binds `sessionId|epoch|senderId`. ✅

## What the design gets right
- **Signature ≠ seq**: signatures bind content + context + `prevHash`, not the relay-assigned
  seq. Order is authenticated by the transcript chain, so the relay can't launder order.
- **Replay is caught by the chain**: a replayed (ciphertext, signature) lands at a new position
  whose expected `prevHash` differs → `chainOk` false → flagged unverified.
- **senderId spoofing is caught by signatures**: the relay doesn't authenticate callers (RDV-32),
  but a spoofed senderId fails signature verification against the pinned key → unverified.
- **Anti-MITM on the creator**: the joiner verifies the creator's key against the invite
  fingerprint commitment.

## Findings

### F1 (was MEDIUM → HIGH) — Group-key distribution unauthenticated — ✅ FIXED (RDV-34)
Originally scoped as a member DoS (any member could overwrite an epoch's wrapped keys). On
review it was worse: because member X25519 pubkeys are public, a **malicious relay** could seal
its **own** group key to each member and read all traffic — a confidentiality break, not just DoS.
**Fixed:** the key-holder (creator) now signs a commitment to the group key bound to
`(sessionId, epoch)`; the relay accepts `postKeys` only from the creator; members verify the
unwrapped key against the holder's signed commitment using the holder's pinned identity key.
Neither another member nor the relay can substitute the key without a forgery. Covered by tests
(core holder-signature; e2e relay-substitution rejected).

### F2 (MEDIUM) — Only the creator is anti-MITM-verified (multi-party) — ✅ ADDRESSED (RDV-17)
The invite commits to the **creator's** fingerprint only, so non-creator members were
relay-attested (TOFU). **Addressed** by the Short Authentication String: both parties compute a
code over the session id + all members' identity keys (using their own real key for their own
entry) and compare out-of-band; any substituted member key makes the codes diverge. Opt-in
(requires the out-of-band compare). Tests: core order-independence/divergence; e2e honest-match +
relay-substitution divergence.

### F3 (LOW) — Fingerprint length
Member identity is keyed by a 16-byte (128-bit) BLAKE2b fingerprint. Preimage resistance
(128-bit) is fine for the invite commitment; birthday resistance for id collisions is ~2^64.
Honest collisions are negligible; a targeted-impersonation collision needs a preimage. → optional
**RDV-35**: widen identity fingerprints to 24–32 bytes.

### F4 (LOW) — Signing-bytes delimiter
`messageSigningBytes` joins fields with `|`. All fields are fixed-format (rdv_/hex/enum) with no
`|`, so no injection today, but it's not length-prefixed. → hardening: length-prefix or per-field
hashing. Tracked in RDV-35.

### F5 (LOW) — Multi-epoch key rotation / removal
Epoch bumps on join; member **removal** and full rekey aren't implemented, so backward secrecy on
membership shrink is absent. → **RDV-18** (forward secrecy) + a removal path.

## Fixes applied in this pass
- **Epoch-aware decryption**: the client now decrypts each message with the key for **its own
  epoch** (`groupKeys.get(m.epoch)`), not just the current epoch — correctness across rekeys.
- **Stronger keystore KDF**: scrypt N raised 2^15 → 2^16.

## Confirmed unchanged from the interop decision (RDV-21)
X25519/XChaCha20-Poly1305/Ed25519 remain a concrete, compatible profile of ANP's under-specified
ECDHE; Ed25519 = EdDSA keeps JWS/VC serialization open (RDV-29).

## Recommended follow-ups
- **External cryptographic audit** before any production / Randevu Cloud launch.
- ~~RDV-34 (group-key authority)~~ ✅ done · ~~RDV-32 (relay request auth)~~ ✅ done ·
  ~~RDV-17 (SAS)~~ ✅ done — the review findings are addressed.
- Remaining hardening: RDV-33 (relay-enforced chain head for concurrency), RDV-35 (wider
  fingerprints + length-prefixed signing), RDV-18 (forward secrecy / member removal).
