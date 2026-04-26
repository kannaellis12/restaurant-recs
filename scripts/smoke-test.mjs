#!/usr/bin/env node
/**
 * Smoke tests for external services. Reads .env.local without depending on
 * any package, so it works straight after a fresh clone.
 *
 *   node scripts/smoke-test.mjs
 *
 * Prints PASS / FAIL per service. Never echoes credentials.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "..", ".env.local");

const env = {};
for (const rawLine of readFileSync(envPath, "utf8").split("\n")) {
  const line = rawLine.trim();
  if (!line || line.startsWith("#")) continue;
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!m) continue;
  let val = m[2].trim();
  if (
    (val.startsWith('"') && val.endsWith('"')) ||
    (val.startsWith("'") && val.endsWith("'"))
  ) {
    val = val.slice(1, -1);
  }
  env[m[1]] = val;
}

const results = [];

async function test(name, fn) {
  process.stdout.write(`${name.padEnd(28)} `);
  try {
    const t0 = Date.now();
    const detail = await fn();
    const ms = Date.now() - t0;
    console.log(`✓ PASS (${ms}ms)${detail ? ` — ${detail}` : ""}`);
    results.push(true);
  } catch (e) {
    console.log(`✗ FAIL — ${e.message}`);
    results.push(false);
  }
}

function need(varName) {
  if (!env[varName]) throw new Error(`${varName} missing from .env.local`);
  return env[varName];
}

await test("Anthropic API", async () => {
  const key = need("ANTHROPIC_API_KEY");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 8,
      messages: [{ role: "user", content: "Reply with just 'ok'." }],
    }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  return `model=${d.model} stop=${d.stop_reason}`;
});

await test("Google Places API", async () => {
  const key = need("GOOGLE_MAPS_API_KEY");
  const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "places.id,places.displayName",
    },
    body: JSON.stringify({ textQuery: "pizza in Denver", maxResultCount: 3 }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  return `${(d.places || []).length} places returned`;
});

await test("Google Geocoding API", async () => {
  const key = need("GOOGLE_MAPS_API_KEY");
  const r = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?address=Denver,CO&key=${key}`,
  );
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = await r.json();
  if (d.status !== "OK") throw new Error(`status=${d.status}: ${d.error_message ?? ""}`);
  return `${d.results.length} results`;
});

await test("Mapbox public token", async () => {
  const tok = need("NEXT_PUBLIC_MAPBOX_TOKEN");
  if (!tok.startsWith("pk.")) {
    throw new Error("token doesn't start with 'pk.' — should be a public token");
  }
  const r = await fetch(
    `https://api.mapbox.com/styles/v1/mapbox/streets-v12?access_token=${tok}`,
  );
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return "public token valid";
});

await test("Supabase anon key", async () => {
  const url = need("NEXT_PUBLIC_SUPABASE_URL");
  const anon = need("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  // /auth/v1/settings accepts either anon or service-role keys; returns 401
  // if the apikey is invalid. Used as a connectivity check that doesn't
  // depend on any tables existing.
  const r = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: anon } });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return `auth reachable (HTTP ${r.status})`;
});

await test("Supabase service role", async () => {
  const url = need("NEXT_PUBLIC_SUPABASE_URL");
  const svc = need("SUPABASE_SERVICE_ROLE_KEY");
  const r = await fetch(`${url}/rest/v1/`, {
    headers: { apikey: svc, Authorization: `Bearer ${svc}` },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return `reachable (HTTP ${r.status})`;
});

await test("Migration applied (cities)", async () => {
  const url = need("NEXT_PUBLIC_SUPABASE_URL");
  const svc = need("SUPABASE_SERVICE_ROLE_KEY");
  const r = await fetch(`${url}/rest/v1/cities?select=slug&order=slug`, {
    headers: { apikey: svc, Authorization: `Bearer ${svc}` },
  });
  if (r.status === 404 || r.status === 400) {
    throw new Error("cities table not found — run supabase/migrations/0001_init.sql in SQL Editor");
  }
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const rows = await r.json();
  if (rows.length !== 4) {
    throw new Error(`expected 4 cities, got ${rows.length}`);
  }
  return `4 cities seeded: ${rows.map((r) => r.slug).join(", ")}`;
});

const allPass = results.every(Boolean);
console.log(`\n${results.filter(Boolean).length}/${results.length} services healthy`);
process.exit(allPass ? 0 : 1);
