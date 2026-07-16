#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const manifestPath = process.argv[2];
const outputDir = process.argv[3] || "docs/report-artifacts/2026-07-16-voice-asr-latency-root-fix";

if (!manifestPath) {
  console.error("Usage: node scripts/voice_asr_benchmark.mjs <manifest.json> [output-dir]");
  process.exit(2);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const samples = Array.isArray(manifest.samples) ? manifest.samples : [];
const runnableSamples = samples.filter((sample) => sample.audioUri || sample.redactedAudioUri);
const status = runnableSamples.length >= 30 ? "ready" : "blocked";

const result = {
  generatedAt: new Date().toISOString(),
  manifestPath,
  status,
  corpusSize: samples.length,
  runnableAudioSamples: runnableSamples.length,
  requiredMinimumSamples: 30,
  modelsRequested: manifest.modelsRequested || [],
  blockedReason:
    status === "blocked"
      ? manifest.blockedReason ||
        "Fewer than 30 approved 8 kHz audio samples are available in the sanitized manifest."
      : null,
  safetyNote:
    "This command never reads or writes raw customer audio to Git. Supply approved audio URIs outside the repository.",
  metrics:
    status === "blocked"
      ? null
      : {
          wordErrorRate: null,
          exactServiceRecognition: null,
          exactDateRecognition: null,
          exactTimeRecognition: null,
          exactStaffRecognition: null,
          exactAnyStaffRecognition: null,
          completeBookingSlotAccuracy: null,
          falsePositiveFullSetRate: null,
          recognitionLatencyMedianMs: null,
          recognitionLatencyP95Ms: null
        }
};

mkdirSync(outputDir, { recursive: true });
const jsonPath = path.join(outputDir, "voice-asr-benchmark-result.json");
const markdownPath = path.join(outputDir, "voice-asr-benchmark-summary.md");
writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`);
writeFileSync(
  markdownPath,
  [
    "# Voice ASR Benchmark Summary",
    "",
    `Status: ${result.status}`,
    `Corpus size: ${result.corpusSize}`,
    `Runnable audio samples: ${result.runnableAudioSamples}`,
    `Required minimum samples: ${result.requiredMinimumSamples}`,
    `Models requested: ${(result.modelsRequested || []).join(", ") || "none"}`,
    result.blockedReason ? `Blocked reason: ${result.blockedReason}` : "Blocked reason: none",
    "",
    result.safetyNote
  ].join("\n") + "\n"
);

console.log(JSON.stringify(result, null, 2));
