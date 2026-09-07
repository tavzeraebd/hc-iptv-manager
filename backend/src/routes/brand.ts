import { Router, Request, Response } from "express";
import { getBrandConfig, setBrandConfig } from "../brandStore";

// GET  /api/settings/brand  — marca do app (white-label) atual. Atrás do
//                    guard de admin (o Player recebe a marca pelo heartbeat).
// PUT  /api/settings/brand  — grava { name, logoUrl, accent }. Vazio = padrão.
//
// Trilha do provedor (p-1). Armazenamento: brandStore.ts (key "brand" em
// portal_settings). Só no portal hospedado (Supabase); no APK embarcado
// setBrandConfig lança e o PUT responde 500 (esperado — não há admin lá).

const router = Router();

router.get("/settings/brand", async (_req: Request, res: Response) => {
  try {
    res.json((await getBrandConfig()) ?? { name: "", logoUrl: "", accent: "" });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Erro ao ler a marca." });
  }
});

router.put("/settings/brand", async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.json(await setBrandConfig(body));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Erro ao salvar a marca." });
  }
});

export default router;
