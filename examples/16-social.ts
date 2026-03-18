/**
 * 16-social.ts
 *
 * NPC social interaction system with @alife-sdk/social.
 * Runs in Node.js with:
 *   npx tsx --tsconfig examples/tsconfig.json examples/16-social.ts
 *
 * What we build here:
 *   - ContentPool — text pool by category; addLines / loadSocialData
 *   - MeetOrchestrator — greeting bubbles when player approaches NPCs
 *   - RemarkDispatcher — ambient NPC remarks driven by plugin.update()
 *   - CampfireFSM — auto-managed campfire sessions (IDLE → STORY/JOKE → REACTING, or EATING → IDLE)
 *   - SocialPlugin + kernel — wiring ISocialPresenter and INPCSocialProvider
 *   - Serialize / restore — cooldowns survive save/load
 *
 * Architecture:
 *   The social package is framework-agnostic. It computes WHAT to say and WHEN;
 *   the host implements two ports that tell it about the world:
 *
 *     ISocialPresenter   — showBubble(npcId, text, durationMs)
 *                          Host renders speech bubbles / plays voice lines.
 *
 *     INPCSocialProvider — getOnlineNPCs(), areFactionsHostile(), getNPCTerrainId()
 *                          Host exposes NPC list, faction relations, terrain layout.
 *
 * Key design:
 *   MeetOrchestrator is host-driven — call plugin.meetOrchestrator.update(ctx)
 *   manually in your player-proximity check (e.g. inside the game loop).
 *
 *   RemarkDispatcher and CampfireFSM are plugin-driven — call plugin.update(deltaMs)
 *   each frame; bubbles flow automatically through ISocialPresenter.showBubble().
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

// SocialPlugin — kernel plugin; owns contentPool, meetOrchestrator, remarkDispatcher.
// SocialPorts  — port tokens to register ISocialPresenter / INPCSocialProvider.
import { SocialPlugin, SocialPorts } from '@alife-sdk/social';

// ContentPool    — text pool keyed by SocialCategory strings.
// loadSocialData — bulk-populate ContentPool from an ISocialData JSON structure.
import { ContentPool, loadSocialData } from '@alife-sdk/social';

// CampfireFSM — 5-state campfire director FSM (used standalone in Phase 4).
import { CampfireFSM } from '@alife-sdk/social';

// SocialCategory — canonical category string constants.
// ISocialData    — shape of the social content JSON loaded at startup.
// IBubbleRequest — bubble display request returned by meet/remark/campfire.
import type { ISocialData, IBubbleRequest } from '@alife-sdk/social';
import { SocialCategory } from '@alife-sdk/social';

// Port interfaces — implement these on the game-engine (Phaser) side.
import type { ISocialPresenter, INPCSocialProvider } from '@alife-sdk/social';

// ISocialNPC  — minimal NPC view the social system needs (id, position, factionId, state).
import type { ISocialNPC } from '@alife-sdk/social';

import { ALifeKernel, SeededRandom } from '@alife-sdk/core';

// ---------------------------------------------------------------------------
// Social content data
//
// In production this comes from social.json loaded at boot.
// ISocialData is the exact shape of that file — greetings, remarks, campfire.
// ---------------------------------------------------------------------------

const SOCIAL_DATA: ISocialData = {
  greetings: {
    friendly: ['Привіт, друже!', 'Здоров, брате!', 'Вітаю!'],
    neutral:  ['Хто такий?',    'Чого треба?',    'Проходь.'],
    evening:  ['Добрий вечір.', 'Доброї ночі.',   'Тихо сьогодні.'],
  },
  remarks: {
    zone:    ['Тут небезпечно...', 'Аномалія поруч.'],
    weather: ['Знову дощ.',        'Радіаційна хмара.'],
    gossip: {
      loner:  ['Чув новини зі Зони?', 'Бачив вчора снорка.'],
      bandit: ['Барига хоче стволи.', 'Контролер на базі.'],
    },
  },
  campfire: {
    stories:   ['Одного разу у Зоні...', 'Була така пригода...', 'Слухай, колись давно...'],
    jokes:     ['Приходить сталкер у бар...', 'Знаєш різницю між сталкером і зомбі?'],
    reactions: {
      laughter:    ['Ха-ха!',    'Ото дає!',   'Помру!'],
      story_react: ['Серйозно?', 'Неможливо!', 'Ну і ну...'],
      eating:      ['*жує*',     "*п'є*",       '*хрустить*'],
    },
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a bubble request for console output. */
function showBubble(b: IBubbleRequest): void {
  console.log(`    [${b.npcId}] "${b.text}" (${b.durationMs} ms, category: ${b.category})`);
}

