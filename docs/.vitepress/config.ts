import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'A-Life SDK',
  description:
    'TypeScript SDK for living game worlds: offline NPC simulation, online combat AI, smart terrains, factions, hazards, economy, social systems, and Phaser integration.',
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ['meta', { name: 'theme-color', content: '#120d0b' }],
    ['meta', { property: 'og:title', content: 'A-Life SDK' }],
    [
      'meta',
      {
        property: 'og:description',
        content:
          'Build living game worlds with offline simulation, online AI, and engine-agnostic ports.',
      },
    ],
  ],
  themeConfig: {
    siteTitle: 'A-Life SDK',
    search: {
      provider: 'local',
    },
    nav: [
      { text: 'Start Here', link: '/quick-start' },
      { text: 'Guides', link: '/guides/' },
      { text: 'Concepts', link: '/concepts/' },
      { text: 'Packages', link: '/packages/' },
      { text: 'Examples', link: '/examples/' },
      { text: 'Glossary', link: '/glossary' },
      { text: 'GitHub', link: 'https://github.com/eurusik/alife-sdk' },
    ],
    sidebar: {
      '/guides/': [
        {
          text: 'Guides',
          items: [
            { text: 'Overview', link: '/guides/' },
            { text: 'Choose Your Stack', link: '/guides/choose-your-stack' },
            { text: 'First Living World', link: '/guides/first-living-world' },
            { text: 'Phaser Integration', link: '/guides/phaser-integration' },
            { text: 'Custom Engine', link: '/guides/custom-engine' },
            { text: 'Gameplay Systems', link: '/guides/gameplay-systems' },
            { text: 'Save / Load', link: '/guides/save-load' },
            { text: 'Troubleshooting', link: '/guides/troubleshooting' },
          ],
        },
      ],
      '/concepts/': [
        {
          text: 'Concepts',
          items: [
            { text: 'Overview', link: '/concepts/' },
            { text: 'Kernel', link: '/concepts/kernel' },
            { text: 'Ports', link: '/concepts/ports' },
            { text: 'Online vs Offline', link: '/concepts/online-offline' },
            { text: 'Smart Terrains', link: '/concepts/smart-terrains' },
            { text: 'Events', link: '/concepts/events' },
            { text: 'NPC Lifecycle', link: '/concepts/npc-lifecycle' },
          ],
        },
      ],
      '/packages/': [
        {
          text: 'Packages',
          items: [
            { text: 'Overview', link: '/packages/' },
            { text: 'core', link: '/packages/core' },
            { text: 'simulation', link: '/packages/simulation' },
            { text: 'ai', link: '/packages/ai' },
            { text: 'social', link: '/packages/social' },
            { text: 'economy', link: '/packages/economy' },
            { text: 'hazards', link: '/packages/hazards' },
            { text: 'persistence', link: '/packages/persistence' },
            { text: 'phaser', link: '/packages/phaser' },
          ],
        },
      ],
      '/examples/': [
        {
          text: 'Examples',
          items: [{ text: 'Overview', link: '/examples/' }],
        },
      ],
      '/': [
        {
          text: 'Guide',
          items: [
            { text: 'Quick Start', link: '/quick-start' },
            { text: 'Guides', link: '/guides/' },
            { text: 'Concepts', link: '/concepts/' },
            { text: 'Packages', link: '/packages/' },
            { text: 'Examples', link: '/examples/' },
            { text: 'Glossary', link: '/glossary' },
          ],
        },
      ],
    },
    outline: {
      level: [2, 3],
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/eurusik/alife-sdk' }],
    editLink: {
      pattern: 'https://github.com/eurusik/alife-sdk/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },
    footer: {
      message: 'Field manual for developers building living worlds.',
      copyright: 'MIT Licensed',
    },
  },
  vite: {
    build: {
      target: 'es2022',
      reportCompressedSize: false,
    },
  },
});
