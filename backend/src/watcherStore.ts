import { promises as fs } from "fs";
import path from "path";
import { supabaseEnabled, getSupabase } from "./db/supabase";
import { normalizeMac } from "./deviceStore";

// Perfis de espectador ("Watcher") por aparelho — estilo Netflix: até 4 por
// device (chave = MAC, o mesmo do deviceStore). Cada Watcher tem nome + avatar;
// o estado pessoal de cada um (progresso de "continuar assistindo", favoritos,
// sinais do motor de recomendação) fica num blob separado, um por
// (mac, watcherId).
//
// Persistência: arquivo (JSON-lines) por padrão / no APK embarcado; Postgres do
// Supabase quando SUPABASE_URL + SUPABASE_SECRET_KEY estão definidos. Mesma
// semântica nos dois modos — espelha deviceStore.ts.

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "..", "data");
const WATCHERS_FILE = path.join(DATA_DIR, "watchers.txt");
const STATE_FILE = path.join(DATA_DIR, "watcher-state.txt");
const WATCHERS_TABLE = "watchers";
const STATE_TABLE = "watcher_state";

export const MAX_WATCHERS = 4;
const MAX_NAME = 80;
const MAX_AVATAR_ID = 40;
const MAX_RECO_EVENTS = 500;
const MAX_RECO_META = 400;
const MAX_STATE_BYTES = 480 * 1024; // folga sob o limite de 512 KB do parser

export interface Watcher {
  mac: string;
  id: string;
  name: string;
  avatarId: string;
  createdAt: number;
  updatedAt: number;
}

export interface WatcherState {
  mac: string;
  watcherId: string;
  /** `{ vod: {id: entry}, series: {id: entry} }` — espelha iptv-progress:<scope>:<kind>. */
  progress: Record<string, unknown>;
  /** `{ live: [...], vod: [...], series: [...] }` — espelha iptv-favorites:<scope>:<kind>. */
  favorites: Record<string, unknown>;
  /** Lista de eventos do motor de reco (iptv-reco-events:<scope>), cauda mais recente. */
  recoEvents: unknown[];
  /** `{ "<kind>:<id>": meta }` — espelha iptv-reco-meta:<scope>. */
  recoMeta: Record<string, unknown>;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Saneamento — nunca confia no formato de entrada externa.
// ---------------------------------------------------------------------------

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function plainObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Um Watcher vindo do corpo/arquivo/linha. `mac` é imposto pelo chamador. */
export function coerceWatcher(raw: unknown, mac: string, now = Date.now()): Watcher | null {
  const o = plainObject(raw);
  const id = str(o.id, 64);
  if (!id) return null;
  return {
    mac,
    id,
    name: str(o.name, MAX_NAME),
    avatarId: str(o.avatarId ?? o.avatar_id, MAX_AVATAR_ID),
    createdAt: num(o.createdAt ?? o.created_at, now),
    updatedAt: num(o.updatedAt ?? o.updated_at, now),
  };
}

/** Lista de Watchers: só ids válidos, sem duplicatas, no máximo MAX_WATCHERS. */
export function coerceWatcherList(raw: unknown, mac: string, now = Date.now()): Watcher[] {
  const arr = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const out: Watcher[] = [];
  for (const item of arr) {
    const w = coerceWatcher(item, mac, now);
    if (!w || seen.has(w.id)) continue;
    seen.add(w.id);
    out.push(w);
    if (out.length >= MAX_WATCHERS) break;
  }
  return out;
}

/** Corta o blob de estado pra caber no limite e não crescer sem teto. */
export function coerceState(raw: unknown, mac: string, watcherId: string, now = Date.now()): WatcherState {
  const o = plainObject(raw);
  let recoEvents = Array.isArray(o.recoEvents) ? o.recoEvents.slice(-MAX_RECO_EVENTS) : [];

  let recoMeta = plainObject(o.recoMeta ?? o.reco_meta);
  const metaKeys = Object.keys(recoMeta);
  if (metaKeys.length > MAX_RECO_META) {
    const kept = metaKeys
      .map((k) => [k, num((recoMeta[k] as Record<string, unknown>)?.updatedAt, 0)] as const)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_RECO_META)
      .map(([k]) => k);
    recoMeta = Object.fromEntries(kept.map((k) => [k, recoMeta[k]]));
  }

  let state: WatcherState = {
    mac,
    watcherId,
    progress: plainObject(o.progress),
    favorites: plainObject(o.favorites),
    recoEvents,
    recoMeta,
    updatedAt: num(o.updatedAt ?? o.updated_at, now),
  };

  // Rede de segurança: se ainda passar do teto, vai enxugando reco.
  if (rawByteLength(state) > MAX_STATE_BYTES) {
    recoEvents = recoEvents.slice(-Math.floor(MAX_RECO_EVENTS / 2));
    state = { ...state, recoEvents };
  }
  if (rawByteLength(state) > MAX_STATE_BYTES) {
    state = { ...state, recoMeta: {} };
  }
  return state;
}

