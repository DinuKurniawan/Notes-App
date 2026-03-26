type Note = {
  id: string;
  title: string;
  content: string;
  color: string;
  tags: string[];
  checklist: ChecklistItem[];
  pinned: boolean;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
};

type ChecklistItem = {
  id: string;
  text: string;
  done: boolean;
};

type LayoutMode = "grid" | "list";
type ThemeMode = "light" | "dark";
type StatusFilter = "all" | "active" | "pinned" | "archived";
type SortField = "updatedAt" | "createdAt" | "title";
type SortOrder = "asc" | "desc";

const STORAGE_KEY = "notes-app-data-v1";
const PREFS_KEY = "notes-app-prefs-v1";

type AppState = {
  notes: Note[];
  query: string;
  tagFilter: string;
  statusFilter: StatusFilter;
  sortField: SortField;
  sortOrder: SortOrder;
  layout: LayoutMode;
  theme: ThemeMode;
  editingId: string | null;
};

function must<T>(value: T | null, selector: string): T {
  if (!value) {
    throw new Error(`Required DOM element missing: ${selector}`);
  }
  return value;
}

const form = must(document.querySelector<HTMLFormElement>("#noteForm"), "#noteForm");
const titleInput = must(document.querySelector<HTMLInputElement>("#titleInput"), "#titleInput");
const contentInput = must(document.querySelector<HTMLTextAreaElement>("#contentInput"), "#contentInput");
const colorInput = must(document.querySelector<HTMLInputElement>("#colorInput"), "#colorInput");
const tagsInput = must(document.querySelector<HTMLInputElement>("#tagsInput"), "#tagsInput");
const checklistInput = must(document.querySelector<HTMLTextAreaElement>("#checklistInput"), "#checklistInput");
const searchInput = must(document.querySelector<HTMLInputElement>("#searchInput"), "#searchInput");
const tagFilter = must(document.querySelector<HTMLSelectElement>("#tagFilter"), "#tagFilter");
const statusFilter = must(document.querySelector<HTMLSelectElement>("#statusFilter"), "#statusFilter");
const sortBy = must(document.querySelector<HTMLSelectElement>("#sortBy"), "#sortBy");
const notesContainer = must(document.querySelector<HTMLElement>("#notesContainer"), "#notesContainer");
const themeToggle = must(document.querySelector<HTMLButtonElement>("#themeToggle"), "#themeToggle");
const layoutToggle = must(document.querySelector<HTMLButtonElement>("#layoutToggle"), "#layoutToggle");

const prefs = loadPrefs();

const state: AppState = {
  notes: loadNotes(),
  query: "",
  tagFilter: "",
  statusFilter: "all",
  sortField: "updatedAt",
  sortOrder: "desc",
  layout: prefs.layout ?? "grid",
  theme: prefs.theme ?? "light",
  editingId: null
};

applyTheme();
wireEvents();
render();

function wireEvents(): void {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const title = titleInput.value.trim();
    const content = contentInput.value.trim();

    if (!title || !content) {
      alert("Title and content are required.");
      return;
    }

    if (state.editingId) {
      updateNote(state.editingId, {
        title,
        content,
        color: colorInput.value,
        tags: parseTags(tagsInput.value),
        checklist: parseChecklist(checklistInput.value)
      });
      state.editingId = null;
    } else {
      createNote({
        title,
        content,
        color: colorInput.value,
        tags: parseTags(tagsInput.value),
        checklist: parseChecklist(checklistInput.value)
      });
    }

    form.reset();
    colorInput.value = "#fef3c7";
    render();
  });

  searchInput.addEventListener("input", () => {
    state.query = searchInput.value.trim().toLowerCase();
    render();
  });

  tagFilter.addEventListener("change", () => {
    state.tagFilter = tagFilter.value;
    render();
  });

  statusFilter.addEventListener("change", () => {
    state.statusFilter = (statusFilter.value as StatusFilter) ?? "all";
    render();
  });

  sortBy.addEventListener("change", () => {
    const [field, order] = sortBy.value.split("-") as [SortField, SortOrder];
    state.sortField = field;
    state.sortOrder = order;
    render();
  });

  themeToggle.addEventListener("click", () => {
    state.theme = state.theme === "dark" ? "light" : "dark";
    savePrefs();
    applyTheme();
  });

  layoutToggle.addEventListener("click", () => {
    state.layout = state.layout === "grid" ? "list" : "grid";
    savePrefs();
    render();
  });
}

function createNote(input: Pick<Note, "title" | "content" | "color" | "tags" | "checklist">): void {
  const now = Date.now();
  state.notes.push({
    id: crypto.randomUUID(),
    title: input.title,
    content: input.content,
    color: input.color,
    tags: input.tags,
    checklist: input.checklist,
    pinned: false,
    archived: false,
    createdAt: now,
    updatedAt: now
  });
  persistNotes();
}

