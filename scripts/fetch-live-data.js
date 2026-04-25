#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PLAN_PATH = path.join(ROOT, "data", "race-plan.json");
const OUTPUT_PATH = path.join(ROOT, "data", "live-runner.json");

const plan = JSON.parse(fs.readFileSync(PLAN_PATH, "utf8"));
const runnerUrl = plan.liveTracking?.runnerUrl;

function emptyPayload() {
  return {
    fetchedAt: new Date().toISOString(),
    sourceUrl: runnerUrl || null,
    currentEvent: null,
    runner: {
      resume: {
        bib: null,
        info: { fullname: null },
        prediction: {
          lastPointId: null,
          lastPassing: null,
          nextPointId: null,
          nextPointPrediction: null,
          finishPrediction: null
        }
      },
      detail: {
        passings: []
      }
    }
  };
}

function normalizePayload(payload) {
  const pageProps = extractPageProps(payload);
  return {
    fetchedAt: new Date().toISOString(),
    sourceUrl: runnerUrl,
    currentEvent: pageProps.currentEvent || null,
    runner: pageProps.runner || emptyPayload().runner
  };
}

function extractPageProps(payload) {
  if (!payload || typeof payload !== "object") return {};
  if (payload.props?.pageProps) return payload.props.pageProps;
  if (payload.pageProps) return payload.pageProps;
  if (payload.currentEvent || payload.runner) return payload;
  return {};
}

function looksLikeRunnerPayload(payload) {
  const pageProps = extractPageProps(payload);
  return Boolean(
    pageProps &&
      typeof pageProps === "object" &&
      (pageProps.runner || pageProps.currentEvent)
  );
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function scriptContents(html) {
  return Array.from(
    html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi),
    (match) => match[1]
  );
}

function parseJsonAssignments(script) {
  const assignmentPatterns = [
    /(?:window\.|self\.)?__NEXT_DATA__\s*=\s*(\{[\s\S]*\})\s*;?/,
    /(?:window\.|self\.)?NEXT_DATA\s*=\s*(\{[\s\S]*\})\s*;?/,
    /(?:window\.|self\.)?__INITIAL_STATE__\s*=\s*(\{[\s\S]*\})\s*;?/
  ];

  for (const pattern of assignmentPatterns) {
    const match = script.match(pattern);
    if (!match) continue;
    const parsed = safeParseJson(match[1]);
    if (looksLikeRunnerPayload(parsed)) return parsed;
  }

  return null;
}

function parseCandidateScripts(html) {
  for (const script of scriptContents(html)) {
    const trimmed = script.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      const parsed = safeParseJson(trimmed);
      if (looksLikeRunnerPayload(parsed)) return parsed;
    }

    if (/pageProps|currentEvent|runner/.test(trimmed)) {
      const parsedAssignment = parseJsonAssignments(trimmed);
      if (looksLikeRunnerPayload(parsedAssignment)) return parsedAssignment;
    }
  }

  return null;
}

function extractBalancedJsonObject(text, startIndex) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

function parseLooseHtmlJson(html) {
  const markers = [
    "\"props\":{\"pageProps\":",
    "\"pageProps\":",
    "\"currentEvent\":",
    "\"runner\":"
  ];

  for (const marker of markers) {
    const markerIndex = html.indexOf(marker);
    if (markerIndex < 0) continue;

    let objectStart = html.lastIndexOf("{", markerIndex);
    while (objectStart >= 0) {
      const candidate = extractBalancedJsonObject(html, objectStart);
      if (!candidate) break;
      const parsed = safeParseJson(candidate);
      if (looksLikeRunnerPayload(parsed)) return parsed;
      objectStart = html.lastIndexOf("{", objectStart - 1);
    }
  }

  return null;
}

function parseUtmbPayload(html) {
  const nextDataMatch = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/i
  );
  if (nextDataMatch) {
    const parsed = safeParseJson(nextDataMatch[1]);
    if (looksLikeRunnerPayload(parsed)) return parsed;
  }

  const scriptPayload = parseCandidateScripts(html);
  if (scriptPayload) return scriptPayload;

  const loosePayload = parseLooseHtmlJson(html);
  if (loosePayload) return loosePayload;

  return null;
}

async function main() {
  if (!runnerUrl) {
    throw new Error("race-plan.json is missing liveTracking.runnerUrl");
  }

  const response = await fetch(runnerUrl, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; JonathanCanyonsPagesRefresh/1.0)"
    }
  });

  if (!response.ok) {
    throw new Error(`UTMB responded with ${response.status}`);
  }

  const html = await response.text();
  const payload = parseUtmbPayload(html);
  if (!payload) {
    throw new Error("UTMB page did not include a recognizable runner payload");
  }

  const normalized = normalizePayload(payload);
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(normalized, null, 2) + "\n");
  console.log(`Wrote ${path.relative(ROOT, OUTPUT_PATH)}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

module.exports = {
  emptyPayload,
  extractPageProps,
  looksLikeRunnerPayload,
  normalizePayload,
  parseUtmbPayload
};