function rawByteLength(v: unknown): number {
  return Buffer.byteLength(JSON.stringify(v), "utf-8");
}

// ---------------------------------------------------------------------------
// Armazenamento em arquivo (JSON-lines)
// ---------------------------------------------------------------------------

async function ensureFile(file: string): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(file);
  } catch {
    await fs.writeFile(file, "", "utf-8");
  }
}

async function writeAtomic(file: string, content: string): Promise<void> {
  await ensureFile(file);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, content, "utf-8");
  await fs.rename(tmp, file);
}

async function fileReadWatchers(): Promise<Watcher[]> {
  await ensureFile(WATCHERS_FILE);
  const content = await fs.readFile(WATCHERS_FILE, "utf-8");
  const out: Watcher[] = [];
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const p = JSON.parse(t) as Record<string, unknown>;
      const mac = normalizeMac(p.mac);
      if (!mac) continue;
      const w = coerceWatcher(p, mac);
      if (w) out.push(w);
    } catch {
      /* linha corrompida — ignora */
    }
  }
  return out;
}

async function fileWriteWatchers(all: Watcher[]): Promise<void> {
  const content = all.map((w) => JSON.stringify(w)).join("\n") + (all.length ? "\n" : "");
  await writeAtomic(WATCHERS_FILE, content);
}

async function fileListWatchers(mac: string): Promise<Watcher[]> {
  const norm = normalizeMac(mac);
  if (!norm) return [];
  return (await fileReadWatchers()).filter((w) => w.mac === norm);
}

async function filePutWatchers(mac: string, list: Watcher[]): Promise<Watcher[]> {
  const norm = normalizeMac(mac);
  if (!norm) throw new Error("MAC inválido.");
  const all = await fileReadWatchers();
  const others = all.filter((w) => w.mac !== norm);
  const mine = list.map((w) => ({ ...w, mac: norm }));
  await fileWriteWatchers([...others, ...mine]);
  return mine;
}

async function fileDeleteWatcher(mac: string, id: string): Promise<boolean> {
  const norm = normalizeMac(mac);
  if (!norm) return false;
  const all = await fileReadWatchers();
  const kept = all.filter((w) => !(w.mac === norm && w.id === id));
  if (kept.length === all.length) return false;
  await fileWriteWatchers(kept);
  // limpa o estado órfão
  const states = await fileReadStates();
  await fileWriteStates(states.filter((s) => !(s.mac === norm && s.watcherId === id)));
  return true;
}

async function fileReadStates(): Promise<WatcherState[]> {
  await ensureFile(STATE_FILE);
  const content = await fs.readFile(STATE_FILE, "utf-8");
  const out: WatcherState[] = [];
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const p = JSON.parse(t) as Record<string, unknown>;
      const mac = normalizeMac(p.mac);
      const wid = str(p.watcherId ?? p.watcher_id, 64);
      if (!mac || !wid) continue;
      out.push(coerceState(p, mac, wid));
    } catch {
      /* ignora */
    }
  }
  return out;
}

async function fileWriteStates(all: WatcherState[]): Promise<void> {
  const content = all.map((s) => JSON.stringify(s)).join("\n") + (all.length ? "\n" : "");
  await writeAtomic(STATE_FILE, content);
}

async function fileGetState(mac: string, id: string): Promise<WatcherState | null> {
  const norm = normalizeMac(mac);
  if (!norm) return null;
  return (await fileReadStates()).find((s) => s.mac === norm && s.watcherId === id) ?? null;
}

async function filePutState(mac: string, id: string, incoming: WatcherState): Promise<PutStateResult> {
  const norm = normalizeMac(mac);
  if (!norm) throw new Error("MAC inválido.");
  const all = await fileReadStates();
  const idx = all.findIndex((s) => s.mac === norm && s.watcherId === id);
  const server = idx >= 0 ? all[idx] : null;
  if (server && server.updatedAt > incoming.updatedAt) {
    return { conflict: true, state: server };
  }
  const next = { ...incoming, mac: norm, watcherId: id };
  if (idx >= 0) all[idx] = next;
  else all.push(next);
  await fileWriteStates(all);
  return { conflict: false, state: next };
}

// ---------------------------------------------------------------------------
// Armazenamento no Supabase (Postgres)
// ---------------------------------------------------------------------------

function rowToWatcher(r: Record<string, unknown>): Watcher | null {
  const mac = normalizeMac(r.mac);
  if (!mac) return null;
  return coerceWatcher(r, mac);
}

function rowToState(r: Record<string, unknown>): WatcherState | null {
  const mac = normalizeMac(r.mac);
  const wid = str(r.watcher_id ?? r.watcherId, 64);
  if (!mac || !wid) return null;
  return coerceState(
    {
      progress: r.progress,
      favorites: r.favorites,
      recoEvents: r.reco_events,
      recoMeta: r.reco_meta,
      updatedAt: r.updated_at,
    },
    mac,
    wid
  );
}

