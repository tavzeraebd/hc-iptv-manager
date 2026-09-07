import { Router, Request, Response } from "express";
import { getMeta, putMeta, metaCacheKey, coerceMeta } from "../metaStore";

// GET /api/meta?title=&year=&kind=  — metadados enriquecidos por título.
//
// FASE 0 (agora): só lê o cache (`tmdb_meta`). Se não tem nada, responde
// `{ found:false, cached:false }` e o Player segue com o dado do painel — sem
// buscar em lugar nenhum. Chamado pelo Player sem token (allow-list em
// server.ts).
//
// FASE 2: aqui entra o fetch real no TMDB (chave em env `TMDB_API_KEY`),
// grava no cache com `putMeta` e passa a devolver pôster HD / sinopse /
// elenco / trailer.

const router = Router();

// Quanto tempo um resultado do cache é considerado fresco (30 dias). Um miss
// (cache negativo) revalida mais cedo, em 7 dias — o título pode ter entrado
// no TMDB depois.
const TTL_HIT_MS = 30 * 24 * 60 * 60 * 1000;
const TTL_MISS_MS = 7 * 24 * 60 * 60 * 1000;

router.get("/meta", async (req: Request, res: Response) => {
  const key = metaCacheKey(req.query.title, req.query.year, req.query.kind);
  if (!key) {
    res.status(400).json({ error: "Parâmetro title é obrigatório." });
    return;
  }
  try {
    const rec = await getMeta(key);
    const now = Date.now();
    if (rec) {
      const ttl = rec.found ? TTL_HIT_MS : TTL_MISS_MS;
      const fresh = now - rec.fetchedAt < ttl;
      res.json({ ...publicShape(rec), cached: true, stale: !fresh });
      return;
    }
    // Fase 0: nada em cache e nada pra buscar ainda.
    res.json({
      cacheKey: key,
      found: false,
      cached: false,
      stale: true,
      note: "sem enriquecimento — cache vazio (fetch do TMDB entra na Fase 2)",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao consultar metadados.";
    res.status(500).json({ error: message });
  }
});

// PUT /api/meta  — semear/atualizar um registro manualmente (admin; passa pelo
// guard de token). Útil pra corrigir um título específico à mão antes da
// Fase 2, e pros testes.
router.put("/meta", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const key = metaCacheKey(body.title, body.year, body.kind);
  if (!key) {
    res.status(400).json({ error: "title é obrigatório." });
    return;
  }
  try {
    const now = Date.now();
    const rec = coerceMeta({ ...body, fetchedAt: now, updatedAt: now }, key, now);
    const saved = await putMeta(rec);
    res.json({ ...publicShape(saved), cached: true, stale: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao salvar metadados.";
    res.status(500).json({ error: message });
  }
});

function publicShape(rec: Awaited<ReturnType<typeof getMeta>> & object) {
  return {
    cacheKey: rec.cacheKey,
    found: rec.found,
    tmdbId: rec.tmdbId,
    title: rec.title,
    year: rec.year,
    overview: rec.overview,
    posterUrl: rec.posterUrl,
    backdropUrl: rec.backdropUrl,
    rating: rec.rating,
    genres: rec.genres,
    cast: rec.cast,
    director: rec.director,
    trailerKey: rec.trailerKey,
    runtimeMin: rec.runtimeMin,
    fetchedAt: rec.fetchedAt,
  };
}

export default router;
