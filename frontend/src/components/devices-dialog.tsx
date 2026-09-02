import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";
import { Check, Loader2, MonitorSmartphone, Plus, Power, RotateCw, Trash2, X } from "lucide-react";
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
import { getDevice, updateDevice, type DeviceStatus, type PortalDevice } from "@/lib/api";
import type { IptvUserWithCheck } from "@/lib/types";

interface DevicesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  servers: IptvUserWithCheck[];
  /** Servidor pré-selecionado ao abrir por "Vincular dispositivo" de um card. */
  preselectServerId?: string | null;
}

const NONE = "__none__";

const STATUS_META: Record<DeviceStatus, { label: string; variant: "success" | "warning" | "destructive" }> = {
  active: { label: "ATIVO", variant: "success" },
  pending: { label: "PENDENTE", variant: "warning" },
  disabled: { label: "DESATIVADO", variant: "destructive" },
};

function relTime(ts: number): string {
  if (!ts) return "nunca";
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "agora";
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  return `há ${Math.floor(s / 86400)} d`;
}

export function DevicesDialog({ open, onOpenChange, servers, preselectServerId }: DevicesDialogProps) {
  const { devices, loading, error, reload, bind, rename, setStatus, remove, patch } = useDevices(open);

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
            liberar o acesso — o app baixa a lista sozinho.
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
              onBind={(id) => bind(d.mac, id).catch((e) => toast.error(String(e)))}
              onRename={(name) => rename(d.mac, name).then(() => toast.success("Nome salvo.")).catch((e) => toast.error(String(e)))}
              onStatus={(s) => setStatus(d.mac, s).catch((e) => toast.error(String(e)))}
              onActivate={() =>
                patch(d.mac, { status: "active" })
                  .then(() => toast.success("Dispositivo liberado."))
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
  const [lookup, setLookup] = useState<PortalDevice | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setServerId(preselectServerId ?? NONE);
  }, [preselectServerId]);

  const macValid = /^[0-9a-fA-F]{12}$/.test(mac.replace(/[^0-9a-fA-F]/g, ""));

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
      await updateDevice(mac, {
        name: name.trim() || undefined,
        boundServerId: serverId === NONE ? null : serverId,
        status: serverId === NONE ? "pending" : "active",
      });
      toast.success(serverId === NONE ? "Dispositivo cadastrado." : "Dispositivo cadastrado e liberado.");
      setMac("");
      setName("");
      setLookup(null);
      setServerId(preselectServerId ?? NONE);
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
        <Button type="submit" disabled={saving || !macValid}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          {serverId === NONE ? "Cadastrar" : "Cadastrar e liberar"}
        </Button>
      </div>
    </form>
  );
}

function DeviceRow({
  device,
  servers,
  serverLabel,
  onBind,
  onRename,
  onStatus,
  onActivate,
  onRemove,
}: {
  device: PortalDevice;
  servers: IptvUserWithCheck[];
  serverLabel: Map<string, string>;
  onBind: (id: string | null) => void;
  onRename: (name: string) => void;
  onStatus: (s: DeviceStatus) => void;
  onActivate: () => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(device.name);
  const meta = STATUS_META[device.status];

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

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={device.boundServerId ?? NONE}
          onValueChange={(v) => onBind(v === NONE ? null : v)}
        >
          <SelectTrigger className="h-8 w-[260px]">
            <SelectValue placeholder="Sem servidor" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Sem servidor</SelectItem>
            {servers.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {serverLabel.get(s.id)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {device.status === "active" ? (
          <Button size="sm" variant="outline" onClick={() => onStatus("disabled")}>
            <Power className="size-4" /> Desativar
          </Button>
        ) : (
          <Button size="sm" onClick={onActivate} disabled={!device.boundServerId}>
            <Power className="size-4" /> Ativar
          </Button>
        )}

        <Button size="sm" variant="ghost" className="text-destructive" onClick={onRemove}>
          <Trash2 className="size-4" />
        </Button>
      </div>
    </div>
  );
}