async function sbListWatchers(mac: string): Promise<Watcher[]> {
  const norm = normalizeMac(mac);
  if (!norm) return [];
  const sb = await getSupabase();
  const { data, error } = await sb
    .from(WATCHERS_TABLE)
    .select("*")
    .eq("mac", norm)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => rowToWatcher(r as Record<string, unknown>)).filter((w): w is Watcher => !!w);
}

async function sbPutWatchers(mac: string, list: Watcher[]): Promise<Watcher[]> {
  const norm = normalizeMac(mac);
  if (!norm) throw new Error("MAC inválido.");
  const sb = await getSupabase();
  const mine = list.map((w) => ({ ...w, mac: norm }));
  const keepIds = mine.map((w) => w.id);

  // remove os que sumiram da lista (cascade apaga o watcher_state)
  let del = sb.from(WATCHERS_TABLE).delete().eq("mac", norm);
  if (keepIds.length > 0) del = del.not("id", "in", `(${keepIds.map((i) => `"${i}"`).join(",")})`);
  const delRes = await del;
  if (delRes.error) throw new Error(delRes.error.message);

  if (mine.length > 0) {
    const rows = mine.map((w) => ({
      mac: w.mac,
      id: w.id,
      name: w.name,
      avatar_id: w.avatarId,
      created_at: w.createdAt,
      updated_at: w.updatedAt,
    }));
    const { error } = await sb.from(WATCHERS_TABLE).upsert(rows, { onConflict: "mac,id" });
    if (error) throw new Error(error.message);
  }
  return mine;
}

async function sbDeleteWatcher(mac: string, id: string): Promise<boolean> {
  const norm = normalizeMac(mac);
  if (!norm) return false;
  const sb = await getSupabase();
  const { data, error } = await sb
    .from(WATCHERS_TABLE)
    .delete()
    .eq("mac", norm)
    .eq("id", id)
    .select("id");
  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}

async function sbGetState(mac: string, id: string): Promise<WatcherState | null> {
  const norm = normalizeMac(mac);
  if (!norm) return null;
  const sb = await getSupabase();
  const { data, error } = await sb
    .from(STATE_TABLE)
    .select("*")
    .eq("mac", norm)
    .eq("watcher_id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? rowToState(data as Record<string, unknown>) : null;
}

async function sbPutState(mac: string, id: string, incoming: WatcherState): Promise<PutStateResult> {
  const norm = normalizeMac(mac);
  if (!norm) throw new Error("MAC inválido.");
  const server = await sbGetState(norm, id);
  if (server && server.updatedAt > incoming.updatedAt) {
    return { conflict: true, state: server };
  }
  const sb = await getSupabase();
  const row = {
    mac: norm,
    watcher_id: id,
    progress: incoming.progress,
    favorites: incoming.favorites,
    reco_events: incoming.recoEvents,
    reco_meta: incoming.recoMeta,
    updated_at: incoming.updatedAt,
  };
  const { error } = await sb.from(STATE_TABLE).upsert(row, { onConflict: "mac,watcher_id" });
  if (error) throw new Error(error.message);
  return { conflict: false, state: { ...incoming, mac: norm, watcherId: id } };
}

// ---------------------------------------------------------------------------
// API pública — despacha para o Supabase ou para o arquivo.
// ---------------------------------------------------------------------------

export interface PutStateResult {
  conflict: boolean;
  /** No conflito: o estado do servidor (mais novo). Sem conflito: o que foi gravado. */
  state: WatcherState;
}

export function listWatchers(mac: string): Promise<Watcher[]> {
  return supabaseEnabled() ? sbListWatchers(mac) : fileListWatchers(mac);
}

/** Substitui a lista inteira de Watchers do device. `list` já vem saneada e ≤ MAX_WATCHERS. */
export function putWatchers(mac: string, list: Watcher[]): Promise<Watcher[]> {
  return supabaseEnabled() ? sbPutWatchers(mac, list) : filePutWatchers(mac, list);
}

export function deleteWatcher(mac: string, id: string): Promise<boolean> {
  return supabaseEnabled() ? sbDeleteWatcher(mac, id) : fileDeleteWatcher(mac, id);
}

export function getWatcherState(mac: string, id: string): Promise<WatcherState | null> {
  return supabaseEnabled() ? sbGetState(mac, id) : fileGetState(mac, id);
}

/** Grava o blob de estado. Last-write-wins por `updatedAt`: se o servidor tem um
 * `updatedAt` maior, NÃO grava e devolve `{ conflict: true, state: <servidor> }`. */
export function putWatcherState(mac: string, id: string, incoming: WatcherState): Promise<PutStateResult> {
  return supabaseEnabled() ? sbPutState(mac, id, incoming) : filePutState(mac, id, incoming);
}
