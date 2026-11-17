import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'vite';

const require = createRequire(import.meta.url);

// Exercise what each consumer actually loads. A renamed package or green
// advisory database alone cannot demonstrate remediation of the ReDoS.
for (const consumer of ['vite', 'tinyglobby', 'fdir']) {
  test(`OPS-DEPS-02: ${consumer} rejects single-branch extglob attacks within a bounded process`, () => {
    const consumerRequire = createRequire(require.resolve(consumer));
    const matcher = consumerRequire.resolve('picomatch');
    const result = spawnSync(
      process.execPath,
      [
        '-e',
        `
          const assert = require('node:assert/strict');
          const pm = require(process.argv[1]);
          const cases = [
            ['+(*a)', 'a'.repeat(80) + '!'],
            ['*(*a)', 'a'.repeat(80) + '!'],
            ['+(a*)', 'a'.repeat(80) + '/'],
            ['*(a*)', 'a'.repeat(80) + '/'],
            ['+(*)', 'a'.repeat(80) + '/'],
            ['*(*)', 'a'.repeat(80) + '/'],
            ['+(*)b', 'a'.repeat(80) + '!'],
            ['*(*)b', 'a'.repeat(80) + '!'],
            ['+(*a)c', 'a'.repeat(80) + '!'],
            ['+(a*b)', 'ab'.repeat(40) + '!'],
            ['+(**)', 'a'.repeat(80) + '/.'],
            ['+(**a)', 'a'.repeat(80) + '!'],
            ['+(@(*a))', 'a'.repeat(80) + '!'],
            ['+(?(*a))', 'a'.repeat(80) + '!']
          ];
          for (const options of [{}, { windows: true }, { capture: true }]) {
            for (const [pattern, input] of cases) {
              assert.equal(pm.isMatch(input, pattern, options), false, pattern);
            }
          }
          assert.equal(pm.isMatch('axbayb', '+(a*b)'), true);
          assert.equal(pm.isMatch('*a*a', '+("*a")'), true);
          assert.equal(pm.isMatch('a*ba*b', '+(a\\\\*b)'), true);
        `,
        matcher,
      ],
      { encoding: 'utf8', timeout: 5000, windowsHide: true },
    );
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
  });
}

test('OPS-DEPS-02: file discovery and Vite import.meta.glob preserve nested includes and exclusions', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'crm-picomatch-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'fixtures', 'nested'), { recursive: true });
  await Promise.all(
    ['entry.js', 'nested/Card.vue', 'nested/skip.js', '.hidden.js'].map(
      (name) => writeFile(join(root, 'fixtures', name), 'synthetic fixture'),
    ),
  );
  // Consumer declarations reference optional picomatch types that are not
  // installed by this project. Keep this runtime integration at that boundary.
  const loadConsumer = (/** @type {string} */ name) => import(name);
  const { glob, globSync } = await loadConsumer('tinyglobby');
  const options = { cwd: root, ignore: ['**/skip.js'] };
  const pattern = 'fixtures/**/*.{js,vue}';
  const expected = ['fixtures/entry.js', 'fixtures/nested/Card.vue'];
  assert.deepEqual((await glob(pattern, options)).sort(), expected);
  assert.deepEqual(globSync(pattern, options).sort(), expected);

  const { fdir } = await loadConsumer('fdir');
  assert.deepEqual(
    new fdir()
      .withRelativePaths()
      .globWithOptions([pattern], { dot: false, ignore: '**/skip.js' })
      .crawl(root)
      .sync()
      .map((/** @type {string} */ path) => path.replaceAll('\\', '/'))
      .sort(),
    expected,
  );

  const entry = join(root, 'entry.js');
  await writeFile(
    entry,
    `export default Object.keys(import.meta.glob(
      ['./fixtures/**/*.{js,vue}', '!**/skip.js'],
      { eager: true, query: '?raw', import: 'default' }
    )).sort();`,
  );
  const result = await build({
    configFile: false,
    root,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: { entry, formats: ['es'] },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  assert.equal(outputs.length, 1);
  const [output] = outputs;
  assert('output' in output);
  const chunk = output.output.find((item) => item.type === 'chunk');
  assert(chunk);
  const compiled = await import(
    `data:text/javascript;base64,${Buffer.from(chunk.code).toString('base64')}`
  );
  assert.deepEqual(
    compiled.default,
    expected.map((path) => `./${path}`),
  );
});
