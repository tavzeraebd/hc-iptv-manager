import { promises as fs } from "fs";
import path from "path";
import { supabaseEnabled, getSupabase } from "./db/supabase";

// Cache de metadados enriquecidos (TMDB) por título. FASE 0: só o
// armazenamento + a chave de cache; o fetch real no TMDB entra na Fase 2
// (routes/meta.ts). Mesma persistência dupla dos outros stores:
// arquivo JSON-lines (`tmdb-meta.txt`) ou Supabase (tabela `tmdb_meta`).

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "..", "data");
const DATA_FILE = path.join(DATA_DIR, "tmdb-meta.txt");
const TABLE = "tmdb_meta";

/** Um resultado do TMDB já normalizado para o que o Player consome. */
export interface MetaRecord {
  cacheKey: string;
  kind: "movie" | "tv";
  /** null quando o TMDB não achou nada (cache negativo — evita re-perguntar). */
  found: boolean;
  tmdbId: number | null;
  title: string;
  year: number | null;
  overview: string;
  posterUrl: string | null;
  backdropUrl: string | null;
  rating: number | null;
  genres: string[];
  cast: string[];
  director: string | null;
  trailerKey: string | null;
  runtimeMin: number | null;
  fetchedAt: number;
  updatedAt: number;
}

const KIND = new Set(["movie", "tv"]);

// Normaliza título p/ chave estável: minúsculo, sem acento, sem pontuação,
// espaços colapsados. Ano ausente vira "0". kind default "movie".
export function metaCacheKey(title: unknown, year: unknown, kind: unknown): string | null {
  if (typeof title !== "string") return null;
  const t = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 120);
  if (!t) return null;
  const y = Number.parseInt(String(year ?? ""), 10);
  const yy = Number.isFinite(y) && y > 1870 && y < 2100 ? y : 0;
  const k = kind === "tv" || kind === "series" ? "tv" : "movie";
  return `${t}|${yy}|${k}`;
}

// ---------------------------------------------------------------------------
// Saneamento
// ---------------------------------------------------------------------------

function str(v: unknown, max = 4000): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}
function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function strArr(v: unknown, cap = 20): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && !!x).map((x) => x.slice(0, 120)).slice(0, cap);
}

export function coerceMeta(raw: unknown, cacheKey: string, now = Date.now()): MetaRecord {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const kind: "movie" | "tv" = o.kind === "tv" ? "tv" : "movie";
  return {
    cacheKey,
    kind,
    found: o.found === true,
    tmdbId: numOrNull(o.tmdbId ?? o.tmdb_id),
    title: str(o.title, 300),
    year: numOrNull(o.year),
    overview: str(o.overview, 4000),
    posterUrl: str(o.posterUrl ?? o.poster_url) || null,
    backdropUrl: str(o.backdropUrl ?? o.backdrop_url) || null,
    rating: numOrNull(o.rating),
    genres: strArr(o.genres),
    cast: strArr(o.cast ?? o.cast_json, 15),
    director: str(o.director, 200) || null,
    trailerKey: str(o.trailerKey ?? o.trailer_key, 40) || null,
    runtimeMin: numOrNull(o.runtimeMin ?? o.runtime_min),
    fetchedAt: numOrNull(o.fetchedAt ?? o.fetched_at) ?? now,
    updatedAt: numOrNull(o.updatedAt ?? o.updated_at) ?? now,
  };
}

// ---------------------------------------------------------------------------
// Arquivo (JSON-lines)
// ---------------------------------------------------------------------------

async function ensureFile(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.writeFile(DATA_FILE, "", "utf-8");
  }
}

async function fileReadAll(): Promise<Map<string, MetaRecord>> {
  await ensureFile();
  const content = await fs.readFile(DATA_FILE, "utf-8");
  const map = new Map<string, MetaRecord>();
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const p = JSON.parse(t) as Record<string, unknown>;
      const key = typeof p.cacheKey === "string" ? p.cacheKey : null;
      if (key) map.set(key, coerceMeta(p, key));
    } catch {
      /* linha corrompida */
    }
  }
  return map;
}

async function fileWriteAll(map: Map<string, MetaRecord>): Promise<void> {
  await ensureFile();
  // teto de 5000 entradas — descarta as mais antigas por updatedAt
  let entries = [...map.values()];
  if (entries.length > 5000) {
    entries = entries.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5000);
  }
  const content = entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length ? "\n" : "");
  const tmp = `${DATA_FILE}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, content, "utf-8");
  await fs.rename(tmp, DATA_FILE);
}

async function fileGet(cacheKey: string): Promise<MetaRecord | null> {
  return (await fileReadAll()).get(cacheKey) ?? null;
}

async function filePut(rec: MetaRecord): Promise<MetaRecord> {
  const map = await fileReadAll();
  map.set(rec.cacheKey, rec);
  await fileWriteAll(map);
  return rec;
}

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

function rowToMeta(r: Record<string, unknown>): MetaRecord {
  const key = String(r.cache_key ?? "");
  return coerceMeta(
    {
      kind: r.kind,
      found: r.found,
      tmdbId: r.tmdb_id,
      title: r.title,
      year: r.year,
      overview: r.overview,
      posterUrl: r.poster_url,
      backdropUrl: r.backdrop_url,
      rating: typeof r.rating === "string" ? Number(r.rating) : r.rating,
      genres: r.genres,
      cast: r.cast_json,
      director: r.director,
      trailerKey: r.trailer_key,
      runtimeMin: r.runtime_min,
      fetchedAt: r.fetched_at,
      updatedAt: r.updated_at,
    },
    key
  );
}

async function sbGet(cacheKey: string): Promise<MetaRecord | null> {
  const sb = await getSupabase();
  const { data, error } = await sb.from(TABLE).select("*").eq("cache_key", cacheKey).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? rowToMeta(data as Record<string, unknown>) : null;
}

async function sbPut(rec: MetaRecord): Promise<MetaRecord> {
  const sb = await getSupabase();
  const row = {
    cache_key: rec.cacheKey,
    kind: rec.kind,
    found: rec.found,
    tmdb_id: rec.tmdbId,
    title: rec.title,
    year: rec.year,
    overview: rec.overview,
    poster_url: rec.posterUrl,
    backdrop_url: rec.backdropUrl,
    rating: rec.rating,
    genres: rec.genres,
    cast_json: rec.cast,
    director: rec.director,
    trailer_key: rec.trailerKey,
    runtime_min: rec.runtimeMin,
    fetched_at: rec.fetchedAt,
    updated_at: rec.updatedAt,
  };
  const { error } = await sb.from(TABLE).upsert(row, { onConflict: "cache_key" });
  if (error) throw new Error(error.message);
  return rec;
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

export function getMeta(cacheKey: string): Promise<MetaRecord | null> {
  return supabaseEnabled() ? sbGet(cacheKey) : fileGet(cacheKey);
}

export function putMeta(rec: MetaRecord): Promise<MetaRecord> {
  return supabaseEnabled() ? sbPut(rec) : filePut(rec);
}

export { KIND as META_KINDS };
