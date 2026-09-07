import { supabaseEnabled, getSupabase } from "./db/supabase";

// Config de "Novidades pra você" (Fase 5, f5-4) — editável pelo provedor no
// Manager, key "whats-new" da tabela portal_settings (mesmo padrão do
// renewal). O Player busca em GET /api/whats-new: `enabled` é o kill-switch
// do provedor; `title` personaliza a notificação semanal; `leadHour` é a
// hora do dia pra disparar. Sem Supabase (APK embarcado) → default.

const SETTINGS = "portal_settings";

export interface WhatsNewConfig {
  /** Kill-switch do provedor. Default ligado. */
  enabled: boolean;
  /** Título da notificação semanal (o corpo é montado no Player com a contagem). */
  title: string;
  /** Hora do dia (0–23) pra disparar a notificação. */
  leadHour: number;
}

const DEFAULT_CONFIG: WhatsNewConfig = {
  enabled: true,
  title: "Novidades que combinam com você",
  leadHour: 20,
};

function coerce(v: unknown): WhatsNewConfig {
  const o = (v ?? {}) as Record<string, unknown>;
  const h = Number(o.leadHour);
  return {
    enabled: o.enabled !== false,
    title:
      typeof o.title === "string" && o.title.trim()
        ? o.title.trim().slice(0, 80)
        : DEFAULT_CONFIG.title,
    leadHour: Number.isFinite(h) ? Math.min(23, Math.max(0, Math.round(h))) : DEFAULT_CONFIG.leadHour,
  };
}

export async function getWhatsNewConfig(): Promise<WhatsNewConfig> {
  if (!supabaseEnabled()) return DEFAULT_CONFIG;
  const sb = await getSupabase();
  const { data, error } = await sb
    .from(SETTINGS)
    .select("value")
    .eq("key", "whats-new")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? coerce(data.value) : DEFAULT_CONFIG;
}

export async function setWhatsNewConfig(patch: Partial<WhatsNewConfig>): Promise<WhatsNewConfig> {
  if (!supabaseEnabled()) {
    throw new Error("Config só no portal hospedado (requer Supabase).");
  }
  const sb = await getSupabase();
  const current = await getWhatsNewConfig();
  const next = coerce({ ...current, ...patch });
  const { error } = await sb
    .from(SETTINGS)
    .upsert({ key: "whats-new", value: next, updated_at: Date.now() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
  return next;
}
