export type RunTabSource =
  | { kind: "custom"; scriptId: string; paramValues?: Record<string, string> }
  | { kind: "package"; scriptName: string }
  | { kind: "maven"; scriptName: string };

export type RunTabStatus = "running" | "exited";

export interface RunTab {
  id: string;
  label: string;
  source: RunTabSource;
  command: string[];
  cwd: string;
  env: Record<string, string>;
  terminalId: string;
  status: RunTabStatus;
  exitCode?: number;
  startedAt: number;
}
