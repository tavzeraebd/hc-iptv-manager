import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";
import { BarChart3, CreditCard, Loader2, Megaphone, Palette } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getRenewalSettings, updateRenewalSettings } from "@/lib/api";
import type { IptvUserWithCheck } from "@/lib/types";

const NONE = "__none__";

interface RenewalSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  servers: IptvUserWithCheck[];
  /** Atalhos da central de config do provedor: "Marca do app" (p-1),
   * "Aviso no app" (p-2) e "Analytics" (p-3). */
  onOpenBranding?: () => void;
  onOpenNotice?: () => void;
  onOpenAnalytics?: () => void;
}

const reaisToCents = (v: string) => Math.round(parseFloat(v.replace(",", ".")) * 100);
const centsToReais = (c: number) => (c / 100).toFixed(2);
// input[type=date] "YYYY-MM-DD" -> epoch ms (fim do dia local) e volta
const dateToTs = (v: string) => (v ? new Date(`${v}T23:59:59`).getTime() : null);
const tsToDate = (ts: number | null) => {
  if (!ts) return "";
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export function RenewalSettingsDialog({
  open,
  onOpenChange,
  servers,
  onOpenBranding,
  onOpenNotice,
  onOpenAnalytics,
}: RenewalSettingsDialogProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [providerOk, setProviderOk] = useState(false);
  const [price, setPrice] = useState("19.90");
  const [months, setMonths] = useState("1");
  const [ttl, setTtl] = useState("30");
  const [promoOn, setPromoOn] = useState(false);
  const [promoPrice, setPromoPrice] = useState("");
  const [promoUntil, setPromoUntil] = useState("");
  const [trialOn, setTrialOn] = useState(false);
  const [trialServer, setTrialServer] = useState<string>(NONE);
  const [trialHours, setTrialHours] = useState("1");
  // p-4: planos alternativos (upgrade) + bônus de indicação.
  const [plans, setPlans] = useState<{ label: string; months: string; price: string }[]>([]);
  const [referralDays, setReferralDays] = useState("0");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    getRenewalSettings()
      .then((s) => {
        setProviderOk(s.providerConfigured);
        setPrice(centsToReais(s.priceCents));
        setMonths(String(s.months));
        setTtl(String(s.qrTtlMin));
        const hasPromo = s.promoPriceCents != null && s.promoUntil != null;
        setPromoOn(hasPromo);
        setPromoPrice(s.promoPriceCents != null ? centsToReais(s.promoPriceCents) : "");
        setPromoUntil(tsToDate(s.promoUntil));
        setTrialOn(s.trialEnabled);
        setTrialServer(s.trialServerId ?? NONE);
        setPlans(
          (s.plans ?? []).map((p) => ({
            label: p.label,
            months: String(p.months),
            price: centsToReais(p.priceCents),
          }))
        );
        setReferralDays(String(s.referralBonusDays ?? 0));
        setTrialHours(String(s.trialHours || 1));
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Erro ao carregar."))
      .finally(() => setLoading(false));
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const priceCents = reaisToCents(price);
    if (!Number.isFinite(priceCents) || priceCents < 100) {
      toast.error("Preço mínimo R$ 1,00.");
      return;
    }
    const patch: Parameters<typeof updateRenewalSettings>[0] = {
      priceCents,
      months: Math.max(1, parseInt(months || "1", 10)),
      qrTtlMin: Math.min(60, Math.max(5, parseInt(ttl || "30", 10))),
    };
    if (promoOn) {
      const pc = reaisToCents(promoPrice);
      const pu = dateToTs(promoUntil);
      if (!Number.isFinite(pc) || pc < 100 || !pu) {
        toast.error("Preencha preço e data do valor promocional.");
        return;
      }
      patch.promoPriceCents = pc;
      patch.promoUntil = pu;
    } else {
      patch.promoPriceCents = null;
      patch.promoUntil = null;
    }

    if (trialOn && trialServer === NONE) {
      toast.error("Escolha a linha que o teste grátis vai usar.");
      return;
    }
    patch.trialEnabled = trialOn;
    patch.trialServerId = trialOn && trialServer !== NONE ? trialServer : null;
    patch.trialHours = Math.min(720, Math.max(1, parseInt(trialHours || "1", 10)));

    // p-4: planos alternativos — só entram os com meses ≥ 1 e preço ≥ R$ 1.
    patch.plans = plans
      .map((p) => ({
        label: p.label.trim(),
        months: parseInt(p.months || "0", 10),
        priceCents: reaisToCents(p.price),
      }))
      .filter((p) => p.months >= 1 && Number.isFinite(p.priceCents) && p.priceCents >= 100)
      .map((p) => ({ id: `p${p.months}m${p.priceCents}`, ...p }));
    patch.referralBonusDays = Math.min(365, Math.max(0, parseInt(referralDays || "0", 10)));

    setSaving(true);
    try {
      const s = await updateRenewalSettings(patch);
      toast.success(
        `Preço em vigor: R$ ${centsToReais(s.effectivePriceCents).replace(".", ",")}` +
          (s.promoUntil ? " (promoção ativa)" : "")
      );
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="size-5" /> Pagamento / renovação
            </DialogTitle>
            <DialogDescription>
              Valor que o usuário paga por PIX (Mercado Pago) para renovar o acesso. O portal
              estende a validade automaticamente quando o pagamento é confirmado.
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Carregando…
            </div>
          ) : (
            <>
              <p
                className={
                  providerOk
                    ? "text-xs font-medium text-success"
                    : "text-xs font-medium text-warning"
                }
              >
                {providerOk
                  ? "● Mercado Pago conectado"
                  : "● Mercado Pago não configurado — defina MP_ACCESS_TOKEN no portal (Render → Environment)."}
              </p>

              <div className="flex gap-3">
                <div className="flex-1">
                  <Label htmlFor="r-price" className="text-xs">
                    Preço (R$)
                  </Label>
                  <Input
                    id="r-price"
                    inputMode="decimal"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                  />
                </div>
                <div className="w-24">
                  <Label htmlFor="r-months" className="text-xs">
                    Meses
                  </Label>
                  <Input
                    id="r-months"
                    type="number"
                    min={1}
                    value={months}
                    onChange={(e) => setMonths(e.target.value)}
                  />
                </div>
                <div className="w-28">
                  <Label htmlFor="r-ttl" className="text-xs">
                    QR expira (min)
                  </Label>
                  <Input
                    id="r-ttl"
                    type="number"
                    min={5}
                    max={60}
                    value={ttl}
                    onChange={(e) => setTtl(e.target.value)}
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={promoOn}
                  onChange={(e) => setPromoOn(e.target.checked)}
                  className="size-4 accent-primary"
                />
                Valor promocional (temporário)
              </label>
              {promoOn && (
                <div className="flex gap-3">
                  <div className="flex-1">
                    <Label htmlFor="r-promo-price" className="text-xs">
                      Preço promo (R$)
                    </Label>
                    <Input
                      id="r-promo-price"
                      inputMode="decimal"
                      placeholder="14,90"
                      value={promoPrice}
                      onChange={(e) => setPromoPrice(e.target.value)}
                    />
                  </div>
                  <div className="flex-1">
                    <Label htmlFor="r-promo-until" className="text-xs">
                      Até (inclusive)
                    </Label>
                    <Input
                      id="r-promo-until"
                      type="date"
                      value={promoUntil}
                      onChange={(e) => setPromoUntil(e.target.value)}
                    />
                  </div>
                </div>
              )}

              <div className="mt-1 flex flex-col gap-3 rounded-md border bg-muted/20 p-3">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={trialOn}
                    onChange={(e) => setTrialOn(e.target.checked)}
                    className="size-4 accent-primary"
                  />
                  Teste grátis automático para dispositivos novos
                </label>
                <p className="text-xs text-muted-foreground">
                  No 1º acesso de um aparelho ainda desconhecido, o portal libera sozinho por
                  algumas horas. Vencido o prazo, o app mostra o QR de pagamento. Vale 1× por
                  aparelho (reinstalar não reinicia — o ID vem do Android).
                </p>
                {trialOn && (
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <Label className="text-xs">Linha do teste</Label>
                      <Select value={trialServer} onValueChange={setTrialServer}>
                        <SelectTrigger>
                          <SelectValue placeholder="Escolha um servidor" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>Escolha um servidor</SelectItem>
                          {servers.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.host} — {s.username}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="w-28">
                      <Label htmlFor="r-trial-hours" className="text-xs">
                        Horas
                      </Label>
                      <Input
                        id="r-trial-hours"
                        type="number"
                        min={1}
                        max={720}
                        value={trialHours}
                        onChange={(e) => setTrialHours(e.target.value)}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* p-4: planos alternativos (upgrade) */}
              <div className="flex flex-col gap-2 rounded-md border bg-muted/20 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Planos alternativos (upgrade)</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setPlans((p) => [...p, { label: "", months: "3", price: "49.90" }].slice(0, 6))
                    }
                  >
                    + Plano
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  O plano base acima é sempre oferecido. Estes aparecem como opção de upgrade no app.
                </p>
                {plans.map((pl, i) => (
                  <div key={i} className="flex items-end gap-2">
                    <div className="flex-1">
                      <Label className="text-xs">Nome</Label>
                      <Input
                        placeholder="Trimestral"
                        value={pl.label}
                        onChange={(e) =>
                          setPlans((p) => p.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                        }
                      />
                    </div>
                    <div className="w-20">
                      <Label className="text-xs">Meses</Label>
                      <Input
                        type="number"
                        min={1}
                        value={pl.months}
                        onChange={(e) =>
                          setPlans((p) => p.map((x, j) => (j === i ? { ...x, months: e.target.value } : x)))
                        }
                      />
                    </div>
                    <div className="w-24">
                      <Label className="text-xs">R$</Label>
                      <Input
                        inputMode="decimal"
                        value={pl.price}
                        onChange={(e) =>
                          setPlans((p) => p.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))
                        }
                      />
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => setPlans((p) => p.filter((_, j) => j !== i))}
                      aria-label="Remover plano"
                    >
                      ×
                    </Button>
                  </div>
                ))}
              </div>

              {/* p-4: bônus de indicação */}
              <div className="flex items-end gap-3 rounded-md border bg-muted/20 p-3">
                <div className="flex-1">
                  <Label htmlFor="r-referral" className="text-sm font-medium">
                    Bônus de indicação
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Dias creditados a quem indica, no 1º pagamento do indicado. 0 = sem bônus
                    automático (você credita à mão em "Dispositivos").
                  </p>
                </div>
                <div className="w-24">
                  <Label htmlFor="r-referral" className="text-xs">
                    Dias
                  </Label>
                  <Input
                    id="r-referral"
                    type="number"
                    min={0}
                    max={365}
                    value={referralDays}
                    onChange={(e) => setReferralDays(e.target.value)}
                  />
                </div>
              </div>
            </>
          )}

          <DialogFooter className="gap-2 sm:justify-between">
            <div className="flex flex-wrap gap-1">
              {onOpenBranding && (
                <Button type="button" variant="ghost" size="sm" onClick={onOpenBranding}>
                  <Palette className="size-4" /> Marca…
                </Button>
              )}
              {onOpenNotice && (
                <Button type="button" variant="ghost" size="sm" onClick={onOpenNotice}>
                  <Megaphone className="size-4" /> Aviso…
                </Button>
              )}
              {onOpenAnalytics && (
                <Button type="button" variant="ghost" size="sm" onClick={onOpenAnalytics}>
                  <BarChart3 className="size-4" /> Analytics…
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving || loading}>
                {saving && <Loader2 className="size-4 animate-spin" />} Salvar
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
