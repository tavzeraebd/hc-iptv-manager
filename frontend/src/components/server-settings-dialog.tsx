import { useEffect, useState } from "react";
import type { FormEvent } from "react";
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
import {
  getServerUrl,
  setServerUrl,
  usesEmbeddedBackend,
  getPortalToken,
  setPortalToken,
  EMBEDDED_BACKEND_URL,
} from "@/lib/api";

interface ServerSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function ServerSettingsDialog({ open, onOpenChange, onSaved }: ServerSettingsDialogProps) {
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setUrl(getServerUrl());
      setToken(getPortalToken());
      setError(null);
    }
  }, [open]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!/^https?:\/\/[^/]+$/i.test(trimmed)) {
      setError("Informe uma URL válida, ex.: http://192.168.0.10:3001");
      return;
    }
    setServerUrl(trimmed);
    setPortalToken(token);
    onOpenChange(false);
    onSaved();
  };

  const handleUseEmbedded = () => {
    setServerUrl(EMBEDDED_BACKEND_URL);
    setPortalToken(token);
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Endereço do servidor</DialogTitle>
            <DialogDescription>
              Por padrão o app usa o backend embarcado, que já roda automaticamente
              dentro dele — nenhuma configuração é necessária. Só preencha o campo
              abaixo se quiser apontar para um servidor externo (seu computador, um
              servidor ou o próprio celular via Termux).
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor="server-url">URL do servidor externo (opcional)</Label>
            <Input
              id="server-url"
              placeholder="http://192.168.0.10:3001"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              autoFocus
            />
            {!usesEmbeddedBackend() && (
              <button
                type="button"
                onClick={handleUseEmbedded}
                className="self-start text-xs text-muted-foreground underline-offset-2 hover:underline"
              >
                Voltar a usar o backend embarcado
              </button>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="portal-token">Token do portal (opcional)</Label>
            <Input
              id="portal-token"
              type="password"
              placeholder="exigido só se o servidor externo pedir"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              Enviado como <code>x-portal-token</code> em todas as chamadas. Deixe em branco
              para o backend embarcado.
            </p>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit">Salvar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
