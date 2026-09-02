// Trava administrativa local: um PIN (mínimo 4 dígitos) guardado como hash
// SHA-256 no localStorage do próprio aparelho. Não há back-end de
// autenticação — o Manager é uma ferramenta administrativa de uso local, e o
// objetivo aqui é só impedir que alguém que pegue o aparelho abra o painel e
// veja/edite as credenciais dos clientes. A sessão desbloqueada vale só
// enquanto o app está aberto (sessionStorage).

const PIN_HASH_KEY = "iptv-manager-admin-pin";
const SESSION_KEY = "iptv-manager-admin-unlocked";

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function hasPin(): boolean {
  return Boolean(localStorage.getItem(PIN_HASH_KEY));
}

export async function setPin(pin: string): Promise<void> {
  localStorage.setItem(PIN_HASH_KEY, await sha256Hex(pin));
  sessionStorage.setItem(SESSION_KEY, "1");
}

export async function verifyPin(pin: string): Promise<boolean> {
  const stored = localStorage.getItem(PIN_HASH_KEY);
  if (!stored) return false;
  const ok = stored === (await sha256Hex(pin));
  if (ok) sessionStorage.setItem(SESSION_KEY, "1");
  return ok;
}

export function isUnlocked(): boolean {
  return sessionStorage.getItem(SESSION_KEY) === "1";
}

export function lock(): void {
  sessionStorage.removeItem(SESSION_KEY);
}
