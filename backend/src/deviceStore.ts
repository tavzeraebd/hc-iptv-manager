import { promises as fs } from "fs";
import path from "path";
import { supabaseEnabled, getSupabase } from "./db/supabase";

// Registro de dispositivos (o backend do Manager é o "portal" no modelo
// player <-> portal, estilo IBO Player / Duplex): cada aparelho do Player se
// anuncia por MAC via POST /api/devices/heartbeat, o admin vincula um dos
// servidores de usuarios.txt e libera.
//
// Persistência: em arquivo (JSON-lines devices.txt) por padrão / no APK
// embarcado; no Postgres do Supabase quando SUPABASE_URL + SUPABASE_SECRET_KEY
// estão definidos (portal hospedado). Mesma semântica nos dois modos.

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "..", "data");
const DATA_FILE = path.join(DATA_DIR, "devices.txt");
const TABLE = "devices";
const DAY_MS = 86_400_000;
const DEFAULT_VALIDITY_DAYS = 30;

export type DeviceStatus = "pending" | "active" | "disabled";
/** Estado efetivo de acesso (status + validade). */
export type DeviceAccess = "pending" | "active" | "disabled" | "expired";

export interface Device {
  mac: string;
  name: string;
  model: string;
  platform: string;
  firstSeenAt: number;
  lastSeenAt: number;
  status: DeviceStatus;
  /**
   * Linhas vinculadas (ids de entradas de usuarios.txt / iptv_users), em ordem
   * de prioridade: `[0]` é a principal, as demais são reservas de failover.
   * Vazio = nenhuma linha vinculada.
   */
  boundServerIds: string[];
  /** Validade do acesso (epoch ms). null = sem validade (vitalício). */
  expiresAt: number | null;
  /** Quando o teste grátis automático foi concedido a este device (epoch ms).
   * null = nunca teve teste. Garante que o teste só é dado 1x por device. */
  trialStartedAt: number | null;
  /** O que o Player está reproduzindo agora, reportado a cada heartbeat
   * enquanto assiste. null = parado/navegando. Só existe pra devices que
   * entraram via pareamento (o portal não sabe de nada rodando fora dele). */
  nowPlaying: NowPlaying | null;
}

export interface NowPlaying {
  kind: "live" | "vod" | "series";
  title: string;
  /** Quando começou a tocar este item (epoch ms). */
  startedAt: number;
}

const NOW_PLAYING_KINDS = new Set(["live", "vod", "series"]);

// Sanitiza o `nowPlaying` vindo do heartbeat (ou lido do storage) — nunca
// confia no formato de entrada externa.
export function coerceNowPlaying(raw: unknown): NowPlaying | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.kind !== "string" || !NOW_PLAYING_KINDS.has(o.kind)) return null;
  if (typeof o.title !== "string" || !o.title.trim()) return null;
  const startedAt =
    typeof o.startedAt === "number" && Number.isFinite(o.startedAt) ? o.startedAt : Date.now();
  return { kind: o.kind as NowPlaying["kind"], title: o.title.trim().slice(0, 200), startedAt };
}

export interface HeartbeatInput {
  mac: string;
  name?: string;
  model?: string;
  platform?: string;
  /** `undefined` = não informado (Player antigo); `null`/objeto = estado atual. */
  nowPlaying?: NowPlaying | null;
}

/** Concessão de teste grátis a aplicar SÓ quando o device é criado agora (1º
 * heartbeat). Montada na rota a partir de RenewalConfig. */
export interface TrialGrant {
  serverId: string;
  expiresAt: number;
}

export interface DeviceAdminPatch {
  name?: string;
  /** Linha única (compat). `null`/`""` desvincula. Ignorado se `boundServerIds` vier. */
  boundServerId?: string | null;
  /**
   * Lista ordenada de linhas (principal + reservas). `null` ou `[]` desvincula
   * todas. Tem prioridade sobre `boundServerId`.
   */
  boundServerIds?: string[] | null;
  status?: DeviceStatus;
  /** Define a validade absoluta. `null` = vitalício. `undefined` = não mexe. */
  expiresAt?: number | null;
  /** Renova: soma dias à validade atual (se ainda válida) ou a partir de agora. */
  extendDays?: number;
  /** Dias de validade padrão ao ativar sem prazo definido (default 30). */
  defaultValidityDays?: number;
}

