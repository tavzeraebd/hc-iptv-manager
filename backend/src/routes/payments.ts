import { Router, Request, Response } from "express";
import { findDevice, updateDevice, normalizeMac, accessOf } from "../deviceStore";
import { findUser } from "../storage";
import {
  getRenewalConfig,
  setRenewalConfig,
  effectivePriceCents,
  getPaymentById,
  getPaymentByProviderRef,
  getOpenPaymentForDevice,
  listPaymentsForDevice,
  insertPayment,
  markPaymentStatus,
  newPaymentId,
  type Payment,
} from "../paymentStore";
import {
  mpConfigured,
  createPixPayment,
  getPayment,
  verifyWebhookSignature,
} from "../mercadopago";

const router = Router();

const publicPayment = (p: Payment) => ({
  paymentId: p.id,
  status: p.status,
  amountCents: p.amountCents,
  months: p.months,
  qrCode: p.qrCode,
  qrCodeBase64: p.qrCodeB64,
  ticketUrl: p.ticketUrl,
  expiresAt: p.expiresAt,
  createdAt: p.createdAt,
});

function payerEmailFor(mac: string): string {
  return `pix.${mac.replace(/[^0-9a-z]/gi, "").toLowerCase()}@hciptv.app`;
}

// Aplica a renovação (idempotente): estende o device e marca a cobrança paga.
async function settlePayment(row: Payment, paidAmountReais: number): Promise<void> {
  if (row.processed || row.status === "paid") return;
  const expectedReais = row.amountCents / 100;
  if (paidAmountReais + 0.01 < expectedReais) {
    await markPaymentStatus(row.id, "error");
    throw new Error(
      `Valor pago (R$ ${paidAmountReais.toFixed(2)}) menor que o esperado (R$ ${expectedReais.toFixed(2)}).`
    );
  }
  await updateDevice(row.deviceMac, { extendDays: 30 * (row.months || 1) });
  await markPaymentStatus(row.id, "paid", { paidAt: Date.now(), processed: true });
}

// --- público: info de preço (pro botão "Renovar — R$ x") --------------------
router.get("/renewal/info", async (_req: Request, res: Response) => {
  try {
    const cfg = await getRenewalConfig();
    res.json({
      priceCents: effectivePriceCents(cfg),
      months: cfg.months,
      providerConfigured: mpConfigured(),
    });
  } catch {
    res.status(500).json({ error: "Não foi possível carregar as informações de renovação." });
  }
});

// --- público: o Player pede uma cobrança PIX -------------------------------
router.post("/devices/:mac/renewal", async (req: Request, res: Response) => {
  const mac = normalizeMac(req.params.mac);
  if (!mac) {
    res.status(400).json({ error: "MAC inválido." });
    return;
  }
  if (!mpConfigured()) {
    res.status(503).json({ error: "Pagamento não configurado no portal." });
    return;
  }
  try {
    const device = await findDevice(mac);
    if (!device) {
      res.status(404).json({ error: "Dispositivo não encontrado." });
      return;
    }
    if (device.boundServerIds.length === 0) {
      res.status(409).json({
        error: "Dispositivo ainda não foi liberado pelo provedor. Fale com o suporte.",
      });
      return;
    }

    // Reaproveita uma cobrança pendente e ainda válida (evita spammar o MP).
    const open = await getOpenPaymentForDevice(mac);
    if (open) {
      res.json(publicPayment(open));
      return;
    }

    const cfg = await getRenewalConfig();
    const amountCents = effectivePriceCents(cfg);
    const months = cfg.months;
    const id = newPaymentId();
    const expiresAt = Date.now() + cfg.qrTtlMin * 60_000;

    const mp = await createPixPayment({
      amountReais: amountCents / 100,
      description: `Renovação IPTV — ${months} mês(es) — ${mac}`,
      externalReference: id,
      payerEmail: payerEmailFor(mac),
      expiresAt,
    });

    const saved = await insertPayment({
      id,
      deviceMac: mac,
      amountCents,
      months,
      providerRef: mp.id,
      qrCode: mp.qrCode,
      qrCodeB64: mp.qrCodeBase64,
      ticketUrl: mp.ticketUrl,
      expiresAt,
    });
    res.json(publicPayment(saved));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao gerar a cobrança.";
    res.status(502).json({ error: message });
  }
});