// ---------------------------------------------------------------------------
// PHASE 1 — ContentPool
//
// ContentPool is the text database for every social interaction.
// Each category key maps to a pool of lines. getRandomLine() avoids
// returning the same line twice in a row (round-robin cursor).
//
// You can populate it two ways:
//   a) addLines(category, lines[]) — add one category at a time
//   b) loadSocialData(pool, data)  — bulk-load from an ISocialData object
//      (matches the shape of social.json loaded from disk)
// ---------------------------------------------------------------------------

console.log('=== PHASE 1: ContentPool — text pool by category ===');
console.log('');

const random = new SeededRandom(42);
const pool   = new ContentPool(random);

// a) Manual category population — useful for custom in-game categories.
pool.addLines(SocialCategory.GREETING_FRIENDLY, ['Привіт!', 'Здоров!', 'Слава!']);
console.log(`  Pools after manual addLines: ${pool.size}`);

// b) Bulk-load from ISocialData — replaces any existing categories with the same key.
loadSocialData(pool, SOCIAL_DATA);
console.log(`  Pools after loadSocialData:  ${pool.size}`);

// getRandomLine — picks a random entry, never repeating the previous one.
const line1 = pool.getRandomLine(SocialCategory.GREETING_FRIENDLY);
const line2 = pool.getRandomLine(SocialCategory.REMARK_ZONE);
const line3 = pool.getRandomLine('nonexistent_category');   // returns null if pool missing
console.log(`  greeting_friendly:  "${line1}"`);
console.log(`  remark_zone:        "${line2}"`);
console.log(`  nonexistent:        ${line3}`);   // null

// hasLines — check before calling getRandomLine in optional paths.
console.log(`  hasLines(campfire_story): ${pool.hasLines(SocialCategory.CAMPFIRE_STORY)}`);

// Faction gossip uses a composite key: "remark_gossip:<factionId>".
// ContentPool.gossipKey() builds it for you.
const gossipKey = ContentPool.gossipKey('loner');
console.log(`  gossip key for 'loner': "${gossipKey}"`);
console.log(`  gossip line: "${pool.getRandomLine(gossipKey)}"`);
console.log('');

// ---------------------------------------------------------------------------
// PHASE 2 — MeetOrchestrator
//
// MeetOrchestrator fires greeting bubbles when the player walks near NPCs.
// It checks eligibility on an interval (meetCheckIntervalMs) and enforces
// per-NPC cooldowns so the same NPC doesn't greet twice in a row.
//
// IMPORTANT: MeetOrchestrator is HOST-DRIVEN.
//   Call plugin.meetOrchestrator.update(ctx) from your own player-proximity
//   loop — SocialPlugin.update() does NOT call it automatically.
//
// Greeting category selection:
//   ally faction  → GREETING_FRIENDLY
//   neutral       → GREETING_NEUTRAL
//   evening state → GREETING_EVENING
//   hostile       → no greeting (blocked by isMeetEligible)
// ---------------------------------------------------------------------------

console.log('=== PHASE 2: MeetOrchestrator — greetings when player approaches ===');
console.log('');

// NOTE: No ALifeKernel needed here.
// MeetOrchestrator is a pure compute unit — it doesn't use kernel ports or lifecycle.
// You can call plugin.meetOrchestrator.update() as soon as SocialPlugin is constructed.
// (Ports + kernel ARE required for RemarkDispatcher and CampfireFSM — see Phase 3/4.)
const meetPlugin = new SocialPlugin(new SeededRandom(42), {
  data: SOCIAL_DATA,
  social: {
    meet: {
      meetDistance:          200,    // greet NPCs within 200 px of the player
      meetCooldownMs:      5_000,    // same NPC won't greet again for 5 s
      meetCheckIntervalMs:   100,    // run eligibility check every 100 ms
    },
  },
});

