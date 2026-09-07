import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";
import { Loader2, Palette } from "lucide-react";
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
import { getBrandSettings, updateBrandSettings } from "@/lib/api";

// Trilha do provedor (p-1). Nome / logo / cor de destaque que o Player usa no
// lugar da marca padrão ("HC IPTV" / laranja). Vai pro Player pelo heartbeat.

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_ACCENT = "#f97316";

interface BrandingSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BrandingSettingsDialog({ open, onOpenChange }: BrandingSettingsDialogProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [accent, setAccent] = useState("");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    getBrandSettings()
      .then((b) => {
        setName(b.name ?? "");
        setLogoUrl(b.logoUrl ?? "");
        setAccent(b.accent ?? "");
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Erro ao carregar."))
      .finally(() => setLoading(false));
  }, [open]);

  const accentValid = accent === "" || HEX_RE.test(accent.trim());
  const logoValid = logoUrl === "" || /^https:\/\//i.test(logoUrl.trim());
  const previewAccent = HEX_RE.test(accent.trim()) ? accent.trim() : DEFAULT_ACCENT;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!accentValid) {
      toast.error("Cor de destaque: use hex #RRGGBB (ou deixe em branco).");
      return;
    }
    if (!logoValid) {
      toast.error("A URL da logo precisa começar com https://.");
      return;
    }
    setSaving(true);
    try {
      await updateBrandSettings({
        name: name.trim(),
        logoUrl: logoUrl.trim(),
        accent: accent.trim(),
      });
      const custom = name.trim() || logoUrl.trim() || accent.trim();
      toast.success(
        custom ? "Marca salva — os apps aplicam no próximo heartbeat." : "Marca restaurada ao padrão."
      );
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  };

  const restore = () => {
    setName("");
    setLogoUrl("");
    setAccent("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Palette className="size-5" /> Marca do app (white-label)
            </DialogTitle>
            <DialogDescription>
              Nome, logo e cor de destaque que aparecem no app do cliente no lugar de "HC IPTV".
              Campos em branco voltam ao padrão. Aplica em todos os aparelhos no próximo heartbeat.
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Carregando…
            </div>
          ) : (
            <>
              <div>
                <Label htmlFor="b-name" className="text-xs">
                  Nome exibido
                </Label>
                <Input
                  id="b-name"
                  maxLength={40}
                  placeholder="HC IPTV"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div>
                <Label htmlFor="b-logo" className="text-xs">
                  URL da logo (https, PNG/SVG transparente)
                </Label>
                <Input
                  id="b-logo"
                  inputMode="url"
                  placeholder="https://…/logo.png"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  className={!logoValid ? "border-destructive" : undefined}
                />
              </div>

              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <Label htmlFor="b-accent" className="text-xs">
                    Cor de destaque (hex)
                  </Label>
                  <Input
                    id="b-accent"
                    placeholder="#f97316"
                    value={accent}
                    onChange={(e) => setAccent(e.target.value)}
                    className={!accentValid ? "border-destructive" : undefined}
                  />
                </div>
                <input
                  type="color"
                  aria-label="Escolher cor"
                  value={previewAccent}
                  onChange={(e) => setAccent(e.target.value)}
                  className="h-10 w-12 shrink-0 cursor-pointer rounded-md border bg-transparent"
                />
              </div>

              <div className="rounded-md border bg-muted/20 p-3">
                <p className="mb-1.5 text-xs text-muted-foreground">Prévia</p>
                <div className="flex items-center gap-2">
                  {logoValid && logoUrl.trim() ? (
                    <img
                      src={logoUrl.trim()}
                      alt=""
                      className="h-6 w-auto max-w-[120px] object-contain"
                    />
                  ) : null}
                  <span className="text-lg font-semibold">
                    {name.trim() || "HC "}
                    {!name.trim() && <span style={{ color: previewAccent }}>IPTV</span>}
                  </span>
                </div>
              </div>
            </>
          )}

          <DialogFooter className="gap-2 sm:justify-between">
            <Button type="button" variant="ghost" onClick={restore} disabled={loading}>
              Restaurar padrão
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving || loading}>
                {saving && <Loader2 className="size-4 animate-spin" />} Salvar
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
