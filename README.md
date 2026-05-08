# Minecraft Speedrun Bot

An autonomous Minecraft bot built with [Mineflayer](https://github.com/PrismarineJS/mineflayer) that spawns in a fresh world and progresses through resource gathering, crafting, and mining to enter the Nether — targeting Minecraft Java Edition **1.16.1**.

## Running

```bash
bun install
bun start
```

Connects to `localhost:25565` by default. Override with environment variables:

| Variable       | Default     | Description      |
| -------------- | ----------- | ---------------- |
| `BOT_HOST`     | `localhost` | Server address   |
| `BOT_PORT`     | `25565`     | Server port      |
| `BOT_USERNAME` | `Bot`       | In-game username |

The server must be running Minecraft 1.16.1 with `online-mode=false`.

## Architecture

The bot uses a **phase-based sequential execution model** with an interrupt system for survival.

### Phases

Each phase has a `canSkip()` check (inspects current inventory) and an `execute()` method. Phases run in order; completed phases are skipped on restart.

| #   | Phase              | Goal                                  | Key Items                                                               |
| --- | ------------------ | ------------------------------------- | ----------------------------------------------------------------------- |
| 1   | **Gather Wood**    | Punch trees, craft basics             | 20 logs => planks, sticks, crafting table, wooden pickaxe, wooden sword |
| 2   | **Stone Age**      | Mine stone, upgrade tools             | 24 cobblestone => stone pickaxe, stone sword, furnace                   |
| 3   | **Gather Food**    | Hunt animals, cook meat               | 20 cooked food items                                                    |
| 4   | **Iron Age**       | Mine/smelt iron, craft gear           | 12 iron => iron pickaxe, iron sword, bucket, flint & steel              |
| 5   | **Diamond Mining** | Branch mine at Y=11                   | 3 diamonds => diamond pickaxe                                           |
| 6   | **Nether Portal**  | Create obsidian, build & enter portal | 10 obsidian => portal frame => enter Nether                             |

### Death Recovery

On death the bot respawns, re-assesses its inventory via precondition checks, determines the earliest incomplete phase, and resumes from there. A `runId` system prevents race conditions between concurrent executions.

## Logging

Every run writes to `logs/run-{timestamp}.log` and to the console in the format:

```
[2026-05-08T12:15:04.207Z][INFO]: Phase 1 complete: Wood gathered and basic tools crafted
```

## Scope

See [docs/SCOPE.md](docs/SCOPE.md) for milestones. Current target: **Milestone 1** (enter the Nether).
