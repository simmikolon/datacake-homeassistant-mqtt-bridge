import pino, { Logger } from "pino";
import { Writable } from "stream";

export type LogEntry = {
  time: number;
  level: string;
  msg: string;
  module?: string;
  err?: string;
  raw: string;
};

const LEVEL_LOOKUP: Record<number, string> = {
  10: "trace",
  20: "debug",
  30: "info",
  40: "warn",
  50: "error",
  60: "fatal"
};

const BUFFER_SIZE = (() => {
  const raw = process.env.LOG_BUFFER_SIZE;
  if (!raw) return 500;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 500;
})();

const buffer: LogEntry[] = [];

function pushToBuffer(entry: LogEntry) {
  buffer.push(entry);
  while (buffer.length > BUFFER_SIZE) buffer.shift();
}

// Intercepts every structured log line and pushes a normalized entry to an
// in-memory ring buffer so the /logs page can render recent activity without
// touching the filesystem.
const bufferStream = new Writable({
  write(chunk, _enc, cb) {
    const text = chunk.toString("utf8").trim();
    if (!text) return cb();
    for (const line of text.split("\n")) {
      if (!line) continue;
      try {
        const obj = JSON.parse(line);
        const entry: LogEntry = {
          time: typeof obj.time === "number" ? obj.time : Date.now(),
          level: LEVEL_LOOKUP[obj.level] ?? String(obj.level ?? "info"),
          msg: String(obj.msg ?? ""),
          module: typeof obj.module === "string" ? obj.module : undefined,
          err: obj.err?.message ?? obj.err,
          raw: line
        };
        pushToBuffer(entry);
      } catch {
        pushToBuffer({
          time: Date.now(),
          level: "info",
          msg: line,
          raw: line
        });
      }
    }
    cb();
  }
});

const prettyStream = {
  level: process.env.LOG_LEVEL ?? "info",
  stream: pino.transport({
    target: "pino-pretty",
    options: {
      colorize: true,
      translateTime: "SYS:HH:MM:ss.l",
      ignore: "pid,hostname"
    }
  })
};

const bufferStreamWrapped = {
  level: "trace",
  stream: bufferStream
};

export const logger: Logger = pino(
  {
    level: process.env.LOG_LEVEL ?? "info",
    base: undefined
  },
  pino.multistream([prettyStream, bufferStreamWrapped] as any, { dedupe: false })
);

export function childLogger(module: string): Logger {
  return logger.child({ module });
}

export function getRecentLogs(limit = BUFFER_SIZE): LogEntry[] {
  if (limit >= buffer.length) return [...buffer];
  return buffer.slice(buffer.length - limit);
}

export function logBufferSize(): number {
  return buffer.length;
}
