# Minecraft Speedrun Bot

This project focuses on developing an autonomous AI agent for Minecraft using the [mineflayer](https://github.com/PrismarineJS/mineflayer) Python/Node.js framework. The ultimate objective is to program a bot capable of completing the game from scratch, spawning in a new world, gathering resources, surviving, and eventually traveling to the End dimension to defeat the Ender Dragon. The project will explore complex AI decision-making, pathfinding in a 3D voxel environment, resource management, and combat strategies.

See [Assumptions & Scope](docs/assumptions-and-scope.md) for project boundaries and current implementation limits.

## Current Implementation

Milestone 1 is implemented as a runnable Mineflayer bot in `src/bot.js`. On spawn, the bot can:

* use pathfinding with block breaking and scaffold placement enabled;
* harvest nearby logs, craft planks, sticks, a crafting table, and starter tools;
* mine cobblestone, craft stone tools, mine iron ore, place a furnace, and smelt iron;
* craft an iron pickaxe and bucket when enough ingots are available;
* automatically eat available food and hunt nearby passive animals for food;
* attack nearby hostile overland mobs with the best available weapon.

The bot considers the first milestone complete when it has either a diamond pickaxe or a bucket-based Nether portal route available.

## Setup

Requirements:

* Node.js 20 or newer
* A vanilla Minecraft Java server with offline-mode enabled, or a Microsoft-authenticated account for online-mode servers

Install dependencies:

```bash
npm install
```

## Run

Start a local server, then run:

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

## Milestones

### Milestone 1: Foundation & Resource Independence (05.05.2026)
The bot should be capable of basic survival and fundamental game progression.
* **Capabilities**: Predictable navigation, obstacle avoidance, basic block breaking/placing.
* **Resource Gathering**: The bot can autonomously harvest wood, mine stone and iron, and smelt ores.
* **Crafting & Survival**: The bot can craft essential tools (pickaxes, swords) and armor, manage hunger by consuming food, and survive basic overland hostile mobs.
* **Goal**: The bot is fully prepared to enter the Nether safely (has a diamond pickaxe or knows how to build a portal using buckets).

### Milestone 2: Dimensions & The Dragon (16.06.2026)
The bot should be able to execute the complex sequence of events required to beat the game.
* **The Nether**: Navigate the dangerous Nether terrain, locate a Nether Fortress, farm Blazes for rods, and barter/hunt for Ender Pearls.
* **The Stronghold**: Craft Eyes of Ender, use them to triangulate the Stronghold, navigate the stronghold maze, and activate the End Portal.
* **The End**: Enter the End, destroy the End Crystals (using projectiles or pillaring), and successfully fight and defeat the Ender Dragon.
* **Goal**: Full, unassisted completion of the Minecraft main storyline.
