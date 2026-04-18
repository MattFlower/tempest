// macOS Keychain wrapper for Pi-agent env var secrets.
// Values are stored as generic passwords under a fixed service name; the
// account field holds the env var name (e.g. OPENAI_API_KEY). Only name
// listings are persisted to config.json — values never touch disk here.

const SERVICE = "tempest-pi-env";

const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isValidEnvVarName(name: string): boolean {
  return NAME_PATTERN.test(name);
}

function assertDarwin(): void {
  if (process.platform !== "darwin") {
    throw new Error(
      "Keychain-backed Pi env vars are only supported on macOS",
    );
  }
}

async function runSecurity(
  args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd: ["/usr/bin/security", ...args],
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

export interface KeychainClient {
  setSecret(name: string, value: string): Promise<void>;
  getSecret(name: string): Promise<string | null>;
  deleteSecret(name: string): Promise<void>;
}

export class MacKeychain implements KeychainClient {
  private readonly service: string;

  constructor(service: string = SERVICE) {
    this.service = service;
  }

  async setSecret(name: string, value: string): Promise<void> {
    assertDarwin();
    if (!isValidEnvVarName(name)) {
      throw new Error(`Invalid env var name: ${name}`);
    }
    // `security` requires the password to be passed as an argument; there is
    // no stdin mode for add-generic-password. The value briefly appears in
    // argv/ps, which is a known, narrow-window tradeoff of using this CLI.
    // -U updates if already exists.
    const { exitCode, stderr } = await runSecurity([
      "add-generic-password",
      "-a", name,
      "-s", this.service,
      "-U",
      "-w", value,
    ]);
    if (exitCode !== 0) {
      throw new Error(
        `Failed to save keychain item ${name}: ${stderr.trim() || `exit ${exitCode}`}`,
      );
    }
  }

  async getSecret(name: string): Promise<string | null> {
    assertDarwin();
    if (!isValidEnvVarName(name)) return null;
    const { exitCode, stdout, stderr } = await runSecurity([
      "find-generic-password",
      "-a", name,
      "-s", this.service,
      "-w",
    ]);
    if (exitCode === 0) {
      // `security` appends a trailing newline to the printed password.
      return stdout.endsWith("\n") ? stdout.slice(0, -1) : stdout;
    }
    // Exit 44 = item not found.
    if (exitCode === 44) return null;
    throw new Error(
      `Failed to read keychain item ${name}: ${stderr.trim() || `exit ${exitCode}`}`,
    );
  }

  async deleteSecret(name: string): Promise<void> {
    assertDarwin();
    if (!isValidEnvVarName(name)) return;
    const { exitCode, stderr } = await runSecurity([
      "delete-generic-password",
      "-a", name,
      "-s", this.service,
    ]);
    if (exitCode === 0 || exitCode === 44) return;
    throw new Error(
      `Failed to delete keychain item ${name}: ${stderr.trim() || `exit ${exitCode}`}`,
    );
  }
}
