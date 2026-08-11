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

export const logger = pino(
  { level: config.LOG_LEVEL },
  pino.multistream(streams)
);