function updateNote(
  id: string,
  patch: Partial<Pick<Note, "title" | "content" | "color" | "tags" | "checklist">>
): void {
  const note = state.notes.find((item) => item.id === id);
  if (!note) {
    throw new Error("Note not found for update.");
  }

  if (patch.title !== undefined) note.title = patch.title;
  if (patch.content !== undefined) note.content = patch.content;
  if (patch.color !== undefined) note.color = patch.color;
  if (patch.tags !== undefined) note.tags = patch.tags;
  if (patch.checklist !== undefined) note.checklist = patch.checklist;
  note.updatedAt = Date.now();
  persistNotes();
}

function deleteNote(id: string): void {
  state.notes = state.notes.filter((item) => item.id !== id);
  persistNotes();
}

function togglePin(id: string): void {
  const note = state.notes.find((item) => item.id === id);
  if (!note) throw new Error("Note not found for pin toggle.");
  note.pinned = !note.pinned;
  note.updatedAt = Date.now();
  persistNotes();
}

function toggleArchive(id: string): void {
  const note = state.notes.find((item) => item.id === id);
  if (!note) throw new Error("Note not found for archive toggle.");
  note.archived = !note.archived;
  note.updatedAt = Date.now();
  persistNotes();
}

function toggleChecklistItem(noteId: string, itemId: string): void {
  const note = state.notes.find((item) => item.id === noteId);
  if (!note) throw new Error("Note not found for checklist toggle.");
  const target = note.checklist.find((item) => item.id === itemId);
  if (!target) throw new Error("Checklist item not found.");
  target.done = !target.done;
  note.updatedAt = Date.now();
  persistNotes();
}

function render(): void {
  notesContainer.className = state.layout === "grid" ? "notes-grid" : "notes-list";
  layoutToggle.textContent = state.layout === "grid" ? "Grid" : "List";
  themeToggle.textContent = state.theme === "dark" ? "☀️ Light" : "🌙 Dark";

  syncTagFilter();
  const notes = getVisibleNotes();

  if (notes.length === 0) {
    notesContainer.innerHTML = '<p class="empty">No notes found.</p>';
    return;
  }

  notesContainer.innerHTML = notes
    .map((note) => {
      const tags = note.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("");
      const updated = new Date(note.updatedAt).toLocaleString();
      const title = escapeHtml(note.title);
      const content = escapeHtml(note.content);
      const readableText = getReadableTextColor(note.color);
      const readableMuted = withAlpha(readableText, 0.72);
      const readableBorder = withAlpha(readableText, 0.25);
      const readableButtonBg = withAlpha(readableText, 0.12);
      const checklist = note.checklist
        .map(
          (item) => `
            <label class="check-item">
              <input type="checkbox" data-action="check" data-id="${note.id}" data-check-id="${item.id}" ${item.done ? "checked" : ""} />
              <span class="${item.done ? "done" : ""}">${escapeHtml(item.text)}</span>
            </label>
          `
        )
        .join("");
      return `
        <article
          class="note-card"
          style="background:${note.color};--note-text:${readableText};--note-muted:${readableMuted};--note-border:${readableBorder};--note-btn-bg:${readableButtonBg};"
        >
          <div class="note-header">
            <h3 class="note-title">${title}</h3>
            <span>${note.pinned ? "📌" : ""}${note.archived ? "🗄️" : ""}</span>
          </div>
          <p>${content}</p>
          ${note.checklist.length > 0 ? `<div class="checklist">${checklist}</div>` : ""}
          <div class="tags">${tags}</div>
          <p class="meta">Updated: ${updated}</p>
          <div class="note-actions">
            <button class="btn ghost" data-action="edit" data-id="${note.id}" type="button">Edit</button>
            <button class="btn ghost" data-action="pin" data-id="${note.id}" type="button">${note.pinned ? "Unpin" : "Pin"}</button>
            <button class="btn ghost" data-action="archive" data-id="${note.id}" type="button">${note.archived ? "Unarchive" : "Archive"}</button>
            <button class="btn danger" data-action="delete" data-id="${note.id}" type="button">Delete</button>
          </div>
        </article>
      `;
    })
    .join("");

  bindCardActions();
}

function bindCardActions(): void {
  const actionButtons = notesContainer.querySelectorAll<HTMLButtonElement>("button[data-action]");
  actionButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.action;
      const id = button.dataset.id;
      if (!action || !id) return;

      switch (action) {
        case "edit":
          startEdit(id);
          break;
        case "pin":
          togglePin(id);
          render();
          break;
        case "archive":
          toggleArchive(id);
          render();
          break;
        case "delete":
          deleteNote(id);
          render();
          break;
        default:
          throw new Error(`Unhandled action: ${action}`);
      }
    });
  });

  const checklistBoxes = notesContainer.querySelectorAll<HTMLInputElement>("input[data-action='check']");
  checklistBoxes.forEach((box) => {
    box.addEventListener("change", () => {
      const noteId = box.dataset.id;
      const checkId = box.dataset.checkId;
      if (!noteId || !checkId) return;
      toggleChecklistItem(noteId, checkId);
      render();
    });
  });
}