// ISocialNPC — the minimal NPC view the social system needs.
// In production, getOnlineNPCs() builds this from your entity/component system.
const friendlyNPC: ISocialNPC = { id: 'wolf',   position: { x: 120, y: 100 }, factionId: 'loner',  state: 'idle' };
const banditNPC:   ISocialNPC = { id: 'razor',  position: { x: 130, y: 100 }, factionId: 'bandit', state: 'idle' };

// — Greeting context — player is at (100, 100).
// deltaMs must exceed meetCheckIntervalMs (100 ms) for the eligibility check to run.
const meetCtx = (npcs: ISocialNPC[], currentTime: number) => ({
  deltaMs:        200,  // 200 ms > meetCheckIntervalMs: 100 → check fires
  targetX:        100,
  targetY:        100,
  currentTime,
  npcs,
  isHostile: (a: string, b: string) => (a === 'loner' && b === 'bandit') || (a === 'bandit' && b === 'loner'),
  isAlly:    (a: string, b: string) => a === b,
  targetFactionId: 'loner',
});

// — Friendly NPC → GREETING_FRIENDLY bubble
const greet1 = meetPlugin.meetOrchestrator.update(meetCtx([friendlyNPC], 1_000));
console.log('  Friendly NPC approaches:');
greet1.forEach(showBubble);

// — Same NPC again at t+200 ms: cooldown (5 000 ms) blocks the second greeting.
const greet2 = meetPlugin.meetOrchestrator.update(meetCtx([friendlyNPC], 1_200));
console.log(`  Same NPC 200 ms later (cooldown): ${greet2.length} bubbles`);  // 0

// — Hostile NPC (bandit) → no greeting.
const greet3 = meetPlugin.meetOrchestrator.update(meetCtx([banditNPC], 2_000));
console.log(`  Hostile NPC:                       ${greet3.length} bubbles`);  // 0

// — Friendly NPC after cooldown expires (t = 10 000 ms).
const greet4 = meetPlugin.meetOrchestrator.update(meetCtx([friendlyNPC], 10_000));
console.log('  Friendly NPC after cooldown:');
greet4.forEach(showBubble);
console.log('');

// ---------------------------------------------------------------------------
// PHASE 3 — RemarkDispatcher (via SocialPlugin + kernel)
//
// RemarkDispatcher fires ambient remarks while NPCs are idle / on patrol.
// It runs automatically inside SocialPlugin.update(deltaMs) — no manual call.
//
// Eligibility rules (all must pass):
//   - NPC state is in eligibleStates (default: idle, patrol, camp)
//   - Per-NPC cooldown (30–60 s default) has expired
//   - Only one NPC per terrain may speak per check pass (terrain lock)
//   - Random chance (default 30%) rolls pass
//
// Remark category is selected by weighted random:
//   weightZone              → REMARK_ZONE
//   weightWeatherCumulative → REMARK_WEATHER
//   fallback                → REMARK_GOSSIP:<factionId>
//
// Bubbles flow through ISocialPresenter.showBubble() automatically.
// ---------------------------------------------------------------------------

console.log('=== PHASE 3: RemarkDispatcher — ambient NPC remarks ===');
console.log('');

// Tracking presenter — collects all showBubble calls.
// ISocialPresenter.showBubble receives (npcId, text, durationMs) — no category.
// Category is used internally by the SDK but not forwarded to the presenter.
// In Phaser, showBubble spawns a speech bubble sprite above the NPC.
const collectedBubbles: Array<{ npcId: string; text: string; durationMs: number }> = [];
const remarkPresenter: ISocialPresenter = {
  showBubble(npcId, text, durationMs) {
    collectedBubbles.push({ npcId, text, durationMs });
  },
};

// NPC provider — exposes the live NPC list and terrain assignments.
// In Phaser, getOnlineNPCs() reads from the entity/brain manager.
const remarkNPCs: ISocialNPC[] = [
  { id: 'sidorovich', position: { x: 100, y: 100 }, factionId: 'trader', state: 'idle'   },
  { id: 'wolf',       position: { x: 200, y: 100 }, factionId: 'loner',  state: 'patrol' },
];
const remarkProvider: INPCSocialProvider = {
  getOnlineNPCs:      ()     => remarkNPCs,
  areFactionsHostile: ()     => false,
  areFactionsFriendly:(a, b) => a === b,
  getNPCTerrainId:    (id)   => id === 'wolf' ? 'terrain_field' : 'terrain_bar',
};

