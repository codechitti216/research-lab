import { exec } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

const LAB_ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORTFOLIO_ROOT = path.join(LAB_ROOT, "..", "codechitti216.github.io");
const DB_PATH = path.join(LAB_ROOT, "data", "db.json");
const LEDGER_PATH = path.join(LAB_ROOT, "data", "ledger.json");
const TRASH_LEDGER_PATH = path.join(LAB_ROOT, "data", "trash_ledger.json");
const TODOS_PATH = path.join(LAB_ROOT, "data", "todos.json");
const execAsync = promisify(exec);

function createId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getCurrentStatus(card: { history?: Array<{ status?: string }>; status?: string }) {
  const history = Array.isArray(card.history) ? card.history : [];
  return history[history.length - 1]?.status || card.status || "Concepts & Ideas";
}

function findNodeById(nodes: any[], id: string): any | null {
  for (const n of nodes || []) {
    if (n.id === id) return n;
    const inner = findNodeById(n.subtasks || [], id);
    if (inner) return inner;
  }
  return null;
}

function nodeDepth(nodes: any[], id: string, depth = 0): number | null {
  for (const n of nodes || []) {
    if (n.id === id) return depth;
    const d = nodeDepth(n.subtasks || [], id, depth + 1);
    if (d !== null) return d;
  }
  return null;
}

function completionSnapshot(nodes: any[], acc: Map<string, boolean> = new Map()): Map<string, boolean> {
  for (const n of nodes || []) {
    acc.set(n.id, Boolean(n.completed));
    completionSnapshot(n.subtasks || [], acc);
  }
  return acc;
}

/** Apply the same completion state to the clicked node and everything under it. */
function setSubtreeCompletion(node: any, completed: boolean, ts: string): any {
  return {
    ...node,
    completed,
    completedAt: completed ? ts : null,
    subtasks: (node.subtasks || []).map((c: any) => setSubtreeCompletion(c, completed, ts)),
  };
}

function replaceSubtaskById(nodes: any[], targetId: string, replacer: (n: any) => any): any[] {
  return nodes.map((node) => {
    if (node.id === targetId) return replacer(node);
    if (node.subtasks?.length) {
      return { ...node, subtasks: replaceSubtaskById(node.subtasks, targetId, replacer) };
    }
    return node;
  });
}

/** Parent state is derived from direct children after each toggle. */
function reconcileCompletion(nodes: any[], ts: string): any[] {
  return nodes.map((node) => {
    const children = reconcileCompletion(node.subtasks || [], ts);
    if (children.length === 0) {
      return { ...node, subtasks: children };
    }
    const shouldBeCompleted = children.every((c: any) => c.completed);
    return {
      ...node,
      subtasks: children,
      completed: shouldBeCompleted,
      completedAt: shouldBeCompleted ? node.completedAt || ts : null,
    };
  });
}

function removeSubtaskFromTree(nodes: any[], targetId: string): any[] {
  return (nodes || [])
    .filter((n) => n.id !== targetId)
    .map((n) => ({ ...n, subtasks: removeSubtaskFromTree(n.subtasks || [], targetId) }));
}

type LedgerEntryOut = {
  timestamp: string;
  cardId: string;
  topicTitle: string;
  track: string;
  subjectId: string;
  clickedSubjectId: string;
  clickedSubjectLabel: string;
  eventKind: "parent_complete" | "leaf_complete" | "parent_reopen" | "leaf_reopen";
  title: string;
  fromStatus: string;
  toStatus: string;
  comment: string;
};

