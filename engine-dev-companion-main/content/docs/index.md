---
title: A-Life SDK
layout: doc
outline: false
---

<div class="hero-page">
  <section class="hero-scene">
    <div class="hero-scene-media">
      <img src="/zone-hero.svg" alt="Zone-inspired scene with a campfire, anomaly, patrol, and ruined reactor skyline" />
    </div>

    <div class="hero-scene-overlay"></div>

    <div class="hero-scene-content">
      <div class="hero-copy-card">
        <span class="hero-kicker">A-Life SDK</span>
        <h1>The world keeps living when the player leaves.</h1>
        <p>
          Build games where distant camps keep moving, patrols keep travelling, hazards keep changing,
          and nearby encounters inherit real context instead of spawning empty.
        </p>

        <div class="hero-actions-row">
          <a class="hero-button hero-button-primary" href="/quick-start">Quick Start</a>
          <a class="hero-button" href="/examples/">See Examples</a>
          <a class="hero-button" href="/packages/">Browse Packages</a>
        </div>
      </div>

      <aside class="hero-proof-card">
        <span class="hero-kicker">Runtime Loop</span>
        <div class="hero-proof-lines">
          <code>Far away -> off-screen simulation</code>
          <code>In range -> online AI takes over</code>
          <code>Combat starts -> local context matters</code>
          <code>Player leaves -> world keeps its state</code>
        </div>
      </aside>
    </div>

    <div class="hero-value-rail">
      <article class="hero-value-card">
        <span>Off-screen simulation</span>
        <strong>NPCs keep moving without full frame cost.</strong>
      </article>
      <article class="hero-value-card">
        <span>Online AI handoff</span>
        <strong>Nearby encounters become richer only when they need to.</strong>
      </article>
      <article class="hero-value-card">
        <span>Engine boundary</span>
        <strong>Your rendering, physics, animation, and feel remain yours.</strong>
      </article>
    </div>
  </section>

  <section class="hero-followup">
    <div class="hero-followup-copy">
      <span class="hero-kicker">First Proof</span>
      <h2>Run the runtime before you wire it into a scene.</h2>
      <p>
        Watch the world advance in Node first. Once that model clicks, integrating it into Phaser
        or your own engine becomes much easier to reason about.
      </p>
    </div>

    <div class="hero-command-stack">
      <code>pnpm install</code>
      <code>pnpm build:sdk</code>
      <code>npx tsx --tsconfig examples/tsconfig.json examples/18-full-npc.ts</code>
    </div>
  </section>
</div>
