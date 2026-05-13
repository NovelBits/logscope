# CLAUDE.md

LogScope is a VS Code extension for real-time embedded firmware log viewing with Bluetooth LE HCI decoding.

## Quick Reference

- **Current version**: See `package.json` `version` field (source of truth)
- **Marketplace**: `novelbits.novelbits-logscope`
- **Docs site**: https://docs.novelbits.io/logscope/ (Astro/Starlight, in `docs/`)
- **License**: MIT
- **Repo**: https://github.com/NovelBits/logscope (public)

## Architecture

- TypeScript, ESBuild (CJS + IIFE dual bundle), Jest
- Vanilla webview (no frameworks), Canvas 2D for data viz
- `src/` -- extension source, `docs/` -- documentation site
- `execFile` (never `exec`), `textContent` (never `innerHTML`), CSP nonce

## Build & Test

```bash
npm install          # install dependencies
npm run compile      # build extension
npm test             # run Jest tests
npm run package      # create .vsix
```

## Docs Site

```bash
cd docs && npm install && npm run dev    # local preview at localhost:4321/logscope/
cd docs && npm run build                 # production build
```

Docs deploy to Vercel automatically on push to main. Config in `docs/vercel.json`.

## Release Flow

**`.github/workflows/publish.yml` auto-publishes to the VS Code Marketplace on every `v*` tag push.** Do NOT also run `npx @vscode/vsce publish` locally; that creates a race where one path "wins" the publish and the other fails with "already exists". In v0.6.0 this race shipped a bloated 6.4 MB VSIX from the GHA build (before a late `.vscodeignore` fix landed), forcing a v0.6.1 republish. See the v0.6.1 CHANGELOG entry.

Canonical release flow:
1. Bump `package.json` and `package-lock.json` to the new version.
2. Add the CHANGELOG entry for that version.
3. Verify `.vscodeignore` excludes any stray local state (`.cocoindex_code/`, `.pytest_cache/`, etc.) — packagers walk the whole repo.
4. Commit the bump + CHANGELOG. Push to main.
5. `git tag -a vX.Y.Z -m "..." && git push origin vX.Y.Z`. The workflow takes over from there.
6. After the GHA run reports success, verify with `npx @vscode/vsce show novelbits.novelbits-logscope` that the new version is live.

## Cross-Repo Maintenance

**After any version bump or release**, update the NovelBits Brain knowledge base:
1. Update the version in `~/Projects/novelbits-brain` MEMORY.md (the `## LogScope` section header and recent releases list)
2. If a new feature shipped, update `~/.claude/projects/-Users-mafaneh-Projects-novelbits-brain/memory/project_logscope_pending.md` to mark it done
3. Append a log entry to `~/.claude/business/log.md`: `## [YYYY-MM-DD] deploy | LogScope vX.Y.Z`

This keeps the central knowledge base in sync with actual releases.

## Important Rules

- This is a PUBLIC repo. Never commit internal docs, credentials, API keys, or business strategy files.
- Never include AI attribution (Co-Authored-By) in commits.
- Always use "Bluetooth LE" (never "BLE").
