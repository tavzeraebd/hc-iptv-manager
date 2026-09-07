import { useEffect, useState } from "react";
import { toast } from "sonner";
import { BarChart3, Loader2, RefreshCw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getAnalytics, type ProviderAnalytics } from "@/lib/api";

// Trilha do provedor (p-3). Visão agregada só-leitura: acesso, churn
// (quando abriu por último + "em risco"), assistindo agora e saúde de
// reprodução (telemetria da Fase 0). "Mais assistidos" histórico fica de
// fora — o portal só guarda o `nowPlaying` atual, não um log de sessões.

interface AnalyticsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: "warn" | "bad" | "good" }) {
  const color =
    tone === "warn" ? "text-warning" : tone === "bad" ? "text-destructive" : tone === "good" ? "text-success" : "";
  return (
    <div className="rounded-md border bg-muted/20 px-3 py-2">
      <div className={`text-lg font-semibold tabular-nums ${color}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function fmtDaysAgo(ts: number): string {
  const d = Math.floor((Date.now() - ts) / 86_400_000);
  return d <= 0 ? "hoje" : d === 1 ? "1 dia" : `${d} dias`;
}
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export function AnalyticsDialog({ open, onOpenChange }: AnalyticsDialogProps) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ProviderAnalytics | null>(null);

  const load = () => {
    setLoading(true);
    getAnalytics()
      .then(setData)
      .catch((e) => toast.error(e instanceof Error ? e.message : "Erro ao carregar."))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (open) load();
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="size-5" /> Analytics do provedor
          </DialogTitle>
          <DialogDescription>
            Agregado dos aparelhos deste portal. Só leitura.
          </DialogDescription>
        </DialogHeader>

        {loading || !data ? (
          <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Calculando…
          </div>
        ) : (
          <div className="flex flex-col gap-5 text-sm">
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Acesso</h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Aparelhos" value={data.totals.devices} />
                <Stat label="Ativos" value={data.totals.active} tone="good" />
                <Stat label="Vencendo (3d)" value={data.totals.expiringSoon} tone="warn" />
                <Stat label="Expirados" value={data.totals.expired} tone="bad" />
              </div>
            </section>

            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                Última vez que abriu o app
              </h3>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                <Stat label="hoje" value={data.seen.today} />
                <Stat label="1–3d" value={data.seen.d3} />
                <Stat label="3–7d" value={data.seen.d7} />
                <Stat label="7–14d" value={data.seen.d14} tone="warn" />
                <Stat label="14–30d" value={data.seen.d30} tone="warn" />
                <Stat label="30d+" value={data.seen.older} tone="bad" />
              </div>
            </section>

            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                Em risco de churn · acesso ativo, sumidos há 7d+ ({data.atRisk.length})
              </h3>
              {data.atRisk.length === 0 ? (
                <p className="text-xs text-muted-foreground">Ninguém — todos os ativos abriram na última semana.</p>
              ) : (
                <ul className="divide-y rounded-md border">
                  {data.atRisk.slice(0, 12).map((d) => (
                    <li key={d.mac} className="flex items-center justify-between px-3 py-1.5">
                      <span className="truncate">{d.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        há {fmtDaysAgo(d.lastSeenAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                Assistindo agora · {data.watchingNow} {data.watchingNow === 1 ? "aparelho" : "aparelhos"}
              </h3>
              {data.playing.length === 0 ? (
                <p className="text-xs text-muted-foreground">Ninguém assistindo neste momento.</p>
              ) : (
                <ul className="divide-y rounded-md border">
                  {data.playing.slice(0, 12).map((p) => (
                    <li key={`${p.kind}:${p.title}`} className="flex items-center justify-between px-3 py-1.5">
                      <span className="truncate">
                        <span className="mr-2 text-[10px] uppercase text-muted-foreground">{p.kind}</span>
                        {p.title}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {p.count}×
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                Saúde de reprodução · {data.health.reportingDevices} aparelhos reportando ·{" "}
                {data.health.sessions} sessões
              </h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat
                  label="Travadas"
                  value={pct(data.health.stallRate)}
                  tone={data.health.stallRate > 0.15 ? "bad" : data.health.stallRate > 0.05 ? "warn" : "good"}
                />
                <Stat
                  label="Erros"
                  value={pct(data.health.errorRate)}
                  tone={data.health.errorRate > 0.1 ? "bad" : data.health.errorRate > 0.03 ? "warn" : "good"}
                />
                <Stat label="Fallback nativo" value={pct(data.health.fallbackRate)} />
                <Stat
                  label="1º frame (méd.)"
                  value={data.health.avgFirstFrameMs != null ? `${data.health.avgFirstFrameMs}ms` : "—"}
                  tone={
                    data.health.avgFirstFrameMs != null && data.health.avgFirstFrameMs > 4000
                      ? "warn"
                      : undefined
                  }
                />
              </div>
            </section>

            <p className="text-[11px] text-muted-foreground">
              Gerado {new Date(data.generatedAt).toLocaleString("pt-BR")}. "Mais assistidos"
              histórico não entra aqui — o portal guarda só o que está tocando agora.
            </p>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="ghost" onClick={load} disabled={loading}>
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} /> Atualizar
          </Button>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