const remarkKernel = new ALifeKernel();
remarkKernel.provide(SocialPorts.SocialPresenter,  remarkPresenter);
remarkKernel.provide(SocialPorts.NPCSocialProvider, remarkProvider);

const remarkPlugin = new SocialPlugin(new SeededRandom(7), {
  data: SOCIAL_DATA,
  social: {
    remark: {
      remarkCheckIntervalMs:  100,    // check every 100 ms
      remarkCooldownMinMs:    200,    // NPC cooldown 200–400 ms (fast for demo)
      remarkCooldownMaxMs:    400,
      remarkChance:           1.0,    // 100% chance — always fires when eligible
      weightZone:             0.4,    // 40% zone, 30% weather, 30% gossip
      weightWeatherCumulative:0.7,
    },
  },
});
remarkKernel.use(remarkPlugin);
remarkKernel.init();
remarkKernel.start();

// Run 5 plugin ticks (each 200 ms) — remarks fire through presenter automatically.
// The kernel here is passive: kernel.use() wired the ports so the plugin can resolve
// ISocialPresenter and INPCSocialProvider. The update loop itself is host-driven.
for (let i = 0; i < 5; i++) {
  remarkPlugin.update(200);
}

console.log(`  Remarks emitted after 5 ticks (1 000 ms):`);
for (const b of collectedBubbles) {
  console.log(`    [${b.npcId}] "${b.text}"`);
}
console.log('');

remarkKernel.destroy();

// ---------------------------------------------------------------------------
// PHASE 4 — CampfireFSM
//
// When ≥2 NPCs are in camp state on the same terrain, SocialPlugin automatically
// creates a CampfireFSM for that terrain on each syncIntervalMs tick.
//
// CampfireFSM cycle:
//   IDLE (pause) → STORY or JOKE → REACTING → IDLE (loop)
//   IDLE (pause) → EATING        → IDLE (loop, no REACTING)
//
// The FSM rotates the "director" (storyteller) each cycle.
// Audience reactions are staggered by reactionStaggerMs so bubbles don't
// all appear at the same time.
//
// You can also instantiate CampfireFSM directly (without the plugin) if you
// want manual control — see the standalone example below.
// ---------------------------------------------------------------------------

console.log('=== PHASE 4: CampfireFSM — campfire storytelling session ===');
console.log('');

// — 4a: Standalone CampfireFSM (direct usage, no kernel needed)
console.log('  4a. Standalone CampfireFSM:');

const campfirePool = new ContentPool(new SeededRandom(42));
loadSocialData(campfirePool, SOCIAL_DATA);

// Short durations so the state machine cycles quickly in the example.
// weightStory: 0.99 guarantees STORY is chosen → FSM goes IDLE → STORY → REACTING → IDLE.
// (Set weightStory below ~0.35 or weightJokeCumulative below ~0.65 for EATING paths.)
//
// idleDurationMinMs: 500 in the standalone config keeps the demo steps predictable:
// each campfire.update(N) won't overshoot IDLE and immediately start the next cycle.
const standaloneCfg = {
  minParticipants:       2,
  idleDurationMinMs:   500,  idleDurationMaxMs:  1000,  // long enough not to overshoot in one tick
  storyDurationMinMs:  100,  storyDurationMaxMs:   200,
  jokeDurationMinMs:   100,  jokeDurationMaxMs:    200,
  eatingDurationMinMs: 100,  eatingDurationMaxMs:  200,
  reactionDurationMinMs: 100, reactionDurationMaxMs: 200,
  reactionStaggerMs:    30,  // stagger audience reactions by 30 ms each
  eatingChance:        0.6,
  weightStory:         0.99, // force STORY → REACTING path for this demo
  weightJokeCumulative:1.0,
  syncIntervalMs:      100,
  gatheringStates:     ['camp'],
};

// Separate config for the plugin-managed 4b demo — short idle so sessions cycle quickly.
const campfireCfg = {
  ...standaloneCfg,
  idleDurationMinMs:   50,  idleDurationMaxMs:   100,
};

const campfire = new CampfireFSM('terrain_bar', campfirePool, new SeededRandom(42), standaloneCfg);
campfire.setParticipants(['wolf', 'sidorovich', 'phantom']);

