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
const execAsync = promisify(exec);

function createId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getCurrentStatus(card: { history?: Array<{ status?: string }>; status?: string }) {
  const history = Array.isArray(card.history) ? card.history : [];
  return history[history.length - 1]?.status || card.status || "Concepts & Ideas";
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

      if (req.method === "POST" && url.pathname === "/api/cards") {
        try {
          const body = JSON.parse(await readBody(req));
          const db = await readJson(DB_PATH);
          const timestamp = new Date().toISOString();
          const card = {
            id: createId(),
            title: String(body.title || "").trim() || "Untitled",
            track: body.track === "#Math" ? "#Math" : "#Code",
            description: String(body.description || "").trim(),
            archived: false,
            archiveReason: null,
            links: {
              githubUrl: String(body.githubUrl || "").trim(),
              blogUrl: String(body.blogUrl || "").trim(),
            },
            history: [
              {
                status: body.status || "Concepts & Ideas",
                at: timestamp,
                comment: String(body.description || "").trim(),
                metadata: {
                  githubUrl: String(body.githubUrl || "").trim(),
                  blogUrl: String(body.blogUrl || "").trim(),
                },
              },
            ],
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

      if (req.method === "PATCH" && url.pathname.startsWith("/api/cards/")) {
        try {
          const body = JSON.parse(await readBody(req));
          const cardId = decodeURIComponent(url.pathname.replace("/api/cards/", ""));
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

      if (req.method === "DELETE" && url.pathname.startsWith("/api/cards/")) {
        try {
          const cardId = decodeURIComponent(url.pathname.replace("/api/cards/", ""));
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

      if (req.method === "POST" && url.pathname === "/api/archive-card") {
        try {
          const body = JSON.parse(await readBody(req));
          const db = await readJson(DB_PATH);
          const cardIndex = db.findIndex((card: { id?: string }) => card.id === body.cardId);

          if (cardIndex === -1) {
            sendJson(res, 404, { error: "Card not found." });
            return;
          }

          const updatedCard = {
            ...db[cardIndex],
            archived: true,
            archiveReason: String(body.reason || "archived"),
            archivedAt: new Date().toISOString(),
          };

          db[cardIndex] = updatedCard;
          await writeJson(DB_PATH, db);
          sendJson(res, 200, { card: updatedCard });
        } catch (error) {
          sendJson(res, 500, {
            error: error instanceof Error ? error.message : "Failed to archive card.",
          });
        }
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/trash-card") {
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

      if (req.method === "POST" && url.pathname === "/api/unarchive-card") {
        try {
          const body = JSON.parse(await readBody(req));
          const db = await readJson(DB_PATH);
          const cardIndex = db.findIndex((card: { id?: string }) => card.id === body.cardId);

          if (cardIndex === -1) {
            sendJson(res, 404, { error: "Card not found." });
            return;
          }

          const updatedCard = {
            ...db[cardIndex],
            archived: false,
            archiveReason: null,
            archivedAt: null,
          };

          db[cardIndex] = updatedCard;
          await writeJson(DB_PATH, db);
          sendJson(res, 200, { card: updatedCard });
        } catch (error) {
          sendJson(res, 500, {
            error: error instanceof Error ? error.message : "Failed to unarchive card.",
          });
        }
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/commit-move") {
        try {
          const body = JSON.parse(await readBody(req));
          const db = await readJson(DB_PATH);
          const ledger = await readJson(LEDGER_PATH);
          const cardIndex = db.findIndex((card: { id?: string }) => card.id === body.cardId);

          if (cardIndex === -1) {
            sendJson(res, 404, { error: "Card not found in db.json." });
            return;
          }

          const card = db[cardIndex];
          const fromStatus = getCurrentStatus(card);
          const toStatus = String(body.toStatus || "").trim();

          if (!toStatus || toStatus === fromStatus) {
            sendJson(res, 400, { error: "Move is unchanged." });
            return;
          }

          const timestamp = new Date().toISOString();
          const updatedCard = {
            ...card,
            description: String(body.comment ?? card.description ?? ""),
            links: {
              githubUrl: String(body.githubUrl ?? card.links?.githubUrl ?? ""),
              blogUrl: String(body.blogUrl ?? card.links?.blogUrl ?? ""),
            },
            history: [
              ...(Array.isArray(card.history) ? card.history : []),
              {
                status: toStatus,
                at: timestamp,
                comment: String(body.comment ?? ""),
                metadata: {
                  githubUrl: String(body.githubUrl ?? card.links?.githubUrl ?? ""),
                  blogUrl: String(body.blogUrl ?? card.links?.blogUrl ?? ""),
                },
              },
            ],
          };

          db[cardIndex] = updatedCard;
          ledger.push({
            timestamp,
            cardId: updatedCard.id,
            title: updatedCard.title,
            track: updatedCard.track,
            fromStatus,
            toStatus,
            comment: String(body.comment ?? ""),
          });

          await Promise.all([writeJson(DB_PATH, db), writeJson(LEDGER_PATH, ledger)]);
          sendJson(res, 200, { card: updatedCard });
        } catch (error) {
          sendJson(res, 500, {
            error: error instanceof Error ? error.message : "Failed to commit move.",
          });
        }
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/sync") {
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

      if (req.method === "POST" && url.pathname === "/api/publish") {
        try {
          const researchLab = await publishRepo(LAB_ROOT, "research: log update");
          const portfolio = await publishRepo(PORTFOLIO_ROOT, "telemetry: sync");

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


