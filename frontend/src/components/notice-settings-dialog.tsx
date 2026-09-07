import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";
import { Loader2, Megaphone } from "lucide-react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getNoticeSettings, updateNoticeSettings } from "@/lib/api";

// Trilha do provedor (p-2). Frase curta que aparece num banner no topo do
// app do cliente ("manutenção às 22h", "novos canais"…). Vai pro Player pelo
// heartbeat; some sozinho depois da data (se houver) ou quando o texto some.

const dateToTs = (v: string) => (v ? new Date(`${v}T23:59:59`).getTime() : null);
const tsToDate = (ts: number | null) => {
  if (!ts) return "";
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

interface NoticeSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NoticeSettingsDialog({ open, onOpenChange }: NoticeSettingsDialogProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [text, setText] = useState("");
  const [kind, setKind] = useState<"info" | "warn">("info");
  const [until, setUntil] = useState("");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    getNoticeSettings()
      .then((n) => {
        setText(n.text ?? "");
        setKind(n.kind === "warn" ? "warn" : "info");
        setUntil(tsToDate(n.until));
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Erro ao carregar."))
      .finally(() => setLoading(false));
  }, [open]);

  const save = async (nextText: string) => {
    setSaving(true);
    try {
      await updateNoticeSettings({ text: nextText.trim(), kind, until: dateToTs(until) });
      toast.success(nextText.trim() ? "Aviso publicado — aparece no app no próximo heartbeat." : "Aviso removido.");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void save(text);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Megaphone className="size-5" /> Aviso do provedor no app
            </DialogTitle>
            <DialogDescription>
              Uma frase que aparece num banner no topo do app do cliente. Deixe em branco para
              tirar. Aplica em todos os aparelhos no próximo heartbeat.
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Carregando…
            </div>
          ) : (
            <>
              <div>
                <Label htmlFor="n-text" className="text-xs">
                  Texto do aviso ({text.length}/240)
                </Label>
                <textarea
                  id="n-text"
                  rows={3}
                  maxLength={240}
                  placeholder="Ex.: Manutenção nos servidores hoje das 22h à meia-noite."
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  className="mt-1 w-full resize-none rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>

              <div className="flex gap-3">
                <div className="flex-1">
                  <Label className="text-xs">Estilo</Label>
                  <Select value={kind} onValueChange={(v) => setKind(v as "info" | "warn")}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="info">Informativo (neutro)</SelectItem>
                      <SelectItem value="warn">Atenção (laranja)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1">
                  <Label htmlFor="n-until" className="text-xs">
                    Some em (opcional)
                  </Label>
                  <Input
                    id="n-until"
                    type="date"
                    value={until}
                    onChange={(e) => setUntil(e.target.value)}
                  />
                </div>
              </div>

              {text.trim() && (
                <div className="rounded-md border bg-muted/20 p-3">
                  <p className="mb-1.5 text-xs text-muted-foreground">Prévia</p>
                  <div
                    className={
                      kind === "warn"
                        ? "rounded bg-warning/15 px-3 py-2 text-sm text-warning-foreground"
                        : "rounded bg-muted px-3 py-2 text-sm"
                    }
                  >
                    {text.trim()}
                  </div>
                </div>
              )}
            </>
          )}

          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              onClick={() => void save("")}
              disabled={loading || saving || !text.trim()}
            >
              Tirar aviso
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving || loading}>
                {saving && <Loader2 className="size-4 animate-spin" />} Publicar
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
