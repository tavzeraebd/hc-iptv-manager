import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type StatusFilter = "TODOS" | "ATIVO" | "VENCE_EM_BREVE" | "EXPIRADO" | "OFFLINE";
export type SortOrder = "EXP_ASC" | "EXP_DESC";

interface ToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  statusFilter: StatusFilter;
  onStatusFilterChange: (value: StatusFilter) => void;
  sortOrder: SortOrder;
  onSortOrderChange: (value: SortOrder) => void;
}

export function Toolbar({
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  sortOrder,
  onSortOrderChange,
}: ToolbarProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Pesquisar por host ou usuário..."
          className="pl-9"
        />
      </div>

      <Select value={statusFilter} onValueChange={(v) => onStatusFilterChange(v as StatusFilter)}>
        <SelectTrigger className="sm:w-52">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="TODOS">Todos os status</SelectItem>
          <SelectItem value="ATIVO">Ativo</SelectItem>
          <SelectItem value="VENCE_EM_BREVE">Vence em breve</SelectItem>
          <SelectItem value="EXPIRADO">Expirado</SelectItem>
          <SelectItem value="OFFLINE">Offline</SelectItem>
        </SelectContent>
      </Select>

      <Select value={sortOrder} onValueChange={(v) => onSortOrderChange(v as SortOrder)}>
        <SelectTrigger className="sm:w-56">
          <SelectValue placeholder="Ordenar" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="EXP_ASC">Expiração mais próxima</SelectItem>
          <SelectItem value="EXP_DESC">Expiração mais distante</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
