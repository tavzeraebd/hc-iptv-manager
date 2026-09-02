import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Loader2 } from "lucide-react";
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
import type { UserInput } from "@/lib/api";
import type { IptvUser } from "@/lib/types";

interface UserFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: UserInput) => Promise<void>;
  user?: IptvUser | null;
}

const EMPTY_FORM: UserInput = { host: "", username: "", password: "" };

export function UserFormDialog({ open, onOpenChange, onSubmit, user }: UserFormDialogProps) {
  const [form, setForm] = useState<UserInput>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isEdit = Boolean(user);

  useEffect(() => {
    if (open) {
      setForm(user ? { host: user.host, username: user.username, password: user.password } : EMPTY_FORM);
      setError(null);
    }
  }, [open, user]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.host.trim() || !form.username.trim() || !form.password.trim()) {
      setError("Preencha todos os campos.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        host: form.host.trim(),
        username: form.username.trim(),
        password: form.password.trim(),
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar usuário.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{isEdit ? "Editar usuário" : "Adicionar usuário"}</DialogTitle>
            <DialogDescription>
              {isEdit
                ? "Atualize os dados de acesso IPTV."
                : "Informe os dados de acesso ao servidor IPTV."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor="host">Host</Label>
            <Input
              id="host"
              placeholder="173.208.194.186"
              value={form.host}
              onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
              disabled={submitting}
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="username">Usuário</Label>
            <Input
              id="username"
              placeholder="92370341211"
              value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
              disabled={submitting}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Senha</Label>
            <Input
              id="password"
              placeholder="30082393260"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              disabled={submitting}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="animate-spin" />}
              {isEdit ? "Salvar alterações" : "Adicionar usuário"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
