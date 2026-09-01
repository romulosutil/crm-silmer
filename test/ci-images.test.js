import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const rootUrl = new URL('../', import.meta.url);

/** @param {string} path */
async function text(path) {
  return readFile(new URL(path, rootUrl), 'utf8');
}

/** @param {string} path */
async function json(path) {
  return JSON.parse(await text(path));
}

test('pins the approved browser and accessibility test dependencies', async () => {
  const packageJson = await json('package.json');

  assert.equal(packageJson.devDependencies['@playwright/test'], '1.62.1');
  assert.equal(packageJson.devDependencies['@axe-core/playwright'], '4.13.0');
  assert.equal(packageJson.scripts['test:e2e'], 'playwright test');
  assert.match(packageJson.scripts.validate, /npm test/u);
});

test('builds minimal non-root images from immutable official bases', async () => {
  for (const path of [
    'docker/edge-web.Dockerfile',
    'docker/runtime.Dockerfile',
  ]) {
    const dockerfile = await text(path);
    const fromLines = dockerfile
      .split('\n')
      .filter((line) => line.startsWith('FROM '));

    assert.ok(fromLines.length > 0, `${path} must declare a base image`);
    assert.ok(
      fromLines.every((line) => /@sha256:[a-f0-9]{64}(?:\s|$)/u.test(line)),
      `${path} must pin every base by digest`,
    );
    assert.doesNotMatch(dockerfile, /\blatest\b/u);
    assert.match(dockerfile, /HEALTHCHECK/u);
    assert.match(dockerfile, /USER (?:nginx|node)/u);
  }

  assert.match(await text('docker/edge-web.Dockerfile'), /\/healthz/u);
});

test('routes the edge proxy to the canonical API service', async () => {
  const nginx = await text('docker/nginx.conf');

  assert.match(nginx, /http:\/\/silmer-api:3000/u);
  assert.doesNotMatch(nginx, /http:\/\/api:3000/u);
  assert.match(nginx, /Content-Security-Policy/u);
  assert.match(nginx, /Strict-Transport-Security/u);
  assert.match(nginx, /X-Content-Type-Options "nosniff"/u);
  assert.match(nginx, /X-Frame-Options "DENY"/u);
});

test('packages every runtime workspace required by the API', async () => {
  const dockerfile = await text('docker/runtime.Dockerfile');
  const buildScript = await text('scripts/build.mjs');

  assert.match(dockerfile, /rm -rf \/usr\/local\/lib\/node_modules\/npm/u);

  assert.equal(
    dockerfile.match(/COPY modules\/database\/package\.json/gu)?.length,
    2,
    'both dependency stages need the database workspace manifest',
  );
  assert.match(buildScript, /modules\/database\/src/u);
  assert.match(buildScript, /modules\/database\/migrations/u);
  assert.match(buildScript, /modules\/database\/package\.json/u);

  assert.equal(
    dockerfile.match(/COPY modules\/integration-reliability\/package\.json/gu)
      ?.length,
    2,
    'both dependency stages need the integration reliability workspace manifest',
  );
  assert.match(buildScript, /modules\/integration-reliability\/src/u);
  assert.match(buildScript, /modules\/integration-reliability\/package\.json/u);
});

test('scans each local OCI layout before its only registry publication', async () => {
  const workflow = await text('.github/workflows/ci.yml');
  const actionRefs = [
    ...workflow.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gmu),
  ].map(([, ref]) => ref);

  assert.ok(actionRefs.length >= 8);
  assert.ok(
    actionRefs.every((ref) => /@[a-f0-9]{40}$/u.test(ref)),
    'all third-party Actions must use a full commit SHA',
  );
  assert.equal(
    actionRefs.filter((ref) => ref.startsWith('docker/build-push-action@'))
      .length,
    1,
  );
  assert.match(workflow, /npm ci/u);
  assert.match(workflow, /npm run validate/u);
  assert.match(workflow, /npm run test:e2e/u);
  assert.match(workflow, /npm audit --audit-level=high/u);
  assert.match(workflow, /git diff --check/u);
  assert.doesNotMatch(
    workflow,
    /paths-ignore:\s+- graphify-out\/\*\*/u,
    'Graphify-only commits must still produce required branch checks',
  );
  assert.match(workflow, /timeout-minutes:\s*30/u);
  assert.match(workflow, /timeout-minutes:\s*45/u);
  assert.equal(workflow.match(/version:\s*v0\.36\.1/gu)?.length, 1);
  assert.match(workflow, /image=moby\/buildkit@sha256:[a-f0-9]{64}/u);
  assert.match(
    workflow,
    /images:[\s\S]+permissions:\s+contents:\s+read\s+packages:\s+write/u,
  );
  assert.match(workflow, /aquasecurity\/trivy-action@[a-f0-9]{40}/u);
  assert.match(
    workflow,
    /RELEASE_TAG: ghcr\.io\/\$\{\{ github\.repository \}\}\/\$\{\{ matrix\.image \}\}:\$\{\{ github\.sha \}\}/u,
  );
  const buildIndex = workflow.indexOf('Build one local OCI layout');
  const scanIndex = workflow.indexOf('Scan local OCI layout with Trivy');
  const publishIndex = workflow.indexOf(
    'Publish the scanned OCI layout without rebuilding',
  );
  assert.ok(buildIndex >= 0 && buildIndex < scanIndex);
  assert.ok(scanIndex < publishIndex);
  assert.match(
    workflow,
    /outputs:\s*type=oci,dest=\/tmp\/\$\{\{ matrix\.image \}\}-oci,tar=false/u,
  );
  assert.match(workflow, /input:\s*\/tmp\/\$\{\{ matrix\.image \}\}-oci/u);
  assert.doesNotMatch(workflow, /\/candidates\//u);
  assert.match(workflow, /skopeo copy --all --preserve-digests/u);
  assert.match(
    workflow,
    /EXPECTED_DIGEST:\s*\$\{\{ steps\.build\.outputs\.digest \}\}/u,
  );
  assert.match(workflow, /test "\$release_digest" = "\$EXPECTED_DIGEST"/u);
  assert.match(workflow, /docker buildx imagetools inspect/u);
  assert.match(workflow, /sbom:\s*\$\{\{ github\.event_name == 'push' \}\}/u);
  assert.match(
    workflow,
    /provenance:\s*\$\{\{ github\.event_name == 'push' && 'mode=max' \|\| false \}\}/u,
  );
  assert.doesNotMatch(workflow, /:\s*latest\b|:latest\b/u);
});

