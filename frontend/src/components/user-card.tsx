import { useState } from "react";
import type { ReactNode } from "react";
import {
  Copy,
  Eye,
  EyeOff,
  MonitorSmartphone,
  MoreVertical,
  Pencil,
  RefreshCw,
  Trash2,
  Server,
  User as UserIcon,
  KeyRound,
  CalendarClock,
  Clock,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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

interface UserCardProps {
  user: IptvUserWithCheck;
  onEdit: () => void;
  onDelete: () => void;
  onRefresh: () => void;
  /** Abre "Dispositivos" já com este servidor pré-selecionado pra vincular. */
  onManageDevices: (serverId: string) => void;
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="size-7" onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function UserCard({ user, onEdit, onDelete, onRefresh, onManageDevices }: UserCardProps) {
  const [showPassword, setShowPassword] = useState(false);
  const { check, checking } = user;
  const config = check ? STATUS_CONFIG[check.status] : null;
  const showSkeleton = checking && !check;

  return (
    <Card
      className={cn(
        "border-l-4 hover:shadow-md",
        config ? config.border : "border-l-muted"
      )}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-2 pb-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Server className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-semibold" title={user.host}>
            {user.host}
          </span>
          <IconButton label="Copiar host" onClick={() => copyToClipboard(user.host, "Host")}>
            <Copy />
          </IconButton>
        </div>

        <div className="flex items-center gap-2">
          {showSkeleton ? (
            <Skeleton className="h-5 w-20" />
          ) : config ? (
            <div className="flex items-center gap-1.5">
              <StatusDot status={check!.status} />
              <Badge variant={config.badge}>{config.label}</Badge>
            </div>
          ) : null}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-7">
                <MoreVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onRefresh}>
                <RefreshCw className="size-4" /> Atualizar status
              </DropdownMenuItem>
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
      </CardHeader>

      <CardContent className="flex flex-col gap-3 text-sm">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
            <UserIcon className="size-4 shrink-0" />
            <span className="truncate text-foreground">{user.username}</span>
          </div>
          <IconButton label="Copiar usuário" onClick={() => copyToClipboard(user.username, "Usuário")}>
            <Copy />
          </IconButton>
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
            <KeyRound className="size-4 shrink-0" />
            <span className="truncate text-foreground">
              {showPassword ? user.password : "•".repeat(Math.min(user.password.length, 10))}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <IconButton
              label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              onClick={() => setShowPassword((v) => !v)}
            >
              {showPassword ? <EyeOff /> : <Eye />}
            </IconButton>
            <IconButton label="Copiar senha" onClick={() => copyToClipboard(user.password, "Senha")}>
              <Copy />
            </IconButton>
          </div>
        </div>

        <div className="mt-1 flex flex-col gap-1.5 border-t pt-3 text-muted-foreground">
          <div className="flex items-center gap-2">
            <CalendarClock className="size-4 shrink-0" />
            {showSkeleton ? (
              <Skeleton className="h-4 w-32" />
            ) : (
              <span>Expira em {formatExpDate(check?.expDate ?? null)}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Clock className="size-4 shrink-0" />
            {showSkeleton ? (
              <Skeleton className="h-4 w-24" />
            ) : check?.expDate ? (
              <span>{formatTimeRemaining(check.expDate)}</span>
            ) : (
              <span>{check?.message ?? "Sem dados"}</span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
