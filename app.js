// Lists everything in files/ by asking the GitHub API, so uploading a file is
// the only step needed to publish it. Owner/repo are derived from the URL.
const FALLBACK = { owner: 'arjun10g', repo: 'downloads' }; // used for local preview
const DIR = 'files';

function target() {
  const host = location.hostname;
  if (host.endsWith('github.io')) {
    const owner = host.split('.')[0];
    const seg = location.pathname.split('/').filter(Boolean)[0];
    // User site (arjun10g.github.io) serves from the repo of the same name.
    const repo = seg && !seg.includes('.') ? seg : host;
    return { owner, repo };
  }
  return FALLBACK;
}

const fmtSize = n => {
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${u[i]}`;
};

const listEl = document.getElementById('list');
const statusEl = document.getElementById('status');
const qEl = document.getElementById('q');
let items = [];

function render() {
  const q = qEl.value.trim().toLowerCase();
  const shown = q ? items.filter(f => f.name.toLowerCase().includes(q)) : items;
  listEl.replaceChildren(...shown.map(f => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = f.url;
    a.download = f.name;
    const dot = f.name.lastIndexOf('.');
    a.innerHTML = `<span class="name"></span>${dot > 0 ? '<span class="ext"></span>' : ''}<span class="size"></span>`;
    a.querySelector('.name').textContent = f.name;
    if (dot > 0) a.querySelector('.ext').textContent = f.name.slice(dot + 1);
    a.querySelector('.size').textContent = fmtSize(f.size);
    li.append(a);
    return li;
  }));
  statusEl.textContent = shown.length ? '' : (items.length ? 'No matches.' : 'No files yet.');
}

(async () => {
  const { owner, repo } = target();
  document.getElementById('repo-link').href = `https://github.com/${owner}/${repo}`;
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${DIR}`);
    if (!res.ok) throw new Error(res.status === 404 ? `No ${DIR}/ directory in ${owner}/${repo} yet.` : `GitHub API error ${res.status}`);
    items = (await res.json())
      .filter(f => f.type === 'file' && f.name !== '.gitkeep')
      .map(f => ({ name: f.name, size: f.size, url: f.download_url }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    render();
  } catch (e) {
    statusEl.textContent = e.message;
  }
})();

qEl.addEventListener('input', render);
