# Downloads

A minimal static file-sharing page for GitHub Pages.

## Publishing a file

1. Drop it in `files/`
2. Commit and push

The page reads `files/` through the GitHub API at load time, so no manifest or
rebuild step is needed — the file appears on the site as soon as it's pushed.

## One-time setup

```bash
git remote add origin https://github.com/arjun10g/<repo>.git
git branch -M main
git push -u origin main
```

Then in the repo: **Settings → Pages → Source: Deploy from a branch → `main` / `/ (root)`**.

Live at `https://arjun10g.github.io/<repo>/`.

## Notes

- Owner and repo are detected from the URL, so nothing needs configuring after a
  rename. `FALLBACK` in `app.js` is only used when previewing locally.
- The repo must be public for the API listing and download links to work.
- GitHub's file size limit is 100 MB (warning at 50 MB).
- Unauthenticated API calls are limited to 60/hour per visitor IP.
