# Assumptions & Scope

* **Framework**: The bot is built using [mineflayer](https://github.com/PrismarineJS/mineflayer) (Node.js) along with community plugins such as `mineflayer-pathfinder` for navigation.
* **Environment**: Vanilla Minecraft Survival mode without cheats or predefined advantages.
* **Architecture**: The bot logic is organized around a milestone routine that can later evolve into behavior trees or finite state machines for dynamic task execution.
* **Focus**: The primary focus is functional autonomy rather than human-like behavior. The bot prioritizes efficiency in progressing through the game's required tech tree.
* **Current Limit**: Milestone 1 automation depends on nearby loaded resources. If logs, stone, iron, fuel, or food animals are outside the configured search radius, move the bot closer or increase `COLLECTION_RADIUS`.
