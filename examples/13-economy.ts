/**
 * 13-economy.ts
 *
 * Trade, inventory, and quests with @alife-sdk/economy.
 * Runs in Node.js with:
 *   npx tsx --tsconfig examples/tsconfig.json examples/13-economy.ts
 *
 * What we build here:
 *   - EconomyPlugin wired to a kernel
 *   - Player inventory with item:added / item:removed events
 *   - A trader with two item lines and a configurable restock cycle
 *   - executeBuy — neutral relation, ally discount, failure cases
 *   - executeSell — flat sell multiplier
 *   - executeGift — item transfer without money (quest reward from NPC)
 *   - QuestEngine — register → start → progress → complete lifecycle
 *   - Quest chains: q_first_steps unlocks q_clear_bandits
 *   - Quest failure
 *
 * Pricing formula (default config):
 *   buy  = round(basePrice × 1.3 × allyModifier)   allyModifier=0.8 when relation>50
 *   sell = round(basePrice × 0.5)
 *   Trading blocked when factionRelation < -30
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

// EconomyPlugin — the kernel plugin that owns inventory, traders, and quests.
import { EconomyPlugin } from '@alife-sdk/economy/plugin';

// executeBuy / executeSell — transactional trade functions.
//   On SUCCESS they mutate playerInventory and traders directly (deduct stock,
//   transfer money). On failure nothing changes — check receipt.result first.
// TradeResult — typed const object; compare with receipt.result in your game code.
import { executeBuy, executeSell, TradeResult } from '@alife-sdk/economy/trade';

// executeGift — item transfer without money (gift, quest reward, NPC handoff).
// GiftResult — typed const object; compare with outcome.result.
import { executeGift, GiftResult } from '@alife-sdk/economy/trade';

// Inventory — standalone container; used here to model an NPC's reward inventory.
import { Inventory } from '@alife-sdk/economy/inventory';

// ALifeKernel — the host kernel.
// SeededRandom — deterministic PRNG; fixed seed makes every run identical.
import { ALifeKernel, SeededRandom } from '@alife-sdk/core';

// ---------------------------------------------------------------------------
// Step 1: Build the kernel and install EconomyPlugin
// ---------------------------------------------------------------------------

const random = new SeededRandom(42); // fixed seed for reproducible output

const econ = new EconomyPlugin(random, {
  trade: {
    // Use a short restock interval so Phase 6 (restock demo) works without
    // simulating 5 real minutes.
    restockIntervalMs: 10_000,   // 10 s — much shorter than the default 5 min
    bonusItemChance: 0,          // disable bonus-item lottery for predictable output
  },
});

const kernel = new ALifeKernel();
kernel.use(econ);
kernel.init();
kernel.start();

// ---------------------------------------------------------------------------
// Step 2: Register the trader and initial stock
//
// register(traderId, factionId, initialMoney)
// addStock(traderId, itemId, quantity) — also records restockBaseline
// ---------------------------------------------------------------------------

econ.traders.register('sid', 'loner', 8_000);       // Sid the barman — 8 000 currency
econ.traders.addStock('sid', 'medkit',     10);      // 10 medkits at baseline
econ.traders.addStock('sid', 'ammo_9x19',  60);      // 60 rounds at baseline

console.log(`Traders registered: ${econ.traders.size}`);
const sid = econ.traders.getTrader('sid')!;
console.log(`  sid  faction=${sid.factionId}  money=${sid.money}`);
console.log(`  stock: medkit×${sid.stock.get('medkit')?.quantity}  ammo_9x19×${sid.stock.get('ammo_9x19')?.quantity}`);
console.log('');

// ---------------------------------------------------------------------------
// PHASE 1 — Player inventory basics
//
// Inventory.add(itemId, quantity, maxStack?) → returns overflow count (0 = ok).
// Inventory.remove(itemId, quantity)         → returns boolean.
// Inventory events:  'item:added' | 'item:removed' | 'inventory:cleared'
// ---------------------------------------------------------------------------

console.log('=== PHASE 1: Player inventory ===');
console.log('');

econ.playerInventory.on('item:added',   ({ itemId, quantity, newTotal }) =>
  console.log(`  [INV+] ${itemId} +${quantity} → total=${newTotal}`));
econ.playerInventory.on('item:removed', ({ itemId, quantity, newTotal }) =>
  console.log(`  [INV-] ${itemId} -${quantity} → total=${newTotal}`));

// Give the player a starting kit.
econ.playerInventory.add('bandage',    3);
econ.playerInventory.add('bread',      2);
econ.playerInventory.add('pistol_pm',  1, 1);  // maxStack=1 — only one pistol per slot

console.log('');
console.log(`  Slots used: ${econ.playerInventory.usedSlots} / ${econ.playerInventory.capacity}`);
console.log(`  Has bandage: ${econ.playerInventory.has('bandage', 1)}  qty=${econ.playerInventory.getQuantity('bandage')}`);
console.log('');

// Use a bandage (remove 1).
econ.playerInventory.remove('bandage', 1);
console.log('');

// ---------------------------------------------------------------------------
// PHASE 2 — Buy from trader
//
// executeBuy(ctx) validates the trade and, on TradeResult.SUCCESS, immediately
// mutates playerInventory (adds item) and traders (deducts stock, adds money).
// On any failure code nothing is changed — no need to roll back.
//
// receipt.result is one of the TradeResult constants:
//   TradeResult.SUCCESS | TRADER_NOT_FOUND | RELATION_TOO_LOW |
//   INSUFFICIENT_STOCK | INSUFFICIENT_MONEY | INVENTORY_FULL
//
// Default pricing (neutral faction, relation=0):
//   medkit basePrice=400  →  buy = round(400 × 1.3) = 520
// Ally pricing (relation=60 > allyThreshold=50):
//   medkit basePrice=400  →  buy = round(400 × 1.3 × 0.8) = 416
// ---------------------------------------------------------------------------

console.log('=== PHASE 2: Buy from trader ===');
console.log('');

// Context factory — shared by buy and sell (same fields, same trader).
// In a real game this is assembled per trade interaction (UI opens, player
// picks item, you call executeBuy/executeSell once, read receipt.result).
let playerMoney = 2_000;

function tradeCtx(itemId: string, basePrice: number, relation = 0) {
  return {
    playerInventory: econ.playerInventory,
    playerMoney,
    traders:         econ.traders,
    traderId:        'sid',
    itemId,
    basePrice,
    factionRelation: relation,
    config:          econ.config.trade,
  };
}

// — Neutral buy (relation 0)
const buy1 = executeBuy(tradeCtx('medkit', 400));
if (buy1.receipt.result === TradeResult.SUCCESS) {
  playerMoney = buy1.newPlayerMoney;
}
console.log(`  buy medkit (relation=0) → result=${buy1.receipt.result}  price=${buy1.receipt.totalPrice}`);
console.log(`  player money: ${playerMoney}  medkits in inventory: ${econ.playerInventory.getQuantity('medkit')}`);
console.log('');

// — Ally buy (relation=60 > allyThreshold=50 → discount 0.8)
const buy2 = executeBuy(tradeCtx('medkit', 400, 60));
if (buy2.receipt.result === TradeResult.SUCCESS) {
  playerMoney = buy2.newPlayerMoney;
}
console.log(`  buy medkit (relation=60, ally) → result=${buy2.receipt.result}  price=${buy2.receipt.totalPrice}  (400×1.3×0.8=${Math.round(400*1.3*0.8)})`);
console.log(`  player money: ${playerMoney}  medkits in inventory: ${econ.playerInventory.getQuantity('medkit')}`);
console.log('');

// — Failure: not enough money (price=520, player has only 100).
//   receipt.result !== TradeResult.SUCCESS → newPlayerMoney is unchanged.
const buy3 = executeBuy({ ...tradeCtx('medkit', 400), playerMoney: 100 });
console.log(`  buy medkit (only 100 currency) → result=${buy3.receipt.result}`);

// — Failure: hostile faction (relation=-50 < minRelationToTrade=-30)
const buy4 = executeBuy(tradeCtx('medkit', 400, -50));
console.log(`  buy medkit (relation=-50, hostile) → result=${buy4.receipt.result}`);

// — Failure: no stock for unknown item
const buy5 = executeBuy(tradeCtx('shotgun_toz', 800));
console.log(`  buy shotgun_toz (not stocked) → result=${buy5.receipt.result}`);
console.log('');

// ---------------------------------------------------------------------------
// PHASE 3 — Sell to trader
//
// Sell formula: sell = round(basePrice × sellPriceMultiplier) = round(basePrice × 0.5)
// Artefact "jellyfish" basePrice=1500 → sell = round(1500 × 0.5) = 750
// No ally bonus on sell — flat rate regardless of relation.
// ---------------------------------------------------------------------------

console.log('=== PHASE 3: Sell to trader ===');
console.log('');

// Give the player a rare artefact to sell.
econ.playerInventory.add('jellyfish', 1);
console.log('');

const sell1 = executeSell(tradeCtx('jellyfish', 1_500));
if (sell1.receipt.result === TradeResult.SUCCESS) {
  playerMoney = sell1.newPlayerMoney;
}
console.log(`  sell jellyfish (basePrice=1500) → result=${sell1.receipt.result}  price=${sell1.receipt.totalPrice}  (1500×0.5=${Math.round(1500*0.5)})`);
console.log(`  player money: ${playerMoney}  jellyfish in inventory: ${econ.playerInventory.getQuantity('jellyfish')}`);
console.log('');

// — Failure: selling an item not in inventory
const sell2 = executeSell(tradeCtx('sniper_rifle', 2_000));
console.log(`  sell sniper_rifle (not in inventory) → result=${sell2.receipt.result}`);
console.log('');

// ---------------------------------------------------------------------------
// PHASE 4 — Gift (item transfer without money)
//
// executeGift({ from, to, itemId, quantity, canGive? })
// Used for quest rewards, NPC handoffs, pickups, chest loot, etc.
// canGive defaults to true when omitted.
//
// The function is agnostic to faction, relation, or money — the caller
// evaluates the condition and passes canGive as a plain boolean.
// ---------------------------------------------------------------------------

console.log('=== PHASE 4: Gift (quest reward from NPC) ===');
console.log('');

// Create a small NPC inventory for the quest giver.
const npcInventory = new Inventory({ maxSlots: 5, defaultMaxStack: 1 });
npcInventory.add('medkit', 1);
npcInventory.add('calibration_kit', 1);

console.log(`  NPC has: medkit×${npcInventory.getQuantity('medkit')}  calibration_kit×${npcInventory.getQuantity('calibration_kit')}`);

// Successful gift (quest is complete → canGive=true).
const gift1 = executeGift({
  from:     npcInventory,
  to:       econ.playerInventory,
  itemId:   'calibration_kit',
  quantity: 1,
  canGive:  true,
});
// GiftResult.SUCCESS means all items transferred; check transferred count for PARTIAL.
if (gift1.result === GiftResult.SUCCESS) {
  console.log(`  gift calibration_kit (canGive=true) → result=${gift1.result}  transferred=${gift1.transferred}`);
}
console.log(`  player calibration_kit: ${econ.playerInventory.getQuantity('calibration_kit')}`);
console.log('');

// Declined gift (quest not yet completed → canGive=false).
const gift2 = executeGift({
  from:    npcInventory,
  to:      econ.playerInventory,
  itemId:  'medkit',
  quantity: 1,
  canGive: false,
});
// GiftResult.DECLINED — source inventory is untouched.
console.log(`  gift medkit (canGive=false) → result=${gift2.result}`);
console.log(`  NPC still has medkit: ${npcInventory.has('medkit')}`);
console.log('');

// ---------------------------------------------------------------------------
// PHASE 5 — Quest lifecycle
//
// QuestEngine API:
//   registerQuest(def)                           — must be called before start
//   isQuestStartable(questId)                    → boolean (availability check)
//   startQuest(questId)                          → boolean (AVAILABLE→ACTIVE)
//   completeObjective(questId, objectiveId)      → boolean (marks objective done)
//   updateObjectiveProgress(questId, objId, n)   → boolean (kill-count counter)
//   failQuest(questId)                           → boolean (ACTIVE→FAILED)
//   getQuestState(questId)                       → IQuestState | undefined
//
// Quest events (via quests.on()):
//   'quest:started', 'quest:completed', 'quest:failed'
//   'objective:progress', 'objective:completed'
//
// Quest chains: set requires: ['other_quest_id'] on a definition.
// The engine only allows startQuest() when all required quests are COMPLETED.
// ---------------------------------------------------------------------------

console.log('=== PHASE 5: Quest lifecycle ===');
console.log('');

// Subscribe to all quest events for visibility.
econ.quests.on('quest:started',        ({ questId }) =>
  console.log(`  [QUEST]  started   "${questId}"`));
econ.quests.on('quest:completed',      ({ questId }) =>
  console.log(`  [QUEST]  completed "${questId}"`));
econ.quests.on('quest:failed',         ({ questId }) =>
  console.log(`  [QUEST]  failed    "${questId}"`));
econ.quests.on('objective:progress',   ({ questId, objectiveId, current, total }) =>
  console.log(`  [OBJ]    progress  "${questId}"/"${objectiveId}" ${current}/${total}`));
econ.quests.on('objective:completed',  ({ questId, objectiveId }) =>
  console.log(`  [OBJ]    completed "${questId}"/"${objectiveId}"`));

// Register two quests that form a chain.
// q_first_steps: reach the anomaly field — single reach_zone objective.
econ.quests.registerQuest({
  id:          'q_first_steps',
  name:        'First Steps',
  description: 'Reach the anomaly field near the factory.',
  objectives: [
    {
      id:          'obj_reach_anomaly',
      type:        'reach_zone',
      target:      'anomaly_field',
      description: 'Enter the anomaly field',
      count:       1,
      current:     0,
      completed:   false,
    },
  ],
});

// q_clear_bandits: requires q_first_steps to be completed first.
// Three kill-progress objectives that each auto-complete when count reached.
econ.quests.registerQuest({
  id:          'q_clear_bandits',
  name:        'Clear the Bandit Camp',
  description: 'Eliminate the bandits blocking the route to the lab.',
  requires:    ['q_first_steps'],            // locked until q_first_steps is COMPLETED
  objectives: [
    {
      id:          'obj_kill_bandits',
      type:        'kill',
      target:      'bandit',
      description: 'Kill 3 bandits',
      count:       3,
      current:     0,
      completed:   false,
    },
  ],
});

// q_rescue_guide: a standalone quest that we will intentionally fail.
econ.quests.registerQuest({
  id:          'q_rescue_guide',
  name:        'Rescue the Guide',
  description: 'Find the guide before the bandits do.',
  objectives: [
    {
      id:          'obj_find_guide',
      type:        'reach_zone',
      target:      'guide_hideout',
      description: 'Reach the guide\'s hideout',
      count:       1,
      current:     0,
      completed:   false,
    },
  ],
});

// q_clear_bandits is blocked until q_first_steps is done.
console.log(`  isQuestStartable("q_clear_bandits"): ${econ.quests.isQuestStartable('q_clear_bandits')} (prereq not met)`);
console.log('');

// Start q_first_steps.
econ.quests.startQuest('q_first_steps');

// Complete its only objective — triggers automatic quest completion.
econ.quests.completeObjective('q_first_steps', 'obj_reach_anomaly');
console.log('');

// Now the chain quest becomes available.
console.log(`  isQuestStartable("q_clear_bandits"): ${econ.quests.isQuestStartable('q_clear_bandits')} (prereq met)`);
console.log('');

// Start the chain quest and report kill progress.
econ.quests.startQuest('q_clear_bandits');
econ.quests.updateObjectiveProgress('q_clear_bandits', 'obj_kill_bandits', 1);
econ.quests.updateObjectiveProgress('q_clear_bandits', 'obj_kill_bandits', 1);
econ.quests.updateObjectiveProgress('q_clear_bandits', 'obj_kill_bandits', 1); // 3rd → auto-complete
console.log('');

// Fail q_rescue_guide — guide was captured before the player arrived.
econ.quests.startQuest('q_rescue_guide');
econ.quests.failQuest('q_rescue_guide');
console.log('');

// Query final quest states.
console.log('  Quest summary:');
for (const id of ['q_first_steps', 'q_clear_bandits', 'q_rescue_guide']) {
  const state = econ.quests.getQuestState(id)!;
  console.log(`    ${id.padEnd(22)} status=${state.status}`);
}
console.log('');
console.log(`  Active quests:    ${econ.quests.getActiveQuests().map(q => q.id).join(', ') || 'none'}`);
console.log(`  Completed quests: ${econ.quests.getCompletedQuests().map(q => q.id).join(', ')}`);
console.log('');

// ---------------------------------------------------------------------------
// PHASE 6 — Trader restock
//
// traders.restock(currentTimeMs) restores all eligible traders to their
// baseline stock and money. It skips traders currently in an active
// trade session (isActive=true).
//
// restockIntervalMs is set to 10_000 ms (10 s) in this example.
// Calling restock(0) has no effect — the timer hasn't elapsed.
// Calling restock(15_000) triggers restock because 15_000 >= 10_000.
// ---------------------------------------------------------------------------

console.log('=== PHASE 6: Trader restock ===');
console.log('');

// Drain Sid's medkits completely.
for (let i = 0; i < 10; i++) {
  econ.traders.deductStock('sid', 'medkit', 1);
}
const sidAfterDrain = econ.traders.getTrader('sid')!;
console.log(`  Before restock: medkit=${sidAfterDrain.stock.get('medkit')?.quantity ?? 0}  money=${sidAfterDrain.money}`);

// Spend all of Sid's money manually to show money reset.
econ.traders.adjustMoney('sid', -8_000);
console.log(`  After buying all his goods: money=${econ.traders.getTrader('sid')!.money}`);

// Trigger restock — 15 000 ms has elapsed (> restockIntervalMs of 10 000 ms).
econ.traders.restock(15_000);

const sidAfterRestock = econ.traders.getTrader('sid')!;
console.log(`  After restock:  medkit=${sidAfterRestock.stock.get('medkit')!.quantity}  money=${sidAfterRestock.money}`);
console.log('  (stock and money restored to baseline)');
console.log('');

// Calling restock again immediately — timer hasn't elapsed since last restock.
econ.traders.restock(16_000); // only 1 000 ms since restock at 15 000
console.log(`  Second restock call (16 000 ms): medkit=${econ.traders.getTrader('sid')!.stock.get('medkit')!.quantity} (unchanged)`);
console.log('');

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

kernel.destroy();
npcInventory.destroy();

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('=== Summary ===');
console.log('');
console.log('Key takeaways:');
console.log('  1. EconomyPlugin owns playerInventory, traders, and quests — install with kernel.use().');
console.log('  2. executeBuy / executeSell mutate inventory/traders on SUCCESS; on failure nothing changes.');
console.log('  3. Buy price = round(basePrice × buyPriceMultiplier × allyModifier); sell price is flat.');
console.log('  4. TradeResult codes: SUCCESS, RELATION_TOO_LOW, INSUFFICIENT_STOCK, INSUFFICIENT_MONEY, …');
console.log('  5. executeGift transfers items without money; canGive is a caller-evaluated boolean gate.');
console.log('  6. Quest definitions must be registered before startQuest(); they are not serialized.');
console.log('  7. updateObjectiveProgress(questId, objId, n) auto-completes the objective at count.');
console.log('  8. Quest chains: set requires: [\'other_id\'] — startQuest() is blocked until prereqs complete.');
console.log('  9. traders.restock(timeMs) restores baseline stock; skips active trade sessions.');
console.log(' 10. EconomyPlugin.serialize() / restore() covers inventory, traders, and quest state.');
