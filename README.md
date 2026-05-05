# Minecraft Speedrun Bot

This project focuses on developing an autonomous AI agent for Minecraft using the [mineflayer](https://github.com/PrismarineJS/mineflayer) Python/Node.js framework. The ultimate objective is to program a bot capable of completing the game from scratch, spawning in a new world, gathering resources, surviving, and eventually traveling to the End dimension to defeat the Ender Dragon. The project will explore complex AI decision-making, pathfinding in a 3D voxel environment, resource management, and combat strategies.

See [Scope](docs/SCOPE.md) for project boundaries and current implementation limits.

## Current Implementation

Milestone 1 is implemented as a **reactive Hierarchical Task Network (HTN)** split across three files:

* `src/bot.js` — thin entry point: bot creation, plugin loading, viewer startup, passive combat handler, chat commands.
* `src/htn.js` — reusable HTN decomposer that turns compound tasks into primitive actions.
* `src/speedrun.js` — Milestone 1 HTN domain, bounded resource collection, crafting helpers, smelting, and inventory utilities.

### Architecture

The planner starts from a `complete_game` compound task and currently decomposes it into the Milestone 1 `enter_nether` task. Every short tick it rebuilds the HTN plan from current inventory/world state and runs only the next primitive action, keeping the old fail-fast behavior while making the high-level task tree ready for Fortress, Stronghold, and End methods later. Failed or unreachable block targets are skipped for a short TTL, so the bot quickly tries a different log, stone, ore, or gravel block instead of spending many seconds on the same bad path.

Current HTN decomposition: complete game → enter Nether → prepare bucket route → craft flint and steel → collect portal supports → cast lava-water portal → light portal → enter portal → done.

| Layer | Mechanism |
|---|---|
| Goal progression | HTN methods that re-evaluate inventory every tick |
| Error recovery | Bounded actions fail fast, cancel pathfinding, and immediately re-plan |
| Unreachable blocks | Per-block skip TTL instead of slow multi-pass retries |
| Dropped items | Fast pickup sweep for matching drops before and after mining |
| Crafting stations | Cave-safe table/furnace placement against nearby floors, walls, or ceilings |
| Logging | Timestamped planner messages in Node output |
| Combat | `physicsTick` listener triggers `mineflayer-pvp`; planner briefly yields while fighting |
| Eating | Delegated to `mineflayer-auto-eat` |
| Navigation | `mineflayer-pathfinder` (A*) with short search budgets |

The bot considers the current goal complete once it changes dimension into the Nether. The implemented route uses one bucket, nearby source water, at least ten nearby lava source blocks, support blocks for casting, and flint and steel for ignition.

## Setup

Requirements:

* Node.js 20 or newer
* A vanilla Minecraft Java server with offline-mode enabled, or a Microsoft-authenticated account for online-mode servers

Install dependencies:

```bash
npm install
```

## Run

### Local server

Create a directory for the server, download the latest vanilla server JAR, and accept the EULA:

```bash
mkdir -p ~/minecraft-server && cd ~/minecraft-server
curl -Lo server.jar "$(curl -s https://launchermeta.mojang.com/mc/game/version_manifest.json \
  | python3 -c "import sys,json; d=json.load(sys.stdin); latest=d['latest']['release']; \
    v=next(x for x in d['versions'] if x['id']==latest); print(v['url'])" \
  | xargs curl -s \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['downloads']['server']['url'])")"
echo "eula=true" > eula.txt
```

Enable offline mode so the bot can connect without a Microsoft account, then start the server:

```bash
java -Xmx2G -Xms1G -jar server.jar nogui --world world &
# Wait for "Done" in output, then:
echo "online-mode=false" >> server.properties
# Restart the server once to apply the setting:
kill %1 && java -Xmx2G -Xms1G -jar server.jar nogui
```

The server listens on port 25565 by default. Leave it running in this terminal (or use `tmux`/`screen`), then open a new terminal to run the bot.

### Bot

From the project directory, run:

```bash
npm start
```

By default, the bot connects to `localhost:25565` as `MinecraftBot` using offline auth. Configure it with environment variables:

```bash
MINECRAFT_HOST=localhost \
MINECRAFT_PORT=25565 \
MINECRAFT_USERNAME=MinecraftBot \
MINECRAFT_AUTH=offline \
npm start
```

Useful optional variables:

* `MINECRAFT_VERSION`: pins the Minecraft protocol version when auto-detection is not enough.
* `BOT_AUTOSTART=false`: connects without starting the milestone routine.
* `COLLECTION_RADIUS=64`: changes the block and mob search radius.
* `TARGET_LOGS`, `TARGET_COBBLESTONE`, `TARGET_RAW_IRON`, `TARGET_PORTAL_SUPPORT_BLOCKS`, `TARGET_FOOD`: tune milestone resource targets. `TARGET_LOGS` defaults to 3 starter logs and `TARGET_PORTAL_SUPPORT_BLOCKS` defaults to 28 casting support blocks.
* `PATHFINDER_TIMEOUT_MS`, `COLLECT_MOVE_TIMEOUT_MS`, `COLLECT_DIG_TIMEOUT_MS`, `COLLECT_BATCH_SIZE`, `CRAFTING_STEP_TIMEOUT_MS`, `DROP_PICKUP_RADIUS`, `DROP_PICKUP_TIMEOUT_MS`, `LIQUID_SEARCH_TIMEOUT_MS`, `LIQUID_SEARCH_STEP_BLOCKS`, `REJECTED_LAVA_TTL_MS`, `PORTAL_LAVA_RADIUS`, `PORTAL_BUILD_TIMEOUT_MS`, `PORTAL_LIGHT_TIMEOUT_MS`, `PORTAL_ENTER_TIMEOUT_MS`: tune how aggressively the planner skips slow targets, searches for water/lava, and runs portal casting/entry.

In-game chat commands:

* `start`: begin Milestone 1 if auto-start is disabled or a previous run stopped.
* `stop`: cancel collection, combat, and pathfinding tasks.
* `status`: print the current milestone inventory summary.
* `come`: pathfind to the player who sent the command.

Validate the source files without connecting to Minecraft:

```bash
npm run check
```
