import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";
import { CreditCard, Loader2 } from "lucide-react";
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
import { getRenewalSettings, updateRenewalSettings } from "@/lib/api";

interface RenewalSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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

export function RenewalSettingsDialog({ open, onOpenChange }: RenewalSettingsDialogProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [providerOk, setProviderOk] = useState(false);
  const [price, setPrice] = useState("19.90");
  const [months, setMonths] = useState("1");
  const [ttl, setTtl] = useState("30");
  const [promoOn, setPromoOn] = useState(false);
  const [promoPrice, setPromoPrice] = useState("");
  const [promoUntil, setPromoUntil] = useState("");

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
            </>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving || loading}>
              {saving && <Loader2 className="size-4 animate-spin" />} Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
