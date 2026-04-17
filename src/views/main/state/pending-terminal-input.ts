// Queue for terminal input that should be written after terminal creation.
// Used by "Ask Claude about selection" — input is queued before the terminal
// exists, then consumed by TerminalPane after the PTY is created.

const pendingInputs = new Map<string, string[]>();

export function queueTerminalInput(terminalId: string, input: string) {
  const existing = pendingInputs.get(terminalId);
  if (existing) {
    existing.push(input);
  } else {
    pendingInputs.set(terminalId, [input]);
  }
}

export function consumePendingInput(terminalId: string): string | undefined {
  const inputs = pendingInputs.get(terminalId);
  if (inputs === undefined) return undefined;
  pendingInputs.delete(terminalId);
  return inputs.join("");
}
