import { supabaseEnabled, getSupabase } from "./db/supabase";

// Aviso do provedor no app (trilha do provedor p-2). Uma frase curta que
// aparece num banner no topo do Player ("manutenção às 22h", "novos canais
// adicionados"…). Key "notice" em portal_settings, mesmo padrão de
// "renewal"/"brand". Texto vazio, ou `until` no passado, = sem aviso.

const SETTINGS = "portal_settings";
const KEY = "notice";

export interface NoticeConfig {
  text: string;
  /** "info" (neutro) ou "warn" (laranja, chama mais atenção). */
  kind: "info" | "warn";
  /** Epoch ms — some sozinho depois disso. null = fica até o provedor tirar. */
  until: number | null;
}

const EMPTY: NoticeConfig = { text: "", kind: "info", until: null };

export function coerceNotice(v: unknown): NoticeConfig {
  const o = (v ?? {}) as Record<string, unknown>;
  const text = typeof o.text === "string" ? o.text.trim().slice(0, 240) : "";
  const kind = o.kind === "warn" ? "warn" : "info";
  const until =
    typeof o.until === "number" && Number.isFinite(o.until) && o.until > 0 ? o.until : null;
  return { text, kind, until };
}

/** `null` quando não há aviso ativo (texto vazio ou já expirado) — o
 * heartbeat só carrega o aviso quando ele deve mesmo aparecer. */
export async function getNoticeConfig(now = Date.now()): Promise<NoticeConfig | null> {
  if (!supabaseEnabled()) return null;
  const sb = await getSupabase();
  const { data, error } = await sb.from(SETTINGS).select("value").eq("key", KEY).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const n = coerceNotice(data.value);
  if (!n.text) return null;
  if (n.until != null && n.until <= now) return null;
  return n;
}

/** Config bruta (pro admin editar, mesmo expirada/vazia). */
export async function getNoticeRaw(): Promise<NoticeConfig> {
  if (!supabaseEnabled()) return EMPTY;
  const sb = await getSupabase();
  const { data, error } = await sb.from(SETTINGS).select("value").eq("key", KEY).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? coerceNotice(data.value) : EMPTY;
}

export async function setNoticeConfig(patch: Partial<NoticeConfig>): Promise<NoticeConfig> {
  if (!supabaseEnabled()) {
    throw new Error("Aviso do provedor só disponível no portal hospedado (Supabase).");
  }
  const sb = await getSupabase();
  const current = await getNoticeRaw();
  const next = coerceNotice({ ...current, ...patch });
  const { error } = await sb
    .from(SETTINGS)
    .upsert({ key: KEY, value: next, updated_at: Date.now() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
  return next;
}
