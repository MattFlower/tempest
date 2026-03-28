import { onTerminalOutput, onTerminalExit } from "./rpc-client";

type OutputHandler = (data: string) => void;
type ExitHandler = (exitCode: number) => void;

const outputHandlers = new Map<string, OutputHandler>();
const exitHandlers = new Map<string, ExitHandler>();
let initialized = false;

export function initTerminalDispatch() {
  if (initialized) return;
  initialized = true;

  onTerminalOutput((id, data) => {
    outputHandlers.get(id)?.(data);
  });

  onTerminalExit((id, exitCode) => {
    exitHandlers.get(id)?.(exitCode);
  });
}

export function registerTerminal(
  id: string,
  onOutput: OutputHandler,
  onExit: ExitHandler,
) {
  outputHandlers.set(id, onOutput);
  exitHandlers.set(id, onExit);
}

export function unregisterTerminal(id: string) {
  outputHandlers.delete(id);
  exitHandlers.delete(id);
}
