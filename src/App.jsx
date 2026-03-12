import { useEffect, useMemo, useState } from "react";
import seedCards from "../data/db.json";

const COLUMNS = [
  { title: "Concepts & Ideas", border: "border-sky-200" },
  { title: "Setup", border: "border-purple-200" },
  { title: "Sandboxing", border: "border-amber-200" },
  { title: "Results", border: "border-emerald-200" },
  { title: "Artifacts", border: "border-slate-200" },
  { title: "Broadcast", border: "border-indigo-200" },
];
const STATUSES = COLUMNS.map((column) => column.title);
const INITIAL_STATUS = STATUSES[0];
const FINAL_STATUS = STATUSES[STATUSES.length - 1];
const TRACK_TAGS = ["#Math", "#Code"];
const BUILD_STAMP = __BUILD_STAMP__;
const HEATMAP_WEEKS = 16;

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

function normalizeCards(input) {
  return Array.isArray(input)
    ? input.map((card) => ({
        ...card,
        archived: Boolean(card.archived),
        archiveReason: card.archiveReason || null,
        links: {
          githubUrl: card.links?.githubUrl || "",
          blogUrl: card.links?.blogUrl || "",
        },
        history: Array.isArray(card.history) ? card.history : [],
      }))
    : [];
}

function getCurrentStatus(card) {
  return card.history?.[card.history.length - 1]?.status || card.status || INITIAL_STATUS;
}

function LinkGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11 4" />
      <path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07L13 19" />
    </svg>
  );
}

function GitHubGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.48 2 2 6.58 2 12.23c0 4.5 2.87 8.32 6.84 9.66.5.1.66-.22.66-.49v-1.72c-2.78.62-3.37-1.37-3.37-1.37-.46-1.18-1.11-1.49-1.11-1.49-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.9 1.57 2.35 1.12 2.92.86.09-.67.35-1.12.63-1.38-2.22-.26-4.56-1.14-4.56-5.09 0-1.13.39-2.05 1.03-2.77-.1-.26-.45-1.31.1-2.73 0 0 .84-.28 2.75 1.06A9.3 9.3 0 0 1 12 6.84c.85 0 1.7.12 2.5.35 1.9-1.34 2.74-1.06 2.74-1.06.56 1.42.21 2.47.1 2.73.64.72 1.03 1.64 1.03 2.77 0 3.96-2.34 4.82-4.58 5.08.36.32.69.95.69 1.92v2.85c0 .28.17.6.68.49A10.25 10.25 0 0 0 22 12.23C22 6.58 17.52 2 12 2Z" />
    </svg>
  );
}

function ArchiveGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8h14v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2Z" />
      <path d="M10 12h4" />
    </svg>
  );
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

