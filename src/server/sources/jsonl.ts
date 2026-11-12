const limit = 8 * 1024 * 1024;
const decoder = new TextDecoder('utf-8', { fatal: true });

export function readJsonlChunk(input: {
  pending: Buffer;
  chunk: Buffer;
  discarding?: boolean;
}) {
  let pending: Buffer = input.pending;
  let discarding = input.discarding ?? false;
  const lines: string[] = [];
  const warnings: string[] = [];
  let position = 0;
  while (position < input.chunk.length) {
    const newline = input.chunk.indexOf(10, position);
    const end = newline < 0 ? input.chunk.length : newline;
    const segment = input.chunk.subarray(position, end);
    if (!discarding && pending.length + segment.length > limit) {
      discarding = true;
      pending = Buffer.alloc(0);
      warnings.push(
        'Record exceeds the 8MiB size limit; skipped until its newline.',
      );
    }
    if (!discarding) {
      pending = Buffer.concat([pending, segment]);
      if (newline >= 0) {
        try {
          lines.push(decoder.decode(pending));
        } catch {
          warnings.push(
            'Invalid UTF-8 record skipped; original text cannot be preserved.',
          );
        }
        pending = Buffer.alloc(0);
      }
    }
    if (newline >= 0) discarding = false;
    position = end + 1;
  }
  return { lines, pending, discarding, warnings };
}
