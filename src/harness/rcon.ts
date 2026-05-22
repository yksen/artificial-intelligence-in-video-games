import { Rcon } from "rcon-client";
import { HARNESS } from "./config.js";

export class RconClient {
  private rcon: Rcon | null = null;

  constructor(
    private host: string = HARNESS.botHost,
    private port: number = HARNESS.rconPort,
    private password: string = HARNESS.rconPassword,
  ) {}

  get connected(): boolean {
    return this.rcon !== null;
  }

  async connect(retries = 10, delayMs = 1000): Promise<void> {
    let lastErr: unknown;
    for (let i = 0; i < retries; i++) {
      try {
        this.rcon = await Rcon.connect({
          host: this.host,
          port: this.port,
          password: this.password,
        });
        this.rcon.on("end", () => {
          this.rcon = null;
        });
        return;
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    throw new Error(`RCON connect failed after ${retries} attempts: ${lastErr}`);
  }

  async send(command: string): Promise<string> {
    if (!this.rcon) await this.connect();
    try {
      return await this.rcon!.send(command);
    } catch (err) {
      this.rcon = null;
      await this.connect(3, 500);
      return await this.rcon!.send(command);
    }
  }

  async close(): Promise<void> {
    if (this.rcon) {
      try {
        await this.rcon.end();
      } catch {
      }
      this.rcon = null;
    }
  }
}
