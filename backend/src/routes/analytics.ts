import { Router, Request, Response } from "express";
import { readDevices, accessOf } from "../deviceStore";

// GET /api/analytics — visão agregada pro provedor (trilha do provedor p-3).
// Tudo calculado do que o portal já guarda por device (lastSeenAt, status,
// expiresAt, nowPlaying, playback). Atrás do guard de admin.

const router = Router();

const DAY = 86_400_000;

router.get("/analytics", async (_req: Request, res: Response) => {
  try {
    const devices = await readDevices();
    const now = Date.now();

    // --- Acesso ---
    const totals = { devices: devices.length, active: 0, expiringSoon: 0, expired: 0, pending: 0 };
    for (const d of devices) {
      const a = accessOf(d, now);
      if (a === "active") {
        totals.active++;
        if (d.expiresAt != null && d.expiresAt - now > 0 && d.expiresAt - now <= 3 * DAY) {
          totals.expiringSoon++;
        }
      } else if (a === "expired") totals.expired++;
      else totals.pending++;
    }

    // --- Churn: quando abriu por último ---
    const seen = { today: 0, d3: 0, d7: 0, d14: 0, d30: 0, older: 0, never: 0 };
    const atRisk: { mac: string; name: string; lastSeenAt: number; daysSince: number }[] = [];
    for (const d of devices) {
      if (!d.lastSeenAt) {
        seen.never++;
        continue;
      }
      const days = (now - d.lastSeenAt) / DAY;
      if (days < 1) seen.today++;
      else if (days < 3) seen.d3++;
      else if (days < 7) seen.d7++;
      else if (days < 14) seen.d14++;
      else if (days < 30) seen.d30++;
      else seen.older++;
      // "Em risco": ainda tem acesso ativo mas sumiu há mais de 7 dias.
      if (days >= 7 && accessOf(d, now) === "active") {
        atRisk.push({ mac: d.mac, name: d.name || d.mac, lastSeenAt: d.lastSeenAt, daysSince: Math.floor(days) });
      }
    }
    atRisk.sort((a, b) => b.daysSince - a.daysSince);

    // --- Assistindo agora (snapshot) ---
    const playingMap = new Map<string, { title: string; kind: string; count: number }>();
    for (const d of devices) {
      const np = d.nowPlaying;
      if (!np || now - np.startedAt > 8 * 60 * 60 * 1000) continue; // ignora "preso" > 8h
      const key = `${np.kind}::${np.title}`;
      const e = playingMap.get(key) ?? { title: np.title, kind: np.kind, count: 0 };
      e.count++;
      playingMap.set(key, e);
    }
    const playing = [...playingMap.values()].sort((a, b) => b.count - a.count).slice(0, 20);
    const watchingNow = devices.filter(
      (d) => d.nowPlaying && now - d.nowPlaying.startedAt <= 8 * 60 * 60 * 1000
    ).length;

    // --- Saúde de reprodução (agrega a telemetria da Fase 0) ---
    let sessions = 0;
    let stalls = 0;
    let errors = 0;
    let fallbacks = 0;
    let ffSum = 0;
    let ffN = 0;
    let reporting = 0;
    for (const d of devices) {
      const p = d.playback;
      if (!p) continue;
      reporting++;
      sessions += p.sessions || 0;
      stalls += p.stalls || 0;
      errors += p.errors || 0;
      fallbacks += p.fallbacks || 0;
      if (typeof p.avgFirstFrameMs === "number" && p.avgFirstFrameMs > 0) {
        ffSum += p.avgFirstFrameMs;
        ffN++;
      }
    }
    const health = {
      reportingDevices: reporting,
      sessions,
      stalls,
      errors,
      fallbacks,
      stallRate: sessions ? +(stalls / sessions).toFixed(3) : 0,
      errorRate: sessions ? +(errors / sessions).toFixed(3) : 0,
      fallbackRate: sessions ? +(fallbacks / sessions).toFixed(3) : 0,
      avgFirstFrameMs: ffN ? Math.round(ffSum / ffN) : null,
    };

    res.json({ generatedAt: now, totals, seen, atRisk: atRisk.slice(0, 50), watchingNow, playing, health });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Erro ao gerar analytics." });
  }
});

export default router;
