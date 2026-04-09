import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";

const ADDITIONAL_SEARCH_PATHS = [
  `${homedir()}/.local/bin`,
  `${homedir()}/.cargo/bin`,
  "/opt/homebrew/bin",
  "/usr/local/bin",
];

function captureLoginShellPATH(): string {
  let shellPATH = "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
  try {
    const proc = Bun.spawnSync(["/bin/zsh", "-l", "-c", "echo $PATH"], {
      stderr: "pipe",
    });
    const output = new TextDecoder().decode(proc.stdout).trim();
    if (output) shellPATH = output;
  } catch {
    // Use default
  }

  const existing = new Set(shellPATH.split(":"));
  const missing = ADDITIONAL_SEARCH_PATHS.filter((p) => !existing.has(p));
  if (missing.length > 0) {
    shellPATH += ":" + missing.join(":");
  }
  return shellPATH;
}

// Cache the PATH once at module load time
const cachedPATH = captureLoginShellPATH();

/** The full login-shell PATH, including additional search paths. */
export function getResolvedPATH(): string {
  return cachedPATH;
}

export class PathResolver {
  resolve(binary: string, configuredPath?: string): string {
    if (configuredPath) {
      try {
        accessSync(configuredPath, constants.X_OK);
        return configuredPath;
      } catch {
        throw new Error(
          `Configured path '${configuredPath}' is not executable`,
        );
      }
    }

    for (const dir of cachedPATH.split(":")) {
      const candidate = `${dir}/${binary}`;
      try {
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        continue;
      }
    }

    throw new Error(`'${binary}' not found in PATH`);
  }
}
