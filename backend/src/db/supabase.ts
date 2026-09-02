import type { SupabaseClient } from "@supabase/supabase-js";

// Portal hospedado: quando SUPABASE_URL + SUPABASE_SECRET_KEY estão definidos,
// os storages (usuarios/devices) passam a persistir no Postgres do Supabase
// em vez dos arquivos .txt locais. O backend embarcado no APK do Manager NÃO
// define essas variáveis, então continua 100% em arquivo, offline.
//
// A chave usada é a SECRET (service_role) — ignora RLS. Ela vive só como env
// var no host do portal, nunca no frontend nem no APK. O pacote
// @capacitor/supabase-js é carregado por import() dinâmico e marcado
// `--external` no build:mobile, então nunca entra no bundle embarcado.

const URL_ENV = (process.env.SUPABASE_URL || "").trim();
const KEY_ENV = (
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  ""
).trim();

export function supabaseEnabled(): boolean {
  return URL_ENV !== "" && KEY_ENV !== "";
}

let clientPromise: Promise<SupabaseClient> | null = null;

export function getSupabase(): Promise<SupabaseClient> {
  if (!supabaseEnabled()) {
    throw new Error(
      "Supabase não está configurado — defina SUPABASE_URL e SUPABASE_SECRET_KEY."
    );
  }
  if (!clientPromise) {
    clientPromise = import("@supabase/supabase-js").then(({ createClient }) =>
      createClient(URL_ENV, KEY_ENV, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { "X-Client-Info": "iptv-manager-portal" } },
      })
    );
  }
  return clientPromise;
}
