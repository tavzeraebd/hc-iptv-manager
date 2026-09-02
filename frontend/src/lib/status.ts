import type { IptvStatus } from "./types";

export const STATUS_CONFIG: Record<
  IptvStatus,
  { label: string; border: string; dot: string; badge: "success" | "warning" | "destructive" }
> = {
  ATIVO: {
    label: "ATIVO",
    border: "border-l-success",
    dot: "bg-success",
    badge: "success",
  },
  VENCE_EM_BREVE: {
    label: "VENCE EM BREVE",
    border: "border-l-warning",
    dot: "bg-warning",
    badge: "warning",
  },
  EXPIRADO: {
    label: "EXPIRADO",
    border: "border-l-destructive",
    dot: "bg-destructive",
    badge: "destructive",
  },
  OFFLINE: {
    label: "OFFLINE",
    border: "border-l-destructive",
    dot: "bg-destructive",
    badge: "destructive",
  },
};
