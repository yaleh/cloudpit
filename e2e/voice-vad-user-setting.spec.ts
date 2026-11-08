import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';

/*
 * AC-9: the user's VAD switch, end to end on a real page.
 *
 * WHAT IS REAL: the workspace menu, the Settings modal and its Voice tab, the shared preferences
 * store, the dictation hook, the mode resolver, the splitter and the request builder. Two things are
 * stand-ins, both named where they live: the microphone (an init script replaces the audio graph and
 * `getUserMedia`, so the spec can say exactly two seconds of speech then twelve of silence), and the
 * recogniser (the route below answers `/api/voice/transcribe`, so no request leaves the machine).
 *
 * WHAT IS MEASURED: how many uploads one listen made, and how long each uploaded WAV is — parsed
 * out of the request body, never re-derived from the input. With VAD off the same spoken sample
 * must go out as ONE upload whose length equals the recording (no cut, no edge trim); with it on
 * the same sample must come back to the two segments the shipping segmenter has always produced.
 *
 * THE SESSION IS THE EXISTING FIXTURE. `playwright.config.ts` seeds `voice-live-vad-workspace` and
 * its transcript before the backend scans `~/.claude/projects`; this spec opens the same
 * conversation and never writes to it.
 */

const DATA_DIR = process.env.QUAY_E2E_DATA_DIR!;
const CLIENT_URL = `http://127.0.0.1:${process.env.QUAY_E2E_CLIENT_PORT}`;
const WORKSPACE = path.join(DATA_DIR, 'voice-live-vad-workspace');
const SESSION_ID = 'e2e-voice-live-vad';
const SESSION_NAME = 'voice-live-vad';

const RATE = 16_000;
const WAV_HEADER = 44;
const UPLOAD_TIMEOUT_MS = 30_000;
/** One recorded sample: 2 s speech, 12 s silence, 2 s speech, 3 s silent tail (19 s). */
const SAMPLE_SEC = 19;

test.describe.configure({ mode: 'serial' });

