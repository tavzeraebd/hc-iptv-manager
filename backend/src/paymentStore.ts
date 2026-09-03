import crypto from "crypto";
import { supabaseEnabled, getSupabase } from "./db/supabase";

// Cobranças PIX (Mercado Pago) + config de renovação editável pelo Manager.
// Só faz sentido no portal hospedado (Supabase + webhook público). Em modo
// arquivo/APK embarcado, tudo aqui lança "não configurado".

const PAYMENTS = "payments";
const SETTINGS = "portal_settings";
const DAY_MS = 86_400_000;

export type PaymentStatus = "pending" | "paid" | "expired" | "error" | "cancelled";

export interface Payment {
  id: string;
  deviceMac: string;
  provider: string;
  providerRef: string | null;
  amountCents: number;
  months: number;
  status: PaymentStatus;
  qrCode: string | null;
  qrCodeB64: string | null;
  ticketUrl: string | null;
  createdAt: number;
  expiresAt: number | null;
  paidAt: number | null;
  processed: boolean;
}

export interface RenewalConfig {
  priceCents: number;
  months: number;
  qrTtlMin: number;
  /** Preço promocional opcional; usado enquanto `promoUntil` (epoch ms) > agora. */
  promoPriceCents?: number | null;
  promoUntil?: number | null;
  /** Teste grátis: ao 1º heartbeat de um device NOVO, libera automaticamente
   * por `trialHours` horas na linha `trialServerId`. Vencido, cai em "expired"
   * e o Player mostra o QR de pagamento. Só vale 1x por device. */
  trialEnabled?: boolean;
  trialServerId?: string | null;
  trialHours?: number;
}

const DEFAULT_CONFIG: RenewalConfig = {
  priceCents: 1990,
  months: 1,
  qrTtlMin: 30,
  trialEnabled: false,
  trialServerId: null,
  trialHours: 1,
};

function ensureSb() {
  if (!supabaseEnabled()) {
    throw new Error(
      "Pagamento não disponível neste modo (requer portal hospedado com Supabase)."
    );
  }
}

// ---------------------------------------------------------------------------
// Config de renovação (portal_settings / key = "renewal")
// ---------------------------------------------------------------------------

function coerceConfig(v: unknown): RenewalConfig {
  const o = (v ?? {}) as Record<string, unknown>;
  const num = (x: unknown, def: number) =>
    typeof x === "number" && Number.isFinite(x) ? x : def;
  return {
    priceCents: Math.max(100, Math.round(num(o.priceCents, DEFAULT_CONFIG.priceCents))),
    months: Math.max(1, Math.round(num(o.months, DEFAULT_CONFIG.months))),
    qrTtlMin: Math.min(60, Math.max(5, Math.round(num(o.qrTtlMin, DEFAULT_CONFIG.qrTtlMin)))),
    promoPriceCents:
      typeof o.promoPriceCents === "number" && o.promoPriceCents >= 100
        ? Math.round(o.promoPriceCents)
        : null,
    promoUntil:
      typeof o.promoUntil === "number" && Number.isFinite(o.promoUntil) ? o.promoUntil : null,
    trialEnabled: o.trialEnabled === true,
    trialServerId: typeof o.trialServerId === "string" && o.trialServerId ? o.trialServerId : null,
    trialHours: Math.min(720, Math.max(1, Math.round(num(o.trialHours, DEFAULT_CONFIG.trialHours!)))),
  };
}

export async function getRenewalConfig(): Promise<RenewalConfig> {
  if (!supabaseEnabled()) return DEFAULT_CONFIG;
  const sb = await getSupabase();
  const { data, error } = await sb
    .from(SETTINGS)
    .select("value")
    .eq("key", "renewal")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? coerceConfig(data.value) : DEFAULT_CONFIG;
}

