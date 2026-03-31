// Queue for terminal input that should be written after terminal creation.
// Used by "Ask Claude about selection" — input is queued before the terminal
// exists, then consumed by TerminalPane after the PTY is created.

const pendingInputs = new Map<string, string>();

export function queueTerminalInput(terminalId: string, input: string) {
  pendingInputs.set(terminalId, input);
}

export function consumePendingInput(terminalId: string): string | undefined {
  const input = pendingInputs.get(terminalId);
  if (input !== undefined) pendingInputs.delete(terminalId);
  return input;
}
