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
export function getServerUrl(): string {
  return (
    localStorage.getItem(SERVER_URL_STORAGE_KEY) ||
    BAKED_PORTAL_URL ||
    EMBEDDED_BACKEND_URL
  );
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

// Wrapper de fetch que injeta o token do portal (quando houver). Substitui
// `fetch(apiUrl(path), init)` em todas as chamadas abaixo.
function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getPortalToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("x-portal-token", token);
  return fetch(apiUrl(path), { ...init, headers });
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

export interface PortalDevice {
  mac: string;
  name: string;
  model: string;
  platform: string;
  status: DeviceStatus;
  boundServerId: string | null;
  firstSeenAt: number;
  lastSeenAt: number;
}

export interface DevicePatch {
  name?: string;
  boundServerId?: string | null;
  status?: DeviceStatus;
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
