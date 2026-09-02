import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";
import {
  CalendarClock,
  Check,
  ChevronDown,
  ChevronUp,
  Infinity as InfinityIcon,
  Loader2,
  MonitorSmartphone,
  Plus,
  Power,
  RotateCw,
  Trash2,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDevices } from "@/hooks/use-devices";
import {
  getDevice,
  updateDevice,
  type DeviceAccess,
  type DeviceStatus,
  type PortalDevice,
} from "@/lib/api";
import type { IptvUserWithCheck } from "@/lib/types";

interface DevicesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  servers: IptvUserWithCheck[];
  /** Servidor pré-selecionado ao abrir por "Vincular dispositivo" de um card. */
  preselectServerId?: string | null;
}

const NONE = "__none__";
const DAY = 86_400_000;
const DEFAULT_DAYS = 30;

const ACCESS_META: Record<
  DeviceAccess,
  { label: string; variant: "success" | "warning" | "destructive" }
> = {
  active: { label: "ATIVO", variant: "success" },
  pending: { label: "PENDENTE", variant: "warning" },
  disabled: { label: "DESATIVADO", variant: "destructive" },
  expired: { label: "EXPIRADO", variant: "destructive" },
};

function relTime(ts: number): string {
  if (!ts) return "nunca";
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "agora";
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  return `há ${Math.floor(s / 86400)} d`;
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

// "válido até 10/10/2026 · faltam 28 dias" | "expirou em 01/09/2026 · há 3 dias"
function validityLabel(expiresAt: number | null): string {
  if (expiresAt == null) return "Sem validade (vitalício)";
  const diffDays = Math.round((expiresAt - Date.now()) / DAY);
  if (diffDays >= 0) {
    return `Válido até ${fmtDate(expiresAt)} · ${
      diffDays === 0 ? "vence hoje" : `faltam ${diffDays} dia${diffDays === 1 ? "" : "s"}`
    }`;
  }
  const ago = -diffDays;
  return `Expirou em ${fmtDate(expiresAt)} · há ${ago} dia${ago === 1 ? "" : "s"}`;
}

// input[type=date] usa "YYYY-MM-DD" no fuso local
function toDateInput(ts: number | null): string {
  if (ts == null) return "";
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function fromDateInput(v: string): number | null {
  if (!v) return null;
  // fim do dia local, pra "válido até DD" incluir o dia inteiro
  const d = new Date(`${v}T23:59:59`);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

export function DevicesDialog({ open, onOpenChange, servers, preselectServerId }: DevicesDialogProps) {
  const { devices, loading, error, reload, setServers, rename, setStatus, extend, setExpiry, remove, patch } =
    useDevices(open);

  const serverLabel = useMemo(() => {
    const m = new Map<string, string>();
    servers.forEach((s) => m.set(s.id, `${s.host} — ${s.username}`));
    return m;
  }, [servers]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MonitorSmartphone className="size-5" /> Dispositivos
          </DialogTitle>
          <DialogDescription>
            Cada aparelho do IPTV Player se anuncia aqui pelo MAC. Vincule um servidor e ative para
            liberar o acesso — o app baixa a lista sozinho e perde o acesso quando a validade vence.
          </DialogDescription>
        </DialogHeader>

        <AddDeviceForm
          servers={servers}
          serverLabel={serverLabel}
          preselectServerId={preselectServerId ?? null}
          onSaved={() => reload(true)}
        />

        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">
            {loading ? "carregando…" : `${devices.length} dispositivo${devices.length === 1 ? "" : "s"}`}
          </span>
          <Button variant="ghost" size="sm" onClick={() => reload()}>
            <RotateCw className="size-4" /> Atualizar
          </Button>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex max-h-[45vh] flex-col divide-y overflow-y-auto rounded-md border">
          {devices.length === 0 && !loading && (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Nenhum dispositivo ainda. Instale o IPTV Player e informe o endereço deste portal nele —
              o MAC aparece aqui automaticamente.
            </p>
          )}
          {devices.map((d) => (
            <DeviceRow
              key={d.mac}
              device={d}
              servers={servers}
              serverLabel={serverLabel}
              onSetServers={(ids) =>
                setServers(d.mac, ids)
                  .then(() => toast.success(ids.length ? "Linhas atualizadas." : "Linhas removidas."))
                  .catch((e) => toast.error(String(e)))
              }
              onRename={(name) => rename(d.mac, name).then(() => toast.success("Nome salvo.")).catch((e) => toast.error(String(e)))}
              onStatus={(s) => setStatus(d.mac, s).catch((e) => toast.error(String(e)))}
              onActivate={() =>
                patch(d.mac, { status: "active" })
                  .then(() => toast.success(`Liberado por ${DEFAULT_DAYS} dias.`))
                  .catch((e) => toast.error(String(e)))
              }
              onExtend={(days) =>
                extend(d.mac, days)
                  .then((u) => toast.success(`Renovado — válido até ${fmtDate(u.expiresAt ?? Date.now())}.`))
                  .catch((e) => toast.error(String(e)))
              }
              onSetExpiry={(ts) =>
                setExpiry(d.mac, ts)
                  .then(() =>
                    toast.success(ts == null ? "Marcado como vitalício." : `Validade: ${fmtDate(ts)}.`)
                  )
                  .catch((e) => toast.error(String(e)))
              }
              onRemove={() =>
                remove(d.mac).then(() => toast.success("Dispositivo removido.")).catch((e) => toast.error(String(e)))
              }
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddDeviceForm({
  servers,
  serverLabel,
  preselectServerId,
  onSaved,
}: {
  servers: IptvUserWithCheck[];
  serverLabel: Map<string, string>;
  preselectServerId: string | null;
  onSaved: () => void;
}) {
  const [mac, setMac] = useState("");
  const [name, setName] = useState("");
  const [serverId, setServerId] = useState<string>(preselectServerId ?? NONE);
  const [days, setDays] = useState<string>(String(DEFAULT_DAYS));
  const [lookup, setLookup] = useState<PortalDevice | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setServerId(preselectServerId ?? NONE);
  }, [preselectServerId]);

  const macValid = /^[0-9a-fA-F]{12}$/.test(mac.replace(/[^0-9a-fA-F]/g, ""));
  const willLiberate = serverId !== NONE;

  const doLookup = async () => {
    if (!macValid) return;
    setChecking(true);
    try {
      const found = await getDevice(mac);
      setLookup(found);
      if (found?.name && !name) setName(found.name);
    } finally {
      setChecking(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!macValid) {
      toast.error("MAC inválido — 12 dígitos hexadecimais.");
      return;
    }
    setSaving(true);
    try {
      const n = Number(days);
      await updateDevice(mac, {
        name: name.trim() || undefined,
        boundServerId: willLiberate ? serverId : null,
        status: willLiberate ? "active" : "pending",
        validityDays: willLiberate && n > 0 ? n : undefined,
      });
      toast.success(
        willLiberate
          ? `Cadastrado e liberado por ${Number(days) > 0 ? days : DEFAULT_DAYS} dias.`
          : "Dispositivo cadastrado."
      );
      setMac("");
      setName("");
      setLookup(null);
      setServerId(preselectServerId ?? NONE);
      setDays(String(DEFAULT_DAYS));
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao cadastrar.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-md border bg-muted/30 p-3">
      <p className="text-xs font-semibold text-muted-foreground">Adicionar / liberar dispositivo</p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex-1">
          <Label htmlFor="dev-mac" className="text-xs">
            MAC do aparelho
          </Label>
          <Input
            id="dev-mac"
            value={mac}
            onChange={(e) => {
              setMac(e.target.value);
              setLookup(null);
            }}
            onBlur={doLookup}
            placeholder="AA:BB:CC:DD:EE:FF"
            className="font-mono"
          />
        </div>
        <div className="flex-1">
          <Label htmlFor="dev-name" className="text-xs">
            Nome do dispositivo
            {checking && <Loader2 className="ml-1 inline size-3 animate-spin" />}
          </Label>
          <Input
            id="dev-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={lookup ? "" : "Ex.: TV da sala do João"}
          />
        </div>
      </div>

      {lookup && (
        <p className="text-xs text-muted-foreground">
          Reportado pelo aparelho: <span className="font-medium text-foreground">{lookup.name || "—"}</span>
          {lookup.model ? ` · ${lookup.model}` : ""}
          {lookup.platform ? ` · ${lookup.platform}` : ""} · visto {relTime(lookup.lastSeenAt)}
        </p>
      )}
      {macValid && !lookup && !checking && (
        <p className="text-xs text-muted-foreground">
          MAC ainda não conhecido — será pré-cadastrado; o nome/modelo chegam quando o app conectar.
        </p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Label className="text-xs">Servidor vinculado</Label>
          <Select value={serverId} onValueChange={setServerId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Nenhum (só cadastrar)</SelectItem>
              {servers.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {serverLabel.get(s.id)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {willLiberate && (
          <div className="w-full sm:w-28">
            <Label htmlFor="dev-days" className="text-xs">
              Validade (dias)
            </Label>
            <Input
              id="dev-days"
              type="number"
              min={1}
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </div>
        )}
        <Button type="submit" disabled={saving || !macValid}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          {willLiberate ? "Cadastrar e liberar" : "Cadastrar"}
        </Button>
      </div>
    </form>
  );
}

function DeviceRow({
  device,
  servers,
  serverLabel,
  onSetServers,
  onRename,
  onStatus,
  onActivate,
  onExtend,
  onSetExpiry,
  onRemove,
}: {
  device: PortalDevice;
  servers: IptvUserWithCheck[];
  serverLabel: Map<string, string>;
  onSetServers: (ids: string[]) => void;
  onRename: (name: string) => void;
  onStatus: (s: DeviceStatus) => void;
  onActivate: () => void;
  onExtend: (days: number) => void;
  onSetExpiry: (ts: number | null) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(device.name);
  const [dateDraft, setDateDraft] = useState(toDateInput(device.expiresAt));
  const meta = ACCESS_META[device.access];

  useEffect(() => setDateDraft(toDateInput(device.expiresAt)), [device.expiresAt]);

  const showValidity = device.status !== "pending";

  return (
    <div className="flex flex-col gap-2 p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs">{device.mac}</span>
        <Badge variant={meta.variant}>{meta.label}</Badge>
      </div>

      <div className="flex items-center gap-2">
        {editing ? (
          <>
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="h-8"
              autoFocus
            />
            <Button
              size="icon"
              variant="ghost"
              className="size-8"
              onClick={() => {
                onRename(draft.trim());
                setEditing(false);
              }}
            >
              <Check className="size-4" />
            </Button>
            <Button size="icon" variant="ghost" className="size-8" onClick={() => setEditing(false)}>
              <X className="size-4" />
            </Button>
          </>
        ) : (
          <>
            <span className="font-medium">{device.name || "(sem nome)"}</span>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setEditing(true)}>
              renomear
            </Button>
          </>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {device.model || "modelo desconhecido"} · {device.platform || "—"} · visto {relTime(device.lastSeenAt)}
      </p>

      <div className="flex flex-col gap-2">
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            Linhas (a 1ª é a principal; as demais entram sozinhas se ela cair)
          </p>
          <ServerLinesEditor
            servers={servers}
            serverLabel={serverLabel}
            value={device.boundServerIds}
            onChange={onSetServers}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {device.status === "active" ? (
            <Button size="sm" variant="outline" onClick={() => onStatus("disabled")}>
              <Power className="size-4" /> Desativar
            </Button>
          ) : (
            <Button size="sm" onClick={onActivate} disabled={device.boundServerIds.length === 0}>
              <Power className="size-4" /> Ativar
            </Button>
          )}

          <Button size="sm" variant="ghost" className="text-destructive" onClick={onRemove}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      {showValidity && (
        <div className="mt-1 flex flex-col gap-2 rounded-md border bg-muted/20 p-2">
          <div className="flex items-center gap-1.5 text-xs">
            <CalendarClock className="size-3.5 shrink-0 text-muted-foreground" />
            <span
              className={
                device.access === "expired" ? "font-medium text-destructive" : "text-muted-foreground"
              }
            >
              {validityLabel(device.expiresAt)}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => onExtend(7)}>
              +7d
            </Button>
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => onExtend(30)}>
              +30d
            </Button>
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => onExtend(365)}>
              +1 ano
            </Button>
            <Input
              type="date"
              value={dateDraft}
              onChange={(e) => setDateDraft(e.target.value)}
              onBlur={() => {
                const ts = fromDateInput(dateDraft);
                if (ts !== device.expiresAt) onSetExpiry(ts);
              }}
              className="h-7 w-[9.5rem] px-2 text-xs"
            />
            {device.expiresAt != null && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => onSetExpiry(null)}
                title="Remover validade (vitalício)"
              >
                <InfinityIcon className="size-3.5" /> sem validade
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Editor da lista ordenada de linhas do dispositivo: [0] é a principal, as
// demais são reservas de failover que o Player usa sozinho se a de cima cair.
function ServerLinesEditor({
  servers,
  serverLabel,
  value,
  onChange,
}: {
  servers: IptvUserWithCheck[];
  serverLabel: Map<string, string>;
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const available = servers.filter((s) => !value.includes(s.id));

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const removeAt = (i: number) => onChange(value.filter((_, k) => k !== i));
  const add = (id: string) => {
    if (id !== NONE && !value.includes(id)) onChange([...value, id]);
  };

  return (
    <div className="flex w-full flex-col gap-1.5">
      {value.map((id, i) => (
        <div key={id} className="flex items-center gap-1.5 text-xs">
          <Badge variant={i === 0 ? "success" : "warning"} className="shrink-0">
            {i === 0 ? "Principal" : `Reserva ${i}`}
          </Badge>
          <span className="min-w-0 flex-1 truncate font-mono" title={serverLabel.get(id) ?? id}>
            {serverLabel.get(id) ?? id}
          </span>
          <Button
            size="icon"
            variant="ghost"
            className="size-6"
            disabled={i === 0}
            onClick={() => move(i, -1)}
            title="Subir (mais prioridade)"
          >
            <ChevronUp className="size-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-6"
            disabled={i === value.length - 1}
            onClick={() => move(i, 1)}
            title="Descer"
          >
            <ChevronDown className="size-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-6 text-destructive"
            onClick={() => removeAt(i)}
            title="Remover linha"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      ))}

      {available.length > 0 && (
        <Select value={NONE} onValueChange={add}>
          <SelectTrigger className={value.length === 0 ? "h-8 w-[260px]" : "h-7 w-[260px] text-xs"}>
            <SelectValue placeholder={value.length === 0 ? "Vincular linha" : "+ adicionar reserva"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>
              {value.length === 0 ? "Sem linha" : "+ adicionar reserva"}
            </SelectItem>
            {available.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {serverLabel.get(s.id)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
