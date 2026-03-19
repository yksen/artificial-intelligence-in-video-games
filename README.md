# Minecraft Speedrun Bot

This project focuses on developing an autonomous AI agent for Minecraft using the `mineflayer` Python/Node.js framework. The ultimate objective is to program a bot capable of completing the game from scratch, spawning in a new world, gathering resources, surviving, and eventually traveling to the End dimension to defeat the Ender Dragon. The project will explore complex AI decision-making, pathfinding in a 3D voxel environment, resource management, and combat strategies.

## Assumptions & Scope
* **Framework**: The bot will be built using `mineflayer` (Node.js) along with community plugins such as `mineflayer-pathfinder` for navigation.
* **Environment**: Vanilla Minecraft Survival mode without any cheats or predefined advantages.
* **Architecture**: The bot's logic will be driven by advanced AI architectures such as Behavior Trees or Finite State Machines (FSM) to handle dynamic task execution (e.g., switching from mining to combat when attacked).
* **Focus**: The primary focus is functional autonomy rather than human-like behavior. The bot must prioritize efficiency in progressing through the game's required tech tree.

## Milestones

### Milestone 1: Foundation & Resource Independence (30.04.2026)
The bot should be capable of basic survival and fundamental game progression.
* **Capabilities**: Predictable navigation, obstacle avoidance, basic block breaking/placing.
* **Resource Gathering**: The bot can autonomously harvest wood, mine stone and iron, and smelt ores.
* **Crafting & Survival**: The bot can craft essential tools (pickaxes, swords) and armor, manage hunger by consuming food, and survive basic overland hostile mobs.
* **Goal**: The bot is fully prepared to enter the Nether safely (has a diamond pickaxe or knows how to build a portal using buckets).

### Milestone 2: Dimensions & The Dragon (11.06.02026)
The bot should be able to execute the complex sequence of events required to beat the game.
* **The Nether**: Navigate the dangerous Nether terrain, locate a Nether Fortress, farm Blazes for rods, and barter/hunt for Ender Pearls.
* **The Stronghold**: Craft Eyes of Ender, use them to triangulate the Stronghold, navigate the stronghold maze, and activate the End Portal.
* **The End**: Enter the End, destroy the End Crystals (using projectiles or pillaring), and successfully fight and defeat the Ender Dragon.
* **Goal**: Full, unassisted completion of the Minecraft main storyline.
