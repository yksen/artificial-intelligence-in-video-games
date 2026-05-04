# Minecraft Speedrun Bot

This project focuses on developing an autonomous AI agent for Minecraft using the [mineflayer](https://github.com/PrismarineJS/mineflayer) Python/Node.js framework. The ultimate objective is to program a bot capable of completing the game from scratch, spawning in a new world, gathering resources, surviving, and eventually traveling to the End dimension to defeat the Ender Dragon. The project will explore complex AI decision-making, pathfinding in a 3D voxel environment, resource management, and combat strategies.

See [Scope](docs/SCOPE.md) for project boundaries and current implementation limits.

## Current Implementation

Milestone 1 is implemented as a **Finite State Machine** split across two files:

* `src/bot.js` — thin entry point: bot creation, plugin loading, viewer startup, passive combat handler, chat commands.
* `src/fsm.js` — `MilestoneOneFSM` class containing all states, collection logic, crafting helpers, and inventory utilities.

### Architecture

The FSM uses an **IDLE hub** pattern: after every action — whether it completes normally or throws — the machine returns to `IDLE`, which inspects the current inventory and derives the next state to enter. This means the bot self-heals automatically: if it dies, loses items, or gets interrupted by combat, the next `IDLE` pass simply re-evaluates what is still missing and picks up from there.

States: `IDLE` → `COLLECT_LOGS` → `CRAFT_BASICS` → `COLLECT_COBBLESTONE` → `CRAFT_STONE_TOOLS` → `COLLECT_IRON` → `SMELT_IRON` → `CRAFT_IRON_GEAR` → `DONE`

| Layer | Mechanism |
|---|---|
| Goal progression | FSM with IDLE hub re-evaluating inventory on every cycle |
| Error recovery | All state handlers catch exceptions and return to IDLE |
| Unreachable blocks | Per-block skip set; cleared after 3 empty passes |
| Combat | `physicsTick` listener triggers `mineflayer-pvp`; collection waits for combat to end before resuming |
| Eating | Delegated to `mineflayer-auto-eat` |
| Navigation | `mineflayer-pathfinder` (A*) |

The bot considers Milestone 1 complete when it has either a diamond pickaxe or a bucket (bucket-based Nether portal route).

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

By default, the bot connects to `localhost:25565` as `MilestoneBot` using offline auth. Configure it with environment variables:

```bash
MINECRAFT_HOST=localhost \
MINECRAFT_PORT=25565 \
MINECRAFT_USERNAME=MilestoneBot \
MINECRAFT_AUTH=offline \
npm start
```

Useful optional variables:

* `MINECRAFT_VERSION`: pins the Minecraft protocol version when auto-detection is not enough.
* `MILESTONE_AUTOSTART=false`: connects without starting the milestone routine.
* `COLLECTION_RADIUS=64`: changes the block and mob search radius.
* `TARGET_LOGS`, `TARGET_COBBLESTONE`, `TARGET_RAW_IRON`, `TARGET_FOOD`: tune milestone resource targets.

In-game chat commands:

* `start`: begin Milestone 1 if auto-start is disabled or a previous run stopped.
* `stop`: cancel collection, combat, and pathfinding tasks.
* `status`: print the current milestone inventory summary.
* `come`: pathfind to the player who sent the command.

Validate the source files without connecting to Minecraft:

```bash
npm run check
```
