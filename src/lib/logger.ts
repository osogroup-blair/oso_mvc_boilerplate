// Structured logger. Pretty in dev, JSON in prod.
import pino from "pino";
import { config } from "../config/index.js";
import { EventEmitter } from "events";
import { Writable } from "stream";
import pinoPretty from "pino-pretty";

export class LogRingBuffer {
  private buffer: string[] = [];
  private head = 0;
  private isFull = false;

  constructor(private size: number) {}

  push(line: string) {
    this.buffer[this.head] = line;
    this.head = (this.head + 1) % this.size;
    if (this.head === 0) this.isFull = true;
  }

  getAll(): string[] {
    if (!this.isFull) return this.buffer.slice(0, this.head);
    return [...this.buffer.slice(this.head), ...this.buffer.slice(0, this.head)];
  }
}

export const logRingBuffer = new LogRingBuffer(500);
export const logBus = new EventEmitter();

const bufferStream = new Writable({
  write(chunk, _encoding, callback) {
    const line = chunk.toString();
    logRingBuffer.push(line);
    logBus.emit("line", line);
    callback();
  }
});

const streams = [
  { stream: config.isDev ? pinoPretty({ colorize: true, translateTime: "SYS:HH:MM:ss" }) : process.stdout },
  { stream: bufferStream }
];

export function safeLogError(error: unknown) {
  const value = error as { name?: string; code?: string } | null;
  const names = ["Error", "TypeError", "AppError", "PrismaClientKnownRequestError", "PrismaClientUnknownRequestError", "ZodError"];
  const codes = ["BAD_REQUEST", "FORBIDDEN", "NOT_FOUND", "CONFLICT", "UNAUTHORIZED", "INTERNAL_ERROR", "ETIMEDOUT", "ECONNREFUSED", "ECONNRESET", "EAI_AGAIN"];
  return { type: names.includes(value?.name ?? "") ? value!.name : "Error",
    code: codes.includes(value?.code ?? "") || /^P\d{4}$/.test(value?.code ?? "") ? value!.code : "UNCLASSIFIED_ERROR" };
}

export const logger = pino(
  { level: config.LOG_LEVEL,
    redact: { paths: ["password", "passwordHash", "token", "secret", "apiKey", "authorization", "cookie", "credentials", "credentialCiphertext",
      "*.password", "*.passwordHash", "*.token", "*.secret", "*.apiKey", "*.authorization", "*.cookie", "*.credentials",
      "req.headers.authorization", "req.headers.cookie", "res.headers.set-cookie"], censor: "[REDACTED]" },
    serializers: { err: safeLogError },
  },
  pino.multistream(streams)
);