test.describe('the user VAD switch end to end', () => {
  let context: BrowserContext;
  let page: Page;
  /** Every upload the recogniser stand-in saw, as its declared WAV duration in seconds. */
  const uploads: number[] = [];

  const composer = () => page.locator('[data-slot="prompt-input-textarea"]');
  const micButton = () => page.getByRole('button', { name: 'Voice input' });
  const stopButton = () => page.getByRole('button', { name: 'Stop recording' });
  const menuTrigger = () => page.locator('[data-workspace-menu-trigger]');
  const vadRow = () => page.locator('[data-workspace-menu-item="voiceVadEnabled"]');
  const settingsButton = () => page.getByRole('button', { name: 'Settings', exact: true }).first();
  const voiceTab = () => page.getByRole('button', { name: 'Voice', exact: true }).first();
  const voiceInputTab = () => page.getByTestId('voice-settings-tab-input');
  const vadSwitch = () => page.getByRole('switch', { name: 'Voice activity detection (VAD)' });
  const projectRow = () =>
    page.getByRole('button', { name: new RegExp(`^${path.basename(WORKSPACE)}`) }).first();
  const sessionLink = () => page.locator('a[href^="/session/"]').filter({ hasText: SESSION_NAME });

  const expandProject = async () => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (await sessionLink().isVisible().catch(() => false)) return;
      await projectRow().click();
      try {
        await expect(sessionLink()).toBeVisible({ timeout: 10_000 });
        return;
      } catch {
        /* collapsed again; click once more */
      }
    }
    await expect(sessionLink()).toBeVisible({ timeout: 15_000 });
  };

  /** Loads `/`, opens the seeded session, and returns with the composer ready. */
  const openSession = async () => {
    await page.goto('/');
    await expandProject();
    await sessionLink().click();
    await expect(page).toHaveURL(new RegExp(`/session/${SESSION_ID}$`));
    await expect(composer()).toBeVisible({ timeout: 15_000 });
    await composer().fill('');
  };

  /** Opens the workspace menu (if it is not already open) and returns the VAD row. */
  const openMenu = async () => {
    if (!(await vadRow().isVisible().catch(() => false))) {
      await menuTrigger().click();
    }
    await expect(vadRow()).toBeVisible({ timeout: 5_000 });
    return vadRow();
  };

  /** Flips the VAD row and waits for the save the debounce makes, so a reload sees the value. */
  const flipViaMenu = async () => {
    const saved = page
      .waitForResponse((response) => response.url().includes('/api/user/preferences'), { timeout: 8_000 })
      .catch(() => null);
    await (await openMenu()).click();
    await saved;
  };

  /** Records the reference sample through the fake microphone and waits for its upload(s). */
  const recordSample = async (): Promise<number> => {
    const before = uploads.length;
    await micButton().click();
    await expect(stopButton()).toBeVisible({ timeout: 10_000 });
    await page.evaluate(() => {
      const fake = (window as unknown as {
        __voiceFake: { speak: (seconds: number) => void; pause: (seconds: number) => void };
      }).__voiceFake;
      fake.speak(2);
      fake.pause(12);
      fake.speak(2);
      fake.pause(3);
    });
    await stopButton().click();
    await expect.poll(() => uploads.length, { timeout: UPLOAD_TIMEOUT_MS }).toBeGreaterThan(before);
    // Give a would-be second upload the chance to arrive before the count is read.
    await page.waitForTimeout(1_500);
    return uploads.length - before;
  };

  const openedSettings = async () => {
    await settingsButton().click();
    await expect(voiceTab()).toBeVisible({ timeout: 10_000 });
    await voiceTab().click();
    await expect(voiceInputTab()).toBeVisible({ timeout: 10_000 });
    await voiceInputTab().click();
  };

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(60_000);
    // The DoD's screenshot pair, written into the worktree's untracked tmp/.
    fs.mkdirSync(path.resolve(process.cwd(), 'tmp'), { recursive: true });

    context = await browser.newContext({ baseURL: CLIENT_URL });
    await context.addInitScript(
      ({ voiceConfig, preferences }) => {
        window.localStorage.setItem('voiceConfig', JSON.stringify(voiceConfig));
        window.localStorage.setItem('uiPreferences', JSON.stringify(preferences));
        window.localStorage.setItem(
          'user-preferences',
          JSON.stringify({ uiPreferences: preferences, userLanguage: 'en' }),
        );
        window.localStorage.setItem('userLanguage', 'en');

        // The fake audio graph, the same one `voice-live-vad-ab.spec.ts` drives: the hook's sink is
        // fed exact 20 ms-scale chunks with the VAD transitions posted before each one.
        type Port = { port: { onmessage: ((m: unknown) => void) | null } };
        const state: {
          node: Port | null;
          atSample: number;
          speak: (seconds: number) => void;
          pause: (seconds: number) => void;
        } = {
          node: null,
          atSample: 0,
          speak(seconds: number) {
            const node = state.node;
            if (!node) throw new Error('the fake capture was not connected yet');
            node.port.onmessage?.({ data: { type: 'event', event: { type: 'speechStart', atSample: state.atSample } } });
            push(seconds, 0.3);
          },
          pause(seconds: number, amplitude = 0) {
            const node = state.node;
            if (!node) throw new Error('the fake capture was not connected yet');
            node.port.onmessage?.({ data: { type: 'event', event: { type: 'speechEnd', atSample: state.atSample } } });
            push(seconds, amplitude);
          },
        };
        function push(seconds: number, amplitude: number): void {
          const node = state.node;
          if (!node) throw new Error('the fake capture was not connected yet');
          const count = Math.max(1, Math.round(seconds * 16_000));
          const samples = new Float32Array(count);
          samples.fill(amplitude);
          node.port.onmessage?.({ data: { type: 'pcm', samples, atSample: state.atSample } });
          state.atSample += count;
        }
        (window as unknown as { __voiceFake: typeof state }).__voiceFake = state;

        class FakeWorkletNode {
          port: { onmessage: ((m: unknown) => void) | null; postMessage: () => void };
          constructor() {
            this.port = { onmessage: null, postMessage: () => undefined };
            state.node = this as unknown as typeof state.node;
          }

          connect() {
            /* the graph is inert; the spec drives the port directly */
          }
        }

        class FakeAudioContext {
          sampleRate = 16_000;
          destination = {};
          audioWorklet = { addModule: async () => undefined };
          createGain() {
            return { gain: { value: 0 }, connect: () => undefined };
          }

          createMediaStreamSource() {
            return { connect: () => undefined };
          }

          close() {
            return Promise.resolve();
          }
        }

        (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
        (window as unknown as { AudioWorkletNode: unknown }).AudioWorkletNode = FakeWorkletNode;
        Object.defineProperty(navigator, 'mediaDevices', {
          configurable: true,
          value: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => undefined }] }) },
        });
      },
      {
        // dashscope-omni is proxy-only, so the client posts to this app's own /api/voice/transcribe.
        voiceConfig: {
          baseUrl: '',
          apiKey: '',
          sttModel: '',
          ttsModel: '',
          ttsVoice: '',
          ttsFormat: '',
          providerId: 'dashscope-omni',
          dashscopeEndpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
          dashscopeApiKey: 'sk-e2e-voice-vad-setting-fake',
          dashscopeModel: 'qwen3-asr-flash',
        },
        preferences: { voiceEnabled: true },
      },
    );

    page = await context.newPage();

    // The recogniser stand-in. It also reads the uploaded WAV's declared data length, so "how long
    // was this request" is taken from the bytes the app really sent.
    await page.route('**/api/voice/transcribe', async (route) => {
      const body = route.request().postDataBuffer();
      if (body) {
        const at = body.indexOf('RIFF');
        if (at >= 0) uploads.push(body.readUInt32LE(at + 40) / 2 / RATE);
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ text: 'a transcribed segment' }),
      });
    });

    await page.goto('/');
    let onboarded = await page.locator('#username').isVisible().catch(() => false);
    for (let attempt = 0; !onboarded && attempt < 3; attempt += 1) {
      await page.reload();
      onboarded = await page.locator('#username').isVisible().catch(() => false);
    }
    if (!onboarded) {
      const shown = await page.locator('body').innerText().catch(() => '<unreadable>');
      throw new Error(`the account form never rendered; the page shows: ${JSON.stringify(shown.slice(0, 300))}`);
    }
    await page.locator('#username').fill('e2euser');
    await page.locator('input[type=password]').nth(0).fill('e2epassword');
    if (await page.locator('#confirmPassword').isVisible().catch(() => false)) {
      await page.locator('#confirmPassword').fill('e2epassword');
      await page.getByRole('button', { name: 'Create Account' }).click();
      await page.getByPlaceholder('John Doe').fill('E2E User');
      await page.getByPlaceholder('john@example.com').fill('e2e@example.com');
      await page.getByRole('button', { name: 'Next' }).click();
      await page.getByRole('button', { name: 'Complete Setup' }).click();
    } else {
      await page.getByRole('button', { name: 'Sign In' }).click();
    }
    await expect(projectRow()).toBeVisible({ timeout: 12_000 });
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('off keeps the recording whole, survives a reload, and agrees with the Settings page', async () => {
    test.setTimeout(120_000);

    await openSession();
    await expect(await openMenu()).toHaveAttribute('aria-checked', 'true');

    // Turn the user switch off from the menu.
    await flipViaMenu();
    await expect(await openMenu()).toHaveAttribute('aria-checked', 'false');
    await page.screenshot({ path: path.resolve(process.cwd(), 'tmp/voice-vad-menu-off.png') });
    await page.keyboard.press('Escape');

    const requests = await recordSample();
    expect(requests, `VAD off must send one request, saw ${requests}: ${JSON.stringify(uploads)}`).toBe(1);
    expect(uploads[uploads.length - 1]).toBeCloseTo(SAMPLE_SEC, 1);

    // The value is in `auth.db`, so a full reload restores it in both entry points.
    await page.reload();
    await expandProject();
    await sessionLink().click();
    await expect(composer()).toBeVisible({ timeout: 15_000 });
    await expect(await openMenu()).toHaveAttribute('aria-checked', 'false');
    await page.keyboard.press('Escape');

    await openedSettings();
    await expect(vadSwitch()).toHaveAttribute('aria-checked', 'false');
    await page.screenshot({ path: path.resolve(process.cwd(), 'tmp/voice-vad-settings-off.png') });

    console.log(
      `[voice-vad-setting] arm=user-off requests=${requests} uploadSec=${uploads[uploads.length - 1].toFixed(2)}`,
    );
  });

  test('on restores the shipping segmenter, and the Settings switch follows it', async () => {
    test.setTimeout(120_000);

    await openSession();
    await flipViaMenu();
    await expect(await openMenu()).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');

    const requests = await recordSample();
    expect(requests, `VAD on must cut the sample, saw ${requests}: ${JSON.stringify(uploads)}`).toBe(2);
    const lastTwo = uploads.slice(-2);
    expect(lastTwo.reduce((total, seconds) => total + seconds, 0)).toBeLessThan(SAMPLE_SEC);

    await openedSettings();
    await expect(vadSwitch()).toHaveAttribute('aria-checked', 'true');

    console.log(
      `[voice-vad-setting] arm=user-on requests=${requests} segmentSec=${lastTwo.map((s) => s.toFixed(2)).join(',')}`,
    );
  });
});
