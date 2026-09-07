// Cliente mínimo do TMDB (The Movie Database) para enriquecer o catálogo.
//   TMDB_API_KEY — chave v3 (32 hex) OU token v4 (JWT "eyJ...")
//
// Sem a chave, `tmdbConfigured()` é false e a rota /api/meta se comporta como
// na Fase 0 (só lê o cache, responde found:false). Nada aqui lança pra fora:
// erro/404/429/timeout → { found:false }.

const API = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p";
const POSTER_SIZE = "w500";
const BACKDROP_SIZE = "w1280";
const TIMEOUT_MS = 8000;

export function tmdbConfigured(): boolean {
  return !!(process.env.TMDB_API_KEY || "").trim();
}

function apiKey(): string {
  const k = (process.env.TMDB_API_KEY || "").trim();
  if (!k) throw new Error("TMDB_API_KEY não configurado.");
  return k;
}

// v4 token de leitura é um JWT (3 segmentos separados por "."). Qualquer outra
// coisa tratamos como chave v3 (vai no query param api_key).
function isV4Token(k: string): boolean {
  return k.startsWith("eyJ") && k.split(".").length === 3;
}

async function tmdbGet(pathAndQuery: string): Promise<Record<string, unknown> | null> {
  const k = apiKey();
  const v4 = isV4Token(k);
  const sep = pathAndQuery.includes("?") ? "&" : "?";
  const url = `${API}${pathAndQuery}${v4 ? "" : `${sep}api_key=${encodeURIComponent(k)}`}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: v4 ? { Authorization: `Bearer ${k}`, Accept: "application/json" } : { Accept: "application/json" },
    });
    if (!res.ok) return null; // 404 (id inexistente), 401 (chave ruim), 429 (rate limit)…
    return (await res.json().catch(() => null)) as Record<string, unknown> | null;
  } catch {
    return null; // timeout / rede
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------

type TmdbKind = "movie" | "tv";

/** Campos que o portal grava no cache (subconjunto de MetaRecord). */
export interface TmdbEnrichment {
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
}

const NOT_FOUND: TmdbEnrichment = {
  found: false,
  tmdbId: null,
  title: "",
  year: null,
  overview: "",
  posterUrl: null,
  backdropUrl: null,
  rating: null,
  genres: [],
  cast: [],
  director: null,
  trailerKey: null,
  runtimeMin: null,
};

function yearOf(dateStr: unknown): number | null {
  const y = Number.parseInt(String(dateStr ?? "").slice(0, 4), 10);
  return Number.isFinite(y) && y > 1870 && y < 2100 ? y : null;
}

function imgUrl(pathPart: unknown, size: string): string | null {
  return typeof pathPart === "string" && pathPart.startsWith("/") ? `${IMG}/${size}${pathPart}` : null;
}

// Procura o melhor match pelo título. Com ano, prefere o resultado do mesmo
// ano; senão pega o 1º (o TMDB já ordena por popularidade).
async function searchTitle(title: string, year: number | null, kind: TmdbKind): Promise<number | null> {
  const q = new URLSearchParams({ query: title, language: "pt-BR", include_adult: "false" });
  if (year) q.set("year", String(year));
  const data = await tmdbGet(`/search/${kind}?${q.toString()}`);
  const results = Array.isArray(data?.results) ? (data!.results as Record<string, unknown>[]) : [];
  if (results.length === 0) return null;
  if (year) {
    const exact = results.find((r) => yearOf(r.release_date ?? r.first_air_date) === year);
    if (exact && typeof exact.id === "number") return exact.id;
  }
  return typeof results[0].id === "number" ? (results[0].id as number) : null;
}

function pickTrailerKey(videos: unknown): string | null {
  const list = Array.isArray((videos as { results?: unknown })?.results)
    ? ((videos as { results: Record<string, unknown>[] }).results)
    : [];
  const yt = list.filter((v) => v.site === "YouTube" && typeof v.key === "string");
  const trailer =
    yt.find((v) => v.type === "Trailer") ?? yt.find((v) => v.type === "Teaser") ?? yt[0];
  return trailer ? (trailer.key as string) : null;
}

async function fetchDetails(tmdbId: number, kind: TmdbKind): Promise<TmdbEnrichment> {
  const base = await tmdbGet(
    `/${kind}/${tmdbId}?language=pt-BR&append_to_response=credits,videos&include_video_language=pt,en,null`
  );
  if (!base) return NOT_FOUND;

  // Sinopse costuma faltar em pt-BR — completa com en-US.
  let overview = typeof base.overview === "string" ? base.overview : "";
  if (!overview) {
    const en = await tmdbGet(`/${kind}/${tmdbId}?language=en-US`);
    if (en && typeof en.overview === "string") overview = en.overview;
  }

  const credits = (base.credits ?? {}) as Record<string, unknown>;
  const castList = Array.isArray(credits.cast) ? (credits.cast as Record<string, unknown>[]) : [];
  const crewList = Array.isArray(credits.crew) ? (credits.crew as Record<string, unknown>[]) : [];
  const cast = castList
    .slice(0, 15)
    .map((c) => (typeof c.name === "string" ? c.name : ""))
    .filter(Boolean);

  let director: string | null = null;
  if (kind === "movie") {
    const d = crewList.find((c) => c.job === "Director" && typeof c.name === "string");
    director = d ? (d.name as string) : null;
  } else {
    const createdBy = Array.isArray(base.created_by) ? (base.created_by as Record<string, unknown>[]) : [];
    director = typeof createdBy[0]?.name === "string" ? (createdBy[0].name as string) : null;
  }

  const genres = Array.isArray(base.genres)
    ? (base.genres as Record<string, unknown>[]).map((g) => (typeof g.name === "string" ? g.name : "")).filter(Boolean)
    : [];

  let runtimeMin: number | null = null;
  if (typeof base.runtime === "number" && base.runtime > 0) runtimeMin = base.runtime;
  else if (Array.isArray(base.episode_run_time) && typeof base.episode_run_time[0] === "number") {
    runtimeMin = base.episode_run_time[0] as number;
  }

  return {
    found: true,
    tmdbId,
    title: typeof base.title === "string" ? base.title : typeof base.name === "string" ? base.name : "",
    year: yearOf(base.release_date ?? base.first_air_date),
    overview,
    posterUrl: imgUrl(base.poster_path, POSTER_SIZE),
    backdropUrl: imgUrl(base.backdrop_path, BACKDROP_SIZE),
    rating: typeof base.vote_average === "number" && base.vote_average > 0 ? base.vote_average : null,
    genres,
    cast,
    director,
    trailerKey: pickTrailerKey(base.videos),
    runtimeMin,
  };
}

/** Busca no TMDB e devolve o enriquecimento normalizado. Nunca lança. */
export async function enrichFromTmdb(
  title: string,
  year: number | null,
  kind: TmdbKind
): Promise<TmdbEnrichment> {
  try {
    const t = (title || "").trim();
    if (!t) return NOT_FOUND;
    const id = await searchTitle(t, year, kind);
    if (id == null) return NOT_FOUND;
    return await fetchDetails(id, kind);
  } catch {
    return NOT_FOUND;
  }
}
