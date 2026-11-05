// GitHub Pages serves the UI. The upload service receives files for GitHub archiving.
const UPLOAD_API = 'https://files-zip-inbox-arjun10g.wintry-duck-3190.chatgpt.site';
const FALLBACK = { owner: 'arjun10g', repo: 'files' };
const DIR = 'files';
const MAX_ZIP_SIZE = 25 * 1024 * 1024;

function target() {
  const host = location.hostname;
  if (host.endsWith('.github.io')) {
    const owner = host.split('.')[0];
    const segment = location.pathname.split('/').filter(Boolean)[0];
    return { owner, repo: segment && segment !== 'index.html' ? segment : host };
  }
  return FALLBACK;
}

const fmtSize = n => {
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
};

const listEl = document.getElementById('list');
const statusEl = document.getElementById('status');
const qEl = document.getElementById('q');
const uploadsListEl = document.getElementById('uploads-list');
const uploadsStatusEl = document.getElementById('uploads-status');
const refreshButton = document.getElementById('refresh-uploads');
const uploadForm = document.getElementById('upload-form');
const uploadFields = document.getElementById('upload-fields');
const fileInput = document.getElementById('zip-file');
const dropZone = document.getElementById('drop-zone');
const fileInfo = document.getElementById('file-info');
const uploadButton = document.getElementById('upload-button');
const uploadProgress = document.getElementById('upload-progress');
const uploadStatus = document.getElementById('upload-status');
const receipt = document.getElementById('upload-receipt');
const receiptId = document.getElementById('receipt-id');
const receiptDownload = document.getElementById('receipt-download');
let items = [];
let selectedFile = null;
let uploading = false;
let receiptTimer;
let receiptGeneration = 0;
let listGeneration = 0;

function renderDownloads() {
  const query = qEl.value.trim().toLowerCase();
  const shown = query ? items.filter(file => file.name.toLowerCase().includes(query)) : items;
  listEl.replaceChildren(...shown.map(file => {
    const li = document.createElement('li');
    const link = document.createElement('a');
    link.href = file.url;
    link.download = file.name;
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = file.name;
    link.append(name);
    const dot = file.name.lastIndexOf('.');
    if (dot > 0) {
      const extension = document.createElement('span');
      extension.className = 'ext';
      extension.textContent = file.name.slice(dot + 1);
      link.append(extension);
    }
    const size = document.createElement('span');
    size.className = 'size';
    size.textContent = fmtSize(file.size);
    link.append(size);
    li.append(link);
    return li;
  }));
  statusEl.textContent = shown.length ? '' : (items.length ? 'No matches.' : 'No files yet.');
}

async function loadDownloads(owner, repo) {
  try {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${DIR}`);
    if (!response.ok) throw new Error(response.status === 404 ? `No ${DIR}/ directory in ${owner}/${repo} yet.` : `GitHub API error ${response.status}`);
    items = (await response.json())
      .filter(file => file.type === 'file' && file.name !== '.gitkeep')
      .map(file => ({ name: file.name, size: file.size, url: file.download_url }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    renderDownloads();
  } catch (error) {
    statusEl.textContent = error.message;
  }
}

function githubAssetUrl(value) {
  try {
    const url = new URL(value);
    const releasePath = /^\/arjun10g\/files\/releases\/download\/[^/]+\/[^/]+$/i;
    return url.origin === 'https://github.com' && !url.username && !url.password && !url.search && !url.hash && releasePath.test(url.pathname) ? url.href : null;
  } catch {
    return null;
  }
}

async function getUploadData(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${UPLOAD_API}${path}`, { signal: controller.signal });
    if (!response.ok) throw new Error('The upload service is temporarily unavailable.');
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function renderUploads(uploads) {
  const rows = uploads
    .filter(item => item && typeof item.name === 'string' && ['pending', 'stored'].includes(item.status))
    .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0))
    .slice(0, 50)
    .map(item => {
      const url = item.status === 'stored' ? githubAssetUrl(item.url) : null;
      const li = document.createElement('li');
      li.className = 'upload-item';
      const row = document.createElement(url ? 'a' : 'div');
      row.className = url ? 'upload-download' : 'upload-row';
      if (url) {
        row.href = url;
        row.download = item.name;
      }
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = item.name;
      const size = document.createElement('span');
      size.className = 'size';
      size.textContent = Number.isFinite(item.size) && item.size >= 0 ? fmtSize(item.size) : 'ZIP';
      row.append(name, size);
      const meta = document.createElement('div');
      meta.className = 'upload-meta';
      const state = item.status === 'pending' ? 'Received · waiting for GitHub archive' : (url ? 'Stored on GitHub' : 'Stored · archive link unavailable');
      const date = new Date(item.createdAt);
      meta.textContent = `${state}${Number.isNaN(date.getTime()) ? '' : ` · ${date.toLocaleString()}`}`;
      li.append(row, meta);
      return li;
    });
  uploadsListEl.replaceChildren(...rows);
  uploadsStatusEl.textContent = rows.length ? '' : 'No ZIP files received yet.';
}