test('promotes one approved SHA as identical dev and hml digest references', async () => {
  const workflow = await text('.github/workflows/promote-approved-sha.yml');

  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /approved_sha:/u);
  assert.match(workflow, /environment:\s*t00-2-promotion/u);
  assert.match(workflow, /timeout-minutes:\s*10/u);
  assert.equal(workflow.match(/version:\s*v0\.36\.1/gu)?.length, 1);
  assert.match(workflow, /image=moby\/buildkit@sha256:[a-f0-9]{64}/u);
  assert.match(workflow, /actions:\s*read/u);
  assert.match(workflow, /gh api --method GET/u);
  assert.match(workflow, /head_sha="\$APPROVED_SHA"/u);
  assert.match(workflow, /\.conclusion == "success"/u);
  assert.match(workflow, /\.head_branch == "master"/u);
  assert.match(workflow, /\^\[0-9a-f\]\{40\}\$/u);
  assert.match(workflow, /gh run download "\$CI_RUN_ID"/u);
  assert.match(workflow, /digest-edge-web-\$APPROVED_SHA/u);
  assert.match(workflow, /digest-runtime-\$APPROVED_SHA/u);
  assert.match(workflow, /test "\$edge_registry_digest" = "\$edge_digest"/u);
  assert.match(
    workflow,
    /test "\$runtime_registry_digest" = "\$runtime_digest"/u,
  );
  assert.match(workflow, /docker buildx imagetools inspect/u);
  assert.match(workflow, /edge_ref="\$REGISTRY_ROOT\/edge-web@\$edge_digest"/u);
  assert.match(
    workflow,
    /runtime_ref="\$REGISTRY_ROOT\/runtime@\$runtime_digest"/u,
  );
  assert.match(workflow, /EDGE_WEB_DEV=%s.+"\$edge_ref"/u);
  assert.match(workflow, /EDGE_WEB_HML=%s.+"\$edge_ref"/u);
  assert.match(workflow, /RUNTIME_DEV=%s.+"\$runtime_ref"/u);
  assert.match(workflow, /RUNTIME_HML=%s.+"\$runtime_ref"/u);
  assert.doesNotMatch(workflow, /docker build(?:\s|$)|docker buildx build/u);
  assert.doesNotMatch(workflow, /:\s*latest\b|:latest\b/u);
});

test('documents single-owner governance for the public repository', async () => {
  const codeOwners = await text('.github/CODEOWNERS');
  const security = await text('.github/SECURITY.md');
  const dependabot = await text('.github/dependabot.yml');
  const contributing = await text('CONTRIBUTING.md');

  assert.match(codeOwners, /^\* @romulosutil$/mu);
  assert.match(codeOwners, /^\/\.github\/ @romulosutil$/mu);
  assert.match(security, /Security > Report a vulnerability/u);
  assert.match(security, /dados sint[eé]ticos/u);
  assert.match(dependabot, /package-ecosystem:\s*npm/u);
  assert.match(dependabot, /package-ecosystem:\s*github-actions/u);
  assert.match(dependabot, /package-ecosystem:\s*docker/u);
  assert.match(contributing, /@romulosutil.+único mantenedor/su);
  assert.match(contributing, /proíbe aprovar o próprio PR/u);
});

test('documents T00.2 as supply-chain enablement, not MSG behavior', async () => {
  const supplyChain = await text('docs/phase0/SUPPLY-CHAIN.md');

  assert.match(supplyChain, /T00\.2/u);
  assert.match(supplyChain, /MSG-02/u);
  assert.match(supplyChain, /MSG-03/u);
  assert.match(supplyChain, /enabler/u);
  assert.match(supplyChain, /n[aã]o satisfaz/u);
  assert.match(supplyChain, /Trivy/u);
  assert.match(supplyChain, /CI/u);
  assert.match(supplyChain, /runtime/u);
  assert.match(supplyChain, /dev.+hml|hml.+dev/su);
});