export async function setRenewalConfig(patch: Partial<RenewalConfig>): Promise<RenewalConfig> {
  ensureSb();
  const sb = await getSupabase();
  const current = await getRenewalConfig();
  const next = coerceConfig({ ...current, ...patch });
  const { error } = await sb
    .from(SETTINGS)
    .upsert({ key: "renewal", value: next, updated_at: Date.now() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
  return next;
}

/** Preço em vigor agora (aplica o promocional se estiver na janela). */
export function effectivePriceCents(cfg: RenewalConfig, now = Date.now()): number {
  if (cfg.promoPriceCents && cfg.promoUntil && cfg.promoUntil > now) return cfg.promoPriceCents;
  return cfg.priceCents;
}

// ---------------------------------------------------------------------------
// Cobranças (payments)
// ---------------------------------------------------------------------------

interface PayRow {
  id: string;
  device_mac: string;
  provider: string;
  provider_ref: string | null;
  amount_cents: number | string;
  months: number | string;
  status: string;
  qr_code: string | null;
  qr_code_b64: string | null;
  ticket_url: string | null;
  created_at: number | string;
  expires_at: number | string | null;
  paid_at: number | string | null;
  processed: boolean;
}

function rowToPayment(r: PayRow): Payment {
  const st = r.status as PaymentStatus;
  return {
    id: r.id,
    deviceMac: r.device_mac,
    provider: r.provider,
    providerRef: r.provider_ref,
    amountCents: Number(r.amount_cents),
    months: Number(r.months) || 1,
    status: ["pending", "paid", "expired", "error", "cancelled"].includes(st) ? st : "pending",
    qrCode: r.qr_code,
    qrCodeB64: r.qr_code_b64,
    ticketUrl: r.ticket_url,
    createdAt: Number(r.created_at),
    expiresAt: r.expires_at != null ? Number(r.expires_at) : null,
    paidAt: r.paid_at != null ? Number(r.paid_at) : null,
    processed: !!r.processed,
  };
}

export function newPaymentId(): string {
  return crypto.randomUUID();
}

export interface CreatePaymentInput {
  id: string;
  deviceMac: string;
  amountCents: number;
  months: number;
  providerRef: string;
  qrCode: string | null;
  qrCodeB64: string | null;
  ticketUrl: string | null;
  expiresAt: number | null;
}

export async function insertPayment(input: CreatePaymentInput): Promise<Payment> {
  ensureSb();
  const sb = await getSupabase();
  const row = {
    id: input.id,
    device_mac: input.deviceMac,
    provider: "mercadopago",
    provider_ref: input.providerRef,
    amount_cents: input.amountCents,
    months: input.months,
    status: "pending" as const,
    qr_code: input.qrCode,
    qr_code_b64: input.qrCodeB64,
    ticket_url: input.ticketUrl,
    created_at: Date.now(),
    expires_at: input.expiresAt,
  };
  const { data, error } = await sb.from(PAYMENTS).insert(row).select("*").maybeSingle();
  if (error) throw new Error(error.message);
  return rowToPayment(data as PayRow);
}

export async function getPaymentById(id: string): Promise<Payment | null> {
  ensureSb();
  const sb = await getSupabase();
  const { data, error } = await sb.from(PAYMENTS).select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? rowToPayment(data as PayRow) : null;
}

export async function getPaymentByProviderRef(ref: string): Promise<Payment | null> {
  ensureSb();
  const sb = await getSupabase();
  const { data, error } = await sb
    .from(PAYMENTS)
    .select("*")
    .eq("provider_ref", ref)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? rowToPayment(data as PayRow) : null;
}

/** Última cobrança PENDENTE e ainda válida deste device (pra não spammar o MP). */
export async function getOpenPaymentForDevice(mac: string): Promise<Payment | null> {
  ensureSb();
  const sb = await getSupabase();
  const { data, error } = await sb
    .from(PAYMENTS)
    .select("*")
    .eq("device_mac", mac)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const p = rowToPayment(data as PayRow);
  if (p.expiresAt != null && p.expiresAt <= Date.now()) return null;
  return p;
}

export async function listPaymentsForDevice(mac: string, limit = 10): Promise<Payment[]> {
  ensureSb();
  const sb = await getSupabase();
  const { data, error } = await sb
    .from(PAYMENTS)
    .select("*")
    .eq("device_mac", mac)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => rowToPayment(r as PayRow));
}

export async function markPaymentStatus(
  id: string,
  status: PaymentStatus,
  extra: { paidAt?: number; processed?: boolean } = {}
): Promise<void> {
  ensureSb();
  const sb = await getSupabase();
  const upd: Record<string, unknown> = { status };
  if (extra.paidAt != null) upd.paid_at = extra.paidAt;
  if (extra.processed != null) upd.processed = extra.processed;
  const { error } = await sb.from(PAYMENTS).update(upd).eq("id", id);
  if (error) throw new Error(error.message);
}

export { DAY_MS };
