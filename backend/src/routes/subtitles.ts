import { Router, Request, Response } from "express";
import { osConfigured, fetchVtt } from "../opensubtitles";

// GET /api/subtitles?query=&year=&lang=  — legenda externa (OpenSubtitles).
//
// Sem OPENSUBTITLES_API_KEY → sempre { found:false } (degrada como o TMDB na
// Fase 0; o Player só não mostra o botão "Buscar legenda"). Com a chave,
// busca no OpenSubtitles, converte SRT→VTT e devolve { found:true, vtt }.
// Chamado pelo Player SEM token (allow-list em server.ts).

const router = Router();

router.get("/subtitles", async (req: Request, res: Response) => {
  const query = typeof req.query.query === "string" ? req.query.query.trim() : "";
  if (!query) {
    res.status(400).json({ error: "Parâmetro query é obrigatório." });
    return;
  }
  if (!osConfigured()) {
    res.json({ found: false, note: "sem legenda externa — OPENSUBTITLES_API_KEY ausente" });
    return;
  }
  const y = Number.parseInt(String(req.query.year ?? ""), 10);
  const year = Number.isFinite(y) && y > 1870 && y < 2100 ? y : null;
  const lang =
    typeof req.query.lang === "string" && req.query.lang.trim()
      ? req.query.lang.trim().toLowerCase()
      : "pt-br";
  try {
    const vtt = await fetchVtt(query, year, lang);
    if (!vtt) {
      res.json({ found: false });
      return;
    }
    res.json({ found: true, lang, vtt });
  } catch {
    res.json({ found: false });
  }
});

export default router;
