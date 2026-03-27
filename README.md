# Notes App (TypeScript)

A modern Notes App built with **TypeScript**, focused on clean logic, responsive UI, and local-first storage.

## Features

- Create, edit, trash, restore, and permanently delete notes
- Auto-save to `localStorage`
- Pin and archive notes
- Custom note color and tags
- Checklist per note (one item per line, can be checked/unchecked)
- Due date and reminder per note
- Recurring reminder (`daily` / `weekly`)
- Reminder snooze (`5m` / `10m` / `30m`)
- Undo/redo note state changes (including keyboard shortcuts)
- Export notes as readable text (`.txt`) and import backup (`.json`)
- Bulk actions for selected notes (archive/trash/restore/delete permanently)
- Trash auto-cleanup (older than 30 days)
- Stats panel (total, active, archived, pinned, overdue, trashed)
- PWA-ready (manifest + service worker offline cache)
- Search by title/content/tag
- Filter by tag and status (`all`, `active`, `pinned`, `archived`, `trashed`)
- Sort notes (updated date, created date, title)
- Grid/list layout toggle
- Dark mode toggle
- Adaptive text contrast on colored notes
- Responsive UI for desktop and mobile

## Tech Stack

- TypeScript
- HTML + CSS
- `lite-server` for local development

## Project Structure

```text
.
├─ index.html
├─ src/
│  ├─ index.ts
│  └─ styles.css
├─ dist/
├─ package.json
└─ tsconfig.json
```

## Getting Started

### 1) Install dependencies

```bash
npm install
```

### 2) Type check

```bash
npm run typecheck
```

### 3) Build

```bash
npm run build
```

### 4) Run in development mode

```bash
npm run dev
```

Then open the URL shown by `lite-server` (usually `http://localhost:3000`).

## Available Scripts

- `npm run dev` — start local dev server
- `npm run typecheck` — run TypeScript checks without emitting files
- `npm run build` — compile TypeScript from `src` to `dist`

## Data Storage

- Notes are stored in browser `localStorage` key: `notes-app-data-v1`
- UI preferences (theme/layout) are stored in key: `notes-app-prefs-v1`

## Notes

- This project is frontend-only (no backend/database yet).
- If you clear browser storage, notes and preferences will be removed.
