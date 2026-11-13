# Notes for coding agents

Fresh sessions only see this repository: not earlier chats, requests or reasoning. So the repo
has to carry the context.

## Keep notes in `docs/` as you work

- **Write down progress and design as you go, not only at the end.** When you investigate a bug,
  make a design decision, rule something out or leave work unfinished, record it in `docs/`
  (`docs/design.md` for the overall design and milestones, or a topic file such as
  `docs/audio.md`) and commit it with the work.
- Record **why**, not just what: the evidence, the alternatives you considered and why they lost,
  what you could not verify (e.g. no speakers or no macOS in the sandbox), and open questions or
  decisions the owner still has to make.
- If you can't fix something fundamentally, say so in the docs, explain why, and list the design
  decisions that would unblock it.
- Keep the docs current: update or delete notes that your change makes stale. Link topic files
  from `docs/design.md`.
- Read `docs/design.md` and any topic file for the area you touch before changing it.

## Workflow

- Solo project: commit and push straight to `main` (no PRs). Every push deploys to GitHub Pages.
- Commit in small steps with descriptive messages; push docs updates along with the code.

## Checks

```sh
cd app && npm ci && npx tsc -b && npx oxlint && npx vitest run && npm run build
cd pipeline && uv sync && uv run pytest -q && uv run ruff check . && uv run ruff format --check .
```

## Layout

- `app/`: Vite + React + TypeScript game (see README "Repository layout").
- `data/zh-en/`: committed language pack, built by `pipeline/` (`uv run langmap build`).
- `pipeline/`: offline, deterministic Python build; see `pipeline/README.md`.
- `docs/design.md`: design notes, decisions and milestones; `docs/audio.md`: speech/audio.
