import { mkdirSync, appendFileSync } from "fs";
import { join } from "path";

export type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";

export class Logger {
  private logFilePath: string;

  constructor() {
    const logsDir = join(import.meta.dir, "..", "logs");
    mkdirSync(logsDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    this.logFilePath = join(logsDir, `run-${timestamp}.log`);
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
}

export const logger = new Logger();
