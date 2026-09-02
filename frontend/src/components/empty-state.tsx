import { SatelliteDish } from "lucide-react";
import { Button } from "@/components/ui/button";

export function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-20 text-center">
      <SatelliteDish className="size-10 text-muted-foreground" />
      <div>
        <p className="font-medium">Nenhum usuário cadastrado</p>
        <p className="text-sm text-muted-foreground">
          Adicione um acesso IPTV para começar a monitorar o status.
        </p>
      </div>
      <Button onClick={onAdd}>Adicionar usuário</Button>
    </div>
  );
}
