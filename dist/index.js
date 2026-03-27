"use strict";
const STORAGE_KEY = "notes-app-data-v1";
const PREFS_KEY = "notes-app-prefs-v1";
const EXPORT_VERSION = 1;
const REMINDER_POLL_MS = 30_000;
const TRASH_RETENTION_MS = 30 * 24 * 60 * 60_000;
const HISTORY_LIMIT = 50;
function must(value, selector) {
    if (!value)
        throw new Error(`Required DOM element missing: ${selector}`);
    return value;
}
const form = must(document.querySelector("#noteForm"), "#noteForm");
const titleInput = must(document.querySelector("#titleInput"), "#titleInput");
const contentInput = must(document.querySelector("#contentInput"), "#contentInput");
const colorInput = must(document.querySelector("#colorInput"), "#colorInput");
const tagsInput = must(document.querySelector("#tagsInput"), "#tagsInput");
const checklistInput = must(document.querySelector("#checklistInput"), "#checklistInput");
const dueDateInput = must(document.querySelector("#dueDateInput"), "#dueDateInput");
const dueTimeInput = must(document.querySelector("#dueTimeInput"), "#dueTimeInput");
const reminderOffsetInput = must(document.querySelector("#reminderOffsetInput"), "#reminderOffsetInput");
const recurrenceInput = must(document.querySelector("#recurrenceInput"), "#recurrenceInput");
const searchInput = must(document.querySelector("#searchInput"), "#searchInput");
const tagFilter = must(document.querySelector("#tagFilter"), "#tagFilter");
const statusFilter = must(document.querySelector("#statusFilter"), "#statusFilter");
const sortBy = must(document.querySelector("#sortBy"), "#sortBy");
const notesContainer = must(document.querySelector("#notesContainer"), "#notesContainer");
const statsPanel = must(document.querySelector("#statsPanel"), "#statsPanel");
const bulkActions = must(document.querySelector("#bulkActions"), "#bulkActions");
const themeToggle = must(document.querySelector("#themeToggle"), "#themeToggle");
const layoutToggle = must(document.querySelector("#layoutToggle"), "#layoutToggle");
const undoButton = must(document.querySelector("#undoButton"), "#undoButton");
const redoButton = must(document.querySelector("#redoButton"), "#redoButton");
const exportButton = must(document.querySelector("#exportButton"), "#exportButton");
const importButton = must(document.querySelector("#importButton"), "#importButton");
const importFileInput = must(document.querySelector("#importFileInput"), "#importFileInput");
const prefs = loadPrefs();
const state = {
    notes: loadNotes(),
    query: "",
    tagFilter: "",
    statusFilter: "all",
    sortField: "updatedAt",
    sortOrder: "desc",
    layout: prefs.layout ?? "grid",
    theme: prefs.theme ?? "light",
    editingId: null,
    historyPast: [],
    historyFuture: [],
    selectedIds: new Set()
};
applyTheme();
wireEvents();
render();
startReminderScheduler();
registerServiceWorker();
function wireEvents() {
    form.addEventListener("submit", (event) => {
        event.preventDefault();
        const title = titleInput.value.trim();
        const content = contentInput.value.trim();
        const dueAt = parseDueAtInput(dueDateInput.value, dueTimeInput.value);
        const reminderOffsetMinutes = parseReminderOffsetMinutes(reminderOffsetInput.value);
        const reminderTimes = deriveReminderTimes(dueAt, reminderOffsetMinutes);
        const recurrence = parseRecurrenceMode(recurrenceInput.value);
        if (!title || !content) {
            alert("Title and content are required.");
            return;
        }
        if (reminderTimes.remindAt !== null) {
            maybeRequestNotificationPermission();
        }
        if (state.editingId) {
            updateNote(state.editingId, {
                title,
                content,
                color: colorInput.value,
                tags: parseTags(tagsInput.value),
                checklist: parseChecklist(checklistInput.value),
                dueAt: reminderTimes.dueAt,
                remindAt: reminderTimes.remindAt,
                reminderNotifiedAt: null,
                recurrence
            });
            state.editingId = null;
        }
        else {
            createNote({
                title,
                content,
                color: colorInput.value,
                tags: parseTags(tagsInput.value),
                checklist: parseChecklist(checklistInput.value),
                dueAt: reminderTimes.dueAt,
                remindAt: reminderTimes.remindAt,
                recurrence
            });
        }
        resetForm();
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
        state.statusFilter = statusFilter.value ?? "all";
        render();
    });
    sortBy.addEventListener("change", () => {
        const [field, order] = sortBy.value.split("-");
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
    undoButton.addEventListener("click", () => undoNotesState());
    redoButton.addEventListener("click", () => redoNotesState());
    exportButton.addEventListener("click", () => exportData());
    importButton.addEventListener("click", () => importFileInput.click());
    importFileInput.addEventListener("change", async () => {
        const file = importFileInput.files?.[0];
        if (!file)
            return;
        const text = await file.text();
        importData(text);
        importFileInput.value = "";
    });
    document.addEventListener("keydown", (event) => {
        if (!event.ctrlKey && !event.metaKey)
            return;
        const key = event.key.toLowerCase();
        if (key === "z" && !event.shiftKey) {
            event.preventDefault();
            undoNotesState();
            return;
        }
        if (key === "y" || (key === "z" && event.shiftKey)) {
            event.preventDefault();
            redoNotesState();
        }
    });
}
function createNote(input) {
    runMutation(() => {
        const now = Date.now();
        state.notes.push({
            id: crypto.randomUUID(),
            title: input.title,
            content: input.content,
            color: input.color,
            tags: input.tags,
            checklist: input.checklist,
            dueAt: input.dueAt,
            remindAt: input.remindAt,
            reminderNotifiedAt: null,
            recurrence: input.recurrence,
            pinned: false,
            archived: false,
            trashedAt: null,
            createdAt: now,
            updatedAt: now
        });
    });
}
function updateNote(id, patch) {
    runMutation(() => {
        const note = findNoteOrThrow(id, "update");
        if (patch.title !== undefined)
            note.title = patch.title;
        if (patch.content !== undefined)
            note.content = patch.content;
        if (patch.color !== undefined)
            note.color = patch.color;
        if (patch.tags !== undefined)
            note.tags = patch.tags;
        if (patch.checklist !== undefined)
            note.checklist = patch.checklist;
        if (patch.dueAt !== undefined)
            note.dueAt = patch.dueAt;
        if (patch.remindAt !== undefined)
            note.remindAt = patch.remindAt;
        if (patch.reminderNotifiedAt !== undefined)
            note.reminderNotifiedAt = patch.reminderNotifiedAt;
        if (patch.recurrence !== undefined)
            note.recurrence = patch.recurrence;
        note.updatedAt = Date.now();
    });
}
function deleteNote(id) {
    runMutation(() => {
        const note = findNoteOrThrow(id, "delete");
        note.trashedAt = Date.now();
        note.archived = false;
        note.pinned = false;
        note.updatedAt = Date.now();
    });
}
function restoreNote(id) {
    runMutation(() => {
        const note = findNoteOrThrow(id, "restore");
        note.trashedAt = null;
        note.updatedAt = Date.now();
    });
}
function purgeNote(id) {
    runMutation(() => {
        const before = state.notes.length;
        state.notes = state.notes.filter((item) => item.id !== id);
        if (before === state.notes.length)
            throw new Error("Note not found for purge.");
    });
}
function togglePin(id) {
    runMutation(() => {
        const note = findNoteOrThrow(id, "pin toggle");
        note.pinned = !note.pinned;
        note.updatedAt = Date.now();
    });
}
function toggleArchive(id) {
    runMutation(() => {
        const note = findNoteOrThrow(id, "archive toggle");
        note.archived = !note.archived;
        note.updatedAt = Date.now();
    });
}
function toggleChecklistItem(noteId, itemId) {
    runMutation(() => {
        const note = findNoteOrThrow(noteId, "checklist toggle");
        const target = note.checklist.find((item) => item.id === itemId);
        if (!target)
            throw new Error("Checklist item not found.");
        target.done = !target.done;
        note.updatedAt = Date.now();
    });
}
function snoozeReminder(noteId, minutes) {
    runMutation(() => {
        const note = findNoteOrThrow(noteId, "reminder snooze");
        if (note.remindAt === null)
            throw new Error("Reminder is not configured for this note.");
        note.remindAt = Date.now() + minutes * 60_000;
        note.reminderNotifiedAt = null;
        note.updatedAt = Date.now();
    });
}
function applyBulk(action) {
    const selected = state.notes.filter((note) => state.selectedIds.has(note.id));
    if (selected.length === 0)
        return;
    runMutation(() => {
        const now = Date.now();
        if (action === "purge") {
            state.notes = state.notes.filter((note) => !state.selectedIds.has(note.id));
            return;
        }
        selected.forEach((note) => {
            if (action === "archive" && note.trashedAt === null) {
                note.archived = true;
            }
            if (action === "trash") {
                note.trashedAt = now;
                note.archived = false;
                note.pinned = false;
            }
            if (action === "restore") {
                note.trashedAt = null;
            }
            note.updatedAt = now;
        });
    });
}
function runMutation(mutator) {
    snapshotBeforeMutation();
    mutator();
    persistNotes();
    pruneSelection();
}
function findNoteOrThrow(id, operation) {
    const note = state.notes.find((item) => item.id === id);
    if (!note)
        throw new Error(`Note not found for ${operation}.`);
    return note;
}
function render() {
    notesContainer.className = state.layout === "grid" ? "notes-grid" : "notes-list";
    layoutToggle.textContent = state.layout === "grid" ? "Grid" : "List";
    themeToggle.textContent = state.theme === "dark" ? "☀️ Light" : "🌙 Dark";
    undoButton.disabled = state.historyPast.length === 0;
    redoButton.disabled = state.historyFuture.length === 0;
    syncTagFilter();
    renderStatsPanel();
    renderBulkActions();
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
        const dueMeta = getDueMeta(note);
        const checklist = note.checklist
            .map((item) => `
            <label class="check-item">
              <input type="checkbox" data-action="check" data-id="${note.id}" data-check-id="${item.id}" ${item.done ? "checked" : ""} />
              <span class="${item.done ? "done" : ""}">${escapeHtml(item.text)}</span>
            </label>
          `)
            .join("");
        const snoozeActions = note.trashedAt === null && note.remindAt !== null
            ? `
              <div class="snooze-actions">
                <button class="btn ghost" data-action="snooze" data-id="${note.id}" data-minutes="5" type="button">Snooze 5m</button>
                <button class="btn ghost" data-action="snooze" data-id="${note.id}" data-minutes="10" type="button">Snooze 10m</button>
                <button class="btn ghost" data-action="snooze" data-id="${note.id}" data-minutes="30" type="button">Snooze 30m</button>
              </div>
            `
            : "";
        return `
        <article
          class="note-card"
          style="background:${note.color};--note-text:${readableText};--note-muted:${readableMuted};--note-border:${readableBorder};--note-btn-bg:${readableButtonBg};"
        >
          <div class="note-header">
            <div class="note-header-main">
              <input
                class="note-select"
                type="checkbox"
                data-action="select-note"
                data-id="${note.id}"
                ${state.selectedIds.has(note.id) ? "checked" : ""}
              />
              <h3 class="note-title">${title}</h3>
            </div>
            <span>${note.pinned ? "📌" : ""}${note.archived ? "🗄️" : ""}${note.trashedAt ? "🗑️" : ""}</span>
          </div>
          <p>${content}</p>
          ${note.checklist.length > 0 ? `<div class="checklist">${checklist}</div>` : ""}
          <div class="tags">${tags}</div>
          ${dueMeta ? `<p class="meta${dueMeta.overdue ? " overdue" : ""}">${escapeHtml(dueMeta.text)}</p>` : ""}
          <p class="meta">Updated: ${updated}</p>
          ${note.trashedAt ? `<p class="meta">Trashed: ${new Date(note.trashedAt).toLocaleString()}</p>` : ""}
          ${snoozeActions}
          <div class="note-actions">
            <button class="btn ghost" data-action="edit" data-id="${note.id}" type="button">Edit</button>
            ${note.trashedAt ? "" : `<button class="btn ghost" data-action="pin" data-id="${note.id}" type="button">${note.pinned ? "Unpin" : "Pin"}</button>`}
            ${note.trashedAt ? "" : `<button class="btn ghost" data-action="archive" data-id="${note.id}" type="button">${note.archived ? "Unarchive" : "Archive"}</button>`}
            ${note.trashedAt
            ? `<button class="btn ghost" data-action="restore" data-id="${note.id}" type="button">Restore</button><button class="btn danger" data-action="purge" data-id="${note.id}" type="button">Delete Permanently</button>`
            : `<button class="btn danger" data-action="delete" data-id="${note.id}" type="button">Move to Trash</button>`}
          </div>
        </article>
      `;
    })
        .join("");
    bindCardActions();
}
function bindCardActions() {
    notesContainer.querySelectorAll("button[data-action]").forEach((button) => {
        button.addEventListener("click", () => {
            const action = button.dataset.action;
            const id = button.dataset.id;
            if (!action || !id)
                return;
            if (action === "snooze") {
                const minutes = Number.parseInt(button.dataset.minutes ?? "", 10);
                if (!Number.isFinite(minutes))
                    throw new Error("Invalid snooze minute value.");
                snoozeReminder(id, minutes);
                render();
                return;
            }
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
                case "restore":
                    restoreNote(id);
                    render();
                    break;
                case "purge":
                    purgeNote(id);
                    render();
                    break;
                default:
                    throw new Error(`Unhandled action: ${action}`);
            }
        });
    });
    notesContainer.querySelectorAll("input[data-action='check']").forEach((box) => {
        box.addEventListener("change", () => {
            const noteId = box.dataset.id;
            const checkId = box.dataset.checkId;
            if (!noteId || !checkId)
                return;
            toggleChecklistItem(noteId, checkId);
            render();
        });
    });
    notesContainer.querySelectorAll("input[data-action='select-note']").forEach((box) => {
        box.addEventListener("change", () => {
            const noteId = box.dataset.id;
            if (!noteId)
                return;
            if (box.checked)
                state.selectedIds.add(noteId);
            else
                state.selectedIds.delete(noteId);
            renderBulkActions();
        });
    });
}
function renderBulkActions() {
    const selectedCount = state.selectedIds.size;
    bulkActions.hidden = selectedCount === 0;
    if (selectedCount === 0) {
        bulkActions.innerHTML = "";
        return;
    }
    bulkActions.innerHTML = `
    <span class="stat-chip">${selectedCount} selected</span>
    <button class="btn ghost" data-bulk-action="archive" type="button">Archive</button>
    <button class="btn ghost" data-bulk-action="trash" type="button">Move to Trash</button>
    <button class="btn ghost" data-bulk-action="restore" type="button">Restore</button>
    <button class="btn danger" data-bulk-action="purge" type="button">Delete Permanently</button>
    <button class="btn ghost" data-bulk-action="clear" type="button">Clear Selection</button>
  `;
    bulkActions.querySelectorAll("button[data-bulk-action]").forEach((button) => {
        button.addEventListener("click", () => {
            const action = button.dataset.bulkAction;
            if (!action)
                return;
            if (action === "clear") {
                state.selectedIds.clear();
                render();
                return;
            }
            if (action === "archive" || action === "trash" || action === "restore" || action === "purge") {
                applyBulk(action);
                render();
                return;
            }
            throw new Error(`Unhandled bulk action: ${action}`);
        });
    });
}
function renderStatsPanel() {
    const now = Date.now();
    const total = state.notes.length;
    const active = state.notes.filter((n) => !n.archived && n.trashedAt === null).length;
    const archived = state.notes.filter((n) => n.archived && n.trashedAt === null).length;
    const pinned = state.notes.filter((n) => n.pinned && n.trashedAt === null).length;
    const overdue = state.notes.filter((n) => n.dueAt !== null && n.dueAt < now && !n.archived && n.trashedAt === null).length;
    const trashed = state.notes.filter((n) => n.trashedAt !== null).length;
    statsPanel.innerHTML = `
    <span class="stat-chip">Total: ${total}</span>
    <span class="stat-chip">Active: ${active}</span>
    <span class="stat-chip">Archived: ${archived}</span>
    <span class="stat-chip">Pinned: ${pinned}</span>
    <span class="stat-chip">Overdue: ${overdue}</span>
    <span class="stat-chip">Trashed: ${trashed}</span>
  `;
}
function startEdit(id) {
    const note = findNoteOrThrow(id, "edit");
    state.editingId = id;
    titleInput.value = note.title;
    contentInput.value = note.content;
    colorInput.value = note.color;
    tagsInput.value = note.tags.join(", ");
    checklistInput.value = note.checklist.map((item) => item.text).join("\n");
    const dueParts = toDueInputParts(note.dueAt);
    dueDateInput.value = dueParts.date;
    dueTimeInput.value = dueParts.time;
    reminderOffsetInput.value = inferReminderOffset(note.dueAt, note.remindAt);
    recurrenceInput.value = note.recurrence;
    titleInput.focus();
}
function resetForm() {
    form.reset();
    colorInput.value = "#fef3c7";
    dueDateInput.value = "";
    dueTimeInput.value = "";
    reminderOffsetInput.value = "none";
    recurrenceInput.value = "none";
}
function getVisibleNotes() {
    const filtered = state.notes.filter((note) => {
        const q = state.query;
        const textMatch = !q ||
            note.title.toLowerCase().includes(q) ||
            note.content.toLowerCase().includes(q) ||
            note.tags.some((tag) => tag.toLowerCase().includes(q)) ||
            note.checklist.some((item) => item.text.toLowerCase().includes(q));
        const tagMatch = !state.tagFilter || note.tags.includes(state.tagFilter);
        const statusMatch = state.statusFilter === "all" ||
            (state.statusFilter === "active" && !note.archived && note.trashedAt === null) ||
            (state.statusFilter === "pinned" && note.pinned && note.trashedAt === null) ||
            (state.statusFilter === "archived" && note.archived && note.trashedAt === null) ||
            (state.statusFilter === "trashed" && note.trashedAt !== null);
        return textMatch && tagMatch && statusMatch;
    });
    filtered.sort((left, right) => {
        if (left.pinned !== right.pinned)
            return left.pinned ? -1 : 1;
        const factor = state.sortOrder === "asc" ? 1 : -1;
        if (state.sortField === "title")
            return left.title.localeCompare(right.title) * factor;
        return (left[state.sortField] - right[state.sortField]) * factor;
    });
    return filtered;
}
function syncTagFilter() {
    const previous = state.tagFilter;
    const tags = Array.from(new Set(state.notes
        .flatMap((note) => note.tags)
        .map((tag) => tag.trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))));
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
    }
    else {
        state.tagFilter = "";
        tagFilter.value = "";
    }
}
function parseTags(raw) {
    return Array.from(new Set(raw.split(",").map((part) => part.trim()).filter(Boolean)));
}
function parseChecklist(raw) {
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
function persistNotes() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.notes));
}
function loadNotes() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw)
        return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed))
        throw new Error("Stored notes data is invalid.");
    return parsed.map((item) => normalizeNoteRecord(item));
}
function normalizeNoteRecord(value) {
    if (!value || typeof value !== "object")
        throw new Error("Stored note item shape is invalid.");
    const note = value;
    if (typeof note.id !== "string" ||
        typeof note.title !== "string" ||
        typeof note.content !== "string" ||
        typeof note.color !== "string" ||
        !Array.isArray(note.tags) ||
        ("checklist" in note && !Array.isArray(note.checklist)) ||
        ("dueAt" in note && note.dueAt !== null && typeof note.dueAt !== "number") ||
        ("remindAt" in note && note.remindAt !== null && typeof note.remindAt !== "number") ||
        ("reminderNotifiedAt" in note && note.reminderNotifiedAt !== null && typeof note.reminderNotifiedAt !== "number") ||
        ("recurrence" in note && !["none", "daily", "weekly"].includes(String(note.recurrence))) ||
        ("trashedAt" in note && note.trashedAt !== null && typeof note.trashedAt !== "number") ||
        typeof note.pinned !== "boolean" ||
        typeof note.archived !== "boolean" ||
        typeof note.createdAt !== "number" ||
        typeof note.updatedAt !== "number") {
        throw new Error("Stored note item shape is invalid.");
    }
    return {
        id: note.id,
        title: note.title,
        content: note.content,
        color: note.color,
        tags: note.tags.filter((tag) => typeof tag === "string"),
        checklist: normalizeChecklist(note.checklist),
        dueAt: normalizeTimestamp(note.dueAt),
        remindAt: normalizeTimestamp(note.remindAt),
        reminderNotifiedAt: normalizeTimestamp(note.reminderNotifiedAt),
        recurrence: normalizeRecurrence(note.recurrence),
        pinned: note.pinned,
        archived: note.archived,
        trashedAt: normalizeTimestamp(note.trashedAt),
        createdAt: note.createdAt,
        updatedAt: note.updatedAt
    };
}
function normalizeChecklist(value) {
    if (!Array.isArray(value))
        return [];
    return value
        .map((entry) => {
        if (!entry || typeof entry !== "object")
            return null;
        const item = entry;
        if (typeof item.text !== "string")
            return null;
        return {
            id: typeof item.id === "string" ? item.id : crypto.randomUUID(),
            text: item.text,
            done: item.done === true
        };
    })
        .filter((item) => item !== null);
}
function normalizeTimestamp(value) {
    return typeof value === "number" ? value : null;
}
function normalizeRecurrence(value) {
    if (value === "daily" || value === "weekly")
        return value;
    return "none";
}
function savePrefs() {
    localStorage.setItem(PREFS_KEY, JSON.stringify({
        theme: state.theme,
        layout: state.layout
    }));
}
function loadPrefs() {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw)
        return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object")
        return {};
    const prefs = parsed;
    const theme = prefs.theme === "dark" ? "dark" : "light";
    const layout = prefs.layout === "list" ? "list" : "grid";
    return { theme, layout };
}
function applyTheme() {
    document.body.classList.toggle("dark", state.theme === "dark");
}
function parseDueAtInput(dateValue, timeValue) {
    if (!dateValue && !timeValue)
        return null;
    if (!dateValue || !timeValue) {
        throw new Error("Due date and time must be filled together.");
    }
    const timestamp = new Date(`${dateValue}T${timeValue}`).getTime();
    if (Number.isNaN(timestamp))
        throw new Error("Invalid due date value.");
    return timestamp;
}
function parseReminderOffsetMinutes(value) {
    if (value === "none")
        return null;
    const minutes = Number.parseInt(value, 10);
    if (!Number.isFinite(minutes) || minutes < 0)
        throw new Error("Invalid reminder offset.");
    return minutes;
}
function parseRecurrenceMode(value) {
    if (value === "daily" || value === "weekly")
        return value;
    return "none";
}
function deriveReminderTimes(dueAt, reminderOffsetMinutes) {
    if (dueAt === null || reminderOffsetMinutes === null)
        return { dueAt, remindAt: null };
    return {
        dueAt,
        remindAt: dueAt - reminderOffsetMinutes * 60_000
    };
}
function toDueInputParts(timestamp) {
    if (timestamp === null)
        return { date: "", time: "" };
    const date = new Date(timestamp);
    const offset = date.getTimezoneOffset();
    const local = new Date(timestamp - offset * 60_000);
    const iso = local.toISOString();
    return {
        date: iso.slice(0, 10),
        time: iso.slice(11, 16)
    };
}
function inferReminderOffset(dueAt, remindAt) {
    if (dueAt === null || remindAt === null)
        return "none";
    const diffMinutes = Math.round((dueAt - remindAt) / 60_000);
    if ([0, 5, 15, 60, 1440].includes(diffMinutes))
        return String(diffMinutes);
    return "none";
}
function getDueMeta(note) {
    if (note.dueAt === null)
        return null;
    const dueText = new Date(note.dueAt).toLocaleString();
    const overdue = !note.archived && note.trashedAt === null && note.dueAt < Date.now();
    const reminderText = note.remindAt === null ? "" : ` • Reminder ${formatReminderLead(note.dueAt, note.remindAt)}`;
    const recurrenceText = note.recurrence === "none" ? "" : ` • Repeats ${note.recurrence}`;
    return { text: `Due: ${dueText}${reminderText}${recurrenceText}`, overdue };
}
function formatReminderLead(dueAt, remindAt) {
    const diffMinutes = Math.max(0, Math.round((dueAt - remindAt) / 60_000));
    if (diffMinutes === 0)
        return "at due time";
    if (diffMinutes % 1440 === 0) {
        const days = diffMinutes / 1440;
        return `${days} day${days > 1 ? "s" : ""} before`;
    }
    if (diffMinutes % 60 === 0) {
        const hours = diffMinutes / 60;
        return `${hours} hour${hours > 1 ? "s" : ""} before`;
    }
    return `${diffMinutes} minute${diffMinutes > 1 ? "s" : ""} before`;
}
function maybeRequestNotificationPermission() {
    if (!("Notification" in window))
        return;
    if (Notification.permission === "default")
        void Notification.requestPermission();
}
function startReminderScheduler() {
    runAutoMaintenance();
    window.setInterval(() => {
        runAutoMaintenance();
    }, REMINDER_POLL_MS);
}
function runAutoMaintenance() {
    let changed = false;
    if (checkDueReminders())
        changed = true;
    if (autoCleanupTrash())
        changed = true;
    if (changed)
        persistNotes();
    render();
}
function checkDueReminders() {
    const now = Date.now();
    let changed = false;
    state.notes.forEach((note) => {
        if (note.trashedAt !== null)
            return;
        if (note.remindAt === null || note.reminderNotifiedAt !== null)
            return;
        if (note.remindAt > now)
            return;
        showReminder(note);
        if (note.recurrence === "none") {
            note.reminderNotifiedAt = now;
        }
        else {
            const nextDueAt = computeNextDueAt(note.dueAt, note.recurrence);
            const offset = note.dueAt === null || note.remindAt === null ? 0 : note.dueAt - note.remindAt;
            note.dueAt = nextDueAt;
            note.remindAt = nextDueAt - offset;
            note.reminderNotifiedAt = null;
            note.updatedAt = now;
        }
        changed = true;
    });
    return changed;
}
function autoCleanupTrash() {
    const cutoff = Date.now() - TRASH_RETENTION_MS;
    const before = state.notes.length;
    state.notes = state.notes.filter((note) => note.trashedAt === null || note.trashedAt > cutoff);
    const changed = before !== state.notes.length;
    if (changed)
        pruneSelection();
    return changed;
}
function computeNextDueAt(currentDueAt, recurrence) {
    const base = currentDueAt ?? Date.now();
    const interval = recurrence === "daily" ? 24 * 60 * 60_000 : 7 * 24 * 60 * 60_000;
    let next = base + interval;
    const now = Date.now();
    while (next <= now)
        next += interval;
    return next;
}
function snapshotBeforeMutation() {
    state.historyPast.push(cloneNotes(state.notes));
    if (state.historyPast.length > HISTORY_LIMIT)
        state.historyPast.shift();
    state.historyFuture = [];
}
function undoNotesState() {
    const previous = state.historyPast.pop();
    if (!previous)
        return;
    state.historyFuture.push(cloneNotes(state.notes));
    state.notes = cloneNotes(previous);
    pruneSelection();
    persistNotes();
    render();
}
function redoNotesState() {
    const next = state.historyFuture.pop();
    if (!next)
        return;
    state.historyPast.push(cloneNotes(state.notes));
    state.notes = cloneNotes(next);
    pruneSelection();
    persistNotes();
    render();
}
function cloneNotes(notes) {
    return notes.map((note) => ({
        ...note,
        tags: [...note.tags],
        checklist: note.checklist.map((item) => ({ ...item }))
    }));
}
function pruneSelection() {
    const availableIds = new Set(state.notes.map((note) => note.id));
    state.selectedIds.forEach((id) => {
        if (!availableIds.has(id))
            state.selectedIds.delete(id);
    });
}
function exportData() {
    const lines = [];
    lines.push("Notes App Export");
    lines.push(`Exported at: ${new Date().toLocaleString()}`);
    lines.push(`Theme: ${state.theme}`);
    lines.push(`Layout: ${state.layout}`);
    lines.push("");
    if (state.notes.length === 0) {
        lines.push("No notes available.");
    }
    else {
        state.notes.forEach((note, index) => {
            lines.push(`=== Note ${index + 1} ===`);
            lines.push(`Title: ${note.title}`);
            lines.push(`Content: ${note.content}`);
            lines.push(`Tags: ${note.tags.length > 0 ? note.tags.join(", ") : "-"}`);
            lines.push(`Pinned: ${note.pinned ? "Yes" : "No"}`);
            lines.push(`Archived: ${note.archived ? "Yes" : "No"}`);
            lines.push(`Trashed: ${note.trashedAt ? "Yes" : "No"}`);
            lines.push(`Created: ${new Date(note.createdAt).toLocaleString()}`);
            lines.push(`Updated: ${new Date(note.updatedAt).toLocaleString()}`);
            if (note.dueAt !== null) {
                lines.push(`Due: ${new Date(note.dueAt).toLocaleString()}`);
                lines.push(`Reminder: ${note.remindAt !== null ? new Date(note.remindAt).toLocaleString() : "-"}`);
                lines.push(`Repeat: ${note.recurrence}`);
            }
            else {
                lines.push("Due: -");
            }
            if (note.checklist.length > 0) {
                lines.push("Checklist:");
                note.checklist.forEach((item) => {
                    lines.push(`- [${item.done ? "x" : " "}] ${item.text}`);
                });
            }
            lines.push("");
        });
    }
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `notes-export-${new Date().toISOString().slice(0, 10)}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
}
function importData(rawText) {
    const parsed = JSON.parse(rawText);
    if (!parsed || typeof parsed !== "object")
        throw new Error("Import file must be a JSON object.");
    const payload = parsed;
    if (!Array.isArray(payload.notes))
        throw new Error("Import file must contain a notes array.");
    const importedNotes = payload.notes.map((item) => normalizeNoteRecord(item));
    const importedPrefs = normalizeImportedPrefs(payload.prefs);
    if (!confirm("Import will replace current notes. Continue?"))
        return;
    runMutation(() => {
        state.notes = importedNotes;
    });
    state.theme = importedPrefs.theme ?? state.theme;
    state.layout = importedPrefs.layout ?? state.layout;
    savePrefs();
    applyTheme();
    render();
}
function normalizeImportedPrefs(value) {
    if (!value || typeof value !== "object")
        return {};
    const prefs = value;
    return {
        theme: prefs.theme === "dark" ? "dark" : "light",
        layout: prefs.layout === "list" ? "list" : "grid"
    };
}
function showReminder(note) {
    const message = note.dueAt ? `${note.title}\nDue: ${new Date(note.dueAt).toLocaleString()}` : note.title;
    if ("Notification" in window && Notification.permission === "granted") {
        new Notification("Notes App Reminder", { body: message });
        return;
    }
    alert(`Reminder:\n${message}`);
}
function registerServiceWorker() {
    if (!("serviceWorker" in navigator))
        return;
    void navigator.serviceWorker.register("./src/sw.js");
}
function escapeHtml(value) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}
function getReadableTextColor(hexColor) {
    const rgb = hexToRgb(hexColor);
    if (!rgb)
        return "#111827";
    const luminance = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
    return luminance > 0.62 ? "#111827" : "#f8fafc";
}
function withAlpha(hexColor, alpha) {
    const rgb = hexToRgb(hexColor);
    if (!rgb)
        return `rgba(17, 24, 39, ${alpha})`;
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}
function hexToRgb(value) {
    const hex = value.trim().replace("#", "");
    if (!/^[\da-fA-F]{6}$/.test(hex))
        return null;
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    return { r, g, b };
}
//# sourceMappingURL=index.js.map