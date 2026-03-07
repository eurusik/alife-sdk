import Phaser from 'phaser';
import { HUD_FONT, HUD_PANEL_BG, HUD_PANEL_STROKE } from './demoConfig';

interface CreateHudLayerParams {
  scene: Phaser.Scene;
  viewport: { width: number; height: number };
  compactHud: boolean;
  topBarRect: Phaser.Geom.Rectangle;
  hpBarRect: Phaser.Geom.Rectangle;
  factoryBounds: { x: number; y: number; width: number; height: number };
  bunkerBounds: { x: number; y: number; width: number; height: number };
}

export interface HudLayerResult {
  hpGraphics: Phaser.GameObjects.Graphics;
  hudGraphics: Phaser.GameObjects.Graphics;
  onlineRadiusGfx: Phaser.GameObjects.Graphics;
  dangerGfx: Phaser.GameObjects.Graphics;
  aiOverlay: Phaser.GameObjects.Text;
  eventLogText: Phaser.GameObjects.Text;
  tickText: Phaser.GameObjects.Text;
  tickerBg: Phaser.GameObjects.Graphics;
  playerDeadText: Phaser.GameObjects.Text;
  playerHpText: Phaser.GameObjects.Text;
  helpUi: Phaser.GameObjects.GameObject[];
  layoutTicker: () => void;
}

/**
 * Builds all static HUD panels and returns live UI references.
 *
 * Scene runtime can then update text/values without mixing layout code
 * into the gameplay logic.
 */
