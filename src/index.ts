import cv from '@u4/opencv4nodejs';
import adbkit, { Client, DeviceClient } from 'adbkit-repack';
import { createWriteStream } from 'fs';
import { Images } from './types/images.type';
import { wait } from './utils';
import { getImagePath } from './utils/getImagePath';

class GameAutomation {
  private client: Client;
  private device?: DeviceClient;
  private currentImageLoop: number | null = null;
  private loopCount: number = 0;
  private isInBattle: boolean = false;
  private isInBattleCount: number = 0;
  private pause: boolean = false;

  private readonly firstTroop = { x: 680, y: 2024 };
  private readonly upgradeMenu = { x: 330, y: 2178 };
  private readonly upgradeProduction = { x: 852, y: 1307 };
  private readonly battleMenu = { x: 543, y: 2178 };

  constructor() {
    this.client = adbkit.createClient({ host: '127.0.0.1', port: 5037 });
  }

  async initialize() {
    const devices = await this.client.listDevices();
    const firstDevice = devices?.[0];

    if (!firstDevice) {
      console.log('No devices connected');
      return false;
    }

    this.device = new DeviceClient(this.client, firstDevice.id);
    this.setupPauseHandler();
    this.isInBattle = await this.checkIfIsInBattle();
    return true;
  }

  private setupPauseHandler() {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', (key) => {
      if (key.toString() === 'p') {
        this.pause = !this.pause;
        console.log(this.pause ? 'Paused' : 'Resumed');
      }
    });
  }

  private async screenshot(): Promise<void> {
    return new Promise(async (resolve, reject) => {
      if (!this.device) {
        console.error('No device connected');
        reject(new Error('No device connected'));
        return;
      }

      const screencap = await this.device.screencap();
      const outStream = createWriteStream('./screencap.png');

      screencap.pipe(outStream);
      outStream.on('finish', () => resolve());
      outStream.on('error', (err) => {
        console.error('Error saving screencap', err);
        reject(err);
      });
    });
  }

  private async analyzeImage(
    image: Images,
    refreshImage = false
  ): Promise<{ x: number; y: number } | null> {
    if (
      refreshImage ||
      this.currentImageLoop === null ||
      this.currentImageLoop !== this.loopCount
    ) {
      await this.screenshot();
      this.currentImageLoop = this.loopCount;
    }

    const mat = cv.imread('./screencap.png');
    const buttonTemplate = cv.imread(getImagePath(image));
    const matched = mat.matchTemplate(buttonTemplate, cv.TM_CCOEFF_NORMED);
    const {
      maxLoc: { x, y },
      maxVal,
    } = matched.minMaxLoc();

    const matchThreshold = 0.7;
    console.log(image, maxVal);

    if (maxVal < matchThreshold) {
      return null;
    }

    const buttonCenterX = x + buttonTemplate.cols / 2;
    const buttonCenterY = y + buttonTemplate.rows / 2;

    return { x: buttonCenterX, y: buttonCenterY };
  }

  private async touchScreen(x: number, y: number): Promise<void> {
    if (!this.device) {
      console.error('No device connected');
      return;
    }

    await this.device.shell(`input tap ${x} ${y}`);
  }

  private async createFirstUnit(): Promise<void> {
    await this.touchScreen(this.firstTroop.x, this.firstTroop.y);
  }

  private async checkIfIsInBattle(): Promise<boolean> {
    await this.screenshot();
    const isInBattle = await this.analyzeImage('is-in-battle.png');
    return !!isInBattle;
  }

  private async checkIfIsOnMenu(): Promise<boolean> {
    await this.screenshot();
    const isOnMarketMenu = await this.analyzeImage('market-menu-button.png');
    return !!isOnMarketMenu;
  }

  private async handleBattleState(): Promise<void> {
    this.isInBattleCount++;
    await this.createFirstUnit();

    if (this.isInBattleCount >= 100) {
      await this.screenshot();
      const closeBattleButton = await this.analyzeImage(
        'close-battle-button.png'
      );
      this.isInBattle = await this.checkIfIsInBattle();

      if (closeBattleButton) {
        await this.exitBattle(closeBattleButton);
        this.isInBattle = false;
      }

      this.isInBattleCount = 0;
    }
  }

  private async exitBattle(closeBattleButton: {
    x: number;
    y: number;
  }): Promise<void> {
    let isOnMenu = false;
    while (!isOnMenu) {
      await this.touchScreen(closeBattleButton.x, closeBattleButton.y);
      await wait(500);
      isOnMenu = await this.checkIfIsOnMenu();
    }

    const areYouStuckButton = await this.analyzeImage(
      'are-you-stuck-button.png'
    );
    if (areYouStuckButton) {
      await this.touchScreen(areYouStuckButton.x, areYouStuckButton.y);
    }
  }

  private async handleMenuState(): Promise<void> {
    const areYouStuckButton = await this.analyzeImage(
      'are-you-stuck-button.png'
    );
    if (areYouStuckButton) {
      await this.touchScreen(areYouStuckButton.x, areYouStuckButton.y);
    }

    await this.upgradeAndStartBattle();
  }

  private async upgradeAndStartBattle(): Promise<void> {
    await this.touchScreen(this.upgradeMenu.x, this.upgradeMenu.y);
    await wait(400);

    for (let i = 0; i < 3; i++) {
      await this.touchScreen(
        this.upgradeProduction.x,
        this.upgradeProduction.y
      );
      await wait(200);
    }

    await wait(400);
    await this.touchScreen(this.battleMenu.x, this.battleMenu.y);

    await this.screenshot();
    const battleButton = await this.analyzeImage(
      'start-battle-button.png',
      true
    );

    if (battleButton) {
      while (!this.isInBattle) {
        await this.touchScreen(battleButton.x, battleButton.y);
        this.isInBattle = await this.checkIfIsInBattle();
      }
    }
  }

  async run(): Promise<void> {
    const startTime = Date.now();

    while (true) {
      if (this.pause) {
        await wait(100);
        continue;
      }

      if (this.loopCount > 10000) {
        const endTime = Date.now();
        console.log(`Loop ran for ${endTime - startTime} milliseconds`);
        this.isInBattle = await this.checkIfIsInBattle();
      }

      if (this.isInBattle) {
        await this.handleBattleState();
        continue;
      }

      const isOnMarketMenu = await this.checkIfIsOnMenu();

      if (isOnMarketMenu) {
        await this.handleMenuState();
      } else {
        this.isInBattle = true;
        const areYouStuckButton = await this.analyzeImage(
          'are-you-stuck-button.png'
        );
        if (areYouStuckButton) {
          await this.touchScreen(areYouStuckButton.x, areYouStuckButton.y);
        }
      }

      this.loopCount++;
    }
  }
}

(async () => {
  try {
    const gameAutomation = new GameAutomation();
    const initialized = await gameAutomation.initialize();
    if (initialized) {
      await gameAutomation.run();
    }
  } catch (error) {
    console.error(error);
  }
})();
