const PAIRING_COMMAND = /^(p|pair)$/i;

export function isPairingCommand(line: string): boolean {
  return PAIRING_COMMAND.test(line.trim());
}

/**
 * Watch the foreground terminal for `p` or `pair` lines. The server keeps
 * running; each command issues a fresh pairing code. Non-TTY inputs are left
 * alone so services and piped output do not get a hidden input consumer.
 */
export function watchPairingCommands(
  input: NodeJS.ReadStream,
  onPair: () => void,
): () => void {
  if (!input.isTTY) return () => {};

  input.setEncoding("utf8");
  let buffer = "";

  const onData = (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (isPairingCommand(line)) onPair();
      newline = buffer.indexOf("\n");
    }
  };

  input.on("data", onData);
  input.resume();

  return () => {
    input.off("data", onData);
    input.pause();
  };
}
