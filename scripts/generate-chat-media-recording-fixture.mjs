// Synthetic oscillator only: never records a microphone or a user's browser.
/* global AudioContext, MediaRecorder, Blob */
import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const browser = await chromium.launch({
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
try {
  const page = await browser.newPage();
  const recording = await page.evaluate(async () => {
    const context = new AudioContext();
    await context.resume();
    const tone = context.createOscillator();
    const destination = context.createMediaStreamDestination();
    tone.connect(destination);
    tone.frequency.value = 440;
    const recorder = new MediaRecorder(destination.stream, {
      mimeType: 'audio/webm;codecs=opus',
    });
    /** @type {Blob[]} */
    const chunks = [];
    recorder.addEventListener('dataavailable', (event) =>
      chunks.push(event.data),
    );
    const stopped = new Promise((complete) =>
      recorder.addEventListener('stop', complete),
    );
    tone.start();
    recorder.start(100);
    await new Promise((complete) => setTimeout(complete, 1200));
    recorder.stop();
    await stopped;
    tone.stop();
    for (const track of destination.stream.getTracks()) track.stop();
    await context.close();
    return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
  });
  const bytes = Buffer.from(recording);
  const directory = resolve('var/tooling');
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, 'chromium-media-recorder.webm'), bytes);
  console.log(
    JSON.stringify({
      synthetic: true,
      browser: browser.version(),
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }),
  );
} finally {
  await browser.close();
}