async function loadUploads() {
  const generation = ++listGeneration;
  refreshButton.disabled = true;
  try {
    const data = await getUploadData('/api/received');
    if (!Array.isArray(data.uploads)) throw new Error('Invalid upload list.');
    if (generation === listGeneration) renderUploads(data.uploads);
  } catch {
    if (generation === listGeneration) uploadsStatusEl.textContent = 'Received ZIPs could not be loaded. Try Refresh in a moment.';
  } finally {
    if (generation === listGeneration) refreshButton.disabled = false;
  }
}

function setUploadStatus(message, state = '') {
  uploadStatus.textContent = message;
  uploadStatus.dataset.state = state;
}

function selectFile(files) {
  if (uploading) return;
  // A new selection owns the form status; older receipts remain in Received ZIPs.
  receiptGeneration++;
  clearTimeout(receiptTimer);
  receipt.hidden = true;
  selectedFile = null;
  uploadButton.disabled = true;
  fileInput.removeAttribute('aria-invalid');
  const file = files[0];
  let error = '';
  if (files.length !== 1) error = 'Choose one ZIP file at a time.';
  else if (!/\.zip$/i.test(file.name)) error = 'Please choose a ZIP file (.zip).';
  else if (!file.size) error = 'This file is empty. Choose a ZIP with content.';
  else if (file.size > MAX_ZIP_SIZE) error = 'This ZIP is too large. The maximum size is 25 MB.';
  if (error) {
    fileInput.value = '';
    fileInput.setAttribute('aria-invalid', 'true');
    fileInfo.textContent = 'No file selected.';
    setUploadStatus(error, 'error');
    return;
  }
  selectedFile = file;
  fileInfo.textContent = `${file.name} · ${fmtSize(file.size)}`;
  uploadButton.disabled = false;
  setUploadStatus('Ready to upload.');
}

function showReceipt(data, fallbackName) {
  receipt.hidden = false;
  receiptId.textContent = `Receipt: ${data.id}`;
  const url = data.status === 'stored' ? githubAssetUrl(data.url) : null;
  receiptDownload.hidden = !url;
  if (url) receiptDownload.href = url;
  else receiptDownload.removeAttribute('href');
  const name = data.name || fallbackName;
  if (data.status === 'stored') {
    setUploadStatus(`${name} is stored on GitHub.${url ? '' : ' Find it using the GitHub archive link below.'}`, 'success');
  } else {
    setUploadStatus(`We received ${name}. Waiting for the GitHub archive; you can leave this page.`, 'success');
  }
}

function pollReceipt(id, name, generation) {
  clearTimeout(receiptTimer);
  receiptTimer = setTimeout(async () => {
    if (generation !== receiptGeneration) return;
    let complete = false;
    try {
      const data = await getUploadData(`/api/uploads/${encodeURIComponent(id)}`);
      if (generation !== receiptGeneration) return;
      if (!['pending', 'stored'].includes(data.status)) throw new Error('Unknown archive status.');
      showReceipt({ ...data, id }, name);
      complete = data.status === 'stored';
      await loadUploads();
    } catch {
      if (generation === receiptGeneration) setUploadStatus('Your ZIP was received. Archive status is temporarily unavailable; check Received ZIPs shortly.', 'success');
    }
    if (!complete && generation === receiptGeneration) pollReceipt(id, name, generation);
  }, document.hidden ? 60000 : 10000);
}