function startEdit(id: string): void {
  const note = state.notes.find((item) => item.id === id);
  if (!note) throw new Error("Note not found for edit.");
  state.editingId = id;
  titleInput.value = note.title;
  contentInput.value = note.content;
  colorInput.value = note.color;
  tagsInput.value = note.tags.join(", ");
  checklistInput.value = note.checklist.map((item) => item.text).join("\n");
  titleInput.focus();
}

function getVisibleNotes(): Note[] {
  const filtered = state.notes.filter((note) => {
    const q = state.query;
    const textMatch =
      !q ||
      note.title.toLowerCase().includes(q) ||
      note.content.toLowerCase().includes(q) ||
      note.tags.some((tag) => tag.toLowerCase().includes(q)) ||
      note.checklist.some((item) => item.text.toLowerCase().includes(q));
    const tagMatch = !state.tagFilter || note.tags.includes(state.tagFilter);
    const statusMatch =
      state.statusFilter === "all" ||
      (state.statusFilter === "active" && !note.archived) ||
      (state.statusFilter === "pinned" && note.pinned) ||
      (state.statusFilter === "archived" && note.archived);
    return textMatch && tagMatch && statusMatch;
  });

  filtered.sort((left, right) => {
    if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
    const factor = state.sortOrder === "asc" ? 1 : -1;
    if (state.sortField === "title") return left.title.localeCompare(right.title) * factor;
    return (left[state.sortField] - right[state.sortField]) * factor;
  });

  return filtered;
}

function syncTagFilter(): void {
  const previous = state.tagFilter;
  const tags = Array.from(
    new Set(
      state.notes
        .flatMap((note) => note.tags)
        .map((tag) => tag.trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))
    )
  );

  tagFilter.innerHTML = '<option value="">All tags</option>';
  tags.forEach((tag) => {
    const option = document.createElement("option");
    option.value = tag;
    option.textContent = tag;
    tagFilter.append(option);
  });

  if (previous && tags.includes(previous)) {
    tagFilter.value = previous;
    state.tagFilter = previous;
  } else {
    state.tagFilter = "";
    tagFilter.value = "";
  }
}

function parseTags(raw: string): string[] {
  return Array.from(new Set(raw.split(",").map((part) => part.trim()).filter(Boolean)));
}

function parseChecklist(raw: string): ChecklistItem[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((text) => ({
      id: crypto.randomUUID(),
      text,
      done: false
    }));
}

function persistNotes(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.notes));
}

function loadNotes(): Note[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];

  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Stored notes data is invalid.");
  }

  return parsed.map((item) => {
    const note = item as Partial<Note>;
    if (
      typeof note.id !== "string" ||
      typeof note.title !== "string" ||
      typeof note.content !== "string" ||
      typeof note.color !== "string" ||
      !Array.isArray(note.tags) ||
      ("checklist" in note && !Array.isArray(note.checklist)) ||
      typeof note.pinned !== "boolean" ||
      typeof note.archived !== "boolean" ||
      typeof note.createdAt !== "number" ||
      typeof note.updatedAt !== "number"
    ) {
      throw new Error("Stored note item shape is invalid.");
    }

    return {
      id: note.id,
      title: note.title,
      content: note.content,
      color: note.color,
      tags: note.tags.filter((tag): tag is string => typeof tag === "string"),
      checklist: normalizeChecklist(note.checklist),
      pinned: note.pinned,
      archived: note.archived,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt
    };
  });
}

function normalizeChecklist(value: unknown): ChecklistItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const item = entry as Partial<ChecklistItem>;
      if (typeof item.text !== "string") return null;
      return {
        id: typeof item.id === "string" ? item.id : crypto.randomUUID(),
        text: item.text,
        done: item.done === true
      };
    })
    .filter((item): item is ChecklistItem => item !== null);
}

function savePrefs(): void {
  localStorage.setItem(
    PREFS_KEY,
    JSON.stringify({
      theme: state.theme,
      layout: state.layout
    })
  );
}

function loadPrefs(): Partial<Pick<AppState, "theme" | "layout">> {
  const raw = localStorage.getItem(PREFS_KEY);
  if (!raw) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object") return {};

  const prefs = parsed as { theme?: string; layout?: string };
  const theme = prefs.theme === "dark" ? "dark" : "light";
  const layout = prefs.layout === "list" ? "list" : "grid";
  return { theme, layout };
}

function applyTheme(): void {
  document.body.classList.toggle("dark", state.theme === "dark");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getReadableTextColor(hexColor: string): string {
  const rgb = hexToRgb(hexColor);
  if (!rgb) return "#111827";
  const luminance = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
  return luminance > 0.62 ? "#111827" : "#f8fafc";
}

function withAlpha(hexColor: string, alpha: number): string {
  const rgb = hexToRgb(hexColor);
  if (!rgb) return `rgba(17, 24, 39, ${alpha})`;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

function hexToRgb(value: string): { r: number; g: number; b: number } | null {
  const hex = value.trim().replace("#", "");
  if (!/^[\da-fA-F]{6}$/.test(hex)) return null;
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  return { r, g, b };
}
