export function formatReadyLine(ready: {
  port: number;
  token: string;
}): string {
  return `{"event":"ready","port":${ready.port},"token":"${ready.token}"}\n`;
}

export function attachStdinLifeline(
  input: NodeJS.ReadableStream,
  stop: () => Promise<void>,
  exit: (code: number) => void,
): void {
  let triggered = false;
  const handler = () => {
    if (triggered) return;
    triggered = true;
    void stop().then(
      () => exit(0),
      (error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error));
        exit(1);
      },
    );
  };
  input.once('end', handler);
  input.once('close', handler);
  // Nothing else reads stdin; put it in flowing mode so 'end' fires on EOF.
  input.resume();
}
