import { mkdirSync, appendFileSync } from "fs";
import { join } from "path";

export type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";

export type LogSink = (level: LogLevel, message: string) => void;

export interface LogWriter {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}

export class Logger implements LogWriter {
  private logFilePath: string;
  private sinks: LogSink[] = [];

  constructor() {
    const logsDir = join(import.meta.dir, "..", "logs");
    mkdirSync(logsDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    this.logFilePath = join(logsDir, `run-${timestamp}.log`);
  }

  addSink(sink: LogSink): () => void {
    this.sinks.push(sink);
    return () => {
      const i = this.sinks.indexOf(sink);
      if (i >= 0) this.sinks.splice(i, 1);
    };
  }

  private format(level: LogLevel, message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}][${level}]: ${message}`;
  }

  private write(level: LogLevel, message: string): void {
    const formatted = this.format(level, message);

    switch (level) {
      case "ERROR":
        console.error(formatted);
        break;
      case "WARN":
        console.warn(formatted);
        break;
      default:
        console.log(formatted);
        break;
    }

    try {
      appendFileSync(this.logFilePath, formatted + "\n");
    } catch {
    }

    for (const sink of this.sinks) {
      try {
        sink(level, message);
      } catch {
      }
    }
  }

  info(message: string): void {
    this.write("INFO", message);
  }

  warn(message: string): void {
    this.write("WARN", message);
  }

  error(message: string): void {
    this.write("ERROR", message);
  }

  debug(message: string): void {
    this.write("DEBUG", message);
  }

  scoped(prefix: string): LogWriter {
    const tag = `[${prefix}] `;
    return {
      info: (m) => this.info(tag + m),
      warn: (m) => this.warn(tag + m),
      error: (m) => this.error(tag + m),
      debug: (m) => this.debug(tag + m),
    };
  }
}

export const logger = new Logger();
