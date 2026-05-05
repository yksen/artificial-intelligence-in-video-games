# Assumptions & Scope

* **Framework**: The bot is built using [mineflayer](https://github.com/PrismarineJS/mineflayer) (Node.js) along with community plugins such as `mineflayer-pathfinder` for navigation.
* **Environment**: Vanilla Minecraft Survival mode without cheats or predefined advantages.
* **Architecture**: The bot logic is organized around a reactive Hierarchical Task Network (HTN) planner with bounded actions and frequent re-planning.
* **Focus**: The primary focus is functional autonomy rather than human-like behavior. The bot prioritizes efficiency in progressing through the game's required tech tree.
* **Current Limit**: Milestone 1 automation depends on nearby loaded resources. If logs, stone, iron, fuel, or food animals are outside the configured search radius, move the bot closer or increase `COLLECTION_RADIUS`.

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
