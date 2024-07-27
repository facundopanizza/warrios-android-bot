import adbkit, { DeviceClient } from 'adbkit-repack';
import { wait } from './utils';
import { createWriteStream } from 'fs';
import cv from '@u4/opencv4nodejs';
import { getImagePath } from './utils/getImagePath';
import { Images } from './types/images.type';

(async () => {
  try {
    const client = adbkit.createClient({
      host: '127.0.0.1',
      port: 5037,
    });

    const devices = await client.listDevices();
    const firstDevice = devices?.[0];

    if (!firstDevice) {
      console.log('No devices connected');
      return;
    }

    const device = new DeviceClient(client, firstDevice.id);

    const firstTroop = {
      x: 680,
      y: 2024,
    };

    const upgradeMenu = {
      x: 330,
      y: 2178,
    };

    const upgradeProduction = {
      x: 852,
      y: 1307,
    };

    const battleMenu = {
      x: 543,
      y: 2178,
    };

    let pause = false;

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', (key) => {
      if (key.toString() === 'p') {
        pause = !pause;

        if (pause) {
          console.log('Paused');
        } else {
          console.log('Resumed');
        }
      }
    });

    const screenshot = async () => {
      await new Promise(async (resolve, reject) => {
        const screencap = await device.screencap();
        const outStream = createWriteStream('./screencap.png');
        screencap.pipe(outStream);
        outStream.on('finish', () => {
          resolve(true);
        });
        outStream.on('error', (err) => {
          console.error('Error saving screencap', err);
          reject(err);
        });
      });
    };

    async function analyzeImage(image: Images) {
      const mat = cv.imread('./screencap.png');
      const buttonTemplate = cv.imread(getImagePath(image));
      const matched = mat.matchTemplate(buttonTemplate, cv.TM_CCOEFF_NORMED);
      const minMax = matched.minMaxLoc();
      const {
        maxLoc: { x, y },
        maxVal,
      } = minMax;

      const matchThreshold = 0.7;

      if (maxVal < matchThreshold) {
        return null;
      }

      const buttonCenterX = x + buttonTemplate.cols / 2;
      const buttonCenterY = y + buttonTemplate.rows / 2;

      return { x: buttonCenterX, y: buttonCenterY };
    }

    const touchScreen = async (x: number, y: number) => {
      await device.shell(`input tap ${x} ${y}`);
    };

    const createFirstUnit = async () => {
      await touchScreen(firstTroop.x, firstTroop.y);
    };

    const checkIfIsInBattle = async (): Promise<boolean> => {
      await screenshot();
      const isInBattle = await analyzeImage('is-in-battle.png');

      return !!isInBattle;
    };

    const checkIfIsOnMenu = async (): Promise<boolean> => {
      await screenshot();
      const isOnMarketMenu = await analyzeImage('market-menu-button.png');

      return !!isOnMarketMenu;
    };

    let isInBattle = await checkIfIsInBattle();
    let loopNumber = 0;

    while (true) {
      if (pause) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }

      if (isInBattle) {
        loopNumber++;
        await createFirstUnit();

        if (loopNumber >= 100) {
          await screenshot();

          const closeBattleButton = await analyzeImage(
            'close-battle-button.png'
          );
          isInBattle = await checkIfIsInBattle();

          if (closeBattleButton) {
            let isOnMenu = false;

            while (isOnMenu === false) {
              const { x, y } = closeBattleButton;
              await touchScreen(x, y);

              await wait(500);

              isOnMenu = await checkIfIsOnMenu();
            }

            isInBattle = false;
          }

          loopNumber = 0;
        }

        continue;
      }

      const isOnMarketMenu = await checkIfIsOnMenu();

      if (isOnMarketMenu) {
        await touchScreen(upgradeMenu.x, upgradeMenu.y);

        await wait(400);

        await touchScreen(upgradeProduction.x, upgradeProduction.y);
        await wait(200);
        await touchScreen(upgradeProduction.x, upgradeProduction.y);
        await wait(200);
        await touchScreen(upgradeProduction.x, upgradeProduction.y);

        await wait(400);

        await touchScreen(battleMenu.x, battleMenu.y);

        await screenshot();
        const battleButton = await analyzeImage('start-battle-button.png');

        if (battleButton) {
          while (!isInBattle) {
            await touchScreen(battleButton.x, battleButton.y);
            isInBattle = await checkIfIsInBattle();
          }
        }
      }
    }
  } catch (error) {
    console.error(error);
  }
})();
