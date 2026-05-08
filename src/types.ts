import type { Bot } from "mineflayer";

export interface Phase {
  name: string;
  canSkip(bot: Bot): boolean;
  execute(bot: Bot): Promise<void>;
}