function buildSingleLedgerEntry(args: {
  card: any;
  subtasksAfter: any[];
  clickedId: string;
  clickedHadChildren: boolean;
  targetWasCompleted: boolean;
  beforeSnap: Map<string, boolean>;
  afterSnap: Map<string, boolean>;
  ts: string;
}): LedgerEntryOut {
  const {
    card,
    subtasksAfter,
    clickedId,
    clickedHadChildren,
    targetWasCompleted,
    beforeSnap,
    afterSnap,
    ts,
  } = args;

  const changedIds: string[] = [];
  for (const [id, done] of afterSnap.entries()) {
    if (done !== Boolean(beforeSnap.get(id))) changedIds.push(id);
  }

  const topicTitle = String(card.title || "Untitled");
  const clickedNode = findNodeById(subtasksAfter, clickedId);
  const clickedSubjectLabel = String(clickedNode?.text || "task");
  const action = targetWasCompleted ? "reopened" : "completed";
  const transition = targetWasCompleted
    ? { fromStatus: "Checked", toStatus: "Open" }
    : { fromStatus: "Open", toStatus: "Checked" };
  const base = {
    timestamp: ts,
    cardId: card.id,
    topicTitle,
    track: card.track,
    clickedSubjectId: clickedId,
    clickedSubjectLabel,
    fromStatus: transition.fromStatus,
    toStatus: transition.toStatus,
    comment: "",
  };

  if (clickedHadChildren) {
    return {
      ...base,
      subjectId: clickedId,
      eventKind: targetWasCompleted ? "parent_reopen" : "parent_complete",
      title: `${topicTitle}: [${clickedSubjectLabel}] ${action}`,
    };
  }

  const changedParentNodes = changedIds.filter((id) => {
    const node = findNodeById(subtasksAfter, id);
    return node && Array.isArray(node.subtasks) && node.subtasks.length > 0;
  });

  if (changedParentNodes.length > 0) {
    let selectedParentId = changedParentNodes[0];
    let selectedParentDepth = nodeDepth(subtasksAfter, selectedParentId) ?? 999;

    for (const id of changedParentNodes.slice(1)) {
      const depth = nodeDepth(subtasksAfter, id) ?? 999;
      if (depth < selectedParentDepth) {
        selectedParentId = id;
        selectedParentDepth = depth;
      }
    }

    return {
      ...base,
      subjectId: selectedParentId,
      eventKind: targetWasCompleted ? "parent_reopen" : "parent_complete",
      title: `${topicTitle}: [${clickedSubjectLabel}] ${action}`,
    };
  }

  return {
    ...base,
    subjectId: clickedId,
    eventKind: targetWasCompleted ? "leaf_reopen" : "leaf_complete",
    title: `${topicTitle}: [${clickedSubjectLabel}] ${action}`,
  };

  if (clickedHadChildren) {
    return {
      ...base,
      subjectId: clickedId,
      eventKind: targetWasCompleted ? "parent_reopen" : "parent_complete",
      title: `${topicTitle} — Parent ${action} (${node?.text || "task"})`,
    };
  }

  const parentNodes = changedIds.filter((id) => {
    const n = findNodeById(subtasksAfter, id);
    return n && Array.isArray(n.subtasks) && n.subtasks.length > 0;
  });

  if (parentNodes.length > 0) {
    let best = parentNodes[0];
    let bestDepth = nodeDepth(subtasksAfter, best) ?? 999;
    for (const id of parentNodes.slice(1)) {
      const d = nodeDepth(subtasksAfter, id) ?? 999;
      if (d < bestDepth) {
        best = id;
        bestDepth = d;
      }
    }
    const n = findNodeById(subtasksAfter, best);
    return {
      ...base,
      subjectId: best,
      eventKind: targetWasCompleted ? "parent_reopen" : "parent_complete",
      title: `${topicTitle} — Parent topic ${action} (${n?.text || "rollup"})`,
    };
  }

  const leaf = findNodeById(subtasksAfter, clickedId);
  return {
    ...base,
    subjectId: clickedId,
    eventKind: targetWasCompleted ? "leaf_reopen" : "leaf_complete",
    title: `${topicTitle}: [${leaf?.text || ""}] ${action}`,
  };
}

function buildSubtasksFromLines(taskLines: string[]) {
  return taskLines.map((text) => ({
    id: createId(),
    text,
    completed: false,
    completedAt: null,
    subtasks: [] as any[],
  }));
}

