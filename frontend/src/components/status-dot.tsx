import { cn } from "@/lib/utils";
import { STATUS_CONFIG } from "@/lib/status";
import type { IptvStatus } from "@/lib/types";

export function StatusDot({ status }: { status: IptvStatus }) {
  const config = STATUS_CONFIG[status];
  return (
    <span className="relative flex size-2.5">
      <span
        className={cn("status-dot-pulse absolute inline-flex h-full w-full opacity-75", config.dot)}
      />
      <span className={cn("relative inline-flex size-2.5", config.dot)} />
    </span>
  );
}
