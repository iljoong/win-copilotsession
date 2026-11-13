// Fake Node sidecar used by BackendSupervisorTests. The mode is passed as the
// first command-line argument and selects one of the behaviors the supervisor
// needs to handle: a well-formed ready handshake, a ready line split across
// several stdout writes, noise before the ready line, an early non-zero exit,
// a hang (never prints anything, never exits), or an environment-variable
// inheritance probe.
import { writeFileSync } from 'node:fs';

const mode = process.argv[2] ?? 'ready';
// 'silent' mode accepts an optional third argument: a path to write this
// process's PID to, synchronously, so a test can confirm later that
// cancelling startup actually killed this process rather than leaving it
// running.
const pidFile = process.argv[3];
const PORT = 5173;
const TOKEN = 'a'.repeat(64);
const readyLine = `${JSON.stringify({ event: 'ready', port: PORT, token: TOKEN })}\n`;

function waitForStdinCloseThenExit() {
  process.stdin.resume();
  process.stdin.on('end', () => process.exit(0));
}

switch (mode) {
  case 'ready': {
    process.stdout.write(readyLine);
    waitForStdinCloseThenExit();
    break;
  }

  case 'chunked': {
    const third = Math.ceil(readyLine.length / 3);
    const chunks = [
      readyLine.slice(0, third),
      readyLine.slice(third, third * 2),
      readyLine.slice(third * 2),
    ];
    let i = 0;
    const sendNext = () => {
      process.stdout.write(chunks[i]);
      i++;
      if (i < chunks.length) {
        setTimeout(sendNext, 10);
      } else {
        waitForStdinCloseThenExit();
      }
    };
    sendNext();
    break;
  }

  case 'noise': {
    process.stdout.write('hello\n');
    // Intentionally never sends a ready line; the supervisor must reject
    // after the first line and not wait for anything further.
    break;
  }

  case 'exit-early': {
    process.stderr.write('ownership marker missing\n');
    process.exit(3);
    break;
  }

  case 'silent': {
    // Never writes anything and never exits on its own. Resuming stdin
    // (without reacting to its data or end event) keeps the event loop,
    // and therefore the process, alive indefinitely even once stdin is
    // closed; only killing the process/job ends it.
    if (pidFile) {
      writeFileSync(pidFile, String(process.pid));
    }
    process.stdin.resume();
    break;
  }

  case 'env': {
    process.stderr.write(`${process.env.NODE_OPTIONS ?? 'unset'}\n`);
    process.stdout.write(readyLine);
    waitForStdinCloseThenExit();
    break;
  }

  default: {
    process.stderr.write(`unknown mode: ${mode}\n`);
    process.exit(1);
  }
}
