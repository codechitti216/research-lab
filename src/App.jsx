import { useEffect, useMemo, useRef, useState } from "react";
import seedCards from "../data/db.json";
import seedLedger from "../data/ledger.json";

const TRACK_TAGS = ["#Math", "#Code"];
const BUILD_STAMP = __BUILD_STAMP__;
const HEATMAP_WEEKS = 16;
const PUBLIC_LEDGER_LIMIT = 24;
const RESEARCH_LAB_REPO_URL = "https://github.com/codechitti216/research-lab";

function toDateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function startOfWeek(date) {
  const result = new Date(date);
  const day = result.getDay();
  const diff = result.getDate() - day + (day === 0 ? -6 : 1);
  result.setDate(diff);
  result.setHours(0, 0, 0, 0);
  return result;
}

function flattenHistory(cards) {
  return cards.flatMap((card) => {
    const history = Array.isArray(card.history) ? card.history : [];
    return history.map((entry, index) => ({
      cardId: card.id,
      title: card.title,
      track: card.track,
      at: entry.at,
      status: entry.status,
      comment: entry.comment || "",
      metadata: entry.metadata || {},
      type: index === 0 ? "created" : "moved",
      fromStatus: index > 0 ? history[index - 1]?.status || null : null,
    }));
  });
}

function getIntensityClass(count) {
  if (count >= 4) return "bg-emerald-600";
  if (count === 3) return "bg-emerald-500";
  if (count === 2) return "bg-emerald-400";
  if (count === 1) return "bg-emerald-200";
  return "bg-neutral-100";
}

function migrateCardShape(card) {
  const next = {
    ...card,
    links: {
      githubUrl: card.links?.githubUrl || "",
      blogUrl: card.links?.blogUrl || "",
    },
    subtasks: Array.isArray(card.subtasks) ? card.subtasks : [],
  };
  delete next.archived;
  delete next.archivedAt;
  delete next.archiveReason;

  if (
    next.subtasks.length === 0 &&
    Array.isArray(card.history) &&
    card.history.length > 0
  ) {
    next.subtasks = [
      {
        id: `legacy-${card.id}`,
        text: card.title || "Imported task",
        completed: false,
        completedAt: null,
        subtasks: [],
      },
    ];
  }
  return next;
}

function normalizeCards(input) {
  if (!Array.isArray(input)) return [];
  return input.filter((c) => !c.archived).map(migrateCardShape);
}

async function requestJson(url, options) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
    ...options,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }

  return payload;
}

function collectSubtaskCompletionEvents(subtasks, acc) {
  if (!Array.isArray(subtasks)) return;
  for (const n of subtasks) {
    if (n.completedAt) acc.push({ at: n.completedAt });
    collectSubtaskCompletionEvents(n.subtasks, acc);
  }
}

function formatIndexPath(indexPath) {
  return indexPath.map((i) => i + 1).join(".");
}

function formatLedgerDetail(entry) {
  switch (entry.eventKind) {
    case "parent_complete":
      return "Topic milestone completed";
    case "leaf_complete":
      return "Sub-task completed";
    case "parent_reopen":
      return "Topic milestone reopened";
    case "leaf_reopen":
      return "Sub-task reopened";
    default:
      if (entry.fromStatus && entry.toStatus) {
        return `Moved from ${entry.fromStatus} to ${entry.toStatus}`;
      }
      return "Research update";
  }
}

function isTaskToggleLedgerEntry(entry) {
  if (typeof entry.eventKind === "string" && /_(complete|reopen)$/.test(entry.eventKind)) {
    return true;
  }

  const fromStatus = String(entry.fromStatus || "").trim().toLowerCase();
  const toStatus = String(entry.toStatus || "").trim().toLowerCase();
  return (
    (fromStatus === "open" || fromStatus === "checked") &&
    (toStatus === "open" || toStatus === "checked")
  );
}