console.log(`    Participants: ${campfire.participantCount}`);
console.log(`    Initial state: ${campfire.getState()}`);  // CampfireState.IDLE

// DEMO NOTE: In a real game (60fps, deltaMs ≈ 16ms) phase durations are seconds-long,
// so each update() advances one small step and never overshoots a state boundary.
// Here we use artificially large deltas to skip through phases instantly.
// update(2000) > any phase's max duration → guaranteed one transition per call.

// Step 1: exit IDLE → director tells a story (weightStory: 0.99 forces STORY).
const storyBubbles = campfire.update(2000);
console.log(`    → ${campfire.getState()} (director tells story):`);
storyBubbles.forEach(b => console.log(`      [${b.npcId}] "${b.text}" (${b.category})`));

// Step 2: exit STORY → REACTING. enterReacting() returns [] immediately;
// each audience member reacts after their stagger delay (0, 30, 60 ms … for N participants).
campfire.update(2000);
console.log(`    → ${campfire.getState()} (audience reacts, staggered by ${standaloneCfg.reactionStaggerMs} ms):`);
// One tick covering (audience size × reactionStaggerMs) unlocks everyone at once.
// Audience = participants - director = 3 - 1 = 2; 2×30ms = 60 ms covers both delays.
const allReactions: IBubbleRequest[] = campfire.update(60);
allReactions.forEach(b => console.log(`      [${b.npcId}] "${b.text}" (${b.category})`));

// Step 3: exit REACTING → back to IDLE.
// Use 300 ms: enough to pass reactionDurationMax (200 ms) but not idleDurationMin (500 ms),
// so the FSM lands in IDLE without immediately starting the next cycle.
campfire.update(300);
console.log(`    → ${campfire.getState()} (cycle complete)`);

console.log('');

// — 4b: Campfire via SocialPlugin (auto-managed)
console.log('  4b. CampfireFSM via SocialPlugin (auto-managed):');

const campfireBubbles: Array<{ npcId: string; text: string }> = [];
const campfirePresenter: ISocialPresenter = {
  showBubble(npcId, text) { campfireBubbles.push({ npcId, text }); },
};

// All 3 NPCs are in 'camp' state on the same terrain 'terrain_bar'.
// SocialPlugin detects this on each syncIntervalMs tick and auto-creates a CampfireFSM.
const campfireNPCs: ISocialNPC[] = [
  { id: 'wolf',       position: { x: 100, y: 100 }, factionId: 'loner', state: 'camp' },
  { id: 'sidorovich', position: { x: 105, y: 100 }, factionId: 'loner', state: 'camp' },
  { id: 'phantom',    position: { x: 110, y: 100 }, factionId: 'loner', state: 'camp' },
];
const campfireProvider: INPCSocialProvider = {
  getOnlineNPCs:       ()     => campfireNPCs,
  areFactionsHostile:  ()     => false,
  areFactionsFriendly: (a, b) => a === b,
  getNPCTerrainId:     ()     => 'terrain_bar',  // all on the same terrain
};

const campfireKernel = new ALifeKernel();
campfireKernel.provide(SocialPorts.SocialPresenter,  campfirePresenter);
campfireKernel.provide(SocialPorts.NPCSocialProvider, campfireProvider);

const campfirePlugin = new SocialPlugin(new SeededRandom(42), {
  data: SOCIAL_DATA,
  social: { campfire: campfireCfg },
});
campfireKernel.use(campfirePlugin);
campfireKernel.init();
campfireKernel.start();

// Run enough ticks for two things to happen:
//   1. syncIntervalMs (100 ms) fires — plugin scans NPCs, detects ≥2 in 'camp' on
//      'terrain_bar', and creates a CampfireFSM for that terrain.
//   2. CampfireFSM idle duration expires and the first activity (STORY/JOKE/EATING) fires.
for (let i = 0; i < 20; i++) {
  campfirePlugin.update(150);
}

console.log(`    Campfire bubbles from plugin.update() (${campfireBubbles.length} total):`);
for (const b of campfireBubbles.slice(0, 5)) {
  console.log(`      [${b.npcId}] "${b.text}"`);
}
if (campfireBubbles.length > 5) {
  console.log(`      ... and ${campfireBubbles.length - 5} more`);
}
console.log('');

