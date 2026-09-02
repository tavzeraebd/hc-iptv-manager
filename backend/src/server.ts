import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import usersRouter from "./routes/users";
import devicesRouter from "./routes/devices";
import { adminAuth, portalTokenConfigured } from "./middleware/adminAuth";
import { supabaseEnabled } from "./db/supabase";

const app = express();
const PORT = Number(process.env.PORT) || 3001;
// No app Android o backend roda embarcado (nodejs-mobile) e serve só a API;
// a UI é servida pela própria WebView do Capacitor a partir do webDir, então
// não existe frontend/dist ao lado do backend nesse cenário.
const HOST = process.env.HOST || "0.0.0.0";

app.use(cors());
app.use(express.json({ limit: "100kb" }));

// Health check público (fora de /api, então não passa pelo guard de token) —
// usado pelos hosts (Render/Fly) pra saber se o processo está de pé.
app.get("/healthz", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    storage: supabaseEnabled() ? "supabase" : "file",
    tokenRequired: portalTokenConfigured(),
  });
});

// O Player só chama POST /api/devices/heartbeat e não tem token — essa rota
// fica pública. Todo o resto da API passa pelo guard de token (no-op quando
// PORTAL_ADMIN_TOKEN não está definido, como no backend embarcado do APK).
app.use("/api", (req: Request, res: Response, next: NextFunction) => {
  const isHeartbeat =
    req.method === "POST" && /(^|\/)devices\/heartbeat\/?$/.test(req.path);
  if (isHeartbeat) {
    next();
    return;
  }
  adminAuth(req, res, next);
});

app.use("/api", usersRouter);
app.use("/api", devicesRouter);

const frontendDist = path.join(__dirname, "..", "..", "frontend", "dist");
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(frontendDist, "index.html"));
  });
}

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err.message);
  res.status(500).json({ error: "Erro interno do servidor." });
});

app.listen(PORT, HOST, () => {
  console.log(`IPTV Manager rodando em http://${HOST}:${PORT}`);
  console.log(
    `  armazenamento: ${supabaseEnabled() ? "Supabase (Postgres)" : "arquivo (data/*.txt)"}`
  );
  console.log(
    `  token de admin: ${portalTokenConfigured() ? "exigido (x-portal-token)" : "aberto (sem PORTAL_ADMIN_TOKEN)"}`
  );
});
