#!/usr/bin/env node
import { readFileSync } from "node:fs";

const manifestPath = process.argv[2] || "docs/report-artifacts/2026-07-17-voice-ai-production-upgrade/redacted-replay-manifest.json";
const strict = process.argv.includes("--strict") || process.env.VOICE_REPLAY_STRICT === "1";

const readJson = (filePath) => JSON.parse(readFileSync(filePath, "utf8"));
const normalize = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

const flattenTranscripts = (value) => {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap(flattenTranscripts);
  }
  if (typeof value === "string") {
    return [value];
  }
  if (typeof value === "object") {
    return [
      value.callerTranscript,
      value.inputTranscript,
      value.transcript,
      value.currentTurnTranscript,
      ...(Array.isArray(value.transcripts) ? value.transcripts : []),
      ...(Array.isArray(value.turns) ? value.turns.flatMap(flattenTranscripts) : [])
    ].filter(Boolean);
  }
  return [];
};

const manifest = readJson(manifestPath);
const contacts = [];

for (const source of manifest.sources || []) {
  const data = readJson(source.path);
  if (source.kind === "live-thuyet-voice-recognition") {
    for (const contact of data.allMatchingContactIds || []) {
      contacts.push({
        source: source.path,
        contactId: contact.contactId,
        expectedTransition: "safe_replay_from_redacted_july_15_report",
        transcripts: flattenTranscripts(contact.transcripts)
      });
    }
  }
  if (source.kind === "live-thuyet-silent-disconnect") {
    for (const contact of data.contacts || []) {
      contacts.push({
        source: source.path,
        contactId: contact.contactId,
        expectedTransition: contact.lambdaInvoked === false
          ? "provider_prompt_path_without_lambda_invocation"
          : contact.finalOutcome || "safe_nonterminal_or_terminal_transition",
        transcripts: flattenTranscripts(contact.transcripts || contact.lambdaTranscripts || contact.turns)
      });
    }
  }
}

const transcriptText = normalize(contacts.flatMap((contact) => contact.transcripts).join(" "));
const requiredPhraseResults = (manifest.requiredPhraseFragments || []).map((phrase) => ({
  phrase,
  present: transcriptText.includes(normalize(phrase))
}));
const missingRequiredPhrases = requiredPhraseResults
  .filter((item) => !item.present)
  .map((item) => item.phrase);
const blockedReasons = [];

if ((manifest.expectedExportedCallCount || 0) > contacts.length) {
  blockedReasons.push(
    `Only ${contacts.length} redacted contacts are available; expected ${manifest.expectedExportedCallCount}.`
  );
}
if (missingRequiredPhrases.length) {
  blockedReasons.push(`Missing required phrase fragments: ${missingRequiredPhrases.join(", ")}`);
}
if (manifest.realAudioMinimumSamples && manifest.realAudioAvailableSamples < manifest.realAudioMinimumSamples) {
  blockedReasons.push(
    `Only ${manifest.realAudioAvailableSamples} approved real-audio samples are available; expected ${manifest.realAudioMinimumSamples}.`
  );
}

const result = {
  manifestPath,
  strict,
  status: blockedReasons.length ? "blocked" : "pass",
  contactsAvailable: contacts.length,
  expectedExportedCallCount: manifest.expectedExportedCallCount,
  requiredPhraseResults,
  blockedReasons,
  contacts: contacts.map((contact) => ({
    source: contact.source,
    contactId: contact.contactId,
    transcriptCount: contact.transcripts.length,
    expectedTransition: contact.expectedTransition
  }))
};

console.log(JSON.stringify(result, null, 2));

if (strict && blockedReasons.length) {
  process.exit(1);
}
