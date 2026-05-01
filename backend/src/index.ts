import "dotenv/config";
import express from "express";
import cors from "cors";
import { runMigrations } from "./db/migrate";
import { probeLibreOffice } from "./lib/libreofficeStatus";
import { chatRouter } from "./routes/chat";
import { projectsRouter } from "./routes/projects";
import { projectChatRouter } from "./routes/projectChat";
import { documentsRouter } from "./routes/documents";
import { tabularRouter } from "./routes/tabular";
import { workflowsRouter } from "./routes/workflows";
import { userRouter } from "./routes/user";
import { downloadsRouter } from "./routes/downloads";
import { authRouter } from "./routes/auth";
import { filesRouter } from "./routes/files";

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(
  cors({
    origin: process.env.FRONTEND_URL ?? "http://localhost:3000",
    credentials: true,
  }),
);

app.use(express.json({ limit: "50mb" }));

app.use("/chat", chatRouter);
app.use("/projects", projectsRouter);
app.use("/projects/:projectId/chat", projectChatRouter);
app.use("/single-documents", documentsRouter);
app.use("/tabular-review", tabularRouter);
app.use("/workflows", workflowsRouter);
app.use("/user", userRouter);
app.use("/users", userRouter);
app.use("/download", downloadsRouter);
app.use("/auth", authRouter);
app.use("/files", filesRouter);

app.get("/health", (_req, res) => res.json({ ok: true }));

if (process.env.WORKSPACE_PATH) {
  try {
    runMigrations();
  } catch (err) {
    console.error("[startup] migrations failed:", err);
    process.exit(1);
  }
}

// Warm the LibreOffice probe in the background so the first /capabilities
// request returns the cached result. Failure is fine — the probe just reports
// unavailable and the frontend shows the install banner when relevant.
probeLibreOffice().then((p) => {
  console.log(
    p.available
      ? `[startup] LibreOffice detected: ${p.version}`
      : "[startup] LibreOffice not detected (DOC/DOCX → PDF rendition disabled)",
  );
});

app.listen(PORT, () => {
  console.log(`Mike backend running on port ${PORT}`);
});