// --- público: o Player consulta o status (faz polling) --------------------
router.get("/payments/:id", async (req: Request, res: Response) => {
  try {
    const row = await getPaymentById(req.params.id);
    if (!row) {
      res.status(404).json({ error: "Cobrança não encontrada." });
      return;
    }

    let current = row;
    if (row.status === "pending") {
      if (row.expiresAt != null && row.expiresAt <= Date.now()) {
        await markPaymentStatus(row.id, "expired");
        current = { ...row, status: "expired" };
      } else if (row.providerRef && mpConfigured()) {
        // auto-cura: consulta o MP direto (caso o webhook tenha perdido)
        try {
          const mp = await getPayment(row.providerRef);
          if (mp.status === "approved") {
            await settlePayment(row, mp.transactionAmount);
            current = { ...row, status: "paid" };
          } else if (mp.status === "rejected" || mp.status === "cancelled") {
            await markPaymentStatus(row.id, "cancelled");
            current = { ...row, status: "cancelled" };
          }
        } catch {
          /* MP indisponível — mantém pending, tenta no próximo poll */
        }
      }
    }

    const device = await findDevice(current.deviceMac);
    res.json({
      status: current.status,
      months: current.months,
      amountCents: current.amountCents,
      expiresAt: current.expiresAt,
      deviceAccess: device ? accessOf(device) : null,
    });
  } catch {
    res.status(500).json({ error: "Erro ao consultar a cobrança." });
  }
});

// --- público (assinado): webhook do Mercado Pago ------------------------------
router.post("/webhooks/mercadopago", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, any>;
  const type = body.type || body.topic || (req.query.type as string) || (req.query.topic as string);
  const dataId =
    (body.data && body.data.id) ||
    (req.query["data.id"] as string) ||
    (req.query.id as string) ||
    "";

  // Responde 200 rápido pra tudo que não for pagamento (MP manda vários tipos).
  if (type !== "payment" || !dataId) {
    res.status(200).json({ ok: true, ignored: true });
    return;
  }

  const ok = verifyWebhookSignature({
    dataId: String(dataId),
    xSignature: req.get("x-signature") ?? undefined,
    xRequestId: req.get("x-request-id") ?? undefined,
  });
  if (!ok) {
    res.status(401).json({ error: "Assinatura inválida." });
    return;
  }

  try {
    const mp = await getPayment(String(dataId));
    if (mp.status !== "approved") {
      res.status(200).json({ ok: true, status: mp.status });
      return;
    }
    let row: Payment | null = mp.externalReference
      ? await getPaymentById(mp.externalReference)
      : null;
    if (!row) row = await getPaymentByProviderRef(String(dataId));
    if (!row) {
      res.status(200).json({ ok: true, note: "cobrança desconhecida" });
      return;
    }
    await settlePayment(row, mp.transactionAmount);
    res.status(200).json({ ok: true, settled: true });
  } catch (err) {
    // 200 mesmo em erro de valor (não queremos MP reenviando pra sempre);
    // erros transitórios sobem como 500 pra o MP repetir.
    const msg = err instanceof Error ? err.message : "erro";
    if (msg.startsWith("Valor pago")) {
      res.status(200).json({ ok: false, error: msg });
    } else {
      res.status(500).json({ error: msg });
    }
  }
});

// --- admin: config de preço/meses ------------------------------------------
router.get("/settings/renewal", async (_req: Request, res: Response) => {
  try {
    const cfg = await getRenewalConfig();
    res.json({ ...cfg, effectivePriceCents: effectivePriceCents(cfg), providerConfigured: mpConfigured() });
  } catch {
    res.status(500).json({ error: "Não foi possível carregar a configuração." });
  }
});

router.put("/settings/renewal", async (req: Request, res: Response) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  if (typeof b.priceCents === "number") patch.priceCents = b.priceCents;
  if (typeof b.months === "number") patch.months = b.months;
  if (typeof b.qrTtlMin === "number") patch.qrTtlMin = b.qrTtlMin;
  if (b.promoPriceCents === null || typeof b.promoPriceCents === "number")
    patch.promoPriceCents = b.promoPriceCents;
  if (b.promoUntil === null || typeof b.promoUntil === "number") patch.promoUntil = b.promoUntil;
  if (typeof b.trialEnabled === "boolean") patch.trialEnabled = b.trialEnabled;
  if (typeof b.trialHours === "number") patch.trialHours = b.trialHours;
  if (b.trialServerId === null || b.trialServerId === "") {
    patch.trialServerId = null;
  } else if (typeof b.trialServerId === "string") {
    const srv = await findUser(b.trialServerId);
    if (!srv) {
      res.status(400).json({ error: "Servidor do teste grátis não existe." });
      return;
    }
    patch.trialServerId = b.trialServerId;
  }
  try {
    const cfg = await setRenewalConfig(patch);
    res.json({ ...cfg, effectivePriceCents: effectivePriceCents(cfg), providerConfigured: mpConfigured() });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Erro ao salvar." });
  }
});

// --- admin: histórico de cobranças de um device --------------------------
router.get("/devices/:mac/payments", async (req: Request, res: Response) => {
  const mac = normalizeMac(req.params.mac);
  if (!mac) {
    res.status(400).json({ error: "MAC inválido." });
    return;
  }
  try {
    const list = await listPaymentsForDevice(mac);
    res.json(
      list.map((p) => ({
        id: p.id,
        status: p.status,
        amountCents: p.amountCents,
        months: p.months,
        createdAt: p.createdAt,
        paidAt: p.paidAt,
      }))
    );
  } catch {
    res.status(500).json({ error: "Erro ao carregar o histórico." });
  }
});

export default router;
