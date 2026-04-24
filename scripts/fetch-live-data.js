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
  const pageProps = payload?.props?.pageProps || {};
  return {
    fetchedAt: new Date().toISOString(),
    sourceUrl: runnerUrl,
    currentEvent: pageProps.currentEvent || null,
    runner: pageProps.runner || emptyPayload().runner
  };
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
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error("UTMB page did not include __NEXT_DATA__");
  }

  const normalized = normalizePayload(JSON.parse(match[1]));
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(normalized, null, 2) + "\n");
  console.log(`Wrote ${path.relative(ROOT, OUTPUT_PATH)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
