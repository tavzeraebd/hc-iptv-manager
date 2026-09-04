import { useState } from "react";
import {
  Copy,
  Eye,
  EyeOff,
  MonitorSmartphone,
  MoreVertical,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { STATUS_CONFIG } from "@/lib/status";
import { formatExpDate, formatTimeRemaining } from "@/lib/format";
import { copyToClipboard } from "@/lib/clipboard";
import { StatusDot } from "@/components/status-dot";
import type { IptvUserWithCheck } from "@/lib/types";

interface UserTableProps {
  users: IptvUserWithCheck[];
  onEdit: (user: IptvUserWithCheck) => void;
  onDelete: (user: IptvUserWithCheck) => void;
  onRefresh: (user: IptvUserWithCheck) => void;
  /** Abre "Dispositivos" já com este servidor pré-selecionado pra vincular. */
  onManageDevices: (serverId: string) => void;
}

function CopyBtn({ label, value }: { label: string; value: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          onClick={() => copyToClipboard(value, label)}
        >
          <Copy className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Copiar {label.toLowerCase()}</TooltipContent>
    </Tooltip>
  );
}

function UserRow({
  user,
  revealAll,
  onEdit,
  onDelete,
  onRefresh,
  onManageDevices,
}: {
  user: IptvUserWithCheck;
  revealAll: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onRefresh: () => void;
  onManageDevices: (serverId: string) => void;
}) {
  const [show, setShow] = useState(false);
  const reveal = show || revealAll;
  const { check, checking } = user;
  const config = check ? STATUS_CONFIG[check.status] : null;
  const showSkeleton = checking && !check;

  return (
    <tr
      className={cn(
        "group border-b border-l-4 transition-colors hover:bg-muted/40",
        config ? config.border : "border-l-muted"
      )}
    >
      {/* Status */}
      <td className="whitespace-nowrap px-3 py-2">
        {showSkeleton ? (
          <Skeleton className="h-5 w-20" />
        ) : config ? (
          <span className="flex items-center gap-1.5">
            <StatusDot status={check!.status} />
            <Badge variant={config.badge}>{config.label}</Badge>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>

      {/* Conexões ativas AGORA nessa linha, segundo o próprio painel — conta
          qualquer aparelho usando a credencial, não só os dispositivos
          cadastrados aqui. Clique abre "Dispositivos" filtrado nesta linha. */}
      <td className="whitespace-nowrap px-3 py-2">
        {showSkeleton ? (
          <Skeleton className="h-5 w-14" />
        ) : check?.activeConns != null ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onManageDevices(user.id)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset transition-colors hover:opacity-80",
                  check.maxConnections != null && check.activeConns >= check.maxConnections
                    ? "bg-destructive/10 text-destructive ring-destructive/20"
                    : check.activeConns > 0
                      ? "bg-orange-500/10 text-orange-600 ring-orange-500/20 dark:text-orange-400"
                      : "bg-muted text-muted-foreground ring-border"
                )}
              >
                <MonitorSmartphone className="size-3" />
                {check.activeConns}
                {check.maxConnections != null ? `/${check.maxConnections}` : ""}
              </button>
            </TooltipTrigger>
            <TooltipContent>Ver dispositivos vinculados a esta linha</TooltipContent>
          </Tooltip>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>

      {/* Servidor */}
      <td className="max-w-[220px] px-3 py-2">
        <span className="flex items-center gap-1">
          <span className="truncate font-medium" title={user.host}>
            {user.host}
          </span>
          <CopyBtn label="Host" value={user.host} />
        </span>
      </td>

      {/* Usuário */}
      <td className="max-w-[180px] px-3 py-2">
        <span className="flex items-center gap-1">
          <span className="truncate font-mono text-xs" title={user.username}>
            {user.username}
          </span>
          <CopyBtn label="Usuário" value={user.username} />
        </span>
      </td>

      {/* Senha */}
      <td className="max-w-[180px] px-3 py-2">
        <span className="flex items-center gap-1">
          <span className="truncate font-mono text-xs" title={reveal ? user.password : undefined}>
            {reveal ? user.password : "•".repeat(Math.min(user.password.length, 12))}
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[on=true]:opacity-100"
                data-on={show}
                onClick={() => setShow((v) => !v)}
              >
                {reveal ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{reveal ? "Ocultar senha" : "Mostrar senha"}</TooltipContent>
          </Tooltip>
          <CopyBtn label="Senha" value={user.password} />
        </span>
      </td>

      {/* Expira em */}
      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
        {showSkeleton ? <Skeleton className="h-4 w-28" /> : formatExpDate(check?.expDate ?? null)}
      </td>

      {/* Restante / mensagem */}
      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
        {showSkeleton ? (
          <Skeleton className="h-4 w-24" />
        ) : check?.expDate ? (
          formatTimeRemaining(check.expDate)
        ) : (
          <span className="text-xs">{check?.message ?? "Sem dados"}</span>
        )}
      </td>

      {/* Ações */}
      <td className="px-2 py-2 text-right">
        <div className="flex items-center justify-end gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={onRefresh}
                disabled={checking}
              >
                <RefreshCw className={cn("size-3.5", checking && "animate-spin")} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Atualizar status</TooltipContent>
          </Tooltip>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-7">
                <MoreVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onManageDevices(user.id)}>
                <MonitorSmartphone className="size-4" /> Vincular dispositivo
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="size-4" /> Editar
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onClick={onDelete}>
                <Trash2 className="size-4" /> Excluir
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </td>
    </tr>
  );
}

export function UserTable({ users, onEdit, onDelete, onRefresh, onManageDevices }: UserTableProps) {
  const [revealAll, setRevealAll] = useState(false);

  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Conexões</th>
            <th className="px-3 py-2 font-medium">Servidor</th>
            <th className="px-3 py-2 font-medium">Usuário</th>
            <th className="px-3 py-2 font-medium">
              <span className="flex items-center gap-1.5">
                Senha
                <button
                  type="button"
                  onClick={() => setRevealAll((v) => !v)}
                  className="inline-flex items-center gap-1 text-[10px] font-medium normal-case text-muted-foreground hover:text-foreground"
                >
                  {revealAll ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                  {revealAll ? "ocultar" : "ver todas"}
                </button>
              </span>
            </th>
            <th className="px-3 py-2 font-medium">Expira em</th>
            <th className="px-3 py-2 font-medium">Restante</th>
            <th className="px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <UserRow
              key={user.id}
              user={user}
              revealAll={revealAll}
              onEdit={() => onEdit(user)}
              onDelete={() => onDelete(user)}
              onRefresh={() => onRefresh(user)}
              onManageDevices={onManageDevices}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
