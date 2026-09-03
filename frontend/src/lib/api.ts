import { Capacitor } from "@capacitor/core";
import { Nodejs } from "@capawesome/capacitor-nodejs";
import type { CheckResult, IptvUser } from "./types";
import { BAKED_PORTAL_URL, BAKED_PORTAL_TOKEN } from "./baked-config";

// No app Android o próprio backend Node/Express roda embarcado no processo
// do app (nodejs-mobile via @capawesome/capacitor-nodejs), escutando em
// 127.0.0.1 — inicia sozinho junto com o app (startMode "auto" no
// capacitor.config.ts), sem passo manual nenhum. Esse é o endereço padrão
// no app nativo. Um usuário avançado ainda pode apontar para um servidor
// externo (PC, VPS, ou o próprio celular via Termux) usando a tela de
// configurações — a escolha fica salva localmente e tem prioridade sobre o
// backend embarcado.
export const EMBEDDED_BACKEND_URL = "http://127.0.0.1:8891";
const SERVER_URL_STORAGE_KEY = "iptv-manager-server-url";
const PORTAL_TOKEN_STORAGE_KEY = "iptv-manager-portal-token";

// Por padrão o app já aponta para o portal hospedado (URL embutida e ofuscada
// em baked-config). Um valor salvo em ⚙ Endereço do servidor tem prioridade;
// "Voltar a usar o backend embarcado" grava EMBEDDED_BACKEND_URL explicitamente.
// Um endereço salvo apontando pra localhost/127.x que NÃO seja o backend
// embarcado (127.0.0.1:8891) é resquício de teste/dev — ignora e usa o portal
// embutido. O embarcado legítimo e IPs de LAN reais (192.168.x) continuam OK.
function isStaleServerUrl(u: string): boolean {
  if (u === EMBEDDED_BACKEND_URL) return false;
  let host: string;
  try {
    host = new URL(u).hostname.toLowerCase();
  } catch {
    return true;
  }
  return host === "localhost" || host === "0.0.0.0" || host === "::1" || host.startsWith("127.");
}