function getLedgerSubjectKey(entry) {
  if (entry.subjectId) {
    return `${entry.cardId || "unknown-card"}:${entry.subjectId}`;
  }

  const normalizedTitle = String(entry.title || entry.topicTitle || "")
    .trim()
    .replace(/\s+(completed|reopened)(\s*\(|\s*$)/i, "$2");

  return normalizedTitle ? `${entry.cardId || "unknown-card"}:${normalizedTitle}` : null;
}

function toLedgerViewEvent(entry) {
  const topicTitle = String(entry.topicTitle || "").trim();
  const clickedSubjectLabel = String(entry.clickedSubjectLabel || "").trim();
  const displayTitle =
    topicTitle && clickedSubjectLabel
      ? `${topicTitle}: [${clickedSubjectLabel}]`
      : entry.title || entry.topicTitle || "Untitled event";

  return {
    type: "ledger",
    at: entry.timestamp || entry.at,
    title: displayTitle,
    cardId: entry.cardId || "unknown-card",
    detail: formatLedgerDetail(entry),
    comment: entry.comment || "",
  };
}

function InlineAddForm({
  draft,
  setDraft,
  onSubmit,
  onCancel,
  disabled,
  placeholder = "Title…",
}) {
  return (
    <div className="mt-2 rounded-md border border-neutral-200 bg-neutral-50/80 px-3 py-2.5">
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (!disabled && draft.trim()) onSubmit();
          }
          if (e.key === "Escape") onCancel();
        }}
        placeholder={placeholder}
        className="mb-2 w-full border-0 border-b border-neutral-300 bg-transparent py-1 text-sm text-neutral-900 outline-none focus:border-neutral-500"
        autoFocus
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-transparent px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-200/60"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={disabled || !draft.trim()}
          onClick={onSubmit}
          className="rounded bg-neutral-900 px-3 py-1 text-xs font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </div>
  );
}