function uploadFile(file) {
  uploading = true;
  const generation = ++receiptGeneration;
  clearTimeout(receiptTimer);
  receipt.hidden = true;
  uploadFields.disabled = true;
  uploadButton.textContent = 'Uploading…';
  uploadProgress.hidden = false;
  uploadProgress.value = 0;
  setUploadStatus('Uploading your ZIP…');
  const request = new XMLHttpRequest();
  request.open('POST', `${UPLOAD_API}/api/uploads`);
  request.responseType = 'json';
  request.timeout = 180000;
  request.setRequestHeader('Content-Type', 'application/zip');
  request.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
  request.upload.addEventListener('progress', event => {
    if (!event.lengthComputable) return;
    const progress = Math.min(100, Math.round(event.loaded / event.total * 100));
    uploadProgress.value = progress;
    setUploadStatus(progress === 100 ? 'Upload sent. Confirming receipt…' : `Uploading your ZIP… ${progress}%`);
  });
  const finish = () => {
    uploading = false;
    uploadFields.disabled = false;
    uploadButton.textContent = 'Upload ZIP';
    uploadButton.disabled = !selectedFile;
    uploadProgress.hidden = true;
  };
  request.addEventListener('load', () => {
    finish();
    const data = request.response;
    if (request.status < 200 || request.status >= 300) {
      const message = typeof data?.error === 'string' ? data.error : (request.status === 429 ? 'Too many uploads. Please wait a moment and try again.' : 'Your ZIP could not be received. Please try again.');
      setUploadStatus(message, 'error');
      return;
    }
    if (!data || typeof data.id !== 'string' || !data.id || !['pending', 'stored'].includes(data.status)) {
      setUploadStatus('The service returned an incomplete receipt. Check Received ZIPs before trying again.', 'error');
      loadUploads();
      return;
    }
    selectedFile = null;
    fileInput.value = '';
    fileInfo.textContent = 'No file selected.';
    uploadButton.disabled = true;
    showReceipt(data, file.name);
    loadUploads();
    if (data.status !== 'stored') pollReceipt(data.id, data.name || file.name, generation);
  });
  request.addEventListener('error', () => {
    finish();
    setUploadStatus('The upload connection failed. Check Received ZIPs before trying again, or use the GitHub link below.', 'error');
  });
  request.addEventListener('timeout', () => {
    finish();
    setUploadStatus('The upload timed out. Check Received ZIPs before trying again.', 'error');
  });
  request.send(file);
}

fileInput.addEventListener('change', () => {
  if (fileInput.files.length) selectFile(fileInput.files);
});
for (const name of ['dragenter', 'dragover']) {
  dropZone.addEventListener(name, event => {
    event.preventDefault();
    if (!uploading) dropZone.classList.add('is-dragging');
  });
}
for (const name of ['dragleave', 'drop']) {
  dropZone.addEventListener(name, event => {
    event.preventDefault();
    dropZone.classList.remove('is-dragging');
    if (name === 'drop' && !uploading) selectFile(event.dataTransfer.files);
  });
}
document.addEventListener('dragover', event => {
  if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
});
document.addEventListener('drop', event => {
  if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
});
uploadForm.addEventListener('submit', event => {
  event.preventDefault();
  if (uploading) return;
  if (!selectedFile) {
    setUploadStatus('Choose a ZIP file first.', 'error');
    fileInput.focus();
    return;
  }
  uploadFile(selectedFile);
});

const { owner, repo } = target();
document.getElementById('repo-link').href = `https://github.com/${owner}/${repo}`;
document.getElementById('upload-link').href = `https://github.com/${owner}/${repo}/issues/1`;
qEl.addEventListener('input', renderDownloads);
refreshButton.addEventListener('click', loadUploads);
uploadFields.disabled = false;
loadDownloads(owner, repo);
loadUploads();
