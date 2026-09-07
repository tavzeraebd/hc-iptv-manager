import { Router, Request, Response } from "express";
import { getWhatsNewConfig, setWhatsNewConfig } from "../whatsNewStore";

// GET  /api/whats-new  — config de "Novidades pra você" (f5-4). Público (o
//                       Player lê sem token). Sem Supabase → default.
// PUT  /api/whats-new  — atualiza a config (atrás do guard de admin).

const router = Router();

router.get("/whats-new", async (_req: Request, res: Response) => {
  try {
    res.json(await getWhatsNewConfig());
  } catch {
    res.json({ enabled: true, title: "Novidades que combinam com você", leadHour: 20 });
  }
});

router.put("/whats-new", async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.json(await setWhatsNewConfig(body));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao salvar a config.";
    res.status(500).json({ error: message });
  }
});

export default router;