export function getServerUrl(): string {
  const stored = localStorage.getItem(SERVER_URL_STORAGE_KEY);
  if (stored && isStaleServerUrl(stored)) {
    try {
      localStorage.removeItem(SERVER_URL_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    return BAKED_PORTAL_URL || EMBEDDED_BACKEND_URL;
  }
  return stored || BAKED_PORTAL_URL || EMBEDDED_BACKEND_URL;
}

export function setServerUrl(url: string): void {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (trimmed) {
    localStorage.setItem(SERVER_URL_STORAGE_KEY, trimmed);
  } else {
    localStorage.removeItem(SERVER_URL_STORAGE_KEY);
  }
}

// Token do portal hospedado — enviado como header `x-portal-token` em toda
// chamada. O backend embarcado no APK não exige token (a env var
// PORTAL_ADMIN_TOKEN não é definida lá), então mandar o header é inofensivo.
export function getPortalToken(): string {
  try {
    return localStorage.getItem(PORTAL_TOKEN_STORAGE_KEY) || BAKED_PORTAL_TOKEN;
  } catch {
    return BAKED_PORTAL_TOKEN;
  }
}

export function setPortalToken(token: string): void {
  const trimmed = token.trim();
  try {
    if (trimmed) localStorage.setItem(PORTAL_TOKEN_STORAGE_KEY, trimmed);
    else localStorage.removeItem(PORTAL_TOKEN_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function usesEmbeddedBackend(): boolean {
  return Capacitor.isNativePlatform() && getServerUrl() === EMBEDDED_BACKEND_URL;
}

// O runtime Node embarcado leva um instante para subir e o Express começar
// a escutar; sem esperar isso, a primeira leitura de usuários chegaria
// antes do servidor existir.
export async function waitForEmbeddedBackend(): Promise<void> {
  if (!usesEmbeddedBackend()) return;
  const { ready } = await Nodejs.isReady();
  if (ready) return;
  await new Promise<void>((resolve) => {
    Nodejs.addListener("ready", () => resolve());
  });
}

function apiUrl(path: string): string {
  if (!Capacitor.isNativePlatform()) return `/api${path}`;
  return `${getServerUrl()}/api${path}`;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// O portal roda no plano grátis do Render, que hiberna após ~15 min ociosos:
// a 1ª chamada acorda a instância e por alguns segundos devolve timeout ou
// 502/503/504 — cuja página de erro do Render NÃO tem `Access-Control-Allow-Origin`,
// então a WebView reporta como "erro de CORS" mesmo estando tudo certo. Estas
// tentativas com backoff cobrem o cold start; 2xx/3xx/4xx são respostas
// definitivas e não são repetidas.
const RETRY_DELAYS_MS = [4000, 9000, 18000];
const REQUEST_TIMEOUT_MS = 25000;

// Wrapper de fetch que injeta o token do portal (quando houver) e repete no
// cold start do portal. Substitui `fetch(apiUrl(path), init)` em todas as
// chamadas abaixo.
async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getPortalToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("x-portal-token", token);
  const url = apiUrl(path);

  let lastErr = new Error("Não foi possível falar com o servidor.");
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, { ...init, headers, signal: ctrl.signal });
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      continue;
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      lastErr = new Error(`Servidor indisponível (HTTP ${res.status}).`);
      continue;
    }
    return res;
  }
  throw lastErr;
}

async function handle<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = "Erro inesperado.";
    try {
      const body = await response.json();
      if (body?.error) message = body.error;
    } catch {
      // sem corpo JSON
    }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export interface UserInput {
  host: string;
  username: string;
  password: string;
}

export async function fetchUsers(): Promise<IptvUser[]> {
  const res = await apiFetch("/users");
  return handle<IptvUser[]>(res);
}

export async function createUser(input: UserInput): Promise<IptvUser & { check: CheckResult }> {
  const res = await apiFetch("/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return handle(res);
}

export async function editUser(
  id: string,
  input: UserInput
): Promise<IptvUser & { check: CheckResult }> {
  const res = await apiFetch(`/users/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return handle(res);
}

export async function removeUser(id: string): Promise<void> {
  const res = await apiFetch(`/users/${id}`, { method: "DELETE" });
  return handle(res);
}

export async function checkUser(id: string): Promise<CheckResult> {
  const res = await apiFetch(`/users/${id}/check`);
  return handle(res);
}

export async function checkAllUsers(): Promise<{ id: string; check: CheckResult }[]> {
  const res = await apiFetch("/check-all", { method: "POST" });
  return handle(res);
}

// ---------------------------------------------------------------------------
// Check client-side (direto do dispositivo)
//
// Muitos painéis (ex.: dns.explouddev.com) devolvem 404/403 para IPs de
// datacenter — o portal no Render cai nisso e marca tudo OFFLINE — mas
// respondem normalmente para uma conexão residencial. Como o app é servido em
// http://localhost (androidScheme 'http' + cleartext) e o painel manda
// `Access-Control-Allow-Origin: *`, a própria WebView consegue checar pela
// conexão local do aparelho, que é a mesma que os Players dos clientes usam.
// `use-iptv-users` tenta isto primeiro no app nativo e só cai pro backend se
// der erro de rede.
// ---------------------------------------------------------------------------

const CLIENT_CHECK_TIMEOUT_MS = 9000;

function panelApiUrl(host: string, username: string, password: string): string {
  const clean = host.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  const qs = new URLSearchParams({ username, password }).toString();
  return `http://${clean}/player_api.php?${qs}`;
}

function statusFromExp(expDateSec: number, nowSec: number): CheckResult["status"] {
  if (expDateSec <= nowSec) return "EXPIRADO";
  if (expDateSec <= nowSec + 86400) return "VENCE_EM_BREVE";
  return "ATIVO";
}

/**
 * Checa o painel direto do dispositivo. Lança em erro de rede/timeout/CORS —
 * o chamador deve cair pro check via backend nesse caso. Um retorno OFFLINE
 * (404, JSON inválido, etc.) é definitivo e não deve tentar o backend.
 */
export async function clientCheckUser(
  host: string,
  username: string,
  password: string
): Promise<CheckResult> {
  const nowSec = Math.floor(Date.now() / 1000);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CLIENT_CHECK_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(panelApiUrl(host, username, password), {
      cache: "no-store",
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    return { status: "OFFLINE", expDate: null, checkedAt: nowSec, message: `HTTP ${res.status}` };
  }

  let data: { user_info?: { exp_date?: string | number | null; auth?: number; status?: string } };
  try {
    data = await res.json();
  } catch {
    return { status: "OFFLINE", expDate: null, checkedAt: nowSec, message: "Resposta inválida da API" };
  }

  const info = data?.user_info;
  if (!info || info.exp_date === undefined || info.exp_date === null) {
    return { status: "OFFLINE", expDate: null, checkedAt: nowSec, message: "Resposta inválida da API" };
  }

  const expDate = Number(info.exp_date);
  if (!Number.isFinite(expDate)) {
    return { status: "OFFLINE", expDate: null, checkedAt: nowSec, message: "Data de expiração inválida" };
  }

  if (info.auth === 0 && info.status !== "Active") {
    return { status: "EXPIRADO", expDate, checkedAt: nowSec, message: info.status };
  }

  return { status: statusFromExp(expDate, nowSec), expDate, checkedAt: nowSec };
}

export interface ImportCandidate {
  host: string;
  username: string;
  password: string;
  channelCount: number;
  sampleChannel: string;
  alreadyExists: boolean;
}

export async function previewImport(url: string): Promise<ImportCandidate[]> {
  const res = await apiFetch("/import/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  return handle(res);
}

export async function importUsers(
  users: UserInput[]
): Promise<{ added: IptvUser[]; skipped: number }> {
  const res = await apiFetch("/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ users }),
  });
  return handle(res);
}

// ---------------------------------------------------------------------------
// Dispositivos (portal) — o backend do Manager é o portal do modelo
// player <-> portal: o IPTV Player se anuncia por MAC e o admin vincula um
// dos servidores (entradas de /api/users) e libera. Ver backend/routes/devices.
// ---------------------------------------------------------------------------

export type DeviceStatus = "pending" | "active" | "disabled";
/** Estado efetivo (status + validade) calculado pelo portal. */
export type DeviceAccess = "pending" | "active" | "disabled" | "expired";

export interface PortalDevice {
  mac: string;
  name: string;
  model: string;
  platform: string;
  status: DeviceStatus;
  access: DeviceAccess;
  /** Linha principal (= boundServerIds[0]). Mantido por compatibilidade. */
  boundServerId: string | null;
  /** Linhas vinculadas em ordem: [0] principal, demais são reservas de failover. */
  boundServerIds: string[];
  firstSeenAt: number;
  lastSeenAt: number;
  /** Validade do acesso (epoch ms). null = sem validade (vitalício). */
  expiresAt: number | null;
  /** Quando o teste grátis automático foi concedido (epoch ms). null = nunca teve. */
  trialStartedAt: number | null;
}

export interface DevicePatch {
  name?: string;
  boundServerId?: string | null;
  /** Lista ordenada de linhas (principal + reservas). `[]` ou `null` desvincula todas. */
  boundServerIds?: string[] | null;
  status?: DeviceStatus;
  /** Validade absoluta: número (epoch ms) | null (vitalício) | undefined (não mexe). */
  expiresAt?: number | null;
  /** Renova somando dias à validade atual (se válida) ou a partir de agora. */
  extendDays?: number;
  /** Dias de validade a aplicar ao ativar sem prazo (default 30). */
  validityDays?: number;
}

export async function fetchDevices(): Promise<PortalDevice[]> {
  const res = await apiFetch("/devices", { cache: "no-store" });
  return handle<PortalDevice[]>(res);
}

// null quando o MAC ainda não é conhecido (404) — usado pra auto-preencher o
// nome ao digitar um MAC no formulário "Adicionar dispositivo".
export async function getDevice(mac: string): Promise<PortalDevice | null> {
  const res = await apiFetch(`/devices/${encodeURIComponent(mac)}`, { cache: "no-store" });
  if (res.status === 404) return null;
  return handle<PortalDevice>(res);
}

export async function updateDevice(mac: string, patch: DevicePatch): Promise<PortalDevice> {
  const res = await apiFetch(`/devices/${encodeURIComponent(mac)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return handle<PortalDevice>(res);
}

export async function deleteDevice(mac: string): Promise<void> {
  const res = await apiFetch(`/devices/${encodeURIComponent(mac)}`, { method: "DELETE" });
  return handle(res);
}

// ---------------------------------------------------------------------------
// Renovação / pagamento (PIX via Mercado Pago) — config editável do portal.
// ---------------------------------------------------------------------------

export interface RenewalSettings {
  priceCents: number;
  months: number;
  qrTtlMin: number;
  promoPriceCents: number | null;
  promoUntil: number | null;
  effectivePriceCents: number;
  providerConfigured: boolean;
  /** Teste grátis automático pra dispositivos novos (1º heartbeat). */
  trialEnabled: boolean;
  trialServerId: string | null;
  trialHours: number;
}

export type RenewalSettingsPatch = Partial<
  Pick<
    RenewalSettings,
    | "priceCents"
    | "months"
    | "qrTtlMin"
    | "promoPriceCents"
    | "promoUntil"
    | "trialEnabled"
    | "trialServerId"
    | "trialHours"
  >
>;

export async function getRenewalSettings(): Promise<RenewalSettings> {
  const res = await apiFetch("/settings/renewal", { cache: "no-store" });
  return handle<RenewalSettings>(res);
}

export async function updateRenewalSettings(patch: RenewalSettingsPatch): Promise<RenewalSettings> {
  const res = await apiFetch("/settings/renewal", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return handle<RenewalSettings>(res);
}

export interface DevicePayment {
  id: string;
  status: "pending" | "paid" | "expired" | "error" | "cancelled";
  amountCents: number;
  months: number;
  createdAt: number;
  paidAt: number | null;
}

export async function fetchDevicePayments(mac: string): Promise<DevicePayment[]> {
  const res = await apiFetch(`/devices/${encodeURIComponent(mac)}/payments`, { cache: "no-store" });
  return handle<DevicePayment[]>(res);
}