export function App() {
  const isDev = import.meta.env.DEV;
  const isInteractive = isDev;
  const [cards, setCards] = useState(() => normalizeCards(seedCards));
  const [draftMove, setDraftMove] = useState(null);
  const [draftComment, setDraftComment] = useState("");
  const [newCardDraft, setNewCardDraft] = useState(null);
  const [isCommitting, setIsCommitting] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [draggedCardId, setDraggedCardId] = useState(null);
  const [hoverStatus, setHoverStatus] = useState(null);
  const [showArchiveOverlay, setShowArchiveOverlay] = useState(false);
  const [error, setError] = useState("");
  const [commandMessage, setCommandMessage] = useState("");
  const historyEvents = useMemo(() => flattenHistory(cards), [cards]);
  const todayKey = toDateKey(new Date());
  const activeCards = useMemo(() => cards.filter((card) => !card.archived), [cards]);
  const archivedCards = useMemo(
    () =>
      cards
        .filter((card) => card.archived)
        .sort((a, b) => new Date((b.archivedAt || 0)) - new Date((a.archivedAt || 0))),
    [cards]
  );

  const todaysEvents = useMemo(
    () =>
      historyEvents
        .filter((event) => toDateKey(event.at) === todayKey)
        .sort((a, b) => new Date(b.at) - new Date(a.at)),
    [historyEvents, todayKey]
  );

  const activityHeatmap = useMemo(() => {
    const end = startOfWeek(new Date());
    const dayCounts = new Map();

    for (const event of historyEvents) {
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
  }, [historyEvents]);

  const activitySummary = useMemo(() => {
    const uniqueDays = new Set(historyEvents.map((event) => toDateKey(event.at)).filter(Boolean));
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
      totalEvents: historyEvents.length,
      activeDays: uniqueDays.size,
      currentStreak: streak,
    };
  }, [historyEvents]);

  const grouped = useMemo(() => {
    const byStatus = Object.fromEntries(STATUSES.map((status) => [status, []]));

    for (const card of activeCards) {
      const currentStatus = getCurrentStatus(card);
      if (draftMove?.cardId === card.id && draftMove.fromStatus === currentStatus) {
        continue;
      }
      byStatus[currentStatus]?.push(card);
    }

    if (draftMove) {
      const sourceCard = activeCards.find((card) => card.id === draftMove.cardId);
      if (sourceCard) {
        byStatus[draftMove.toStatus]?.unshift({
          ...sourceCard,
          status: draftMove.toStatus,
          isDraftMove: true,
        });
      }
    }

    if (newCardDraft) {
      byStatus[newCardDraft.status]?.unshift({
        id: "__new-card__",
        title: "",
        isNewCard: true,
      });
    }

    return byStatus;
  }, [activeCards, draftMove, newCardDraft]);

  const cancelDraftMove = () => {
    if (isCommitting) return;
    setDraftMove(null);
    setDraftComment("");
    setHoverStatus(null);
    setDraggedCardId(null);
  };

  const cancelNewCardDraft = () => {
    if (isCreating) return;
    setNewCardDraft(null);
  };

  useEffect(() => {
    if (!isInteractive || !draftMove) return undefined;

    const handleUndo = (event) => {
      const isUndo = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z";
      if (!isUndo) return;

      event.preventDefault();
      cancelDraftMove();
    };

    window.addEventListener("keydown", handleUndo);
    return () => window.removeEventListener("keydown", handleUndo);
  }, [draftMove, isCommitting, isInteractive]);

  const openMoveDraft = (card, toStatus) => {
    if (!isInteractive) return;
    const fromStatus = getCurrentStatus(card);
    if (!toStatus || fromStatus === toStatus) return;

    setError("");
    setDraftComment("");
    setDraftMove({
      cardId: card.id,
      title: card.title,
      track: card.track,
      fromStatus,
      toStatus,
      githubUrl: card.links?.githubUrl || "",
      blogUrl: card.links?.blogUrl || "",
    });
  };

  const startNewCardDraft = (status) => {
    if (!isInteractive) return;
    setError("");
    setNewCardDraft({
      status,
      title: "",
      description: "",
      track: "#Code",
    });
  };

  const handleCreateCard = async () => {
    if (!isInteractive || !newCardDraft) return;
    const title = newCardDraft.title.trim();

    if (!title) {
      setError("A title is required to create a card.");
      return;
    }

    try {
      setIsCreating(true);
      setError("");
      const { card } = await requestJson("/api/cards", {
        method: "POST",
        body: JSON.stringify({
          title,
          description: newCardDraft.description,
          track: newCardDraft.track,
          status: newCardDraft.status,
        }),
      });
      setCards((prev) => [...prev, card]);
      setNewCardDraft(null);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsCreating(false);
    }
  };

  const handleCommitMove = async () => {
    if (!isInteractive || !draftMove) return;

    try {
      setIsCommitting(true);
      setError("");
      const { card } = await requestJson("/api/commit-move", {
        method: "POST",
        body: JSON.stringify({
          cardId: draftMove.cardId,
          toStatus: draftMove.toStatus,
          comment: draftComment,
          githubUrl: draftMove.githubUrl,
          blogUrl: draftMove.blogUrl,
        }),
      });

      setCards((prev) => prev.map((entry) => (entry.id === card.id ? card : entry)));
      cancelDraftMove();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsCommitting(false);
    }
  };

  const handleCommand = async (path, start, stop, successMessage) => {
    if (!isDev) return;

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

  const handleDeleteCard = async (id) => {
    if (!isInteractive) return;

    try {
      setError("");
      await requestJson(`/api/cards/${id}`, {
        method: "DELETE",
      });
      setCards((prev) => prev.filter((entry) => entry.id !== id));
      if (draftMove?.cardId === id) {
        cancelDraftMove();
      }
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const handleArchiveCard = async (id, reason = "archived") => {
    if (!isInteractive) return;

    try {
      setError("");
      await requestJson("/api/archive-card", {
        method: "POST",
        body: JSON.stringify({ cardId: id, reason }),
      });
      setCards((prev) =>
        prev.map((card) =>
          card.id === id
            ? {
                ...card,
                archived: true,
                archivedAt: new Date().toISOString(),
                archiveReason: reason,
              }
            : card
        )
      );
      if (draftMove?.cardId === id) {
        cancelDraftMove();
      }
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const handleUnarchiveCard = async (id) => {
    if (!isInteractive) return;

    try {
      setError("");
      const { card } = await requestJson("/api/unarchive-card", {
        method: "POST",
        body: JSON.stringify({ cardId: id }),
      });
      setCards((prev) => prev.map((entry) => (entry.id === id ? card : entry)));
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const handleDrop = (status) => {
    if (!isInteractive || !draggedCardId) return;
    const card = cards.find((entry) => entry.id === draggedCardId);
    setDraggedCardId(null);
    setHoverStatus(null);
    if (!card) return;
    openMoveDraft(card, status);
  };

  const handleCompleteDrop = () => {
    if (!isInteractive || !draggedCardId) return;
    const card = cards.find((entry) => entry.id === draggedCardId);
    setDraggedCardId(null);
    setHoverStatus(null);
    if (!card || getCurrentStatus(card) !== FINAL_STATUS) return;
    handleArchiveCard(card.id, "explored-successfully");
  };

  return (
    <div className="min-h-screen bg-neutral-50 px-6 py-8 md:px-10">
      <div className="mx-auto max-w-7xl">
        <div className="mb-4 flex items-center justify-between border border-neutral-200 bg-white px-4 py-3">
          <div className="font-serif text-lg font-medium text-neutral-900">Research Lab</div>
          {isDev ? (
            <div className="flex items-center gap-2">
              <div className="mr-2 text-xs text-neutral-500">
                {commandMessage || "Command Center"}
              </div>
              <button
                type="button"
                disabled={isSyncing || isPublishing}
                onClick={() =>
                  handleCommand("/api/sync", setIsSyncing, setIsSyncing, "Portfolio sync complete.")
                }
                className="border border-neutral-200 px-3 py-1.5 text-xs text-neutral-700 transition duration-fast hover:border-neutral-400 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSyncing ? "Syncing..." : "Sync Portfolio"}
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
                className="border border-neutral-200 px-3 py-1.5 text-xs text-neutral-700 transition duration-fast hover:border-neutral-400 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isPublishing ? "Publishing..." : "Publish to Cloud"}
              </button>
            </div>
          ) : (
            <div className="text-[11px] text-neutral-400">Public build: {BUILD_STAMP}</div>
          )}
        </div>

        {error ? (
          <div className="mb-4 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <main className="grid gap-8 border border-neutral-200 bg-white p-6 xl:grid-cols-6">
          {COLUMNS.map((column, index) => (
            <section
              key={column.title}
              onDragOver={
                isInteractive
                  ? (event) => {
                      event.preventDefault();
                      setHoverStatus(column.title);
                    }
                  : undefined
              }
              onDragLeave={
                isInteractive
                  ? () => setHoverStatus((current) => (current === column.title ? null : current))
                  : undefined
              }
              onDrop={
                isInteractive
                  ? (event) => {
                      event.preventDefault();
                      handleDrop(column.title);
                    }
                  : undefined
              }
              className={`group min-h-[30rem] ${index > 0 ? "border-l border-neutral-200 pl-8" : ""}`}
            >
              <header className={`mb-5 flex items-start justify-between gap-3 border-t-2 pt-3 ${column.border}`}>
                <h2 className="font-serif text-xl font-medium text-neutral-900">{column.title}</h2>
                {isInteractive && column.title === INITIAL_STATUS ? (
                  <button
                    type="button"
                    onClick={() => startNewCardDraft(column.title)}
                    className="opacity-0 transition duration-fast group-hover:opacity-100 text-xs text-neutral-500 hover:text-neutral-900"
                  >
                    Add
                  </button>
                ) : null}
              </header>

              <div
                className={`space-y-4 rounded-sm transition duration-normal ${
                  hoverStatus === column.title ? "ring-1 ring-neutral-300" : ""
                }`}
              >
                {grouped[column.title].map((card) => {
                  const isDraftMove = Boolean(card.isDraftMove);
                  const isNewCard = Boolean(card.isNewCard);

                  return (
                    <article
                      key={isNewCard ? "__new-card__" : isDraftMove ? `${card.id}-draft` : card.id}
                      draggable={isInteractive && !isDraftMove && !isNewCard}
                      onDragStart={
                        isInteractive && !isNewCard ? () => setDraggedCardId(card.id) : undefined
                      }
                      onDragEnd={
                        isInteractive && !isNewCard
                          ? () => {
                              setDraggedCardId(null);
                              setHoverStatus(null);
                            }
                          : undefined
                      }
                      className="group/card border border-neutral-200 bg-white p-4 shadow-sm transition duration-normal hover:shadow-md"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-2">
                          <h3 className="font-serif text-lg font-medium text-neutral-900">
                            {isNewCard ? "New Card" : card.title}
                          </h3>
                          {!isNewCard && (card.links?.githubUrl || card.links?.blogUrl) ? (
                            <div className="flex items-center gap-2 text-neutral-500">
                              {card.links?.githubUrl ? (
                                <a href={card.links.githubUrl} target="_blank" rel="noreferrer" className="hover:text-neutral-900">
                                  <GitHubGlyph />
                                </a>
                              ) : null}
                              {card.links?.blogUrl ? (
                                <a href={card.links.blogUrl} target="_blank" rel="noreferrer" className="hover:text-neutral-900">
                                  <LinkGlyph />
                                </a>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-2">
                          {isInteractive && !isDraftMove && !isNewCard ? (
                            <button
                              type="button"
                              onClick={() => handleArchiveCard(card.id)}
                              className="opacity-0 transition duration-fast group-hover/card:opacity-100 text-neutral-400 hover:text-neutral-700"
                              title="Archive"
                            >
                              <ArchiveGlyph />
                            </button>
                          ) : null}
                          {isInteractive && !isDraftMove && !isNewCard ? (
                            <button
                              type="button"
                              onClick={() => handleDeleteCard(card.id)}
                              className="opacity-0 transition duration-fast group-hover/card:opacity-100 text-xs text-neutral-400 hover:text-neutral-700"
                            >
                              Delete
                            </button>
                          ) : null}
                        </div>
                      </div>

                      {isInteractive && isNewCard ? (
                        <div className="mt-4 space-y-3 border-t border-neutral-200 pt-4">
                          <input
                            type="text"
                            value={newCardDraft?.title || ""}
                            onChange={(event) =>
                              setNewCardDraft((current) =>
                                current ? { ...current, title: event.target.value } : current
                              )
                            }
                            placeholder="Title"
                            className="w-full border border-neutral-200 bg-white px-3 py-2 font-serif text-base text-neutral-900 outline-none transition duration-fast placeholder:text-neutral-400 focus:border-neutral-400"
                          />
                          <textarea
                            value={newCardDraft?.description || ""}
                            onChange={(event) =>
                              setNewCardDraft((current) =>
                                current ? { ...current, description: event.target.value } : current
                              )
                            }
                            placeholder="Describe the hypothesis or next step..."
                            className="min-h-24 w-full border border-neutral-200 bg-white px-3 py-2 font-mono text-sm text-neutral-700 outline-none transition duration-fast placeholder:text-neutral-400 focus:border-neutral-400"
                          />
                          <select
                            value={newCardDraft?.track || "#Code"}
                            onChange={(event) =>
                              setNewCardDraft((current) =>
                                current ? { ...current, track: event.target.value } : current
                              )
                            }
                            className="w-full border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700 outline-none transition duration-fast focus:border-neutral-400"
                          >
                            {TRACK_TAGS.map((track) => (
                              <option key={track} value={track}>
                                {track}
                              </option>
                            ))}
                          </select>
                          <div className="flex items-center justify-between">
                            <button
                              type="button"
                              onClick={cancelNewCardDraft}
                              className="text-xs text-neutral-500 hover:text-neutral-900"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              disabled={isCreating}
                              onClick={handleCreateCard}
                              className="rounded-sm bg-neutral-900 px-3 py-1.5 text-sm text-white transition duration-fast hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {isCreating ? "Creating..." : "Create"}
                            </button>
                          </div>
                        </div>
                      ) : null}

                      {isInteractive && isDraftMove ? (
                        <div className="mt-4 space-y-3 border-t border-neutral-200 pt-4">
                          <textarea
                            value={draftComment}
                            onChange={(event) => setDraftComment(event.target.value)}
                            placeholder="Log the Delta for this move..."
                            className="min-h-28 w-full border border-neutral-200 bg-white px-3 py-2 font-mono text-sm text-neutral-700 outline-none transition duration-fast placeholder:text-neutral-400 focus:border-emerald-500"
                          />
                          {draftMove.toStatus === "Artifacts" ? (
                            <>
                              <input
                                type="url"
                                value={draftMove.githubUrl || ""}
                                onChange={(event) =>
                                  setDraftMove((current) =>
                                    current ? { ...current, githubUrl: event.target.value } : current
                                  )
                                }
                                placeholder="GitHub Repo URL"
                                className="w-full border border-neutral-200 bg-white px-3 py-2 font-mono text-sm text-neutral-700 outline-none transition duration-fast placeholder:text-neutral-400 focus:border-neutral-400"
                              />
                              <input
                                type="url"
                                value={draftMove.blogUrl || ""}
                                onChange={(event) =>
                                  setDraftMove((current) =>
                                    current ? { ...current, blogUrl: event.target.value } : current
                                  )
                                }
                                placeholder="Blog/Documentation URL"
                                className="w-full border border-neutral-200 bg-white px-3 py-2 font-mono text-sm text-neutral-700 outline-none transition duration-fast placeholder:text-neutral-400 focus:border-neutral-400"
                              />
                            </>
                          ) : null}
                          <div className="flex justify-end">
                            <button
                              type="button"
                              disabled={isCommitting}
                              onClick={handleCommitMove}
                              className="rounded-sm bg-emerald-500 px-3 py-1.5 text-sm text-white transition duration-fast hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {isCommitting ? "Committing..." : "Commit"}
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </article>
                  );
                })}

                {isInteractive && column.title === FINAL_STATUS ? (
                  <div
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      handleCompleteDrop();
                    }}
                    className="border border-dashed border-emerald-200 px-4 py-5 text-center text-xs text-neutral-500"
                  >
                    Move beyond Broadcast → Explored Successfully
                  </div>
                ) : null}

                {grouped[column.title].length === 0 ? (
                  <div className="border border-dashed border-neutral-200 bg-white px-4 py-10" />
                ) : null}
              </div>
            </section>
          ))}
        </main>

        <section className="mt-8 grid gap-8 xl:grid-cols-[1.4fr_1fr]">
          <article className="border border-neutral-200 bg-white p-6">
            <div className="mb-6 flex items-baseline justify-between gap-4">
              <div>
                <h2 className="font-serif text-2xl font-medium text-neutral-900">
                  Today's Research Ledger
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-neutral-600">
                  A clean record of what changed today across the lab, from fresh hypotheses to
                  new outputs and artifacts.
                </p>
              </div>
              <div className="text-xs uppercase tracking-[0.18em] text-neutral-400">
                {formatDate(new Date())}
              </div>
            </div>

            {todaysEvents.length ? (
              <div className="space-y-5">
                {todaysEvents.map((event) => (
                  <div
                    key={`${event.cardId}-${event.at}-${event.status}`}
                    className="border-l-2 border-emerald-500 pl-4"
                  >
                    <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-400">
                      {formatTime(event.at)}
                    </div>
                    <div className="mt-1 font-serif text-lg text-neutral-900">{event.title}</div>
                    <p className="mt-1 text-sm text-neutral-600">
                      {event.type === "created" ? (
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
                      <p className="mt-2 font-mono text-sm leading-relaxed text-neutral-700 whitespace-pre-wrap">
                        {event.comment}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-neutral-500">
                No lab activity has been logged for today yet.
              </p>
            )}
          </article>

          <article className="border border-neutral-200 bg-white p-6">
            <div className="mb-6">
              <h2 className="font-serif text-2xl font-medium text-neutral-900">Activity Signal</h2>
              <p className="mt-2 text-sm leading-relaxed text-neutral-600">
                A GitHub-style activity field showing the density of research movement over the
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
                <div className="font-serif text-xl text-neutral-900">
                  {activitySummary.currentStreak}
                </div>
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
          </article>
        </section>

        <div className="mt-8 text-sm text-neutral-500">
          Archived: {archivedCards.length} |{" "}
          <button
            type="button"
            onClick={() => setShowArchiveOverlay(true)}
            className="text-neutral-700 underline-offset-2 hover:underline"
          >
            View All
          </button>
        </div>

        {showArchiveOverlay ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/20 px-4">
            <div className="max-h-[80vh] w-full max-w-3xl overflow-y-auto border border-neutral-200 bg-white p-6 shadow-md">
              <div className="mb-6 flex items-center justify-between gap-4">
                <div>
                  <h2 className="font-serif text-2xl font-medium text-neutral-900">Archived Work</h2>
                  <p className="mt-2 text-sm text-neutral-600">
                    Quietly stored explorations and completed research threads.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowArchiveOverlay(false)}
                  className="text-xs text-neutral-500 hover:text-neutral-900"
                >
                  Close
                </button>
              </div>

              <div className="space-y-3">
                {archivedCards.length ? (
                  archivedCards.map((card) => (
                    <div key={card.id} className="flex items-center justify-between border border-neutral-200 p-4">
                      <div>
                        <div className="font-serif text-lg text-neutral-900">{card.title}</div>
                        <div className="mt-1 text-sm text-neutral-500">
                          {card.archiveReason === "explored-successfully"
                            ? "Explored Successfully"
                            : "Archived"}
                        </div>
                      </div>
                      {isInteractive ? (
                        <button
                          type="button"
                          onClick={() => handleUnarchiveCard(card.id)}
                          className="text-xs text-neutral-600 hover:text-neutral-900"
                        >
                          Un-archive
                        </button>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-neutral-500">No archived cards yet.</p>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}


