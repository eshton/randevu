#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { verifyTranscript, type TranscriptBundle } from "@randevu/core";

// Standalone offline verifier for a Randevu transcript bundle (RDV-15).
// Usage: randevu-verify <transcript.json>  → prints the verification, exits 0 if valid.
const path = process.argv[2];
if (!path) {
  process.stderr.write("usage: randevu-verify <transcript.json>\n");
  process.exit(2);
}

const bundle = JSON.parse(readFileSync(path, "utf8")) as TranscriptBundle;
const result = verifyTranscript(bundle);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exit(result.valid ? 0 : 1);
