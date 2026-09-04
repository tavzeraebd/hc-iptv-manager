import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clapperboard,
  Filter,
  Infinity as InfinityIcon,
  Loader2,
  MonitorSmartphone,
  Plus,
  Power,
  RotateCw,
  Trash2,
  Tv,
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  getDevice,
  updateDevice,
  type DeviceAccess,
  type DevicePatch,
  type DeviceStatus,
  type NowPlaying,
  type PortalDevice,
} from "@/lib/api";
import { isDeviceOnline, lineConnectionStats } from "@/lib/device-status";
import type { IptvUserWithCheck } from "@/lib/types";
import { cn } from "@/lib/utils";

interface DevicesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  servers: IptvUserWithCheck[];
  /** Servidor pré-selecionado ao abrir por "Vincular dispositivo" ou pelo
   * badge de Conexões de uma linha. */
  preselectServerId?: string | null;
  /** "manage" (padrão): tela completa, com formulário de cadastro/vínculo.
   * "connections": aberto pelo badge de Conexões — só a lista de quem está
   * conectado nessa linha, sem formulário nenhum. */
  mode?: "manage" | "connections";
  // Estado de dispositivos levantado pro App.tsx (a tabela de servidores
  // também usa, pra mostrar conexões por linha) — ver hooks/use-devices.
  devices: PortalDevice[];
  loading: boolean;
  error: string | null;
  reload: (quiet?: boolean) => void;
  setServers: (mac: string, ids: string[]) => Promise<PortalDevice>;
  rename: (mac: string, name: string) => Promise<PortalDevice>;
  setStatus: (mac: string, status: DeviceStatus) => Promise<PortalDevice>;
  extend: (mac: string, days: number) => Promise<PortalDevice>;
  setExpiry: (mac: string, expiresAt: number | null) => Promise<PortalDevice>;
  remove: (mac: string) => Promise<void>;
  patch: (mac: string, p: DevicePatch) => Promise<PortalDevice>;
}

const NONE = "__none__";
const DAY = 86_400_000;
const DEFAULT_DAYS = 30;

const NOW_PLAYING_LABEL: Record<NowPlaying["kind"], string> = {
  live: "Ao vivo",
  vod: "Filme",
  series: "Série",
};

const ACCESS_META: Record<
  DeviceAccess,
  { label: string; variant: "success" | "warning" | "destructive" }
> = {
  active: { label: "ATIVO", variant: "success" },
  pending: { label: "PENDENTE", variant: "warning" },
  disabled: { label: "DESATIVADO", variant: "destructive" },
  expired: { label: "EXPIRADO", variant: "destructive" },
};

