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

### F1 (MEDIUM) — Group-key authority not enforced
`postKeys` accepts wrapped keys from **any** member. A malicious member could overwrite an
epoch's wrapped keys, causing decryption failures (DoS/confusion). It cannot forge content
(messages are signed), but it can disrupt an epoch. → **RDV-34**: bind the group key to the
epoch's designated key-holder (creator/holder), or namespace `gkey` by poster + have members
pick the holder's copy, or sign the wrapped-key set.

### F2 (MEDIUM) — Only the creator is anti-MITM-verified (multi-party)
The invite commits to the **creator's** fingerprint only. In a 3+-party session, non-creator
members' keys are relay-attested (TOFU) — a malicious relay could substitute a later joiner's
key, and messages from that member would verify against the substituted key. → covered by
**RDV-17 (SAS mutual auth)**; until then, multi-party trust in non-creator members is TOFU.
Documented in ENCRYPTION.md residuals.

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
- Land RDV-34 (group-key authority) and RDV-32 (relay request auth) before untrusted multi-party use.
- RDV-17 (SAS) for airtight multi-party mutual auth.
