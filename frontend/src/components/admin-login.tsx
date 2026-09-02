import { useState } from "react";
import type { FormEvent } from "react";
import { KeyRound, SatelliteDish, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

interface AdminLoginProps {
  /** true na primeira execução: em vez de "entrar", pede pra criar o PIN. */
  firstRun: boolean;
  onCreatePin: (pin: string) => Promise<void>;
  onUnlock: (pin: string) => Promise<boolean>;
}

const PIN_RE = /^\d{4,8}$/;

export function AdminLogin({ firstRun, onCreatePin, onUnlock }: AdminLoginProps) {
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!PIN_RE.test(pin)) {
      setError("O PIN deve ter de 4 a 8 dígitos.");
      return;
    }

    setBusy(true);
    try {
      if (firstRun) {
        if (pin !== confirm) {
          setError("Os PINs não coincidem.");
          return;
        }
        await onCreatePin(pin);
      } else {
        const ok = await onUnlock(pin);
        if (!ok) {
          setError("PIN incorreto.");
          setPin("");
        }
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="flex flex-col items-center gap-3 pb-2 text-center">
          <div className="flex size-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <SatelliteDish className="size-6" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">IPTV Manager</h1>
            <p className="text-xs text-muted-foreground">
              {firstRun ? "Defina um PIN de acesso ao painel" : "Painel protegido — informe seu PIN"}
            </p>
          </div>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div className="relative">
              <KeyRound className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="password"
                inputMode="numeric"
                autoFocus
                placeholder="PIN"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                className="pl-9 tracking-[0.3em]"
                maxLength={8}
              />
            </div>

            {firstRun && (
              <div className="relative">
                <ShieldCheck className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="password"
                  inputMode="numeric"
                  placeholder="Confirme o PIN"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ""))}
                  className="pl-9 tracking-[0.3em]"
                  maxLength={8}
                />
              </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button type="submit" disabled={busy}>
              {firstRun ? "Definir PIN e entrar" : "Entrar"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
