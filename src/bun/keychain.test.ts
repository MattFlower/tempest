import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { MacKeychain, isValidEnvVarName } from "./keychain";

const runningOnDarwin = process.platform === "darwin";
const describeDarwin = runningOnDarwin ? describe : describe.skip;

// Use a throwaway service name so real Tempest entries can't be clobbered.
const TEST_SERVICE = `tempest-pi-env-test-${Date.now()}`;
const kc = new MacKeychain(TEST_SERVICE);

const TEST_NAMES = ["TEMPEST_TEST_VAR_1", "TEMPEST_TEST_VAR_2"];

async function cleanup(): Promise<void> {
  if (!runningOnDarwin) return;
  for (const name of TEST_NAMES) {
    try {
      await kc.deleteSecret(name);
    } catch {
      // ignore
    }
  }
}

beforeAll(cleanup);
afterAll(cleanup);

describe("isValidEnvVarName", () => {
  it("accepts conventional env var names", () => {
    expect(isValidEnvVarName("OPENAI_API_KEY")).toBe(true);
    expect(isValidEnvVarName("_PRIVATE")).toBe(true);
    expect(isValidEnvVarName("A")).toBe(true);
  });

  it("rejects names that are empty or start with a digit", () => {
    expect(isValidEnvVarName("")).toBe(false);
    expect(isValidEnvVarName("1STARTS_WITH_DIGIT")).toBe(false);
  });

  it("rejects names with illegal characters", () => {
    expect(isValidEnvVarName("BAD NAME")).toBe(false);
    expect(isValidEnvVarName("BAD-NAME")).toBe(false);
    expect(isValidEnvVarName("BAD=NAME")).toBe(false);
    expect(isValidEnvVarName("BAD.NAME")).toBe(false);
  });
});

describeDarwin("MacKeychain", () => {
  it("round-trips a secret through set/get/delete", async () => {
    const name = TEST_NAMES[0]!;
    const value = "super-secret-value-!@#$%^&*()";

    await kc.setSecret(name, value);
    expect(await kc.getSecret(name)).toBe(value);

    await kc.deleteSecret(name);
    expect(await kc.getSecret(name)).toBeNull();
  });

  it("overwrites an existing secret on repeated set", async () => {
    const name = TEST_NAMES[1]!;
    await kc.setSecret(name, "first");
    await kc.setSecret(name, "second");
    expect(await kc.getSecret(name)).toBe("second");
    await kc.deleteSecret(name);
  });

  it("returns null for missing secrets and is idempotent on delete", async () => {
    expect(await kc.getSecret("TEMPEST_NEVER_CREATED")).toBeNull();
    await kc.deleteSecret("TEMPEST_NEVER_CREATED");
  });

  it("rejects invalid env var names on set", async () => {
    await expect(kc.setSecret("bad name", "x")).rejects.toThrow();
  });
});
