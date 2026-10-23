# GW2 Bank Sorter

A cleanup planner for Guild Wars 2. It reads your bank, character bags and Material Storage through ArenaNet's official API, then tells you what to deposit, use, sell, salvage or keep, and suggests a tidy layout for your bank tabs.

It only reads your account. You move the items yourself in game, so nothing here automates gameplay.

## Using it

1. Create an API key at [account.arena.net/applications](https://account.arena.net/applications) with these permissions:
   - **account** and **inventories** (required)
   - **characters** to include every character's bags
   - **unlocks** to check which dyes, minis, recipes and skins you already own
   - **progression** to protect items your unfinished collections still need
2. Open `gw2-bank-sorter.html` in a browser, paste the key and choose **Load my bank**.

There's an example bank built in, so you can see how it works without a key.

## What it does

- **Cleanup plan** in in-game order: send to Material Storage, merge split stacks, open or unlock, sell to merchants, salvage, sell on the Trading Post, and destroy items you've already unlocked that can't be sold.
- **Trading Post values** after the 15% fees, and a salvage-or-sell comparison for level 68+ rares based on the current price of Globs of Ectoplasm.
- **Unlock checks**: duplicate dyes, minis, recipes and skins you already own are flagged, and only one copy of something new is marked to use.
- **Collection protection**: items an unfinished collection still needs are kept out of the plan, with a per-collection "Not doing this" override.
- **Always-keep list** for anything you never want suggested again.
- **Saved progress**: ticked items are remembered per account until they're gone from your bank.
- **Suggested bank layout** that groups gear, upgrades, consumables and materials into tabs.

## GW2 Companion (desktop overlay)

The `app/` folder holds a desktop app that floats over the game. It includes this planner along with event timers, an item finder, a gear optimizer and a one-key-per-move bank macro. See [app/README.md](app/README.md).

## Privacy

Your API key is sent only to `api.guildwars2.com`. It's saved in your browser only if you tick "Remember on this computer". Your always-keep list, ticks and ignored collections are stored in your browser's local storage and never leave your machine.

## Not affiliated with ArenaNet

Item names, icons and prices come from the official Guild Wars 2 API. Guild Wars 2 is a trademark of ArenaNet, LLC. This project isn't endorsed by or affiliated with ArenaNet.
