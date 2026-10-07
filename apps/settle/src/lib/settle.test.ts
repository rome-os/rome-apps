import { test } from "vitest";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isToken, newToken } from "../db/repositories/ledger.js";
import { DEFAULT_PROFILE, TIERS, isTier, payeeName, tierActionName, usdFor } from "../shared/model.js";

const root = join(import.meta.dirname, "..", "..");

test("link tokens are 14 unguessable characters and validate", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i++) {
    const t = newToken();
    assert.ok(isToken(t), t);
    seen.add(t);
  }
  assert.equal(seen.size, 2000);
  for (const bad of ["", "short", "../../etc/passwd", "0OIl0OIl0OIl0O", "abcdefghijklmn!"]) assert.equal(isToken(bad), false, bad);
});

test("every tier has a favor-gated action priced exactly at that tier", () => {
  const appYaml = readFileSync(join(root, "app.yaml"), "utf8");
  for (const n of TIERS) {
    const yamlPath = join(root, "src/actions", `pay-${n}`, "action.yaml");
    assert.ok(existsSync(yamlPath), `missing ${yamlPath} — run pnpm gen:tiers`);
    const yaml = readFileSync(yamlPath, "utf8");
    assert.match(yaml, new RegExp(`^name: ${tierActionName(n)}$`, "m"));
    assert.match(yaml, new RegExp(`^  amount: ${n}$`, "m"));
    assert.ok(appYaml.includes(`  - actions/pay-${n}\n`), `app.yaml lists pay-${n}`);
  }
});

test("tiers and dollar hints", () => {
  assert.equal(isTier(2500), true);
  assert.equal(isTier(2400), false);
  assert.equal(isTier("2500"), false);
  assert.equal(usdFor(25000), "$100");
  assert.equal(usdFor(2500), "$10");
  assert.equal(usdFor(25), "$0.10");
  assert.equal(usdFor(1), "<$0.01");
  assert.equal(usdFor(0), "$0");
});

test("a fresh install shows no one's identity until the owner fills in a profile", () => {
  for (const [field, value] of Object.entries(DEFAULT_PROFILE)) assert.equal(value, "", field);
  assert.equal(payeeName({ name: "" }), "Your contact");
  assert.equal(payeeName({ name: "  Ada Lovelace " }), "Ada Lovelace");
});
