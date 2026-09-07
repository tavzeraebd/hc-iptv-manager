import { Router, Request, Response } from "express";
import { getMeta, putMeta, metaCacheKey, coerceMeta, type MetaRecord } from "../metaStore";
import { tmdbConfigured, enrichFromTmdb } from "../tmdb";

// GET /api/meta?title=&year=&kind=  — metadados enriquecidos por título.
//
// Lê o cache (`tmdb_meta`). Em miss/stale e com `TMDB_API_KEY` configurado,
// busca no TMDB, grava (`putMeta`) e devolve pôster HD / sinopse / elenco /
// diretor / trailer / duração. Sem a chave, se comporta como na Fase 0 (só
// cache; miss → `{found:false}` e o Player segue com o dado do painel).
// Chamado pelo Player sem token (allow-list em server.ts).

const router = Router();

// Quanto tempo um resultado do cache é considerado fresco (30 dias). Um miss
// (cache negativo) revalida mais cedo, em 7 dias — o título pode ter entrado
// no TMDB depois.
const TTL_HIT_MS = 30 * 24 * 60 * 60 * 1000;
const TTL_MISS_MS = 7 * 24 * 60 * 60 * 1000;

// Dedupe de buscas concorrentes da mesma chave + teto de concorrência global
// (proteção simples contra rajada — o TMDB permite ~50 req/s, e o uso é sob
// demanda, mas um catálogo abrindo várias telas de uma vez não pode virar
// rajada).
const inFlight = new Map<string, Promise<MetaRecord>>();
const MAX_INFLIGHT = 20;

function kindOf(raw: unknown): "movie" | "tv" {
  return raw === "tv" || raw === "series" ? "tv" : "movie";
}

async function fetchAndCache(
  key: string,
  title: string,
  year: number | null,
  kind: "movie" | "tv"
): Promise<MetaRecord> {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const run = (async () => {
    const now = Date.now();
    const enr = await enrichFromTmdb(title, year, kind);
    // Grava até o miss (found:false) — não re-pergunta ao TMDB por TTL_MISS_MS.
    const rec = coerceMeta({ ...enr, kind }, key, now);
    return putMeta(rec).catch(() => rec);
  })();
  inFlight.set(key, run);
  try {
    return await run;
  } finally {
    inFlight.delete(key);
  }
}

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
      if (fresh || !tmdbConfigured() || inFlight.size >= MAX_INFLIGHT) {
        res.json({ ...publicShape(rec), cached: true, stale: !fresh });
        return;
      }
      // stale + tem chave + há folga → revalida no TMDB.
    }

    if (!tmdbConfigured() || inFlight.size >= MAX_INFLIGHT) {
      res.json({
        cacheKey: key,
        found: false,
        cached: false,
        stale: true,
        note: tmdbConfigured() ? "ocupado — tente de novo" : "sem enriquecimento — TMDB_API_KEY ausente",
      });
      return;
    }

    const title = typeof req.query.title === "string" ? req.query.title : "";
    const y = Number.parseInt(String(req.query.year ?? ""), 10);
    const year = Number.isFinite(y) && y > 1870 && y < 2100 ? y : null;
    const fresh = await fetchAndCache(key, title, year, kindOf(req.query.kind));
    res.json({ ...publicShape(fresh), cached: false, stale: false });
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
