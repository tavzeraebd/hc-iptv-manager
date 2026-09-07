import { Router, Request, Response } from "express";
import { getNoticeRaw, setNoticeConfig } from "../noticeStore";

// GET  /api/settings/notice  — aviso do provedor atual (bruto, pro admin).
// PUT  /api/settings/notice  — grava { text, kind, until }. Atrás do guard
//                              de admin; o Player recebe o aviso ativo pelo
//                              heartbeat. Trilha do provedor (p-2).

const router = Router();

router.get("/settings/notice", async (_req: Request, res: Response) => {
  try {
    res.json(await getNoticeRaw());
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Erro ao ler o aviso." });
  }
});

router.put("/settings/notice", async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.json(await setNoticeConfig(body));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Erro ao salvar o aviso." });
  }
});

export default router;
