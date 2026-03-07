export type DocLink = {
  title: string;
  description: string;
  source: string;
};

export type DocSection = {
  id: string;
  title: string;
  summary: string;
  links: DocLink[];
};

export const topNav = [
  { label: "Quick Start", href: "#quickstart" },
  { label: "Concepts", href: "#concepts" },
  { label: "Guides", href: "#guides" },
  { label: "Packages", href: "#packages" },
  { label: "Examples", href: "#examples" },
  { label: "Glossary", href: "#glossary" },
];

export const docSections: DocSection[] = [
  {
    id: "quickstart",
    title: "Quick Start",
    summary:
      "Почніть з одного польового тесту: підняти kernel, зареєструвати 1 terrain, 1 NPC, дочекатися tick і зафіксувати подію.",
    links: [
      {
        title: "Quick Start",
        description:
          "Покроковий запуск, вибір мінімального стеку, in-memory field test і перехід до Phaser або custom engine.",
        source: "docs/quick-start.md",
      },
      {
        title: "Landing / Runtime Loop",
        description:
          "Ключова ідея: світ живе поза камерою, а біля гравця вмикається online AI.",
        source: "docs/index.md",
      },
    ],
  },
  {
    id: "concepts",
    title: "Concepts",
    summary:
      "Розділ про ментальну модель SDK: kernel, ports, online/offline handoff, життєвий цикл NPC і події.",
    links: [
      {
        title: "Kernel",
        description: "ALifeKernel як координатор lifecycle, event bus, ports і plugins.",
        source: "docs/concepts/kernel.md",
      },
      {
        title: "Ports",
        description: "Контракти між SDK і вашим рушієм. SDK не залежить від Phaser напряму.",
        source: "docs/concepts/ports.md",
      },
      {
        title: "Online vs Offline",
        description: "Базова ідея продуктивності: далекий NPC дешевий офлайн, близький NPC працює покадрово.",
        source: "docs/concepts/online-offline.md",
      },
      {
        title: "NPC Lifecycle",
        description: "Фази від реєстрації до handoff між simulation та runtime AI.",
        source: "docs/concepts/npc-lifecycle.md",
      },
      {
        title: "Smart Terrains",
        description: "Activity zones, jobs та обмеження, які роблять поведінку NPC правдоподібною.",
        source: "docs/concepts/smart-terrains.md",
      },
      {
        title: "Events",
        description: "Декуплінг систем через typed events і спостережуваний runtime flow.",
        source: "docs/concepts/events.md",
      },
    ],
  },
  {
    id: "guides",
    title: "Guides",
    summary:
      "Практичні маршрути інтеграції для першого продакшен-результату без зайвої теорії.",
    links: [
      {
        title: "Choose Your Stack",
        description: "Як обрати пакетний набір під ваш кейс без over-install.",
        source: "docs/guides/choose-your-stack.md",
      },
      {
        title: "First Living World",
        description: "Перший milestone: 1 terrain + 1 NPC + 1 tick + 1 visible event.",
        source: "docs/guides/first-living-world.md",
      },
      {
        title: "Phaser Integration",
        description: "Швидкий шлях для Phaser 3 через @alife-sdk/phaser і createPhaserKernel().",
        source: "docs/guides/phaser-integration.md",
      },
      {
        title: "Custom Engine",
        description: "Чисте підключення через port layer для ECS/власного рушія.",
        source: "docs/guides/custom-engine.md",
      },
      {
        title: "Gameplay Systems",
        description: "Порядок підключення hazards, quests, social і persistence після базової симуляції.",
        source: "docs/guides/gameplay-systems.md",
      },
      {
        title: "Troubleshooting",
        description: "Типові інтеграційні проблеми і перевірки перед масштабуванням систем.",
        source: "docs/guides/troubleshooting.md",
      },
      {
        title: "Save / Load",
        description: "Практики збереження стану світу через PersistencePlugin.",
        source: "docs/guides/save-load.md",
      },
    ],
  },
  {
    id: "packages",
    title: "Packages",
    summary:
      "SDK модульний: start small і додавайте only-when-needed шари симуляції, AI, соціалки, економіки та persistence.",
    links: [
      {
        title: "@alife-sdk/core",
        description: "Kernel, ports, events, smart terrains, faction model та фундамент API.",
        source: "docs/packages/core.md",
      },
      {
        title: "@alife-sdk/simulation",
        description: "Офлайн життєвий цикл світу з tick pipeline і brain updates.",
        source: "docs/packages/simulation.md",
      },
      {
        title: "@alife-sdk/ai",
        description: "Online frame-based поведінка: perception, GOAP, combat tactics.",
        source: "docs/packages/ai.md",
      },
      {
        title: "@alife-sdk/social",
        description: "Greeting/remarks/campfire story layer, який додає \"живості\" світу.",
        source: "docs/packages/social.md",
      },
      {
        title: "@alife-sdk/economy",
        description: "Інвентар, торгівля, квести і прогресійні геймплейні контури.",
        source: "docs/packages/economy.md",
      },
      {
        title: "@alife-sdk/hazards",
        description: "Аномалії, environmental damage та артефактні reward loops.",
        source: "docs/packages/hazards.md",
      },
      {
        title: "@alife-sdk/persistence",
        description: "Save/load world state через pluggable storage providers.",
        source: "docs/packages/persistence.md",
      },
      {
        title: "@alife-sdk/phaser",
        description: "Готовий адаптерний шар для Phaser 3 scenes.",
        source: "docs/packages/phaser.md",
      },
    ],
  },
  {
    id: "examples",
    title: "Examples",
    summary:
      "Робочі сценарії для перевірки runtime-поведінки без здогадок: від hello-npc до повного capstone.",
    links: [
      {
        title: "Examples Index",
        description: "Огляд прикладів, де видно чесну поведінку SDK і стандартні integration paths.",
        source: "docs/examples/index.md",
      },
      {
        title: "Capstone: 18-full-npc",
        description: "Найповніший сценарій: living world loop + NPC runtime state transitions.",
        source: "examples/18-full-npc.ts",
      },
      {
        title: "Phaser Example",
        description: "Практичний demo з online/offline перемиканням у Phaser scene.",
        source: "examples/phaser/README.md",
      },
    ],
  },
  {
    id: "glossary",
    title: "Glossary",
    summary:
      "Швидкий словник термінів SDK: kernel, ports, adapters, providers, brains, records, ticks і події.",
    links: [
      {
        title: "ALife SDK Glossary",
        description: "Пояснення термінів і частих плутанин для швидкого вирівнювання командного контексту.",
        source: "docs/glossary.md",
      },
    ],
  },
];

export const runtimeChecklist = [
  "kernel.init() та kernel.start() проходять без помилок",
  "Є мінімум 1 terrain та 1 NPC у світі",
  "update loop викликається стабільно",
  "Події TICK / NPC_MOVED видно у логах",
  "Online/offline handoff відпрацьовує біля гравця",
];

export const quickCommands = [
  "pnpm install",
  "pnpm build:sdk",
  "npx tsx --tsconfig examples/tsconfig.json examples/18-full-npc.ts",
];
