import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  loadMediaGuardConfig,
  mergeMediaGuardConfigs,
  parseMediaGuardConfig,
  resolveLayeredMediaBudget,
} from "../src/config.js";

test("strict config parsing accepts declared budgets and rejects unknown fields", () => {
  const valid = parseMediaGuardConfig({
    version: 1,
    budget: { maxSerializedMediaBytes: 3_145_728 },
    profiles: { "private-gateway": { maxMediaBlocks: 4 } },
  });
  assert.equal(valid.ok, true);

  const invalid = parseMediaGuardConfig({
    version: 1,
    budegt: { maxSerializedMediaBytes: 3_145_728 },
  });
  assert.deepEqual(invalid, { ok: false, error: 'Unknown config field "budegt"' });
});

test("project config overrides global fields while inheriting other declared values", () => {
  const globalConfig = parseMediaGuardConfig({
    version: 1,
    budget: { maxMediaBlocks: 10, maxSerializedMediaBytes: 4_000_000 },
    profiles: { "amazon-bedrock": { maxMediaBlocks: 12, maxSerializedMediaBytes: 8_000_000 } },
  });
  const projectConfig = parseMediaGuardConfig({
    version: 1,
    budget: { maxMediaBlocks: 6 },
    profiles: { "amazon-bedrock": { maxSerializedMediaBytes: 12_000_000 } },
  });
  assert.equal(globalConfig.ok, true);
  assert.equal(projectConfig.ok, true);
  if (!globalConfig.ok || !projectConfig.ok) assert.fail("expected valid configs");

  assert.deepEqual(mergeMediaGuardConfigs(globalConfig.config, projectConfig.config), {
    version: 1,
    budget: { maxMediaBlocks: 6, maxSerializedMediaBytes: 4_000_000 },
    profiles: {
      "amazon-bedrock": { maxMediaBlocks: 12, maxSerializedMediaBytes: 12_000_000 },
    },
  });
});

test("project provider declarations override a global top-level budget", () => {
  const globalConfig = parseMediaGuardConfig({
    version: 1,
    budget: { maxSerializedMediaBytes: 4_000_000 },
  });
  const projectConfig = parseMediaGuardConfig({
    version: 1,
    profiles: { "amazon-bedrock": { maxSerializedMediaBytes: 12_000_000 } },
  });
  assert.equal(globalConfig.ok, true);
  assert.equal(projectConfig.ok, true);
  if (!globalConfig.ok || !projectConfig.ok) assert.fail("expected valid configs");

  const resolved = resolveLayeredMediaBudget({
    provider: "amazon-bedrock",
    globalConfig: globalConfig.config,
    projectConfig: projectConfig.config,
  });

  assert.equal(resolved.budget.maxSerializedMediaBytes, 12_000_000);
});

test("a provider profile overrides the top-level budget declared in the same file", () => {
  // The README example: a conservative default budget plus a wider
  // amazon-bedrock profile in one global config file. The profile is more
  // specific and must win for the fields it declares.
  const globalConfig = parseMediaGuardConfig({
    version: 1,
    budget: {
      maxMediaBlocks: 8,
      maxSerializedMediaBytes: 2_097_152,
      maxDecodedMediaBytes: 1_572_864,
      maxSerializedBytesPerImage: 524_288,
    },
    profiles: {
      "amazon-bedrock": {
        maxSerializedMediaBytes: 12_582_912,
        maxDecodedMediaBytes: 9_437_184,
      },
    },
  });
  assert.equal(globalConfig.ok, true);
  if (!globalConfig.ok) assert.fail("expected a valid config");

  const bedrock = resolveLayeredMediaBudget({
    provider: "amazon-bedrock",
    globalConfig: globalConfig.config,
  });
  assert.equal(bedrock.budget.maxSerializedMediaBytes, 12_582_912);
  assert.equal(bedrock.budget.maxDecodedMediaBytes, 9_437_184);
  assert.equal(bedrock.budget.maxMediaBlocks, 8);
  assert.equal(bedrock.budget.maxSerializedBytesPerImage, 524_288);

  const other = resolveLayeredMediaBudget({
    provider: "openai",
    globalConfig: globalConfig.config,
  });
  assert.equal(other.budget.maxSerializedMediaBytes, 2_097_152);
});

test("file loading reads trusted project overrides and ignores an invalid layer safely", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-media-guard-"));
  const agentDir = join(root, "agent");
  const cwd = join(root, "project");
  await mkdir(agentDir, { recursive: true });
  await mkdir(join(cwd, ".pi"), { recursive: true });
  await writeFile(
    join(agentDir, "pi-media-guard.json"),
    JSON.stringify({ version: 1, budget: { maxSerializedMediaBytes: 4_000_000 } }),
  );
  await writeFile(join(cwd, ".pi", "pi-media-guard.json"), "{ invalid json");

  const loaded = await loadMediaGuardConfig({
    cwd,
    projectTrusted: true,
    agentDir,
    configDirName: ".pi",
  });

  assert.deepEqual(loaded.config.budget, { maxSerializedMediaBytes: 4_000_000 });
  assert.equal(
    resolveLayeredMediaBudget({
      provider: "amazon-bedrock",
      globalConfig: loaded.globalConfig,
      projectConfig: loaded.projectConfig,
    }).budget.maxSerializedMediaBytes,
    4_000_000,
  );
  assert.equal(loaded.diagnostics.length, 1);
  assert.match(loaded.diagnostics[0] ?? "", /project.*invalid JSON/i);
});
