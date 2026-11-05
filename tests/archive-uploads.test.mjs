import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { archiveUploads, validateUpload } from '../scripts/archive-uploads.mjs';

const bytes = Buffer.from('PK\x03\x04archive-test');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const upload = {
  id: '1793836800000-705777e5-7769-4786-b187-dd7ec5fd4dc4',
  name: 'My submitted ZIP.zip', size: bytes.length, sha256,
  createdAt: '2026-11-05T00:00:00.000Z',
};
const now = Date.parse('2026-11-05T02:00:00.000Z');
const assetFor = (id = 20, tag = 'uploads-2026-11') => ({
  id, name: `${upload.id}.zip`, size: bytes.length, state: 'uploaded',
  digest: `sha256:${sha256}`,
  browser_download_url: `https://github.com/Arjun10g/files/releases/download/${tag}/${upload.id}.zip`,
});

function fixture(options = {}) {
  const state = {
    pending: options.empty ? [] : [structuredClone(upload)],
    releases: new Map(), uploads: 0, downloads: 0, acknowledgements: 0,
    deletes: 0, healthWrites: 0, publicChecks: 0, ackFailure: !!options.ackFailure,
    health: options.staleHealth ? null : { lastSuccessfulScan: new Date(now - 60_000).toISOString() },
  };
  if (options.assets) state.releases.set('uploads-2026-11', { id: 1, assets: options.assets, immutable: !!options.immutable });
  const fetchImpl = async (input, config = {}) => {
    const url = new URL(input);
    const method = config.method || 'GET';
    const response = (body, status = 200) => Response.json(body, { status });
    if (url.origin === 'https://uploads.example') {
      assert.equal(config.headers.authorization, 'Bearer queue-secret');
      assert.equal(config.redirect, 'error');
      if (url.pathname === '/internal/pending') return response({ uploads: state.pending });
      if (url.pathname.startsWith('/internal/files/')) {
        state.downloads++;
        return new Response(options.corrupt ? Buffer.from('bad ZIP contents') : bytes);
      }
      if (url.pathname.startsWith('/internal/ack/')) {
        assert.equal(method, 'POST');
        assert.match(JSON.parse(config.body).url, /^https:\/\/github.com\/Arjun10g\/files\/releases\/download\//);
        if (state.ackFailure) {
          state.ackFailure = false;
          return response({}, 500);
        }
        state.acknowledgements++;
        state.pending = [];
        return response({});
      }
    }
    if (url.origin === 'https://github.com') {
      state.publicChecks++;
      assert.equal(config.headers?.authorization, undefined);
      return new Response(bytes);
    }
    assert.equal(config.headers.authorization, 'Bearer github-secret');
    assert.ok(['https://api.github.com', 'https://uploads.github.com'].includes(url.origin));
    if (url.pathname.endsWith('/contents/.github/upload-archive-status.json')) {
      if (method === 'GET') return state.health
        ? response({ sha: 'old-sha', content: Buffer.from(JSON.stringify(state.health)).toString('base64') })
        : response({}, 404);
      const payload = JSON.parse(config.body);
      state.health = JSON.parse(Buffer.from(payload.content, 'base64').toString());
      state.healthWrites++;
      return response({}, 201);
    }
    const byTag = url.pathname.match(/\/releases\/tags\/([^/]+)$/);
    if (byTag) {
      const release = state.releases.get(byTag[1]);
      return release ? response(release) : response({}, 404);
    }
    if (url.pathname.endsWith('/releases') && method === 'POST') {
      const payload = JSON.parse(config.body);
      assert.equal(payload.make_latest, 'false');
      const release = { id: state.releases.size + 1, assets: [], immutable: false };
      state.releases.set(payload.tag_name, release);
      return response(release, 201);
    }
    const assets = url.pathname.match(/\/releases\/(\d+)\/assets$/);
    if (assets) {
      const [tag, release] = [...state.releases].find(([, item]) => item.id === Number(assets[1]));
      if (method === 'GET') {
        const page = Number(url.searchParams.get('page'));
        return response(release.assets.slice((page - 1) * 100, page * 100));
      }
      state.uploads++;
      assert.deepEqual(Buffer.from(config.body), bytes);
      assert.equal(url.searchParams.get('label'), upload.name);
      const asset = assetFor(50, tag);
      release.assets.push(asset);
      return response(asset, 201);
    }
    const remove = url.pathname.match(/\/releases\/assets\/(\d+)$/);
    if (remove && method === 'DELETE') {
      state.deletes++;
      for (const release of state.releases.values()) release.assets = release.assets.filter(item => item.id !== Number(remove[1]));
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected mocked request: ${method} ${url.pathname}`);
  };
  return {
    state,
    run: () => archiveUploads({
      backendUrl: 'https://uploads.example', queueSecret: 'queue-secret',
      githubToken: 'github-secret', repository: 'Arjun10g/files', fetchImpl, now, log() {},
    }),
  };
}

test('archives verified ZIP bytes and acknowledges only after storage succeeds', async () => {
  const { state, run } = fixture();
  assert.deepEqual(await run(), { archived: 1 });
  assert.equal(state.downloads, 1);
  assert.equal(state.uploads, 1);
  assert.equal(state.acknowledgements, 1);
  assert.equal(state.healthWrites, 0);
});

test('an ACK failure retries without uploading the same asset twice', async () => {
  const { state, run } = fixture({ ackFailure: true });
  await assert.rejects(run(), /remain queued/);
  assert.equal(state.pending.length, 1);
  await run();
  assert.equal(state.uploads, 1);
  assert.equal(state.downloads, 1);
  assert.equal(state.acknowledgements, 1);
});

test('does not overwrite or acknowledge a mismatched existing asset', async () => {
  const existing = { ...assetFor(), digest: `sha256:${'0'.repeat(64)}` };
  const { state, run } = fixture({ assets: [existing] });
  await assert.rejects(run(), /remain queued/);
  assert.equal(state.uploads, 0);
  assert.equal(state.deletes, 0);
  assert.equal(state.acknowledgements, 0);
});

test('a corrupt queue download remains queued without upload or acknowledgement', async () => {
  const { state, run } = fixture({ corrupt: true });
  await assert.rejects(run(), /remain queued/);
  assert.equal(state.uploads, 0);
  assert.equal(state.acknowledgements, 0);
});

test('replaces only GitHub starter assets left by failed uploads', async () => {
  const { state, run } = fixture({ assets: [{ ...assetFor(), state: 'starter', size: 0 }] });
  await run();
  assert.equal(state.deletes, 1);
  assert.equal(state.uploads, 1);
  assert.equal(state.acknowledgements, 1);
});

test('rolls over a full monthly release before its asset limit', async () => {
  const assets = Array.from({ length: 900 }, (_, index) => ({ id: index + 100, name: `other-${index}.zip`, state: 'uploaded' }));
  const { state, run } = fixture({ assets });
  await run();
  assert.equal(state.releases.has('uploads-2026-11-2'), true);
  assert.equal(state.uploads, 1);
});

test('rolls over an immutable release', async () => {
  const { state, run } = fixture({ assets: [], immutable: true });
  await run();
  assert.equal(state.releases.has('uploads-2026-11-2'), true);
});

test('verifies legacy assets without a digest using unauthenticated public bytes', async () => {
  const { state, run } = fixture({ assets: [{ ...assetFor(), digest: null }] });
  await run();
  assert.equal(state.publicChecks, 1);
  assert.equal(state.uploads, 0);
});

test('empty scans write a health record only when it needs refreshing', async () => {
  const { state, run } = fixture({ empty: true, staleHealth: true });
  await run();
  await run();
  assert.equal(state.healthWrites, 1);
  assert.equal(state.health.lastSuccessfulScan, new Date(now).toISOString());
  assert.equal(state.releases.size, 0);
});

test('rejects traversal IDs and over-limit queued files', () => {
  assert.throws(() => validateUpload({ ...upload, id: '../not-a-file' }), /Invalid queued upload ID/);
  assert.throws(() => validateUpload({ ...upload, size: 25 * 1024 * 1024 + 1 }), /Invalid queued upload metadata/);
});