// AA:BB:CC:DD:EE:FF maiúsculo. Aceita entrada com "-" ou "." ou sem separador.
export function normalizeMac(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const hex = raw.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
  if (hex.length !== 12) return null;
  return hex.match(/.{2}/g)!.join(":");
}

function coerceStatus(v: unknown): DeviceStatus {
  return v === "active" || v === "disabled" ? v : "pending";
}

// Normaliza uma lista de ids de linha: só strings não-vazias, sem duplicatas,
// preservando a ordem. Aceita também o formato antigo (id único em string).
function coerceServerIds(raw: unknown, legacy?: unknown): string[] {
  const arr = Array.isArray(raw)
    ? raw
    : typeof legacy === "string" && legacy
    ? [legacy]
    : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of arr) {
    if (typeof v === "string" && v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

// Resolve a nova lista de linhas a partir do patch. `undefined` = não mexe.
function resolveBoundServerIds(
  current: string[],
  patch: DeviceAdminPatch
): string[] | undefined {
  if (patch.boundServerIds !== undefined) {
    return patch.boundServerIds === null ? [] : coerceServerIds(patch.boundServerIds);
  }
  if (patch.boundServerId !== undefined) {
    return patch.boundServerId ? [patch.boundServerId] : [];
  }
  return undefined;
}

/** Acesso expirou? (só relevante quando status === "active") */
export function isExpired(d: Device, now = Date.now()): boolean {
  return d.expiresAt != null && d.expiresAt <= now;
}

/** Estado efetivo: pending / disabled / expired / active. */
export function accessOf(d: Device, now = Date.now()): DeviceAccess {
  if (d.status === "disabled") return "disabled";
  if (d.status === "pending") return "pending";
  return isExpired(d, now) ? "expired" : "active";
}

// Resolve a nova validade a partir do patch. Retorna `undefined` para "não
// mexer", `null` para "vitalício", ou um epoch ms.
function resolveExpiry(
  current: number | null,
  patch: DeviceAdminPatch,
  now: number
): number | null | undefined {
  if (patch.expiresAt !== undefined) return patch.expiresAt; // explícito (número ou null)
  if (patch.extendDays && patch.extendDays > 0) {
    const base = current != null && current > now ? current : now;
    return base + patch.extendDays * DAY_MS;
  }
  // Ativando sem prazo atual válido -> aplica o padrão (30 dias).
  if (patch.status === "active" && (current == null || current <= now)) {
    const days =
      patch.defaultValidityDays && patch.defaultValidityDays > 0
        ? patch.defaultValidityDays
        : DEFAULT_VALIDITY_DAYS;
    return now + days * DAY_MS;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Armazenamento em arquivo (JSON-lines)
// ---------------------------------------------------------------------------

async function ensureDataFile(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.writeFile(DATA_FILE, "", "utf-8");
  }
}

function parseLine(line: string): Device | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const p = JSON.parse(trimmed);
    const mac = normalizeMac(p.mac);
    if (!mac) return null;
    return {
      mac,
      name: typeof p.name === "string" ? p.name : "",
      model: typeof p.model === "string" ? p.model : "",
      platform: typeof p.platform === "string" ? p.platform : "",
      firstSeenAt: typeof p.firstSeenAt === "number" ? p.firstSeenAt : Date.now(),
      lastSeenAt: typeof p.lastSeenAt === "number" ? p.lastSeenAt : Date.now(),
      status: coerceStatus(p.status),
      boundServerIds: coerceServerIds(p.boundServerIds, p.boundServerId),
      expiresAt: typeof p.expiresAt === "number" ? p.expiresAt : null,
      trialStartedAt: typeof p.trialStartedAt === "number" ? p.trialStartedAt : null,
      nowPlaying: coerceNowPlaying(p.nowPlaying),
    };
  } catch {
    return null;
  }
}

async function fileReadDevices(): Promise<Device[]> {
  await ensureDataFile();
  const content = await fs.readFile(DATA_FILE, "utf-8");
  return content.split("\n").map(parseLine).filter((d): d is Device => d !== null);
}

async function fileWriteDevices(devices: Device[]): Promise<void> {
  await ensureDataFile();
  const content =
    devices.map((d) => JSON.stringify(d)).join("\n") + (devices.length ? "\n" : "");
  const tmpFile = `${DATA_FILE}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpFile, content, "utf-8");
  await fs.rename(tmpFile, DATA_FILE);
}

async function fileFindDevice(mac: string): Promise<Device | null> {
  const norm = normalizeMac(mac);
  if (!norm) return null;
  const devices = await fileReadDevices();
  return devices.find((d) => d.mac === norm) ?? null;
}

async function fileUpsertFromHeartbeat(
  input: HeartbeatInput,
  trialGrant?: TrialGrant
): Promise<Device> {
  const mac = normalizeMac(input.mac);
  if (!mac) throw new Error("MAC inválido.");
  const devices = await fileReadDevices();
  const now = Date.now();
  const idx = devices.findIndex((d) => d.mac === mac);

  if (idx === -1) {
    const created: Device = {
      mac,
      name: (input.name ?? "").trim(),
      model: (input.model ?? "").trim(),
      platform: (input.platform ?? "").trim(),
      firstSeenAt: now,
      lastSeenAt: now,
      status: trialGrant ? "active" : "pending",
      boundServerIds: trialGrant ? [trialGrant.serverId] : [],
      expiresAt: trialGrant ? trialGrant.expiresAt : null,
      trialStartedAt: trialGrant ? now : null,
      nowPlaying: input.nowPlaying ?? null,
    };
    devices.push(created);
    await fileWriteDevices(devices);
    return created;
  }

  const existing = devices[idx];
  const updated: Device = {
    ...existing,
    name: input.name != null && input.name.trim() ? input.name.trim() : existing.name,
    model: input.model != null && input.model.trim() ? input.model.trim() : existing.model,
    platform:
      input.platform != null && input.platform.trim() ? input.platform.trim() : existing.platform,
    lastSeenAt: now,
    // Estado ao vivo — sempre reflete o último heartbeat, nunca "mantém o
    // anterior se não vier" (senão "assistindo X" nunca some quando pausa).
    nowPlaying: input.nowPlaying ?? null,
  };
  devices[idx] = updated;
  await fileWriteDevices(devices);
  return updated;
}

async function fileUpdateDevice(mac: string, patch: DeviceAdminPatch): Promise<Device | null> {
  const norm = normalizeMac(mac);
  if (!norm) return null;
  const devices = await fileReadDevices();
  const now = Date.now();
  let idx = devices.findIndex((d) => d.mac === norm);

  if (idx === -1) {
    devices.push({
      mac: norm,
      name: "",
      model: "",
      platform: "",
      firstSeenAt: now,
      lastSeenAt: 0,
      status: "pending",
      boundServerIds: [],
      expiresAt: null,
      trialStartedAt: null,
      nowPlaying: null,
    });
    idx = devices.length - 1;
  }

  const cur = devices[idx];
  const next: Device = { ...cur };
  if (patch.name != null) next.name = patch.name.trim();
  if (patch.status === "pending" || patch.status === "active" || patch.status === "disabled") {
    next.status = patch.status;
  }
  const resolvedIds = resolveBoundServerIds(cur.boundServerIds, patch);
  if (resolvedIds !== undefined) next.boundServerIds = resolvedIds;
  const resolvedExp = resolveExpiry(cur.expiresAt, patch, now);
  if (resolvedExp !== undefined) next.expiresAt = resolvedExp;
  devices[idx] = next;
  await fileWriteDevices(devices);
  return next;
}

async function fileDeleteDevice(mac: string): Promise<boolean> {
  const norm = normalizeMac(mac);
  if (!norm) return false;
  const devices = await fileReadDevices();
  const filtered = devices.filter((d) => d.mac !== norm);
  if (filtered.length === devices.length) return false;
  await fileWriteDevices(filtered);
  return true;
}

// ---------------------------------------------------------------------------
// Armazenamento no Supabase (Postgres)
// ---------------------------------------------------------------------------

interface DeviceRow {
  mac: string;
  name: string | null;
  model: string | null;
  platform: string | null;
  first_seen_at: number | string | null;
  last_seen_at: number | string | null;
  status: string | null;
  bound_server_id: string | null;
  bound_server_ids: unknown;
  expires_at: number | string | null;
  trial_started_at: number | string | null;
  now_playing: unknown;
}

function rowToDevice(r: DeviceRow): Device {
  return {
    mac: normalizeMac(r.mac) ?? r.mac,
    name: r.name ?? "",
    model: r.model ?? "",
    platform: r.platform ?? "",
    firstSeenAt: Number(r.first_seen_at) || Date.now(),
    lastSeenAt: Number(r.last_seen_at) || 0,
    status: coerceStatus(r.status),
    boundServerIds: coerceServerIds(r.bound_server_ids, r.bound_server_id),
    expiresAt: r.expires_at != null ? Number(r.expires_at) : null,
    trialStartedAt: r.trial_started_at != null ? Number(r.trial_started_at) : null,
    nowPlaying: coerceNowPlaying(r.now_playing),
  };
}

async function sbReadDevices(): Promise<Device[]> {
  const sb = await getSupabase();
  const { data, error } = await sb
    .from(TABLE)
    .select("*")
    .order("last_seen_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => rowToDevice(r as DeviceRow));
}

async function sbFindDevice(mac: string): Promise<Device | null> {
  const norm = normalizeMac(mac);
  if (!norm) return null;
  const sb = await getSupabase();
  const { data, error } = await sb.from(TABLE).select("*").eq("mac", norm).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? rowToDevice(data as DeviceRow) : null;
}

async function sbUpsertFromHeartbeat(
  input: HeartbeatInput,
  trialGrant?: TrialGrant
): Promise<Device> {
  const mac = normalizeMac(input.mac);
  if (!mac) throw new Error("MAC inválido.");
  const sb = await getSupabase();
  const now = Date.now();

  // Metadados que o heartbeat pode mexer — NUNCA status/boundServerId.
  // now_playing sempre reflete o último valor enviado (inclusive null),
  // senão "assistindo X" nunca some quando o Player pausa/sai.
  const meta: Record<string, unknown> = { last_seen_at: now, now_playing: input.nowPlaying ?? null };
  if (input.name != null && input.name.trim()) meta.name = input.name.trim();
  if (input.model != null && input.model.trim()) meta.model = input.model.trim();
  if (input.platform != null && input.platform.trim()) meta.platform = input.platform.trim();

  // 1) tenta ATUALIZAR um registro existente (caminho comum; idempotente,
  //    então heartbeats concorrentes depois do 1º não se atropelam).
  const upd = await sb.from(TABLE).update(meta).eq("mac", mac).select("*").maybeSingle();
  if (upd.error) throw new Error(upd.error.message);
  if (upd.data) return rowToDevice(upd.data as DeviceRow);

  // 2) não existe -> INSERE. Se houver teste grátis, já entra liberado por
  //    trialHours na linha do teste; senão, pending (aguardando o admin).
  const insertRow: Record<string, unknown> = {
    mac,
    name: (input.name ?? "").trim(),
    model: (input.model ?? "").trim(),
    platform: (input.platform ?? "").trim(),
    first_seen_at: now,
    last_seen_at: now,
    status: trialGrant ? "active" : "pending",
    now_playing: input.nowPlaying ?? null,
  };
  if (trialGrant) {
    insertRow.bound_server_id = trialGrant.serverId;
    insertRow.bound_server_ids = [trialGrant.serverId];
    insertRow.expires_at = trialGrant.expiresAt;
    insertRow.trial_started_at = now;
  }
  const ins = await sb.from(TABLE).insert(insertRow).select("*").maybeSingle();
  if (!ins.error && ins.data) return rowToDevice(ins.data as DeviceRow);
  // 23505 = unique_violation: outro heartbeat inseriu no meio -> re-atualiza.
  if (ins.error && ins.error.code !== "23505") throw new Error(ins.error.message);

  const again = await sb.from(TABLE).update(meta).eq("mac", mac).select("*").maybeSingle();
  if (again.error) throw new Error(again.error.message);
  if (again.data) return rowToDevice(again.data as DeviceRow);

  const found = await sbFindDevice(mac);
  if (found) return found;
  throw new Error("Não foi possível registrar o dispositivo.");
}

async function sbUpdateDevice(mac: string, patch: DeviceAdminPatch): Promise<Device | null> {
  const norm = normalizeMac(mac);
  if (!norm) return null;
  const sb = await getSupabase();
  const now = Date.now();
  let existing = await sbFindDevice(norm);

  if (!existing) {
    const base = {
      mac: norm,
      name: "",
      model: "",
      platform: "",
      first_seen_at: now,
      last_seen_at: 0,
      status: "pending" as const,
    };
    const { error } = await sb.from(TABLE).insert(base);
    // 23505: corrida com um heartbeat — o registro já existe, segue o baile.
    if (error && error.code !== "23505") throw new Error(error.message);
    existing =
      (await sbFindDevice(norm)) ??
      rowToDevice({
        ...base,
        bound_server_id: null,
        bound_server_ids: [],
        expires_at: null,
        trial_started_at: null,
        now_playing: null,
      });
  }

  const upd: Record<string, unknown> = {};
  if (patch.name != null) upd.name = patch.name.trim();
  if (patch.status === "pending" || patch.status === "active" || patch.status === "disabled") {
    upd.status = patch.status;
  }
  const resolvedIds = resolveBoundServerIds(existing.boundServerIds, patch);
  if (resolvedIds !== undefined) {
    // jsonb com a lista ordenada completa; a coluna FK guarda só a principal
    // (mantém o ON DELETE SET NULL da linha principal coerente).
    upd.bound_server_ids = resolvedIds;
    upd.bound_server_id = resolvedIds[0] ?? null;
  }
  const resolvedExp = resolveExpiry(existing.expiresAt, patch, now);
  if (resolvedExp !== undefined) upd.expires_at = resolvedExp;
  if (Object.keys(upd).length === 0) return existing;

  const { data, error } = await sb
    .from(TABLE)
    .update(upd)
    .eq("mac", norm)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? rowToDevice(data as DeviceRow) : existing;
}

async function sbDeleteDevice(mac: string): Promise<boolean> {
  const norm = normalizeMac(mac);
  if (!norm) return false;
  const sb = await getSupabase();
  const { data, error } = await sb.from(TABLE).delete().eq("mac", norm).select("mac");
  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// API pública — despacha para o Supabase ou para o arquivo.
// ---------------------------------------------------------------------------

export function readDevices(): Promise<Device[]> {
  return supabaseEnabled() ? sbReadDevices() : fileReadDevices();
}

export function findDevice(mac: string): Promise<Device | null> {
  return supabaseEnabled() ? sbFindDevice(mac) : fileFindDevice(mac);
}

// Cria (status "pending") ou atualiza os metadados + lastSeenAt. Nunca mexe em
// status/boundServerId — isso é só via updateDevice (ação do admin).
export function upsertFromHeartbeat(
  input: HeartbeatInput,
  trialGrant?: TrialGrant
): Promise<Device> {
  return supabaseEnabled()
    ? sbUpsertFromHeartbeat(input, trialGrant)
    : fileUpsertFromHeartbeat(input, trialGrant);
}

// Cria o registro se ainda não existe (o admin pode pré-cadastrar um MAC antes
// do aparelho ligar pela primeira vez).
export function updateDevice(mac: string, patch: DeviceAdminPatch): Promise<Device | null> {
  return supabaseEnabled() ? sbUpdateDevice(mac, patch) : fileUpdateDevice(mac, patch);
}

export function deleteDevice(mac: string): Promise<boolean> {
  return supabaseEnabled() ? sbDeleteDevice(mac) : fileDeleteDevice(mac);
}