const ACCESS_BORDER: Record<DeviceAccess, string> = {
  active: "border-l-success",
  pending: "border-l-warning",
  disabled: "border-l-destructive",
  expired: "border-l-destructive",
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

export function DevicesDialog({
  open,
  onOpenChange,
  servers,
  preselectServerId,
  mode = "manage",
  devices,
  loading,
  error,
  reload,
  setServers,
  rename,
  setStatus,
  extend,
  setExpiry,
  remove,
  patch,
}: DevicesDialogProps) {
  const isConnectionsView = mode === "connections";
  const serverLabel = useMemo(() => {
    const m = new Map<string, string>();
    servers.forEach((s) => m.set(s.id, `${s.host} — ${s.username}`));
    return m;
  }, [servers]);

  // Abrindo pelo botão de conexões de uma linha específica (App.tsx), começa
  // filtrado nela; o toggle abaixo deixa ver todos os dispositivos. No modo
  // "connections" o filtro fica travado nessa linha — a intenção do botão é
  // só ver quem está conectado ali, não navegar pro cadastro geral.
  const [onlyThisLineToggle, setOnlyThisLineToggle] = useState(Boolean(preselectServerId));
  useEffect(() => setOnlyThisLineToggle(Boolean(preselectServerId)), [preselectServerId, open]);
  const onlyThisLine = isConnectionsView || onlyThisLineToggle;

  const lineServer = useMemo(
    () => (preselectServerId ? servers.find((s) => s.id === preselectServerId) ?? null : null),
    [servers, preselectServerId]
  );
  const lineDevices = useMemo(
    () => (preselectServerId ? devices.filter((d) => d.boundServerIds.includes(preselectServerId)) : []),
    [devices, preselectServerId]
  );
  // 100% dado nosso (heartbeat) — nunca o active_cons do painel do provedor.
  const lineStats = useMemo(
    () => (preselectServerId ? lineConnectionStats(devices, preselectServerId) : null),
    [devices, preselectServerId]
  );
  const visibleDevices = onlyThisLine && preselectServerId ? lineDevices : devices;
  const filteredToOneLine = onlyThisLine && Boolean(preselectServerId);

  // Detalhes de um dispositivo (renomear, linhas, ativar/desativar, validade,
  // excluir) — clique numa linha da tabela troca o conteúdo do diálogo pra
  // esse painel (ver render abaixo). Fica sincronizado com o polling de 20s
  // do useDevices enquanto aberto.
  const [detailMac, setDetailMac] = useState<string | null>(null);
  useEffect(() => {
    if (!open) setDetailMac(null);
  }, [open]);
  const detailDevice = useMemo(
    () => devices.find((d) => d.mac === detailMac) ?? null,
    [devices, detailMac]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        {detailDevice ? (
          // Detalhes de 1 dispositivo (renomear, linhas, ativar/desativar,
          // validade, excluir) — troca o conteúdo do MESMO diálogo em vez de
          // abrir um 2º Dialog por cima: o Radix trata clique-fora do diálogo
          // aninhado como "fechar o de baixo também", derrubando os dois.
          <DeviceDetailPanel
            device={detailDevice}
            onBack={() => setDetailMac(null)}
            servers={servers}
            serverLabel={serverLabel}
            onSetServers={(ids) =>
              setServers(detailDevice.mac, ids)
                .then(() => toast.success(ids.length ? "Linhas atualizadas." : "Linhas removidas."))
                .catch((e) => toast.error(String(e)))
            }
            onRename={(name) =>
              rename(detailDevice.mac, name).then(() => toast.success("Nome salvo.")).catch((e) => toast.error(String(e)))
            }
            onStatus={(s) => setStatus(detailDevice.mac, s).catch((e) => toast.error(String(e)))}
            onActivate={() =>
              patch(detailDevice.mac, { status: "active" })
                .then(() => toast.success(`Liberado por ${DEFAULT_DAYS} dias.`))
                .catch((e) => toast.error(String(e)))
            }
            onExtend={(days) =>
              extend(detailDevice.mac, days)
                .then((u) => toast.success(`Renovado — válido até ${fmtDate(u.expiresAt ?? Date.now())}.`))
                .catch((e) => toast.error(String(e)))
            }
            onSetExpiry={(ts) =>
              setExpiry(detailDevice.mac, ts)
                .then(() => toast.success(ts == null ? "Marcado como vitalício." : `Validade: ${fmtDate(ts)}.`))
                .catch((e) => toast.error(String(e)))
            }
            onRemove={() =>
              remove(detailDevice.mac)
                .then(() => {
                  toast.success("Dispositivo removido.");
                  setDetailMac(null);
                })
                .catch((e) => toast.error(String(e)))
            }
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <MonitorSmartphone className="size-5" />
                {isConnectionsView ? "Conectados nesta linha" : "Dispositivos"}
              </DialogTitle>
              <DialogDescription>
                {isConnectionsView
                  ? "Dispositivos seus vinculados a esta linha e o que estão assistindo agora."
                  : "Cada aparelho do IPTV Player se anuncia aqui pelo MAC. Vincule um servidor e ative para liberar o acesso — o app baixa a lista sozinho e perde o acesso quando a validade vence."}
              </DialogDescription>
            </DialogHeader>

            {!isConnectionsView && (
              <AddDeviceForm
                servers={servers}
                serverLabel={serverLabel}
                preselectServerId={preselectServerId ?? null}
                onSaved={() => reload(true)}
              />
            )}

            {lineServer && (
              <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3 text-xs sm:flex-row sm:items-center sm:justify-between">
                <span className="text-muted-foreground">
                  Linha <span className="font-medium text-foreground">{serverLabel.get(lineServer.id)}</span>
                  {" · "}
                  {lineDevices.length} dispositivo{lineDevices.length === 1 ? "" : "s"} seu
                  {lineDevices.length === 1 ? "" : "s"} vinculado{lineDevices.length === 1 ? "" : "s"}
                  {lineStats && lineStats.bound > 0 && (
                    <>
                      {`, ${lineStats.online} online agora`}
                      {lineStats.watching > 0 && (
                        <span className="font-medium text-foreground">{`, ${lineStats.watching} assistindo`}</span>
                      )}
                    </>
                  )}
                </span>
                {!isConnectionsView && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 shrink-0 px-2 text-xs"
                    onClick={() => setOnlyThisLineToggle((v) => !v)}
                  >
                    <Filter className="size-3.5" />
                    {onlyThisLine ? "Ver todos os dispositivos" : "Ver só desta linha"}
                  </Button>
                )}
              </div>
            )}

            <div className="mt-2 flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                {loading
                  ? "carregando…"
                  : `${visibleDevices.length} dispositivo${visibleDevices.length === 1 ? "" : "s"}`}
              </span>
              <Button variant="ghost" size="sm" onClick={() => reload()}>
                <RotateCw className="size-4" /> Atualizar
              </Button>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            {visibleDevices.length === 0 && !loading ? (
              <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">
                {onlyThisLine && preselectServerId
                  ? "Nenhum dispositivo seu está vinculado a esta linha ainda."
                  : "Nenhum dispositivo ainda. Instale o IPTV Player e informe o endereço deste portal nele — o MAC aparece aqui automaticamente."}
              </div>
            ) : (
              <div className="max-h-[45vh] overflow-y-auto rounded-md border">
                <DeviceTable
                  devices={visibleDevices}
                  hideLineColumn={filteredToOneLine}
                  serverLabel={serverLabel}
                  onOpenDetail={setDetailMac}
                />
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Tabela compacta: só o essencial pra ver de relance quem está conectado em
// cada linha e o que está assistindo. Clique numa linha abre os detalhes
// completos (renomear, linhas, validade, ativar/desativar, excluir).
function DeviceTable({
  devices,
  hideLineColumn,
  serverLabel,
  onOpenDetail,
}: {
  devices: PortalDevice[];
  /** Some quando já filtrado numa única linha (ela já aparece na barra de
   * resumo acima) — repetir em toda linha da tabela seria redundante. */
  hideLineColumn: boolean;
  serverLabel: Map<string, string>;
  onOpenDetail: (mac: string) => void;
}) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <th className="px-3 py-2 font-medium">Status</th>
          <th className="px-3 py-2 font-medium">Dispositivo</th>
          {!hideLineColumn && <th className="px-3 py-2 font-medium">Linha</th>}
          <th className="px-3 py-2 font-medium">Assistindo agora</th>
          <th className="px-2 py-2" />
        </tr>
      </thead>
      <tbody>
        {devices.map((d) => {
          const online = isDeviceOnline(d);
          const nowPlaying = online ? d.nowPlaying : null;
          const meta = ACCESS_META[d.access];
          const principalLabel = d.boundServerIds[0] ? serverLabel.get(d.boundServerIds[0]) ?? d.boundServerIds[0] : null;

          return (
            <tr
              key={d.mac}
              className={cn(
                "cursor-pointer border-b border-l-4 transition-colors last:border-b-0 hover:bg-muted/40",
                ACCESS_BORDER[d.access]
              )}
              onClick={() => onOpenDetail(d.mac)}
            >
              <td className="whitespace-nowrap px-3 py-2">
                <span className="flex items-center gap-1.5">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        className={cn(
                          "inline-block size-2 shrink-0 rounded-full",
                          online ? "bg-success" : "bg-muted-foreground/30"
                        )}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      {online ? "Online agora" : `Visto ${relTime(d.lastSeenAt)}`}
                    </TooltipContent>
                  </Tooltip>
                  <Badge variant={meta.variant}>{meta.label}</Badge>
                </span>
              </td>

              <td className="max-w-[200px] px-3 py-2">
                <div className="truncate font-medium">{d.name || "(sem nome)"}</div>
                <div className="truncate font-mono text-[11px] text-muted-foreground">{d.mac}</div>
              </td>

              {!hideLineColumn && (
                <td className="max-w-[220px] px-3 py-2 text-xs text-muted-foreground">
                  {principalLabel ? (
                    <span className="truncate" title={principalLabel}>
                      {principalLabel}
                      {d.boundServerIds.length > 1 && ` +${d.boundServerIds.length - 1}`}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
              )}

              <td className="max-w-[240px] px-3 py-2">
                {nowPlaying ? (
                  <span className="flex items-center gap-1.5 text-xs text-orange-600 dark:text-orange-400">
                    {nowPlaying.kind === "live" ? (
                      <Tv className="size-3.5 shrink-0" />
                    ) : (
                      <Clapperboard className="size-3.5 shrink-0" />
                    )}
                    <span className="truncate">
                      {NOW_PLAYING_LABEL[nowPlaying.kind]}: <span className="font-medium">{nowPlaying.title}</span>
                    </span>
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </td>

              <td className="px-2 py-2">
                <ChevronRight className="ml-auto size-4 text-muted-foreground" />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
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

function DeviceDetailPanel({
  device,
  onBack,
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
  onBack: () => void;
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
  const online = isDeviceOnline(device);
  const nowPlaying = online ? device.nowPlaying : null;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="-ml-2 size-8"
            onClick={onBack}
            title="Voltar"
          >
            <ArrowLeft className="size-4" />
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className={cn(
                  "inline-block size-2.5 shrink-0 rounded-full",
                  online ? "bg-success" : "bg-muted-foreground/30"
                )}
              />
            </TooltipTrigger>
            <TooltipContent>{online ? "Online agora" : `Visto ${relTime(device.lastSeenAt)}`}</TooltipContent>
          </Tooltip>
          <span className="font-mono text-sm">{device.mac}</span>
          <Badge variant={meta.variant}>{meta.label}</Badge>
        </DialogTitle>
      </DialogHeader>

      <div className="flex flex-col gap-2 text-sm">
        {nowPlaying && (
            <div className="flex items-center gap-1.5 rounded-md bg-orange-500/10 px-2 py-1 text-xs text-orange-600 ring-1 ring-inset ring-orange-500/20 dark:text-orange-400">
              {nowPlaying.kind === "live" ? (
                <Tv className="size-3.5 shrink-0" />
              ) : (
                <Clapperboard className="size-3.5 shrink-0" />
              )}
              <span className="truncate">
                Assistindo agora · {NOW_PLAYING_LABEL[nowPlaying.kind]}: <span className="font-medium">{nowPlaying.title}</span>
              </span>
            </div>
          )}

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
    </>
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
