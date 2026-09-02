import { useState } from "react";
import type { FormEvent } from "react";
import { Loader2, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { previewImport } from "@/lib/api";
import type { ImportCandidate } from "@/lib/api";

const DEFAULT_URL = "https://explouddev.com/api/canais/todos";

function candidateKey(c: ImportCandidate): string {
  return `${c.host}|${c.username}`;
}

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (
    users: { host: string; username: string; password: string }[]
  ) => Promise<{ added: number; skipped: number }>;
}

export function ImportDialog({ open, onOpenChange, onImport }: ImportDialogProps) {
  const [url, setUrl] = useState(DEFAULT_URL);
  const [candidates, setCandidates] = useState<ImportCandidate[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setCandidates(null);
    setSelected(new Set());
    setError(null);
  };

  const handleClose = (next: boolean) => {
    if (loadingPreview || importing) return;
    if (!next) reset();
    onOpenChange(next);
  };

  const handleSearch = async (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setLoadingPreview(true);
    setError(null);
    try {
      const found = await previewImport(url.trim());
      setCandidates(found);
      setSelected(new Set(found.filter((c) => !c.alreadyExists).map(candidateKey)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao buscar a fonte.");
      setCandidates(null);
    } finally {
      setLoadingPreview(false);
    }
  };

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleImport = async () => {
    if (!candidates) return;
    const chosen = candidates.filter((c) => selected.has(candidateKey(c)));
    if (chosen.length === 0) return;
    setImporting(true);
    setError(null);
    try {
      await onImport(chosen.map(({ host, username, password }) => ({ host, username, password })));
      reset();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao importar usuários.");
    } finally {
      setImporting(false);
    }
  };

  const busy = loadingPreview || importing;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importar de fonte externa</DialogTitle>
          <DialogDescription>
            Busca um JSON de canais e extrai as combinações distintas de host, usuário e senha
            encontradas nos links.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSearch} className="flex items-end gap-2">
          <div className="flex flex-1 flex-col gap-2">
            <Label htmlFor="import-url">URL da fonte</Label>
            <Input
              id="import-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={busy}
            />
          </div>
          <Button type="submit" variant="outline" disabled={busy || !url.trim()}>
            {loadingPreview ? <Loader2 className="animate-spin" /> : <Search />}
            Buscar
          </Button>
        </form>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {candidates && (
          <div className="flex max-h-80 flex-col gap-2 overflow-y-auto rounded-lg border p-2">
            {candidates.length === 0 ? (
              <p className="p-4 text-center text-sm text-muted-foreground">
                Nenhuma credencial reconhecida foi encontrada nessa fonte.
              </p>
            ) : (
              candidates.map((c) => {
                const key = candidateKey(c);
                return (
                  <label
                    key={key}
                    className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-accent has-[:disabled]:opacity-60"
                  >
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={selected.has(key)}
                      disabled={c.alreadyExists || busy}
                      onChange={() => toggle(key)}
                    />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">{c.host}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {c.username} / {c.password} · {c.channelCount}{" "}
                        {c.channelCount === 1 ? "canal" : "canais"}
                        {c.sampleChannel ? ` · ex.: ${c.sampleChannel}` : ""}
                      </span>
                    </div>
                    {c.alreadyExists && <Badge variant="secondary">Já cadastrado</Badge>}
                  </label>
                );
              })
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleClose(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleImport} disabled={busy || selected.size === 0}>
            {importing && <Loader2 className="animate-spin" />}
            Importar selecionados{selected.size > 0 ? ` (${selected.size})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
