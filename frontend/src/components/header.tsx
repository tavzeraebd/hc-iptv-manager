import { Capacitor } from "@capacitor/core";
import { Download, Lock, MonitorSmartphone, Moon, Plus, RefreshCw, Settings, Sun, SatelliteDish } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface StatItemProps {
  label: string;
  value: number;
  dotClassName: string;
}

function StatItem({ label, value, dotClassName }: StatItemProps) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn("size-2", dotClassName)} />
      <span className="text-sm text-muted-foreground">
        {label} <span className="font-semibold text-foreground">{value}</span>
      </span>
    </div>
  );
}

interface HeaderProps {
  total: number;
  active: number;
  expiringSoon: number;
  expiredOrOffline: number;
  onAdd: () => void;
  onImport: () => void;
  onRefreshAll: () => void;
  refreshingAll: boolean;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  onOpenServerSettings: () => void;
  onOpenDevices: () => void;
  onLock: () => void;
}

export function Header({
  total,
  active,
  expiringSoon,
  expiredOrOffline,
  onAdd,
  onImport,
  onRefreshAll,
  refreshingAll,
  theme,
  onToggleTheme,
  onOpenServerSettings,
  onOpenDevices,
  onLock,
}: HeaderProps) {
  return (
    <header className="border-b bg-card/50">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <SatelliteDish className="size-5" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold leading-tight">HC IPTV</h1>
            <p className="truncate text-xs text-muted-foreground">Gerenciamento de acessos IPTV</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <StatItem label="Total" value={total} dotClassName="bg-primary" />
          <Separator orientation="vertical" className="hidden h-5 sm:block" />
          <StatItem label="Ativos" value={active} dotClassName="bg-success" />
          <Separator orientation="vertical" className="hidden h-5 sm:block" />
          <StatItem label="Vencendo" value={expiringSoon} dotClassName="bg-warning" />
          <Separator orientation="vertical" className="hidden h-5 sm:block" />
          <StatItem label="Expirados/Offline" value={expiredOrOffline} dotClassName="bg-destructive" />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {Capacitor.isNativePlatform() && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" onClick={onOpenServerSettings}>
                  <Settings />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Endereço do servidor</TooltipContent>
            </Tooltip>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon" onClick={onToggleTheme}>
                {theme === "dark" ? <Sun /> : <Moon />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{theme === "dark" ? "Tema claro" : "Tema escuro"}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon" onClick={onOpenDevices}>
                <MonitorSmartphone />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Dispositivos</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon" onClick={onLock}>
                <Lock />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Bloquear painel</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon" onClick={onRefreshAll} disabled={refreshingAll}>
                <RefreshCw className={cn(refreshingAll && "animate-spin")} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Atualizar status</TooltipContent>
          </Tooltip>

          <Button variant="outline" onClick={onImport}>
            <Download /> <span className="hidden sm:inline">Importar</span>
          </Button>

          <Button onClick={onAdd}>
            <Plus /> <span className="hidden sm:inline">Adicionar usuário</span>
          </Button>
        </div>
      </div>
    </header>
  );
}