async function readJson(filePath: string) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function writeJson(filePath: string, data: unknown) {
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function readJsonOrDefault(filePath: string, fallback: unknown) {
  try {
    return await readJson(filePath);
  } catch {
    return fallback;
  }
}

async function readBody(req: NodeJS.ReadableStream) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(res: import("node:http").ServerResponse, status: number, data: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

async function runCommand(command: string, cwd: string) {
  return execAsync(command, {
    cwd,
    windowsHide: true,
  });
}

function quotePath(filePath: string) {
  return `"${filePath.replace(/"/g, '\\"')}"`;
}

async function readGitFile(
  repoRoot: string,
  rev: string,
  fileRelPath: string
): Promise<string | null> {
  try {
    const result = await execAsync(`git show ${rev}:${fileRelPath}`, {
      cwd: repoRoot,
      windowsHide: true,
    });
    return result.stdout ?? null;
  } catch {
    return null;
  }
}

function safeParseJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeId(card: { id?: unknown }): string | null {
  if (!card || card.id === undefined || card.id === null) return null;
  const id = String(card.id).trim();
  return id ? id : null;
}

async function buildPortfolioCommitMessage(
  labRoot: string,
  portfolioRoot: string
): Promise<string> {
  const snapshotRel = "src/data/labSnapshot.json";
  const snapshotAbs = path.join(portfolioRoot, "src", "data", "labSnapshot.json");

  const baseSnapshotRaw = await readGitFile(portfolioRoot, "HEAD", snapshotRel);
  const baseSnapshot = safeParseJson(baseSnapshotRaw);
  const currSnapshotRaw = await fs.readFile(snapshotAbs, "utf8").catch(() => null);
  const currSnapshot = safeParseJson(currSnapshotRaw);

  const snapshotTrack = (track: unknown) => {
    const value = String(track || "").trim();
    return value ? value : "Track?";
  };

  const snapshotTitle = (title: unknown) => {
    const value = String(title || "").trim();
    return value ? value : "Untitled";
  };

  const latestActivitySummary = (snapshot: any) => {
    const latest = snapshot?.latestActivity;
    if (!latest) return "Research ledger sync";
    const topicTitle = snapshotTitle(latest.topicTitle);
    const taskTitle = String(latest.taskTitle || "").trim();
    const track = snapshotTrack(latest.track);
    return taskTitle ? `${topicTitle}: [${taskTitle}] (${track})` : `${topicTitle} (${track})`;
  };

  const snapshotChangeLines: string[] = [];

  const baseLatest = JSON.stringify((baseSnapshot as any)?.latestActivity ?? null);
  const currLatest = JSON.stringify((currSnapshot as any)?.latestActivity ?? null);
  const baseSyncedAt = String((baseSnapshot as any)?.syncedAt ?? "");
  const currSyncedAt = String((currSnapshot as any)?.syncedAt ?? "");

  if (!baseSnapshot && currSnapshot) {
    snapshotChangeLines.push(`+ ${latestActivitySummary(currSnapshot)}`);
  } else if (baseSnapshot && !currSnapshot) {
    snapshotChangeLines.push("- Research ledger snapshot removed");
  } else if (baseLatest !== currLatest) {
    snapshotChangeLines.push(`~ ${latestActivitySummary(currSnapshot)}`);
  } else if (baseSyncedAt !== currSyncedAt) {
    snapshotChangeLines.push("~ Research ledger sync");
  }

  const snapshotTodosRel = "data/todos.json";
  const snapshotTodosAbs = path.join(labRoot, "data", "todos.json");

  const snapshotBaseTodosRaw = await readGitFile(labRoot, "HEAD", snapshotTodosRel);
  const snapshotBaseTodos = safeParseJson(snapshotBaseTodosRaw);
  const snapshotCurrTodosRaw = await fs.readFile(snapshotTodosAbs, "utf8").catch(() => null);
  const snapshotCurrTodos = safeParseJson(snapshotCurrTodosRaw);

  if (Array.isArray(snapshotCurrTodos)) {
    const snapshotBaseTodoById = new Map<string, any>();
    if (Array.isArray(snapshotBaseTodos)) {
      for (const todo of snapshotBaseTodos) {
        const id = normalizeId(todo as { id?: unknown });
        if (id) snapshotBaseTodoById.set(id, todo);
      }
    }

    for (const todo of snapshotCurrTodos) {
      const id = normalizeId(todo as { id?: unknown });
      const text = snapshotTitle((todo as any)?.text ?? (todo as any)?.title ?? "");
      const currCompletedAt = (todo as any)?.completedAt ? String((todo as any).completedAt) : null;
      if (!id || !currCompletedAt) continue;

      const prevTodo = snapshotBaseTodoById.get(id);
      const prevCompletedAt =
        prevTodo && (prevTodo as any)?.completedAt ? String((prevTodo as any).completedAt) : null;

      if (prevCompletedAt !== currCompletedAt) {
        snapshotChangeLines.push(`${text} (completed)`);
      }
    }
  }

  if (snapshotChangeLines.length === 0) return "Research ledger sync";

  const SNAPSHOT_MAX_LINES = 8;
  const snapshotShown = snapshotChangeLines.slice(0, SNAPSHOT_MAX_LINES);
  const snapshotRemaining = snapshotChangeLines.length - snapshotShown.length;

  const snapshotSuffix = snapshotRemaining > 0 ? `, +${snapshotRemaining} more` : "";
  return `${snapshotShown.join(", ")}${snapshotSuffix}`;

}

async function publishRepo(repoRoot: string, message: string) {
  const command = `cd /d ${quotePath(repoRoot)} && git add . && (git diff --cached --quiet || git commit -m "${message.replace(/"/g, '\\"')}") && git push`;
  return execAsync(command, {
    windowsHide: true,
  });
}

function researchLabPersistence() {
  const attachPersistenceRoutes = (
    middlewares: import("connect").ServerStack | import("vite").ViteDevServer["middlewares"]
  ) => {
    middlewares.use(async (req, res, next) => {
      const url = req.url ? new URL(req.url, "http://localhost") : null;
      if (!url) {
        next();
        return;
      }

      const rawPath = url.pathname;
      const reqPath =
        rawPath === "/research-lab" || rawPath.startsWith("/research-lab/")
          ? rawPath.slice("/research-lab".length) || "/"
          : rawPath;

      if (req.method === "GET" && reqPath === "/api/health") {
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === "GET" && reqPath === "/api/cards") {
        try {
          const db = await readJson(DB_PATH);
          sendJson(res, 200, { cards: Array.isArray(db) ? db : [] });
        } catch (error) {
          sendJson(res, 500, {
            error: error instanceof Error ? error.message : "Failed to read cards.",
          });
        }
        return;
      }

      if (req.method === "GET" && reqPath === "/api/ledger") {
        try {
          const ledger = await readJsonOrDefault(LEDGER_PATH, []);
          sendJson(res, 200, { ledger: Array.isArray(ledger) ? ledger : [] });
        } catch (error) {
          sendJson(res, 500, {
            error: error instanceof Error ? error.message : "Failed to read ledger.",
          });
        }
        return;
      }

      if (req.method === "POST" && reqPath === "/api/cards") {
        try {
          const body = JSON.parse(await readBody(req));
          const db = await readJson(DB_PATH);
          const title = String(body.title || "").trim() || "Untitled";
          const taskLines = String(body.tasksText || body.tasks || "")
            .split(/\r?\n/)
            .map((l: string) => l.trim())
            .filter(Boolean);
          const subtasks =
            Array.isArray(body.subtasks) && body.subtasks.length
              ? body.subtasks
              : taskLines.length
                ? buildSubtasksFromLines(taskLines)
                : buildSubtasksFromLines([title]);
          const card = {
            id: createId(),
            title,
            track: body.track === "#Math" ? "#Math" : "#Code",
            description: String(body.description || "").trim(),
            links: {
              githubUrl: String(body.githubUrl || "").trim(),
              blogUrl: String(body.blogUrl || "").trim(),
            },
            subtasks,
          };

          db.push(card);
          await writeJson(DB_PATH, db);
          sendJson(res, 200, { card });
        } catch (error) {
          sendJson(res, 500, {
            error: error instanceof Error ? error.message : "Failed to create card.",
          });
        }
        return;
      }

      if (req.method === "POST" && reqPath === "/api/topics") {
        try {
          const body = JSON.parse(await readBody(req));
          const title = String(body.title || "").trim();
          if (!title) {
            sendJson(res, 400, { error: "Topic title is required." });
            return;
          }
          const db = await readJson(DB_PATH);
          const taskLines = String(body.tasksText || "")
            .split(/\r?\n/)
            .map((l: string) => l.trim())
            .filter(Boolean);
          const subtasks = taskLines.length
            ? buildSubtasksFromLines(taskLines)
            : buildSubtasksFromLines(["First step"]);
          const card = {
            id: createId(),
            title,
            track: body.track === "#Math" ? "#Math" : "#Code",
            description: "",
            links: { githubUrl: "", blogUrl: "" },
            subtasks,
          };
          db.push(card);
          await writeJson(DB_PATH, db);
          sendJson(res, 200, { card });
        } catch (error) {
          sendJson(res, 500, {
            error: error instanceof Error ? error.message : "Failed to create topic.",
          });
        }
        return;
      }

      if (req.method === "POST" && reqPath === "/api/subtasks/toggle") {
        try {
          const body = JSON.parse(await readBody(req));
          const topicId = String(body.topicId || "").trim();
          const subtaskId = String(body.subtaskId || "").trim();
          if (!topicId || !subtaskId) {
            sendJson(res, 400, { error: "topicId and subtaskId are required." });
            return;
          }
          const db = await readJson(DB_PATH);
          const ledger = await readJsonOrDefault(LEDGER_PATH, []);
          const cardIndex = db.findIndex((card: { id?: string }) => card.id === topicId);
          if (cardIndex === -1) {
            sendJson(res, 404, { error: "Topic not found." });
            return;
          }
          const card = db[cardIndex];
          const subtasks = Array.isArray(card.subtasks) ? card.subtasks : [];
          const target = findNodeById(subtasks, subtaskId);
          if (!target) {
            sendJson(res, 404, { error: "Subtask not found." });
            return;
          }

          const ts = new Date().toISOString();
          const beforeSnap = completionSnapshot(subtasks);
          const clickedHadChildren = Array.isArray(target.subtasks) && target.subtasks.length > 0;
          const targetWasCompleted = Boolean(target.completed);

          let nextSubtasks = replaceSubtaskById(subtasks, subtaskId, (n) =>
            setSubtreeCompletion(n, !targetWasCompleted, ts)
          );
          nextSubtasks = reconcileCompletion(nextSubtasks, ts);
          const afterSnap = completionSnapshot(nextSubtasks);

          const ledgerEntry = buildSingleLedgerEntry({
            card,
            subtasksAfter: nextSubtasks,
            clickedId: subtaskId,
            clickedHadChildren,
            targetWasCompleted,
            beforeSnap,
            afterSnap,
            ts,
          });

          const updatedCard = {
            ...card,
            subtasks: nextSubtasks,
          };
          db[cardIndex] = updatedCard;
          const log = Array.isArray(ledger) ? ledger : [];
          log.push(ledgerEntry);
          await Promise.all([writeJson(DB_PATH, db), writeJson(LEDGER_PATH, log)]);
          sendJson(res, 200, { card: updatedCard, ledgerEntry });
        } catch (error) {
          sendJson(res, 500, {
            error: error instanceof Error ? error.message : "Failed to toggle subtask.",
          });
        }
        return;
      }

      const subtaskAddMatch = reqPath.match(/^\/api\/topics\/([^/]+)\/subtasks$/);
      if (req.method === "POST" && subtaskAddMatch) {
        try {
          const topicId = decodeURIComponent(subtaskAddMatch[1]);
          const body = JSON.parse(await readBody(req));
          const text = String(body.text || "").trim();
          if (!text) {
            sendJson(res, 400, { error: "Sub-task text is required." });
            return;
          }
          const parentSubtaskId = body.parentSubtaskId
            ? String(body.parentSubtaskId).trim()
            : null;

          const db = await readJson(DB_PATH);
          const cardIndex = db.findIndex((card: { id?: string }) => card.id === topicId);
          if (cardIndex === -1) {
            sendJson(res, 404, { error: "Topic not found." });
            return;
          }
          const card = db[cardIndex];
          const subtasks = Array.isArray(card.subtasks) ? card.subtasks : [];
          const newNode = {
            id: createId(),
            text,
            completed: false,
            completedAt: null,
            subtasks: [] as any[],
          };

          if (parentSubtaskId && !findNodeById(subtasks, parentSubtaskId)) {
            sendJson(res, 404, { error: "Parent sub-task not found." });
            return;
          }

          const nextSubtasks = parentSubtaskId
            ? replaceSubtaskById(subtasks, parentSubtaskId, (p) => ({
                ...p,
                subtasks: [...(p.subtasks || []), newNode],
              }))
            : [...subtasks, newNode];

          const updatedCard = { ...card, subtasks: nextSubtasks };
          db[cardIndex] = updatedCard;
          await writeJson(DB_PATH, db);
          sendJson(res, 200, { card: updatedCard, subtask: newNode });
        } catch (error) {
          sendJson(res, 500, {
            error: error instanceof Error ? error.message : "Failed to add sub-task.",
          });
        }
        return;
      }

      const subtaskDelMatch = reqPath.match(/^\/api\/topics\/([^/]+)\/subtasks\/([^/]+)$/);
      if (req.method === "DELETE" && subtaskDelMatch) {
        try {
          const topicId = decodeURIComponent(subtaskDelMatch[1]);
          const subtaskId = decodeURIComponent(subtaskDelMatch[2]);
          const db = await readJson(DB_PATH);
          const cardIndex = db.findIndex((card: { id?: string }) => card.id === topicId);
          if (cardIndex === -1) {
            sendJson(res, 404, { error: "Topic not found." });
            return;
          }
          const card = db[cardIndex];
          const subtasks = Array.isArray(card.subtasks) ? card.subtasks : [];
          if (!findNodeById(subtasks, subtaskId)) {
            sendJson(res, 404, { error: "Sub-task not found." });
            return;
          }
          const nextSubtasks = removeSubtaskFromTree(subtasks, subtaskId);
          const updatedCard = { ...card, subtasks: nextSubtasks };
          db[cardIndex] = updatedCard;
          await writeJson(DB_PATH, db);
          sendJson(res, 200, { card: updatedCard });
        } catch (error) {
          sendJson(res, 500, {
            error: error instanceof Error ? error.message : "Failed to delete sub-task.",
          });
        }
        return;
      }

      if (req.method === "PATCH" && reqPath.startsWith("/api/cards/")) {
        try {
          const body = JSON.parse(await readBody(req));
          const cardId = decodeURIComponent(reqPath.replace("/api/cards/", ""));
          const db = await readJson(DB_PATH);
          const cardIndex = db.findIndex((card: { id?: string }) => card.id === cardId);

          if (cardIndex === -1) {
            sendJson(res, 404, { error: "Card not found." });
            return;
          }

          const updatedCard = {
            ...db[cardIndex],
            description: String(body.description ?? db[cardIndex].description ?? ""),
            links: {
              githubUrl: String(body.githubUrl ?? db[cardIndex].links?.githubUrl ?? ""),
              blogUrl: String(body.blogUrl ?? db[cardIndex].links?.blogUrl ?? ""),
            },
          };

          db[cardIndex] = updatedCard;
          await writeJson(DB_PATH, db);
          sendJson(res, 200, { card: updatedCard });
        } catch (error) {
          sendJson(res, 500, {
            error: error instanceof Error ? error.message : "Failed to update card.",
          });
        }
        return;
      }

      if (req.method === "DELETE" && reqPath.startsWith("/api/cards/")) {
        try {
          const cardId = decodeURIComponent(reqPath.replace("/api/cards/", ""));
          const db = await readJson(DB_PATH);
          const nextDb = db.filter((card: { id?: string }) => card.id !== cardId);

          if (nextDb.length === db.length) {
            sendJson(res, 404, { error: "Card not found." });
            return;
          }

          await writeJson(DB_PATH, nextDb);
          sendJson(res, 200, { ok: true });
        } catch (error) {
          sendJson(res, 500, {
            error: error instanceof Error ? error.message : "Failed to delete card.",
          });
        }
        return;
      }

      if (req.method === "POST" && reqPath === "/api/trash-card") {
        try {
          const body = JSON.parse(await readBody(req));
          const db = await readJson(DB_PATH);
          const trashLedger = await readJsonOrDefault(TRASH_LEDGER_PATH, []);
          const cardIndex = db.findIndex((card: { id?: string }) => card.id === body.cardId);

          if (cardIndex === -1) {
            sendJson(res, 404, { error: "Card not found." });
            return;
          }

          const [trashedCard] = db.splice(cardIndex, 1);
          trashLedger.push({
            timestamp: new Date().toISOString(),
            cardId: trashedCard.id,
            title: trashedCard.title,
            track: trashedCard.track,
            status: getCurrentStatus(trashedCard),
            reason: String(body.reason || "").trim(),
          });

          await Promise.all([writeJson(DB_PATH, db), writeJson(TRASH_LEDGER_PATH, trashLedger)]);
          sendJson(res, 200, { ok: true });
        } catch (error) {
          sendJson(res, 500, {
            error: error instanceof Error ? error.message : "Failed to trash card.",
          });
        }
        return;
      }

      if (req.method === "POST" && reqPath === "/api/todos/add") {
        try {
          const body = JSON.parse(await readBody(req));
          const text = String(body.text || "").trim();

          if (!text) {
            sendJson(res, 400, { error: "Todo text is required." });
            return;
          }

          const todos = await readJsonOrDefault(TODOS_PATH, []);
          const normalized = Array.isArray(todos) ? todos : [];

          const todo = {
            id: createId(),
            text,
            completedAt: null,
          };

          normalized.push(todo);
          await writeJson(TODOS_PATH, normalized);
          sendJson(res, 200, { todo });
        } catch (error) {
          sendJson(res, 500, {
            error: error instanceof Error ? error.message : "Failed to add todo.",
          });
        }
        return;
      }

      if (req.method === "POST" && reqPath === "/api/todos/toggle") {
        try {
          const body = JSON.parse(await readBody(req));
          const todoId = String(body.id || "").trim();

          if (!todoId) {
            sendJson(res, 400, { error: "Todo id is required." });
            return;
          }

          const todos = await readJsonOrDefault(TODOS_PATH, []);
          const normalized = Array.isArray(todos) ? todos : [];

          const idx = normalized.findIndex((t: { id?: string }) => t.id === todoId);
          if (idx === -1) {
            sendJson(res, 404, { error: "Todo not found." });
            return;
          }

          const currentlyCompleted = Boolean(normalized[idx]?.completedAt);
          normalized[idx] = {
            ...normalized[idx],
            completedAt: currentlyCompleted ? null : new Date().toISOString(),
          };

          await writeJson(TODOS_PATH, normalized);
          sendJson(res, 200, { todo: normalized[idx] });
        } catch (error) {
          sendJson(res, 500, {
            error: error instanceof Error ? error.message : "Failed to toggle todo.",
          });
        }
        return;
      }

      if (req.method === "POST" && reqPath === "/api/sync") {
        try {
          const result = await runCommand("node scripts/sync.js", LAB_ROOT);
          sendJson(res, 200, {
            ok: true,
            stdout: result.stdout,
            stderr: result.stderr,
          });
        } catch (error) {
          sendJson(res, 500, {
            error: error instanceof Error ? error.message : "Failed to sync portfolio.",
          });
        }
        return;
      }

      if (req.method === "POST" && reqPath === "/api/publish") {
        try {
          const publishMessage = await buildPortfolioCommitMessage(LAB_ROOT, PORTFOLIO_ROOT);
          const researchLab = await publishRepo(LAB_ROOT, publishMessage);
          const portfolio = await publishRepo(PORTFOLIO_ROOT, publishMessage);

          sendJson(res, 200, {
            ok: true,
            researchLab,
            portfolio,
          });
        } catch (error) {
          sendJson(res, 500, {
            error: error instanceof Error ? error.message : "Failed to publish repositories.",
          });
        }
        return;
      }

      next();
    });
  };

  return {
    name: "research-lab-persistence",
    configureServer(server: import("vite").ViteDevServer) {
      attachPersistenceRoutes(server.middlewares);
    },
    configurePreviewServer(server: import("vite").PreviewServer) {
      attachPersistenceRoutes(server.middlewares);
    },
  };
}

export default defineConfig({
  base: "/research-lab/",
  define: {
    __BUILD_STAMP__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [tailwindcss(), react(), researchLabPersistence()],
  server: {
    port: 5173
  }
});
