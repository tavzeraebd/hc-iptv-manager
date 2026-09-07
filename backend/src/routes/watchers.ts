import { Router, Request, Response } from "express";
import { findDevice, normalizeMac, accessOf } from "../deviceStore";
import {
  listWatchers,
  putWatchers,
  deleteWatcher,
  getWatcherState,
  putWatcherState,
  coerceWatcherList,
  coerceState,
  MAX_WATCHERS,
  type WatcherState,
} from "../watcherStore";

// Perfis de espectador ("Watcher") por device — sincronizados pelo Player.
// Chamado pelo Player SEM token (rotas na allow-list PUBLIC_API de server.ts).
// Guard leve: o device precisa existir (criado pelo heartbeat) e, nas escritas,
// não estar "disabled".

const router = Router();

async function requireDevice(
  req: Request,
  res: Response,
  { writable }: { writable: boolean }
): Promise<string | null> {
  const mac = normalizeMac(req.params.mac);
  if (!mac) {
    res.status(400).json({ error: "MAC inválido." });
    return null;
  }
  const device = await findDevice(mac);
  if (!device) {
    res.status(404).json({ error: "Dispositivo não encontrado." });
    return null;
  }
  if (writable && accessOf(device) === "disabled") {
    res.status(403).json({ error: "Dispositivo desativado." });
    return null;
  }
  return mac;
}

// GET /api/devices/:mac/watchers
router.get("/devices/:mac/watchers", async (req: Request, res: Response) => {
  try {
    const mac = await requireDevice(req, res, { writable: false });
    if (!mac) return;
    const watchers = await listWatchers(mac);
    const updatedAt = watchers.reduce((m, w) => Math.max(m, w.updatedAt), 0);
    res.json({ watchers, updatedAt });
  } catch {
    res.status(500).json({ error: "Não foi possível carregar os perfis." });
  }
});

// PUT /api/devices/:mac/watchers  — substitui a lista inteira
router.put("/devices/:mac/watchers", async (req: Request, res: Response) => {
  try {
    const mac = await requireDevice(req, res, { writable: true });
    if (!mac) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const raw = Array.isArray(body.watchers) ? body.watchers : [];
    if (raw.length > MAX_WATCHERS) {
      res.status(409).json({ error: `Máximo de ${MAX_WATCHERS} perfis por dispositivo.` });
      return;
    }
    const list = coerceWatcherList(raw, mac);
    const saved = await putWatchers(mac, list);
    const updatedAt = saved.reduce((m, w) => Math.max(m, w.updatedAt), 0);
    res.json({ watchers: saved, updatedAt });
  } catch {
    res.status(500).json({ error: "Não foi possível salvar os perfis." });
  }
});

// DELETE /api/devices/:mac/watchers/:id
router.delete("/devices/:mac/watchers/:id", async (req: Request, res: Response) => {
  try {
    const mac = await requireDevice(req, res, { writable: true });
    if (!mac) return;
    const ok = await deleteWatcher(mac, String(req.params.id).slice(0, 64));
    if (!ok) {
      res.status(404).json({ error: "Perfil não encontrado." });
      return;
    }
    res.status(204).end();
  } catch {
    res.status(500).json({ error: "Não foi possível remover o perfil." });
  }
});

// GET /api/devices/:mac/watchers/:id/state
router.get("/devices/:mac/watchers/:id/state", async (req: Request, res: Response) => {
  try {
    const mac = await requireDevice(req, res, { writable: false });
    if (!mac) return;
    const id = String(req.params.id).slice(0, 64);
    const state = await getWatcherState(mac, id);
    if (!state) {
      const empty: WatcherState = {
        mac,
        watcherId: id,
        progress: {},
        favorites: {},
        recoEvents: [],
        recoMeta: {},
        updatedAt: 0,
      };
      res.json({ state: empty, updatedAt: 0 });
      return;
    }
    res.json({ state, updatedAt: state.updatedAt });
  } catch {
    res.status(500).json({ error: "Não foi possível carregar o estado do perfil." });
  }
});

// PUT /api/devices/:mac/watchers/:id/state
router.put("/devices/:mac/watchers/:id/state", async (req: Request, res: Response) => {
  try {
    const mac = await requireDevice(req, res, { writable: true });
    if (!mac) return;
    const id = String(req.params.id).slice(0, 64);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const incoming = coerceState(body.state ?? body, mac, id);
    const result = await putWatcherState(mac, id, incoming);
    if (result.conflict) {
      res.status(409).json({ conflict: true, state: result.state, updatedAt: result.state.updatedAt });
      return;
    }
    res.json({ state: result.state, updatedAt: result.state.updatedAt });
  } catch {
    res.status(500).json({ error: "Não foi possível salvar o estado do perfil." });
  }
});

export default router;
