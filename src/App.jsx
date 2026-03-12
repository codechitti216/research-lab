import { useEffect, useMemo, useState } from "react";
import seedCards from "../data/db.json";

const STATUSES = ["Hypothesis", "Sandboxing", "Resolved"];
const TRACK_TAGS = ["#Math", "#Code"];

function normalizeCards(input) {
  return Array.isArray(input)
    ? input.map((card) => ({
        ...card,
        history: Array.isArray(card.history) ? card.history : [],
      }))
    : [];
}

function getCurrentStatus(card) {
  return card.history?.[card.history.length - 1]?.status || card.status || "Hypothesis";
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
  const [cards, setCards] = useState(() => normalizeCards(seedCards));
  const [draftMove, setDraftMove] = useState(null);
  const [draftComment, setDraftComment] = useState("");
  const [isCommitting, setIsCommitting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [draggedCardId, setDraggedCardId] = useState(null);
  const [hoverStatus, setHoverStatus] = useState(null);
  const [error, setError] = useState("");
  const [commandMessage, setCommandMessage] = useState("");

  const grouped = useMemo(() => {
    const byStatus = Object.fromEntries(STATUSES.map((status) => [status, []]));
    for (const card of cards) {
      const currentStatus = getCurrentStatus(card);
      if (draftMove?.cardId === card.id && draftMove.fromStatus === currentStatus) {
        continue;
      }
      byStatus[currentStatus]?.push(card);
    }

    if (draftMove) {
      const sourceCard = cards.find((card) => card.id === draftMove.cardId);
      if (sourceCard) {
        byStatus[draftMove.toStatus]?.unshift({
          ...sourceCard,
          status: draftMove.toStatus,
          isDraftMove: true,
        });
      }
    }
    return byStatus;
  }, [cards, draftMove]);

  const cancelDraftMove = () => {
    if (isCommitting) return;
    setDraftMove(null);
    setDraftComment("");
    setHoverStatus(null);
    setDraggedCardId(null);
  };

  useEffect(() => {
    if (!isDev) return undefined;
    if (!draftMove) return undefined;

    const handleUndo = (event) => {
      const isUndo = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z";
      if (!isUndo) return;

      event.preventDefault();
      cancelDraftMove();
    };

    window.addEventListener("keydown", handleUndo);
    return () => window.removeEventListener("keydown", handleUndo);
  }, [draftMove, isCommitting, isDev]);

  const openMoveDraft = (card, toStatus) => {
    if (!isDev) return;
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
    });
  };

  const handleAddCard = async (status) => {
    if (!isDev) return;
    const title = window.prompt("Title?");
    if (!title) return;

    const description = window.prompt("Description? (Daily Delta, notes, etc.)") || "";
    const trackInput = window.prompt("Track? (#Math or #Code)") || "";
    const track =
      TRACK_TAGS.find((tag) => trackInput.toLowerCase().includes(tag.toLowerCase().slice(1))) ||
      "#Code";

    try {
      setError("");
      const { card } = await requestJson("/api/cards", {
        method: "POST",
        body: JSON.stringify({ title, description, track, status }),
      });
      setCards((prev) => [...prev, card]);
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const handleCommitMove = async () => {
    if (!isDev) return;
    if (!draftMove) return;

    try {
      setIsCommitting(true);
      setError("");
      const { card } = await requestJson("/api/commit-move", {
        method: "POST",
        body: JSON.stringify({
          cardId: draftMove.cardId,
          toStatus: draftMove.toStatus,
          comment: draftComment,
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
    if (!isDev) return;
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

  const handleDrop = (status) => {
    if (!isDev) return;
    if (!draggedCardId) return;
    const card = cards.find((entry) => entry.id === draggedCardId);
    setDraggedCardId(null);
    setHoverStatus(null);
    if (!card) return;
    openMoveDraft(card, status);
  };

  return (
    <div className="min-h-screen bg-neutral-50 px-6 py-8 md:px-10">
      <div className="mx-auto max-w-7xl">
        {import.meta.env.DEV && (
          <div className="mb-4 flex items-center justify-between border border-neutral-200 bg-white px-4 py-3">
            <div className="font-serif text-lg font-medium text-neutral-900">Research Lab</div>
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
          </div>
        )}

        {error ? (
          <div className="mb-4 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <main className="grid gap-8 border border-neutral-200 bg-white p-6 xl:grid-cols-3">
          {STATUSES.map((status, index) => (
            <section
              key={status}
              onDragOver={
                isDev
                  ? (event) => {
                      event.preventDefault();
                      setHoverStatus(status);
                    }
                  : undefined
              }
              onDragLeave={
                isDev
                  ? () => setHoverStatus((current) => (current === status ? null : current))
                  : undefined
              }
              onDrop={
                isDev
                  ? (event) => {
                      event.preventDefault();
                      handleDrop(status);
                    }
                  : undefined
              }
              className={`group min-h-[30rem] ${index > 0 ? "border-l border-neutral-200 pl-8" : ""}`}
            >
              <header className="mb-5 flex items-start justify-between gap-3">
                <h2 className="font-serif text-xl font-medium text-neutral-900">{status}</h2>
                {isDev ? (
                  <button
                    type="button"
                    onClick={() => handleAddCard(status)}
                    className="opacity-0 transition duration-fast group-hover:opacity-100 text-xs text-neutral-500 hover:text-neutral-900"
                  >
                    Add
                  </button>
                ) : null}
              </header>

              <div
                className={`space-y-4 rounded-sm transition duration-normal ${
                  hoverStatus === status ? "ring-1 ring-neutral-300" : ""
                }`}
              >
                {grouped[status].map((card) => {
                  const isDraftMove = Boolean(card.isDraftMove);
                  return (
                    <article
                      key={isDraftMove ? `${card.id}-draft` : card.id}
                      draggable={isDev && !isDraftMove}
                      onDragStart={isDev ? () => setDraggedCardId(card.id) : undefined}
                      onDragEnd={
                        isDev
                          ? () => {
                              setDraggedCardId(null);
                              setHoverStatus(null);
                            }
                          : undefined
                      }
                      className="group/card border border-neutral-200 bg-white p-4 shadow-sm transition duration-normal hover:shadow-md"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="font-serif text-lg font-medium text-neutral-900">
                          {card.title}
                        </h3>
                        {isDev && !isDraftMove ? (
                          <button
                            type="button"
                            onClick={() => handleDeleteCard(card.id)}
                            className="opacity-0 transition duration-fast group-hover/card:opacity-100 text-xs text-neutral-400 hover:text-neutral-700"
                          >
                            Delete
                          </button>
                        ) : null}
                      </div>

                      {isDev && isDraftMove ? (
                        <div className="mt-4 space-y-3 border-t border-neutral-200 pt-4">
                          <textarea
                            value={draftComment}
                            onChange={(event) => setDraftComment(event.target.value)}
                            placeholder="Log the Delta for this move..."
                            className="min-h-28 w-full border border-neutral-200 bg-white px-3 py-2 font-mono text-sm text-neutral-700 outline-none transition duration-fast placeholder:text-neutral-400 focus:border-emerald-500"
                          />
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

                {grouped[status].length === 0 ? (
                  <div className="border border-dashed border-neutral-200 bg-white px-4 py-10" />
                ) : null}
              </div>
            </section>
          ))}
        </main>
      </div>
    </div>
  );
}


