// Cliente mínimo do OpenSubtitles (api.opensubtitles.com) para buscar uma
// legenda externa por título+ano quando o stream não traz faixa embutida
// (quick win q-5).
//   OPENSUBTITLES_API_KEY — chave de API (painel: profile → API consumers)
//
// Sem a chave, `osConfigured()` é false e a rota /api/subtitles responde
// sempre { found:false } (mesma degradação do TMDB na Fase 0). Nada aqui
// lança pra fora: erro/404/429/quota/timeout → null.

const API = "https://api.opensubtitles.com/api/v1";
const USER_AGENT = "HC IPTV v1.4";
const TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function osConfigured(): boolean {
  return !!(process.env.OPENSUBTITLES_API_KEY || "").trim();
}

function apiKey(): string {
  const k = (process.env.OPENSUBTITLES_API_KEY || "").trim();
  if (!k) throw new Error("OPENSUBTITLES_API_KEY não configurado.");
  return k;
}

// Legenda é grande e a cota do OpenSubtitles é apertada — cacheia o VTT (e
// também o miss) em memória por 7 dias. Sem tabela: é quick win.
const cache = new Map<string, { vtt: string | null; at: number }>();

function cacheKey(query: string, year: number | null, lang: string): string {
  return `${lang}::${year ?? ""}::${query.toLowerCase().trim()}`;
}

interface FetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

async function osFetch(url: string, init?: FetchInit): Promise<Response | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: init?.method,
      body: init?.body,
      signal: ctrl.signal,
      headers: {
        "Api-Key": apiKey(),
        "User-Agent": USER_AGENT,
        Accept: "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    return null; // timeout / rede
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// SRT → WebVTT: prefixo WEBVTT + vírgula→ponto nos timestamps. Os índices
// numéricos viram identificadores de cue (válidos em VTT).
function srtToVtt(srt: string): string {
  const body = srt
    .replace(/^﻿/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2")
    .trim();
  if (/^WEBVTT/.test(body)) return body.endsWith("\n") ? body : `${body}\n`;
  return `WEBVTT\n\n${body}\n`;
}

interface OsFile {
  file_id?: number;
}
interface OsSubtitle {
  attributes?: {
    language?: string;
    download_count?: number;
    files?: OsFile[];
  };
}

async function searchBestFileId(
  query: string,
  year: number | null,
  lang: string
): Promise<number | null> {
  const q = new URLSearchParams({ query, languages: lang });
  if (year) q.set("year", String(year));
  const res = await osFetch(`${API}/subtitles?${q.toString()}`);
  if (!res || !res.ok) return null;
  const json = (await res.json().catch(() => null)) as { data?: OsSubtitle[] } | null;
  const list = Array.isArray(json?.data) ? json!.data! : [];
  const best = list
    .filter((s) => Array.isArray(s.attributes?.files) && s.attributes!.files!.length > 0)
    .sort(
      (a, b) => (b.attributes?.download_count ?? 0) - (a.attributes?.download_count ?? 0)
    )[0];
  const fileId = best?.attributes?.files?.[0]?.file_id;
  return typeof fileId === "number" ? fileId : null;
}

async function downloadLink(fileId: number): Promise<string | null> {
  const res = await osFetch(`${API}/download`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: fileId }),
  });
  if (!res || !res.ok) return null;
  const json = (await res.json().catch(() => null)) as { link?: string } | null;
  return typeof json?.link === "string" ? json.link : null;
}

/** Busca uma legenda e devolve o conteúdo já em WebVTT, ou null. Nunca lança. */
export async function fetchVtt(
  query: string,
  year: number | null,
  lang = "pt-br"
): Promise<string | null> {
  try {
    const q = (query || "").trim();
    if (!q) return null;
    const key = cacheKey(q, year, lang);
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.vtt;

    let vtt: string | null = null;
    const fileId = await searchBestFileId(q, year, lang);
    if (fileId != null) {
      const link = await downloadLink(fileId);
      if (link) {
        const raw = await fetchText(link);
        if (raw && raw.trim().length > 0) vtt = srtToVtt(raw);
      }
    }
    cache.set(key, { vtt, at: Date.now() });
    return vtt;
  } catch {
    return null;
  }
}
