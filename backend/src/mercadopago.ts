import crypto from "crypto";

// Cliente mínimo do Mercado Pago para cobrança PIX.
//   MP_ACCESS_TOKEN   — token do app no MP (produção: APP_USR-..., sandbox: TEST-...)
//   MP_WEBHOOK_SECRET  — segredo do webhook (Painel MP -> seu app -> Webhooks)
//   PORTAL_PUBLIC_URL  — URL pública do portal (pra notification_url do webhook)

const API = "https://api.mercadopago.com";

export function mpConfigured(): boolean {
  return !!(process.env.MP_ACCESS_TOKEN || "").trim();
}

function token(): string {
  const t = (process.env.MP_ACCESS_TOKEN || "").trim();
  if (!t) throw new Error("MP_ACCESS_TOKEN não configurado.");
  return t;
}

function publicUrl(): string {
  return (process.env.PORTAL_PUBLIC_URL || "").trim().replace(/\/+$/, "");
}

export interface MpPixResult {
  id: string;
  status: string; // "pending" | "approved" | "rejected" | ...
  qrCode: string | null; // copia-e-cola (EMV)
  qrCodeBase64: string | null; // PNG base64 (sem prefixo data:)
  ticketUrl: string | null;
}

export interface CreatePixInput {
  amountReais: number; // ex.: 19.9
  description: string;
  externalReference: string; // id da nossa linha em `payments`
  payerEmail: string;
  expiresAt: number; // epoch ms
}

function isoWithOffset(ms: number): string {
  // MP quer ISO 8601 com offset, ex.: 2026-09-02T10:30:00.000-03:00
  const d = new Date(ms);
  const pad = (n: number, w = 2) => String(Math.abs(n)).padStart(w, "0");
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}` +
    `${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`
  );
}

export async function createPixPayment(input: CreatePixInput): Promise<MpPixResult> {
  const body: Record<string, unknown> = {
    transaction_amount: Number(input.amountReais.toFixed(2)),
    description: input.description,
    payment_method_id: "pix",
    external_reference: input.externalReference,
    date_of_expiration: isoWithOffset(input.expiresAt),
    payer: { email: input.payerEmail },
  };
  const notif = publicUrl();
  if (notif) body.notification_url = `${notif}/api/webhooks/mercadopago`;

  const res = await fetch(`${API}/v1/payments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": input.externalReference,
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg =
      (json && (json.message as string)) ||
      (json && JSON.stringify((json as { cause?: unknown }).cause)) ||
      `MP HTTP ${res.status}`;
    throw new Error(`Mercado Pago: ${msg}`);
  }
  const poi = ((json.point_of_interaction as Record<string, unknown>)?.transaction_data ??
    {}) as Record<string, unknown>;
  return {
    id: String(json.id),
    status: String(json.status ?? "pending"),
    qrCode: (poi.qr_code as string) ?? null,
    qrCodeBase64: (poi.qr_code_base64 as string) ?? null,
    ticketUrl: (poi.ticket_url as string) ?? null,
  };
}

export interface MpPayment {
  id: string;
  status: string;
  statusDetail: string;
  externalReference: string | null;
  transactionAmount: number;
}

export async function getPayment(id: string): Promise<MpPayment> {
  const res = await fetch(`${API}/v1/payments/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`Mercado Pago: HTTP ${res.status}`);
  return {
    id: String(json.id),
    status: String(json.status ?? ""),
    statusDetail: String(json.status_detail ?? ""),
    externalReference: (json.external_reference as string) ?? null,
    transactionAmount: Number(json.transaction_amount ?? 0),
  };
}

// Valida a assinatura do webhook (esquema x-signature: "ts=...,v1=...").
// Manifesto: id:<dataId>;request-id:<xRequestId>;ts:<ts>;
export function verifyWebhookSignature(params: {
  dataId: string;
  xSignature: string | undefined;
  xRequestId: string | undefined;
}): boolean {
  const secret = (process.env.MP_WEBHOOK_SECRET || "").trim();
  if (!secret) return true; // sem segredo configurado -> não bloqueia (dev)
  const sig = params.xSignature || "";
  const parts = Object.fromEntries(
    sig.split(",").map((kv) => kv.split("=").map((s) => s.trim()) as [string, string])
  );
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;
  const manifest = `id:${params.dataId};request-id:${params.xRequestId ?? ""};ts:${ts};`;
  const expected = crypto.createHmac("sha256", secret).update(manifest).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
  } catch {
    return false;
  }
}
