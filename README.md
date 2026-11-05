# Downloads

A minimal static file-sharing page for GitHub Pages.

## Receiving a ZIP

Visitors choose or drop a ZIP on the website and click **Upload ZIP**. No GitHub
account is needed for the direct uploader. ZIPs can be up to 25 MB each; uploaded
files are public.

A separate upload API receives the ZIP and returns a receipt immediately. A
GitHub Action moves it into this repository's release assets, verifies its
SHA-256 checksum, and only then removes the temporary copy. The website shows
when a file has been received and when its GitHub download is ready. Scheduled
transfers run every five minutes, though GitHub can delay scheduled jobs.

The **Received ZIPs** list shows recent submissions. Release assets are separate
from the files published in `files/`; they are not committed into the Git history.

If the direct uploader is unavailable, visitors can still attach a ZIP to a
comment in the [upload thread](https://github.com/Arjun10g/files/issues/1). Issue
attachments stay in that thread.

## Upload service

- Frontend: <https://arjun10g.github.io/files/>
- Backend: <https://files-zip-inbox-arjun10g.wintry-duck-3190.chatgpt.site>
- Archive workflow: `.github/workflows/archive-uploads.yml`
- Archive implementation: `scripts/archive-uploads.mjs`

The backend uses temporary object storage provisioned by Sites. Its source is
maintained in the companion **Files ZIP upload API** Sites project; the local
checkout is `.upload-backend/`. Permanent files live in GitHub releases.
The service accepts up to five uploads per hour per address when the edge
provides an address, 100 uploads per day overall, and 100 queued files. These
bounds keep temporary storage small; pending files are retained until archived.

GitHub Actions uses its short-lived, repository-scoped `GITHUB_TOKEN`. The backend
does not receive a personal GitHub token. Its queue endpoints and the workflow
share `UPLOAD_QUEUE_SECRET`, configured as an Actions secret and backend secret.
`UPLOAD_BACKEND_URL` is an Actions repository variable. No secret is included in
the Pages site or committed source.

The workflow can also be started manually from **Actions → Archive uploaded ZIPs →
Run workflow**. Failed transfers remain queued for retry. A weekly health record
keeps track of successful scans and provides repository activity so the scheduled
workflow does not lapse after a long quiet period.

## Publishing a file

1. Drop it in `files/`
2. Commit and push

The page reads `files/` through the GitHub API at load time, so no manifest or
rebuild step is needed — the file appears on the site as soon as it's pushed.

## One-time setup

```bash
git remote add origin https://github.com/arjun10g/files.git
git branch -M main
git push -u origin main
```

Then in the repo: **Settings → Pages → Source: Deploy from a branch → `main` / `/ (root)`**.

Live at `https://arjun10g.github.io/files/`.

## Notes

- Owner and repo are detected from the URL, so nothing needs configuring after a
  rename. `FALLBACK` in `app.js` is only used when previewing locally.
- The repo must be public for the API listing and download links to work.
- GitHub's file size limit is 100 MB (warning at 50 MB).
- Unauthenticated API calls are limited to 60/hour per visitor IP.