// ---------------------------------------------------------------------------
// PHASE 5 — Serialize / Restore
//
// SocialPlugin serializes two things:
//   meetCooldowns   — per-NPC greeting cooldown timestamps
//   remarkCooldowns — per-NPC remark cooldown (stored as remainingMs)
//
// Campfire sessions are intentionally NOT serialized — they are transient
// (seconds-long) and auto-reconstruct from live NPC positions after load.
// ---------------------------------------------------------------------------

console.log('=== PHASE 5: Serialize / Restore ===');
console.log('');

// Trigger a greeting to set a cooldown for 'wolf'.
const savePlugin = new SocialPlugin(new SeededRandom(42), {
  data: SOCIAL_DATA,
  social: {
    meet: { meetDistance: 200, meetCooldownMs: 60_000, meetCheckIntervalMs: 100 },
  },
});

const saveKernel = new ALifeKernel();
saveKernel.provide(SocialPorts.SocialPresenter,  { showBubble() {} });
saveKernel.provide(SocialPorts.NPCSocialProvider, {
  getOnlineNPCs: () => [friendlyNPC],
  areFactionsHostile:  () => false,
  areFactionsFriendly: (a, b) => a === b,
  getNPCTerrainId: () => null,
});
saveKernel.use(savePlugin);
saveKernel.init();
saveKernel.start();

// Fire a greeting to set the cooldown.
savePlugin.meetOrchestrator.update(meetCtx([friendlyNPC], 1_000));

// Verify cooldown is active — same NPC at t+1 s should get no greeting.
const blockedGreet = savePlugin.meetOrchestrator.update(meetCtx([friendlyNPC], 2_000));
console.log(`  Before save — greeting blocked by cooldown: ${blockedGreet.length === 0}`);

// Serialize the kernel (includes social plugin state).
const savedState = saveKernel.serialize();

// Restore into a new kernel + fresh SocialPlugin instance.
// Wiring is identical to saveKernel above — same ports, same config.
// restoreState() replays the serialized cooldowns into the fresh plugin.
const restorePlugin = new SocialPlugin(new SeededRandom(42), {
  data: SOCIAL_DATA,
  social: {
    meet: { meetDistance: 200, meetCooldownMs: 60_000, meetCheckIntervalMs: 100 },
  },
});

const restoreKernel = new ALifeKernel();
restoreKernel.provide(SocialPorts.SocialPresenter,  { showBubble() {} });
restoreKernel.provide(SocialPorts.NPCSocialProvider, {
  getOnlineNPCs: () => [friendlyNPC],
  areFactionsHostile:  () => false,
  areFactionsFriendly: (a, b) => a === b,
  getNPCTerrainId: () => null,
});
restoreKernel.use(restorePlugin);
restoreKernel.init();
restoreKernel.restoreState(savedState);
restoreKernel.start();

// After restore, the cooldown for wolf is still active.
const afterRestoreGreet = restorePlugin.meetOrchestrator.update(meetCtx([friendlyNPC], 2_000));
console.log(`  After restore — greeting still blocked: ${afterRestoreGreet.length === 0}`);
console.log('');

saveKernel.destroy();
restoreKernel.destroy();
campfireKernel.destroy();

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('=== Summary ===');
console.log('');
console.log('Key takeaways:');
console.log('  1. ContentPool.addLines(category, lines) or loadSocialData(pool, data) to populate.');
console.log('  2. MeetOrchestrator is HOST-DRIVEN — call plugin.meetOrchestrator.update(ctx) manually.');
console.log('  3. RemarkDispatcher and CampfireFSM are PLUGIN-DRIVEN — call plugin.update(deltaMs).');
console.log('  4. Bubbles from remarks/campfire flow through ISocialPresenter.showBubble().');
console.log('  5. Bubbles from meet.update() are returned directly — present them yourself.');
console.log('  6. CampfireFSM is auto-created when ≥2 NPCs have state "camp" on the same terrain.');
console.log('  7. Campfire sessions are transient — not serialized, auto-reconstruct after load.');
console.log('  8. Meet / remark cooldowns ARE serialized via kernel.serialize() / restoreState().');
console.log('  9. Implement ISocialPresenter + INPCSocialProvider to bridge your game engine.');