function SubtaskItem({
  topicId,
  node,
  indexPath,
  togglingId,
  onToggle,
  onOpenAddInline,
  onDeleteSubtaskRequest,
  interactive,
  addSlot,
  addDraft,
  setAddDraft,
  onSubmitAddDraft,
  onCancelAddDraft,
  isSubmittingAdd,
}) {
  const numberLabel = formatIndexPath(indexPath);
  const done = Boolean(node.completed);
  const busy = togglingId === node.id;
  const hasChildren = Array.isArray(node.subtasks) && node.subtasks.length > 0;
  const addingHere =
    Boolean(addSlot) &&
    addSlot.topicId === topicId &&
    addSlot.parentSubtaskId === node.id;

  return (
    <li className="space-y-1">
      <div
        className={`flex flex-wrap items-start gap-2 rounded border px-2 py-1.5 text-sm ${
          done ? "border-neutral-200 bg-neutral-50" : "border-neutral-200 bg-white"
        }`}
      >
        <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            checked={done}
            disabled={!interactive || busy}
            onChange={() => onToggle(topicId, node.id)}
            className="mt-1 shrink-0"
          />
          <span className={`min-w-0 ${done ? "text-neutral-500 line-through" : "text-neutral-800"}`}>
            <span className="mr-2 inline-block min-w-[2rem] font-mono text-xs text-neutral-400">
              {numberLabel}
            </span>
            {node.text}
          </span>
        </label>
        {interactive ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={done || addingHere}
              className="rounded px-1.5 py-0.5 text-xs text-neutral-600 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
              onClick={() => onOpenAddInline(topicId, node.id)}
            >
              + Sub-task
            </button>
            <button
              type="button"
              className="rounded px-1.5 py-0.5 text-xs text-neutral-500 hover:bg-red-50 hover:text-red-800"
              onClick={() => onDeleteSubtaskRequest(topicId, node.id, node.text)}
            >
              Remove
            </button>
          </div>
        ) : null}
      </div>
      {addingHere ? (
        <InlineAddForm
          draft={addDraft}
          setDraft={setAddDraft}
          onSubmit={onSubmitAddDraft}
          onCancel={onCancelAddDraft}
          disabled={isSubmittingAdd}
          placeholder="New sub-task…"
        />
      ) : null}
      {hasChildren ? (
        <ul className="mt-1 ml-2 space-y-1 border-l border-neutral-200 pl-3 sm:ml-3 sm:pl-4">
          {node.subtasks.map((child, i) => (
            <SubtaskItem
              key={child.id}
              topicId={topicId}
              node={child}
              indexPath={[...indexPath, i]}
              togglingId={togglingId}
              onToggle={onToggle}
              onOpenAddInline={onOpenAddInline}
              onDeleteSubtaskRequest={onDeleteSubtaskRequest}
              interactive={interactive}
              addSlot={addSlot}
              addDraft={addDraft}
              setAddDraft={setAddDraft}
              onSubmitAddDraft={onSubmitAddDraft}
              onCancelAddDraft={onCancelAddDraft}
              isSubmittingAdd={isSubmittingAdd}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function GitHubGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.48 2 2 6.58 2 12.23c0 4.5 2.87 8.32 6.84 9.66.5.1.66-.22.66-.49v-1.72c-2.78.62-3.37-1.37-3.37-1.37-.46-1.18-1.11-1.49-1.11-1.49-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.9 1.57 2.35 1.12 2.92.86.09-.67.35-1.12.63-1.38-2.22-.26-4.56-1.14-4.56-5.09 0-1.13.39-2.05 1.03-2.77-.1-.26-.45-1.31.1-2.73 0 0 .84-.28 2.75 1.06A9.3 9.3 0 0 1 12 6.84c.85 0 1.7.12 2.5.35 1.9-1.34 2.74-1.06 2.74-1.06.56 1.42.21 2.47.1 2.73.64.72 1.03 1.64 1.03 2.77 0 3.96-2.34 4.82-4.58 5.08.36.32.69.95.69 1.92v2.85c0 .28.17.6.68.49A10.25 10.25 0 0 0 22 12.23C22 6.58 17.52 2 12 2Z" />
    </svg>
  );
}

function PublicLedgerView({ events }) {
  return (
    <div className="min-h-screen bg-neutral-50 px-6 py-8 md:px-10">
      <div className="mx-auto max-w-5xl space-y-8">
        <header className="flex flex-col gap-4 border border-neutral-200 bg-white px-5 py-5 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.18em] text-neutral-400">Research Lab</div>
            <h1 className="mt-2 font-serif text-3xl font-medium text-neutral-900">
              Open Research Ledger
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-neutral-600">
              Public read-only view of the latest persisted task completions and reopenings from the
              local research lab.
            </p>
          </div>
          <div className="text-[11px] text-neutral-400">Public build: {BUILD_STAMP}</div>
        </header>

        <div className="grid gap-8 lg:grid-cols-[320px_1fr]">
          <aside className="border border-neutral-200 bg-white p-6">
            <div className="text-xs uppercase tracking-[0.18em] text-neutral-400">GitHub</div>
            <h2 className="mt-2 font-serif text-2xl font-medium text-neutral-900">research-lab</h2>
            <p className="mt-3 text-sm leading-relaxed text-neutral-600">
              Source for the local task system, sync bridge, and the public ledger feed.
            </p>
            <a
              href={RESEARCH_LAB_REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="mt-5 inline-flex items-center gap-2 rounded border border-neutral-900 px-3 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-100"
            >
              <GitHubGlyph />
              View Repository
            </a>
          </aside>

          <section className="border border-neutral-200 bg-white p-6">
            <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-baseline md:justify-between">
              <div>
                <h2 className="font-serif text-2xl font-medium text-neutral-900">Research Ledger</h2>
                <p className="mt-2 text-sm leading-relaxed text-neutral-600">
                  Latest task toggles mirrored from the local lab. This public page stays read-only.
                </p>
              </div>
              <div className="text-xs uppercase tracking-[0.18em] text-neutral-400">
                {events.length} events
              </div>
            </div>

            {events.length ? (
              <div className="space-y-5">
                {events.map((event, idx) => (
                  <div
                    key={`${event.cardId}-${event.at}-${event.type}-${idx}`}
                    className="border-l-2 border-emerald-500 pl-4"
                  >
                    <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-400">
                      {formatDateTime(event.at)}
                    </div>
                    <div className="mt-1 font-serif text-lg text-neutral-900">{event.title}</div>
                    <p className="mt-1 text-sm text-neutral-600">
                      <span className="font-medium">{event.detail}</span>
                    </p>
                    {event.comment ? (
                      <p className="mt-2 whitespace-pre-wrap font-mono text-sm leading-relaxed text-neutral-700">
                        {event.comment}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-neutral-500">No public ledger events available yet.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

export function App() {
  const isDev = import.meta.env.DEV;
  const isLocalPreviewHost =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
  const [hasLocalApi, setHasLocalApi] = useState(() => isDev);
  /** `vite dev`, or a local production host that still exposes the API middleware. */
  const isInteractive = isDev || (import.meta.env.PROD && isLocalPreviewHost && hasLocalApi);
  const [cards, setCards] = useState(() => normalizeCards(seedCards));
  const [topicTitle, setTopicTitle] = useState("");
  const [tasksText, setTasksText] = useState("");
  const [topicTrack, setTopicTrack] = useState("#Code");
  const [isCreatingTopic, setIsCreatingTopic] = useState(false);
  const [togglingSubId, setTogglingSubId] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [error, setError] = useState("");
  const [commandMessage, setCommandMessage] = useState("");
  const [ledgerEntries, setLedgerEntries] = useState(() =>
    Array.isArray(seedLedger) ? seedLedger : []
  );
  /** Inline add: parentSubtaskId null = top-level under topic */
  const [addSlot, setAddSlot] = useState(null);
  const [addDraft, setAddDraft] = useState("");
  const [isSubmittingAdd, setIsSubmittingAdd] = useState(false);
  /** { kind: 'subtask' | 'topic', topicId, subtaskId?, label } */
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const deleteConfirmRef = useRef(deleteConfirm);
  deleteConfirmRef.current = deleteConfirm;

  useEffect(() => {
    if (isDev || !isLocalPreviewHost) return;

    let cancelled = false;

    fetch("/api/health")
      .then((response) => {
        if (!cancelled) {
          setHasLocalApi(response.ok);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHasLocalApi(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isDev, isLocalPreviewHost]);

  useEffect(() => {
    if (!isInteractive) return;

    let cancelled = false;

    requestJson("/api/cards")
      .then((payload) => {
        if (!cancelled && Array.isArray(payload.cards)) {
          setCards(normalizeCards(payload.cards));
        }
      })
      .catch(() => {
        // Keep the bundled seed as a fallback if the live API read fails.
      });

    requestJson("/api/ledger")
      .then((payload) => {
        if (!cancelled && Array.isArray(payload.ledger)) {
          setLedgerEntries(payload.ledger);
        }
      })
      .catch(() => {
        // Keep the in-memory ledger empty if the live API read fails.
      });

    return () => {
      cancelled = true;
    };
  }, [isInteractive]);

  useEffect(() => {
    if (!deleteConfirm || typeof window === "undefined") return;

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setDeleteConfirm(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deleteConfirm]);

  const historyEvents = useMemo(() => flattenHistory(cards), [cards]);
  const todayKey = toDateKey(new Date());

  const todaysCardEvents = useMemo(
    () =>
      historyEvents
        .filter((event) => toDateKey(event.at) === todayKey)
        .sort((a, b) => new Date(b.at) - new Date(a.at)),
    [historyEvents, todayKey]
  );

  const todaysLedgerEvents = useMemo(() => {
    const todaysEntries = ledgerEntries
      .filter((e) => toDateKey(e.timestamp || e.at) === todayKey)
      .sort((a, b) => new Date(a.timestamp || a.at) - new Date(b.timestamp || b.at));

    const latestTaskState = new Map();
    const visibleEntries = [];

    for (const entry of todaysEntries) {
      if (isTaskToggleLedgerEntry(entry)) {
        const key = getLedgerSubjectKey(entry);
        if (key) {
          latestTaskState.set(key, entry);
          continue;
        }
      }

      visibleEntries.push(toLedgerViewEvent(entry));
    }

    for (const entry of latestTaskState.values()) {
      if (String(entry.eventKind).endsWith("_complete")) {
        visibleEntries.push(toLedgerViewEvent(entry));
      }
    }

    return visibleEntries.sort((a, b) => new Date(b.at) - new Date(a.at));
  }, [ledgerEntries, todayKey]);

  const todaysEvents = useMemo(() => {
    return [...todaysCardEvents, ...todaysLedgerEvents].sort(
      (a, b) => new Date(b.at) - new Date(a.at)
    );
  }, [todaysCardEvents, todaysLedgerEvents]);

  const publicLedgerEvents = useMemo(() => {
    return ledgerEntries
      .filter(isTaskToggleLedgerEntry)
      .sort((a, b) => new Date(b.timestamp || b.at) - new Date(a.timestamp || a.at))
      .slice(0, PUBLIC_LEDGER_LIMIT)
      .map((entry) => toLedgerViewEvent(entry));
  }, [ledgerEntries]);

  const subtaskCompletionTimes = useMemo(() => {
    const acc = [];
    for (const card of cards) {
      collectSubtaskCompletionEvents(card.subtasks, acc);
    }
    return acc;
  }, [cards]);

  const activityEvents = useMemo(() => {
    return [...historyEvents, ...subtaskCompletionTimes];
  }, [historyEvents, subtaskCompletionTimes]);

  const activityHeatmap = useMemo(() => {
    const end = startOfWeek(new Date());
    const dayCounts = new Map();

    for (const event of activityEvents) {
      const key = toDateKey(event.at);
      if (!key) continue;
      dayCounts.set(key, (dayCounts.get(key) || 0) + 1);
    }

    const weeks = [];
    for (let weekOffset = HEATMAP_WEEKS - 1; weekOffset >= 0; weekOffset -= 1) {
      const weekStart = new Date(end);
      weekStart.setDate(end.getDate() - weekOffset * 7);

      const days = Array.from({ length: 7 }, (_, dayOffset) => {
        const current = new Date(weekStart);
        current.setDate(weekStart.getDate() + dayOffset);
        const key = toDateKey(current);
        const count = dayCounts.get(key) || 0;
        return {
          key,
          label: current.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
          count,
        };
      });

      weeks.push(days);
    }

    return weeks;
  }, [activityEvents]);

  const activitySummary = useMemo(() => {
    const uniqueDays = new Set(activityEvents.map((event) => toDateKey(event.at)).filter(Boolean));
    const currentStreakBase = [...uniqueDays].sort().reverse();
    let streak = 0;
    let cursor = new Date();
    cursor.setHours(0, 0, 0, 0);

    for (const key of currentStreakBase) {
      const cursorKey = toDateKey(cursor);
      if (key === cursorKey) {
        streak += 1;
        cursor.setDate(cursor.getDate() - 1);
      } else if (key < cursorKey) {
        break;
      }
    }

    return {
      totalEvents: activityEvents.length,
      activeDays: uniqueDays.size,
      currentStreak: streak,
    };
  }, [activityEvents]);

  const handleCommand = async (path, start, stop, successMessage) => {
    if (!isInteractive) return;

    try {
      start(true);
      setError("");
      setCommandMessage("");
      await requestJson(path, { method: "POST" });
      setCommandMessage(successMessage);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      stop(false);
    }
  };

  const handleCreateTopic = async () => {
    if (!isInteractive) return;
    const title = topicTitle.trim();
    if (!title) {
      setError("Topic title is required.");
      return;
    }
    try {
      setIsCreatingTopic(true);
      setError("");
      const { card } = await requestJson("/api/topics", {
        method: "POST",
        body: JSON.stringify({
          title,
          track: topicTrack,
          tasksText,
        }),
      });
      setCards((prev) => [...prev, migrateCardShape(card)]);
      setTopicTitle("");
      setTasksText("");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsCreatingTopic(false);
    }
  };

  const handleToggleSubtask = async (topicId, subtaskId) => {
    if (!isInteractive) return;
    try {
      setTogglingSubId(subtaskId);
      setError("");
      const payload = await requestJson("/api/subtasks/toggle", {
        method: "POST",
        body: JSON.stringify({ topicId, subtaskId }),
      });
      const { card, ledgerEntry } = payload;
      setCards((prev) => prev.map((c) => (c.id === card.id ? migrateCardShape(card) : c)));
      if (ledgerEntry) {
        setLedgerEntries((prev) => [...prev, ledgerEntry]);
      }
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setTogglingSubId(null);
    }
  };

  const openAddSlot = (topicId, parentSubtaskId) => {
    setAddSlot({ topicId, parentSubtaskId });
    setAddDraft("");
  };

  const cancelAddSlot = () => {
    setAddSlot(null);
    setAddDraft("");
  };

  const submitAddSlot = async () => {
    if (!isInteractive || !addSlot) return;
    const text = addDraft.trim();
    if (!text) return;
    try {
      setIsSubmittingAdd(true);
      setError("");
      const { card } = await requestJson(
        `/api/topics/${encodeURIComponent(addSlot.topicId)}/subtasks`,
        {
          method: "POST",
          body: JSON.stringify({
            parentSubtaskId: addSlot.parentSubtaskId,
            text,
          }),
        }
      );
      setCards((prev) => prev.map((c) => (c.id === card.id ? migrateCardShape(card) : c)));
      cancelAddSlot();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsSubmittingAdd(false);
    }
  };

  const requestDeleteSubtask = (topicId, subtaskId, label) => {
    setDeleteConfirm({
      kind: "subtask",
      topicId,
      subtaskId,
      label: label || "this task",
    });
  };

  const requestDeleteTopic = (topicId, title) => {
    setDeleteConfirm({
      kind: "topic",
      topicId,
      label: title || "this topic",
    });
  };

  const cancelDelete = () => setDeleteConfirm(null);

  const executeDelete = async () => {
    const pending = deleteConfirmRef.current;
    if (!isInteractive || !pending) return;
    if (pending.kind !== "topic" && !pending.subtaskId) {
      setError("Missing sub-task id.");
      return;
    }
    try {
      setError("");
      if (pending.kind === "topic") {
        await requestJson(`/api/cards/${encodeURIComponent(pending.topicId)}`, {
          method: "DELETE",
        });
        setCards((prev) => prev.filter((c) => c.id !== pending.topicId));
      } else {
        const { card } = await requestJson(
          `/api/topics/${encodeURIComponent(pending.topicId)}/subtasks/${encodeURIComponent(
            pending.subtaskId
          )}`,
          { method: "DELETE" }
        );
        setCards((prev) => prev.map((c) => (c.id === card.id ? migrateCardShape(card) : c)));
      }
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setDeleteConfirm(null);
    }
  };

  if (!isInteractive) {
    return <PublicLedgerView events={publicLedgerEvents} />;
  }

  return (
    <div className="min-h-screen bg-neutral-50 px-6 py-8 md:px-10">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6 flex flex-col gap-4 border border-neutral-200 bg-white px-4 py-4 md:flex-row md:items-center md:justify-between">
          <div className="font-serif text-xl font-medium text-neutral-900">Research Lab</div>
          {isInteractive ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-2 text-xs text-neutral-500">
                {commandMessage || "Sync & publish update the portfolio mirror."}
              </span>
              <button
                type="button"
                disabled={isSyncing || isPublishing}
                onClick={() =>
                  handleCommand("/api/sync", setIsSyncing, setIsSyncing, "Portfolio sync complete.")
                }
                className="rounded-sm border-2 border-emerald-600 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-900 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSyncing ? "Syncing…" : "Sync Portfolio"}
              </button>
              <button
                type="button"
                disabled={isPublishing || isSyncing}
                onClick={() =>
                  handleCommand(
                    "/api/publish",
                    setIsPublishing,
                    setIsPublishing,
                    "Publish complete."
                  )
                }
                className="rounded-sm border-2 border-neutral-900 bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isPublishing ? "Publishing…" : "Publish to Cloud"}
              </button>
            </div>
          ) : (
            <div className="text-[11px] text-neutral-400">Public build: {BUILD_STAMP}</div>
          )}
        </header>

        {error ? (
          <div className="mb-4 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {deleteConfirm ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/40 px-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-confirm-title"
            onClick={cancelDelete}
          >
            <div
              className="w-full max-w-md border border-neutral-300 bg-white p-5 shadow-xl"
              onClick={(event) => event.stopPropagation()}
            >
              <h2 id="delete-confirm-title" className="font-serif text-xl font-medium text-neutral-900">
                Remove {deleteConfirm.kind === "subtask" ? "task" : "topic"}?
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-neutral-700">
                <span className="font-medium">{deleteConfirm.label}</span>{" "}
                {deleteConfirm.kind === "subtask"
                  ? "and everything nested under it will be removed."
                  : "and all nested tasks under it will be removed."}{" "}
                This cannot be undone.
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={cancelDelete}
                  className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={executeDelete}
                  className="rounded bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800"
                  autoFocus
                >
                  Remove
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <section className="mb-8 border border-neutral-200 bg-white p-6">
          <div className="mb-6">
            <h2 className="font-serif text-2xl font-medium text-neutral-900">Activity Signal</h2>
            <p className="mt-2 text-sm leading-relaxed text-neutral-600">
              A GitHub-style activity field showing research movement and completed subtasks over the
              last {HEATMAP_WEEKS} weeks.
            </p>
          </div>

          <div className="mb-6 grid grid-cols-3 gap-3">
            <div className="border border-neutral-200 p-3">
              <div className="font-serif text-xl text-neutral-900">{activitySummary.totalEvents}</div>
              <div className="mt-1 text-xs uppercase tracking-[0.18em] text-neutral-400">
                Total Events
              </div>
            </div>
            <div className="border border-neutral-200 p-3">
              <div className="font-serif text-xl text-neutral-900">{activitySummary.activeDays}</div>
              <div className="mt-1 text-xs uppercase tracking-[0.18em] text-neutral-400">
                Active Days
              </div>
            </div>
            <div className="border border-neutral-200 p-3">
              <div className="font-serif text-xl text-neutral-900">{activitySummary.currentStreak}</div>
              <div className="mt-1 text-xs uppercase tracking-[0.18em] text-neutral-400">
                Current Streak
              </div>
            </div>
          </div>

          <div className="space-y-2 overflow-x-auto">
            <div className="flex gap-1">
              {activityHeatmap.map((week, index) => (
                <div key={`week-${index}`} className="grid grid-rows-7 gap-1">
                  {week.map((day) => (
                    <div
                      key={day.key}
                      title={`${day.label}: ${day.count} events`}
                      className={`h-3 w-3 rounded-[2px] ${getIntensityClass(day.count)}`}
                    />
                  ))}
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between text-[11px] text-neutral-400">
              <span>Less</span>
              <span>More</span>
            </div>
          </div>
        </section>

        <div className="grid gap-8 lg:grid-cols-[1fr_1.1fr]">
          <section className="border border-neutral-200 bg-white p-6">
            <h2 className="font-serif text-xl font-medium text-neutral-900">New topic</h2>
            <p className="mt-2 text-sm text-neutral-600">
              Set a <span className="font-medium">Topic</span> and <span className="font-medium">Tasks</span> (one
              per line). Use <span className="font-medium">Add Sub-task</span> under each row for infinite nesting.
            </p>
            <div className="mt-4 space-y-3">
              <input
                type="text"
                value={topicTitle}
                onChange={(e) => setTopicTitle(e.target.value)}
                placeholder="Topic title"
                className="w-full border border-neutral-200 bg-white px-3 py-2 font-serif text-base text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-neutral-400"
              />
              <textarea
                value={tasksText}
                onChange={(e) => setTasksText(e.target.value)}
                placeholder={"Tasks (one per line)\ne.g.\nRead paper\nRun baseline"}
                className="min-h-28 w-full border border-neutral-200 bg-white px-3 py-2 font-mono text-sm text-neutral-700 outline-none placeholder:text-neutral-400 focus:border-neutral-400"
              />
              <select
                value={topicTrack}
                onChange={(e) => setTopicTrack(e.target.value)}
                className="w-full border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700 outline-none focus:border-neutral-400"
              >
                {TRACK_TAGS.map((track) => (
                  <option key={track} value={track}>
                    {track}
                  </option>
                ))}
              </select>
              {isInteractive ? (
                <button
                  type="button"
                  disabled={isCreatingTopic || !topicTitle.trim()}
                  onClick={handleCreateTopic}
                  className="w-full rounded-sm bg-neutral-900 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isCreatingTopic ? "Adding…" : "Add topic"}
                </button>
              ) : (
                <p className="text-xs text-neutral-400">Read-only build — open dev server to edit.</p>
              )}
            </div>
          </section>

          <section className="border border-neutral-200 bg-white p-6">
            <div className="mb-6 flex items-baseline justify-between gap-4">
              <div>
                <h2 className="font-serif text-2xl font-medium text-neutral-900">
                  Today&apos;s Research Ledger
                </h2>
                <p className="mt-2 max-w-xl text-sm leading-relaxed text-neutral-600">
                  Persisted local task transitions and research movement for today.
                </p>
              </div>
              <div className="text-xs uppercase tracking-[0.18em] text-neutral-400">
                {formatDate(new Date())}
              </div>
            </div>

            {todaysEvents.length ? (
              <div className="max-h-80 space-y-5 overflow-y-auto pr-1">
                {todaysEvents.map((event, idx) => (
                  <div
                    key={`${event.cardId}-${event.at}-${event.status ?? event.type}-${idx}`}
                    className="border-l-2 border-emerald-500 pl-4"
                  >
                    <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-400">
                      {formatTime(event.at)}
                    </div>
                    <div className="mt-1 font-serif text-lg text-neutral-900">{event.title}</div>
                    <p className="mt-1 text-sm text-neutral-600">
                      {event.type === "ledger" ? (
                        <span className="font-medium">{event.detail}</span>
                      ) : event.type === "created" ? (
                        <>
                          Started in <span className="font-medium">{event.status}</span>
                        </>
                      ) : (
                        <>
                          Moved from <span className="font-medium">{event.fromStatus}</span> to{" "}
                          <span className="font-medium">{event.status}</span>
                        </>
                      )}
                    </p>
                    {event.comment ? (
                      <p className="mt-2 whitespace-pre-wrap font-mono text-sm leading-relaxed text-neutral-700">
                        {event.comment}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-neutral-500">No lab activity logged for today yet.</p>
            )}
          </section>
        </div>

        <div className="mt-10 border border-neutral-200 bg-white p-6">
          <h2 className="mb-6 font-serif text-xl font-medium text-neutral-900">Tasks</h2>
          <div className="divide-y divide-neutral-200">
            {cards.length === 0 ? (
              <p className="py-6 text-sm text-neutral-500">No topics yet.</p>
            ) : (
              cards.map((card) => (
                <article key={card.id} className="py-8 first:pt-2">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-serif text-xl font-medium text-neutral-900">{card.title}</h3>
                      <div className="mt-1 flex items-center gap-2 text-xs text-neutral-500">
                        <span>{card.track}</span>
                        {card.links?.githubUrl ? (
                          <a
                            href={card.links.githubUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-neutral-600 hover:text-neutral-900"
                          >
                            <GitHubGlyph />
                          </a>
                        ) : null}
                      </div>
                    </div>
                    {isInteractive ? (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => openAddSlot(card.id, null)}
                          className="rounded border border-neutral-200 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
                        >
                          + Root task
                        </button>
                        <button
                          type="button"
                          onClick={() => requestDeleteTopic(card.id, card.title)}
                          className="rounded border border-neutral-200 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100"
                        >
                          Remove topic
                        </button>
                      </div>
                    ) : null}
                  </div>
                  {isInteractive &&
                  addSlot?.topicId === card.id &&
                  addSlot.parentSubtaskId === null ? (
                    <InlineAddForm
                      draft={addDraft}
                      setDraft={setAddDraft}
                      onSubmit={submitAddSlot}
                      onCancel={cancelAddSlot}
                      disabled={isSubmittingAdd}
                      placeholder="New root-level task…"
                    />
                  ) : null}
                  <div className="mt-4">
                    {card.subtasks?.length ? (
                      <ul className="space-y-1">
                        {card.subtasks.map((node, i) => (
                          <SubtaskItem
                            key={node.id}
                            topicId={card.id}
                            node={node}
                            indexPath={[i]}
                            togglingId={togglingSubId}
                            onToggle={handleToggleSubtask}
                            onOpenAddInline={openAddSlot}
                            onDeleteSubtaskRequest={requestDeleteSubtask}
                            interactive={isInteractive}
                            addSlot={addSlot}
                            addDraft={addDraft}
                            setAddDraft={setAddDraft}
                            onSubmitAddDraft={submitAddSlot}
                            onCancelAddDraft={cancelAddSlot}
                            isSubmittingAdd={isSubmittingAdd}
                          />
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-neutral-400 italic">
                        No tasks — add lines when creating a topic, or use + Root task.
                      </p>
                    )}
                  </div>
                </article>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