export function createHudLayer(params: CreateHudLayerParams): HudLayerResult {
  const { scene, viewport, compactHud, topBarRect, hpBarRect, factoryBounds, bunkerBounds } = params;
  const W = viewport.width;
  const H = viewport.height;

  const hpGraphics = scene.add.graphics().setDepth(5);
  const hudGraphics = scene.add.graphics().setDepth(8);
  const onlineRadiusGfx = scene.add.graphics().setDepth(4);
  const dangerGfx = scene.add.graphics().setDepth(6);
  const helpUi: Phaser.GameObjects.GameObject[] = [];

  const hpAreaW = compactHud ? 120 : 180;
  const topBar = scene.add.graphics().setDepth(7);
  topBar.fillStyle(0x071127, 0.92);
  topBar.fillRoundedRect(topBarRect.x, topBarRect.y, topBarRect.width, topBarRect.height, 12);
  topBar.lineStyle(1, 0x4a76ff, 0.95);
  topBar.strokeRoundedRect(topBarRect.x, topBarRect.y, topBarRect.width, topBarRect.height, 12);
  topBar.fillStyle(0x4a76ff, 0.18);
  topBar.fillRoundedRect(topBarRect.x + 1, topBarRect.y + 1, topBarRect.width - 2, 26, 12);

  const hpAreaX = topBarRect.right - hpAreaW - 14;
  const infoX = topBarRect.x + 18;
  const infoWidth = Math.max(180, hpAreaX - infoX - 12);
  const title = scene.add.text(infoX, topBarRect.y + 12, compactHud ? 'ALife SDK' : 'ALife SDK — AI Showcase', {
    fontSize: compactHud ? '16px' : '18px',
    fontStyle: 'bold',
    fontFamily: HUD_FONT,
    color: '#f8fbff',
    stroke: '#10224f',
    strokeThickness: 3,
  }).setDepth(8);
  title.setShadow(0, 2, '#000814', 10, false, true);

  const controlsText = compactHud
    ? 'WASD move  ·  G throw to cursor  ·  Click shoot  ·  H help'
    : 'WASD/arrows: move  ·  G: throw to cursor  ·  Click: shoot  ·  H: toggle help';
  const controls = scene.add.text(
    topBarRect.x + 18,
    topBarRect.y + (compactHud ? 32 : 38),
    controlsText,
    {
      fontSize: compactHud ? '9px' : '11px',
      color: '#d5deff',
      wordWrap: { width: Math.max(compactHud ? 210 : 260, infoWidth) },
    },
  ).setDepth(8);
  const hpCaption = scene.add.text(hpAreaX, topBarRect.y + (compactHud ? 14 : 16), compactHud ? 'HP' : 'PLAYER INTEGRITY', {
    fontSize: compactHud ? '8px' : '10px',
    fontStyle: 'bold',
    fontFamily: HUD_FONT,
    color: '#88f4ff',
  }).setDepth(8);
  const playerHpText = scene.add.text(topBarRect.right - 40, topBarRect.y + (compactHud ? 14 : 16), '100%', {
    fontSize: compactHud ? '10px' : '11px',
    fontStyle: 'bold',
    fontFamily: HUD_FONT,
    color: '#ffffff',
  }).setDepth(8);
  controls.setStyle({ fontFamily: HUD_FONT });
  controls.setShadow(0, 1, '#000814', 6, false, true);
  hpCaption.setShadow(0, 1, '#001018', 6, false, true);
  playerHpText.setShadow(0, 1, '#001018', 6, false, true);
  helpUi.push(topBar, title, controls, hpCaption, playerHpText);

  const uiEdgePadding = 16;
  const panelWidth = 320;
  const panelX = W - uiEdgePadding - panelWidth + 12;
  const panelY = topBarRect.y;
  const panelHeight = 236;
  const legendLineGap = compactHud ? 20 : 24;
  const legendFooterVisible = !compactHud;
  const totalLegendRows = 8;
  const rightLegendColumns = compactHud ? 2 : 1;
  const rightLegendRowsPerColumn = Math.ceil(totalLegendRows / rightLegendColumns);
  const rightLegendWidth = panelWidth;
  const rightLegendHeight = 46 + legendLineGap * rightLegendRowsPerColumn + (legendFooterVisible ? 34 : 10);
  const legendRightX = panelX - 12;
  const legendRightY = panelY + panelHeight + 12;
  const legendBottomLimit = Math.min(bunkerBounds.y - 12, H - 80);
  const useRightLegend = legendRightX + rightLegendWidth <= W - 12
    && legendRightY + rightLegendHeight <= legendBottomLimit;
  const legendColumns = useRightLegend ? rightLegendColumns : 1;
  const legendRowsPerColumn = Math.ceil(totalLegendRows / legendColumns);
  const legendWidth = useRightLegend ? rightLegendWidth : 356;
  const legendHeight = 46 + legendLineGap * legendRowsPerColumn + (legendFooterVisible ? 34 : 10);
  const legendLeftX = 18;
  const legendLeftBaseY = Math.max(topBarRect.bottom + 12, factoryBounds.y + factoryBounds.height + 12);
  const legendLeftY = Math.max(topBarRect.bottom + 12, Math.min(legendLeftBaseY, H - legendHeight - 80));
  const legendX = useRightLegend ? legendRightX : legendLeftX;
  const legendY = useRightLegend ? legendRightY : legendLeftY;

  const legendBg = scene.add.graphics().setDepth(7);
  legendBg.fillStyle(HUD_PANEL_BG, 0.8);
  legendBg.fillRoundedRect(legendX, legendY, legendWidth, legendHeight, 12);
  legendBg.lineStyle(1, HUD_PANEL_STROKE, 0.92);
  legendBg.strokeRoundedRect(legendX, legendY, legendWidth, legendHeight, 12);

  const legendTitle = scene.add.text(legendX + 16, legendY + 14, 'LEGEND', {
    fontSize: '11px',
    fontStyle: 'bold',
    fontFamily: HUD_FONT,
    color: '#8ea6f2',
  }).setDepth(8);
  const legendSwatches = scene.add.graphics().setDepth(8);
  const legendBaseY = legendY + 46;
  const legendRows = [
    { label: 'Player', kind: 'player' },
    { label: 'Stalkers', kind: 'stalker' },
    { label: 'Bandits', kind: 'bandit' },
    { label: 'Offline NPC', kind: 'offline' },
    { label: 'Online NPC', kind: 'online' },
    { label: 'Online switch radius', kind: 'onlineRing' },
    { label: 'Alert radius', kind: 'alertRing' },
    { label: 'Combat radius', kind: 'combatRing' },
  ] as const;
  const legendColumnWidth = legendColumns > 1 ? Math.round((legendWidth - 30) / legendColumns) : legendWidth;
  const legendLines = legendRows.map((row, index) => {
    const col = legendColumns > 1 ? Math.floor(index / legendRowsPerColumn) : 0;
    const rowInColumn = index % legendRowsPerColumn;
    const rowX = legendX + 16 + col * legendColumnWidth;
    const swatchX = rowX + 8;
    const rowY = legendBaseY + legendLineGap * rowInColumn;
    switch (row.kind) {
      case 'player':
        legendSwatches.fillStyle(0xeef3ff, 1);
        legendSwatches.fillCircle(swatchX, rowY + 9, 6);
        break;
      case 'stalker':
        legendSwatches.fillStyle(0x2f80ed, 1);
        legendSwatches.fillRoundedRect(swatchX - 6, rowY + 9 - 6, 12, 12, 2);
        break;
      case 'bandit':
        legendSwatches.fillStyle(0xd44d5c, 1);
        legendSwatches.fillRoundedRect(swatchX - 6, rowY + 9 - 6, 12, 12, 2);
        break;
      case 'offline':
        legendSwatches.fillStyle(0x2f80ed, 0.35);
        legendSwatches.fillRoundedRect(swatchX - 6, rowY + 9 - 6, 12, 12, 2);
        break;
      case 'online':
        legendSwatches.fillStyle(0x2f80ed, 1);
        legendSwatches.fillRoundedRect(swatchX - 6, rowY + 9 - 6, 12, 12, 2);
        legendSwatches.lineStyle(1, 0x93c5ff, 0.9);
        legendSwatches.strokeRoundedRect(swatchX - 8, rowY + 9 - 8, 16, 16, 3);
        break;
      case 'onlineRing':
        legendSwatches.lineStyle(2, 0x00e5ff, 0.85);
        legendSwatches.strokeCircle(swatchX, rowY + 9, 6);
        break;
      case 'alertRing':
        legendSwatches.lineStyle(2, 0xffd84d, 0.85);
        legendSwatches.strokeCircle(swatchX, rowY + 9, 6);
        break;
      case 'combatRing':
        legendSwatches.lineStyle(2, 0xff7a2f, 0.85);
        legendSwatches.strokeCircle(swatchX, rowY + 9, 6);
        break;
    }
    return scene.add.text(rowX + 18, rowY, row.label, {
      fontSize: compactHud ? '10px' : '12px',
      fontFamily: HUD_FONT,
      color: '#d0d6f4',
    }).setDepth(8);
  });
  const legendFooter = legendFooterVisible
    ? scene.add.text(legendX + 16, legendBaseY + legendLineGap * legendRows.length + 8, 'Bottom ticker: world state and online count', {
      fontSize: '11px',
      fontFamily: HUD_FONT,
      color: '#7e89b5',
    }).setDepth(8)
    : null;
  const legendUi: Phaser.GameObjects.GameObject[] = [legendBg, legendTitle, legendSwatches, ...legendLines];
  if (legendFooter) legendUi.push(legendFooter);
  helpUi.push(...legendUi);

  const tickerBg = scene.add.graphics().setDepth(7);
  const tickText = scene.add.text(0, 0, '', {
    fontSize: '13px',
    fontStyle: 'bold',
    fontFamily: HUD_FONT,
    color: '#d8e1ff',
  }).setOrigin(0.5).setDepth(8);
  const eventLogText = scene.add.text(0, 0, '', {
    fontSize: '10px',
    fontFamily: HUD_FONT,
    color: '#8b98c8',
  }).setOrigin(0.5).setDepth(8).setVisible(false);

  const layoutTicker = (): void => {
    const paddingX = 18;
    const bottomMargin = 14;
    const tickerX = 12;
    const hasEvent = eventLogText.text.trim().length > 0;
    const contentWidth = Math.max(
      tickText.width,
      hasEvent ? eventLogText.width : 0,
      280,
    );
    const width = Math.ceil(contentWidth + paddingX * 2);
    const height = hasEvent ? 56 : 38;
    const y = H - bottomMargin - height;
    const centerX = tickerX + width / 2;

    tickerBg.clear();
    tickerBg.fillStyle(0x071127, 0.92);
    tickerBg.fillRoundedRect(tickerX, y, width, height, 12);
    tickerBg.lineStyle(1, 0x4a76ff, 0.92);
    tickerBg.strokeRoundedRect(tickerX, y, width, height, 12);

    if (hasEvent) {
      tickText.setPosition(centerX, y + 17);
      eventLogText.setVisible(true).setPosition(centerX, y + 37);
      return;
    }

    tickText.setPosition(centerX, y + height / 2);
    eventLogText.setVisible(false);
  };
  layoutTicker();

  const panelBg = scene.add.graphics().setDepth(7);
  panelBg.fillStyle(HUD_PANEL_BG, 0.84);
  panelBg.fillRoundedRect(panelX - 12, panelY, panelWidth, panelHeight, 10);
  panelBg.lineStyle(1, HUD_PANEL_STROKE, 0.92);
  panelBg.strokeRoundedRect(panelX - 12, panelY, panelWidth, panelHeight, 10);
  scene.add.text(panelX, panelY + 12, 'AI DEBUG', {
    fontSize: '12px',
    fontStyle: 'bold',
    fontFamily: HUD_FONT,
    color: '#8ea6f2',
  }).setDepth(8);
  const aiOverlay = scene.add.text(panelX, panelY + 32, '', {
    fontSize: '11px',
    fontFamily: HUD_FONT,
    color: '#d0d6f4',
    wordWrap: { width: panelWidth - 20 },
    lineSpacing: 4,
  }).setDepth(8);

  const playerDeadText = scene.add.text(W / 2, H / 2, 'YOU DIED\nClick to respawn', {
    fontSize: '34px',
    fontStyle: 'bold',
    fontFamily: HUD_FONT,
    color: '#ff6666',
    align: 'center',
  }).setOrigin(0.5).setDepth(10).setVisible(false);

  return {
    hpGraphics,
    hudGraphics,
    onlineRadiusGfx,
    dangerGfx,
    aiOverlay,
    eventLogText,
    tickText,
    tickerBg,
    playerDeadText,
    playerHpText,
    helpUi,
    layoutTicker,
  };
}

