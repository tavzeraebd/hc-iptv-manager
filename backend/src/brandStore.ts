import { supabaseEnabled, getSupabase } from "./db/supabase";

// White-label do Player: nome, logo e cor de destaque do provedor. FASE 0:
// só o armazenamento (chave "brand" em `portal_settings`, mesmo lugar de
// "renewal") + a leitura no heartbeat. A tela de admin pra editar isto é da
// trilha do provedor (p-1). Vazio/ausente = o Player usa a marca padrão
// ("HC IPTV" / laranja).

const SETTINGS = "portal_settings";
const KEY = "brand";

export interface BrandConfig {
  /** Nome exibido no lugar de "HC IPTV". Vazio = padrão. */
  name: string;
  /** URL absoluta (https) de uma logo. Vazio = sem logo custom. */
  logoUrl: string;
  /** Cor de destaque em hex (#RRGGBB). Vazio = laranja padrão. */
  accent: string;
}

const EMPTY: BrandConfig = { name: "", logoUrl: "", accent: "" };

const HEX = /^#[0-9a-fA-F]{6}$/;

export function coerceBrand(v: unknown): BrandConfig {
  const o = (v ?? {}) as Record<string, unknown>;
  const name = typeof o.name === "string" ? o.name.trim().slice(0, 40) : "";
  const logoUrl =
    typeof o.logoUrl === "string" && /^https:\/\//i.test(o.logoUrl.trim())
      ? o.logoUrl.trim().slice(0, 500)
      : "";
  const accent = typeof o.accent === "string" && HEX.test(o.accent.trim()) ? o.accent.trim() : "";
  return { name, logoUrl, accent };
}

/** Retorna `null` quando não há nada custom — o payload do heartbeat só carrega
 * a marca quando ela existe de verdade. */
export async function getBrandConfig(): Promise<BrandConfig | null> {
  if (!supabaseEnabled()) return null;
  const sb = await getSupabase();
  const { data, error } = await sb.from(SETTINGS).select("value").eq("key", KEY).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const b = coerceBrand(data.value);
  return b.name || b.logoUrl || b.accent ? b : null;
}

export async function setBrandConfig(patch: Partial<BrandConfig>): Promise<BrandConfig> {
  if (!supabaseEnabled()) {
    throw new Error("Branding só disponível no portal hospedado (Supabase).");
  }
  const sb = await getSupabase();
  const current = (await getBrandConfig()) ?? EMPTY;
  const next = coerceBrand({ ...current, ...patch });
  const { error } = await sb
    .from(SETTINGS)
    .upsert({ key: KEY, value: next, updated_at: Date.now() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
  return next;
}
