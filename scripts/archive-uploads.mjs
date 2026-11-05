import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const MAX_BYTES = 25 * 1024 * 1024;
const ASSETS_PER_RELEASE = 900;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function validateUpload(upload) {
  if (!upload || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{7,99}$/.test(upload.id || '')) {
    throw new Error('Invalid queued upload ID.');
  }
  if (!Number.isSafeInteger(upload.size) || upload.size < 4 || upload.size > MAX_BYTES ||
      !/^[a-f0-9]{64}$/i.test(upload.sha256 || '') ||
      typeof upload.name !== 'string' || !/\.zip$/i.test(upload.name) ||
      !Number.isFinite(Date.parse(upload.createdAt))) {
    throw new Error('Invalid queued upload metadata.');
  }
  return upload;
}

async function boundedBytes(response) {
  if (Number(response.headers.get('content-length')) > MAX_BYTES) {
    await response.body?.cancel();
    throw new Error('ZIP exceeds the archive size limit.');
  }
  if (!response.body) throw new Error('ZIP response has no body.');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        throw new Error('ZIP exceeds the archive size limit.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

export async function archiveUploads({
  backendUrl, queueSecret, githubToken, repository, fetchImpl = fetch, log = console.log,
  now = Date.now(),
}) {
  const backend = new URL(backendUrl);
  if (backend.protocol !== 'https:' || backend.username || backend.password ||
      backend.pathname !== '/' || backend.search || backend.hash) {
    throw new Error('UPLOAD_BACKEND_URL must be an HTTPS origin.');
  }
  if (!queueSecret || !githubToken || !/^[\w.-]+\/[\w.-]+$/.test(repository || '')) {
    throw new Error('Missing archive configuration.');
  }
  const repoPath = `/repos/${repository}`;
  const releases = new Map();
  const request = async (service, path, options = {}) => {
    const isBackend = service === 'backend';
    const origin = isBackend ? backend.origin : service === 'upload'
      ? 'https://uploads.github.com' : 'https://api.github.com';
    const response = await fetchImpl(`${origin}${path}`, {
      ...options,
      redirect: 'error',
      signal: AbortSignal.timeout(120_000),
      headers: {
        authorization: `Bearer ${isBackend ? queueSecret : githubToken}`,
        ...(isBackend ? {} : {
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2026-03-10',
          'user-agent': 'files-zip-archive',
        }),
        ...options.headers,
      },
    });
    return response;
  };
  const json = async (service, path, options, allowed = []) => {
    const response = await request(service, path, options);
    if (!response.ok && !allowed.includes(response.status)) {
      throw new Error(`${service === 'backend' ? 'Upload backend' : 'GitHub'} request failed (${response.status}).`);
    }
    if (!response.ok) return { status: response.status };
    return response.status === 204 ? null : response.json();
  };

  async function releaseFor(tag) {
    if (releases.has(tag)) return releases.get(tag);
    let release = await json('github', `${repoPath}/releases/tags/${tag}`, undefined, [404]);
    if (release.status === 404) {
      release = await json('github', `${repoPath}/releases`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tag_name: tag, name: `Received ZIPs — ${tag.slice(8)}`,
          body: 'Files received through the GitHub Pages upload form.',
          draft: false, prerelease: false, make_latest: 'false',
        }),
      }, [422]);
      if (release.status === 422) {
        release = await json('github', `${repoPath}/releases/tags/${tag}`);
      }
    }
    if (!Number.isSafeInteger(release.id) || release.id <= 0) throw new Error('Invalid release response.');
    const assets = [];
    for (let page = 1; page <= 11; page++) {
      const batch = await json('github', `${repoPath}/releases/${release.id}/assets?per_page=100&page=${page}`);
      if (!Array.isArray(batch)) throw new Error('Invalid asset list.');
      assets.push(...batch);
      if (batch.length < 100) break;
      if (page === 11) throw new Error('Release has an unexpected number of assets.');
    }
    const value = { ...release, assets };
    releases.set(tag, value);
    return value;
  }

  function downloadUrl(asset, upload) {
    const url = new URL(asset.browser_download_url);
    if (url.origin !== 'https://github.com' || url.search || url.hash ||
        !url.pathname.toLowerCase().startsWith(`/${repository}/releases/download/`.toLowerCase()) ||
        url.pathname.split('/').at(-1) !== `${upload.id}.zip`) {
      throw new Error('Invalid GitHub asset download URL.');
    }
    return url.href;
  }

  async function verifyAsset(asset, upload) {
    if (asset.state !== 'uploaded' || asset.size !== upload.size ||
        !Number.isSafeInteger(asset.id) || asset.id <= 0) {
      throw new Error('GitHub asset is not fully uploaded with the expected size.');
    }
    const url = downloadUrl(asset, upload);
    if (asset.digest) {
      if (asset.digest.toLowerCase() !== `sha256:${upload.sha256.toLowerCase()}`) {
        throw new Error('GitHub asset checksum does not match the queued ZIP.');
      }
    } else {
      // Older assets may lack an API digest. Verify public bytes without credentials.
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(120_000) });
      if (!response.ok) throw new Error('Could not verify the stored GitHub asset.');
      const bytes = await boundedBytes(response);
      if (bytes.length !== upload.size || digest(bytes) !== upload.sha256.toLowerCase()) {
        throw new Error('GitHub asset checksum does not match the queued ZIP.');
      }
    }
    return url;
  }

  async function archiveOne(upload) {
    validateUpload(upload);
    const name = `${upload.id}.zip`;
    const month = new Date(upload.createdAt).toISOString().slice(0, 7);
    for (let shard = 1; shard <= 100; shard++) {
      const tag = `uploads-${month}${shard === 1 ? '' : `-${shard}`}`;
      const release = await releaseFor(tag);
      let asset = release.assets.find(item => item.name === name);
      if (asset?.state === 'starter') {
        await json('github', `${repoPath}/releases/assets/${asset.id}`, { method: 'DELETE' });
        release.assets = release.assets.filter(item => item.id !== asset.id);
        asset = null;
      }
      if (!asset && (release.immutable || release.assets.length >= ASSETS_PER_RELEASE)) continue;
      if (!asset) {
        const response = await request('backend', `/internal/files/${upload.id}`);
        if (!response.ok) throw new Error(`Queued ZIP download failed (${response.status}).`);
        const bytes = await boundedBytes(response);
        if (bytes.length !== upload.size || digest(bytes) !== upload.sha256.toLowerCase()) {
          throw new Error('Queued ZIP checksum does not match its receipt.');
        }
        const query = new URLSearchParams({ name, label: upload.name.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 250) });
        asset = await json('upload', `${repoPath}/releases/${release.id}/assets?${query}`, {
          method: 'POST', headers: { 'content-type': 'application/zip', 'content-length': String(bytes.length) },
          body: bytes,
        });
        release.assets.push(asset);
      }
      const url = await verifyAsset(asset, upload);
      await json('backend', `/internal/ack/${upload.id}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }),
      });
      log(`Archived ${upload.id}.`);
      return;
    }
    throw new Error('Monthly release capacity reached.');
  }

  async function updateHealth(archived, batchSize) {
    const path = `${repoPath}/contents/.github/upload-archive-status.json`;
    const existing = await json('github', path, undefined, [404]);
    if (existing.status !== 404 && typeof existing.content === 'string' && existing.content.length < 4096) {
      try {
        const previous = JSON.parse(Buffer.from(existing.content, 'base64').toString('utf8'));
        const age = now - Date.parse(previous.lastSuccessfulScan);
        if (age >= 0 && age < 6 * 24 * 60 * 60 * 1000) return;
      } catch { /* Replace an invalid health record with the current successful scan. */ }
    }
    const content = JSON.stringify({
      lastSuccessfulScan: new Date(now).toISOString(),
      archivedInLastScan: archived,
      queuedInLastBatch: batchSize,
    }, null, 2) + '\n';
    await json('github', path, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: 'Update upload archive health [skip ci]',
        content: Buffer.from(content).toString('base64'),
        ...(existing.sha ? { sha: existing.sha } : {}),
      }),
    });
  }

  const pending = await json('backend', '/internal/pending');
  if (!Array.isArray(pending?.uploads) || pending.uploads.length > 10) {
    throw new Error('Invalid pending upload list.');
  }
  let archived = 0;
  let failed = 0;
  const seen = new Set();
  for (const upload of pending.uploads) {
    try {
      validateUpload(upload);
      if (seen.has(upload.id)) continue;
      seen.add(upload.id);
      await archiveOne(upload);
      archived++;
    } catch (error) {
      failed++;
      log(`A queued ZIP could not be archived: ${error.message}`);
    }
  }
  log(`${archived} ZIP(s) archived; ${failed} failed.`);
  if (failed) throw new Error('Some uploads remain queued for a future retry.');
  // A small weekly health commit also prevents inactivity from disabling the schedule.
  await updateHealth(archived, pending.uploads.length);
  return { archived };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  archiveUploads({
    backendUrl: process.env.UPLOAD_BACKEND_URL,
    queueSecret: process.env.UPLOAD_QUEUE_SECRET,
    githubToken: process.env.GITHUB_TOKEN,
    repository: process.env.GITHUB_REPOSITORY,
  }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
