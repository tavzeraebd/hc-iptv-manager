import { Router, Request, Response } from "express";
import { findUser } from "../storage";
import {
  readDevices,
  findDevice,
  upsertFromHeartbeat,
  updateDevice,
  deleteDevice,
  normalizeMac,
  type Device,
} from "../deviceStore";

const router = Router();

// Monta a resposta pública do device + (quando liberado) as credenciais do
// servidor vinculado, pra o Player conectar sozinho.
async function withServer(device: Device) {
  const base = {
    mac: device.mac,
    name: device.name,
    model: device.model,
    platform: device.platform,
    status: device.status,
    boundServerId: device.boundServerId ?? null,
    firstSeenAt: device.firstSeenAt,
    lastSeenAt: device.lastSeenAt,
  };
  if (device.status !== "active" || !device.boundServerId) {
    return { ...base, server: null as null };
  }
  const user = await findUser(device.boundServerId);
  if (!user) return { ...base, server: null as null };
  return {
    ...base,
    server: { host: user.host, username: user.username, password: user.password },
  };
}

// --- chamado pelo Player -----------------------------------------------------
router.post("/devices/heartbeat", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const mac = normalizeMac(body.mac);
  if (!mac) {
    res.status(400).json({ error: "MAC inválido." });
    return;
  }
  try {
    const device = await upsertFromHeartbeat({
      mac,
      name: typeof body.name === "string" ? body.name : undefined,
      model: typeof body.model === "string" ? body.model : undefined,
      platform: typeof body.platform === "string" ? body.platform : undefined,
    });
    const payload = await withServer(device);
    res.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao registrar o dispositivo.";
    res.status(500).json({ error: message });
  }
});

// --- usados pelo Manager ----------------------------------------------------
router.get("/devices", async (_req: Request, res: Response) => {
  try {
    const devices = await readDevices();
    devices.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
    res.json(devices);
  } catch {
    res.status(500).json({ error: "Não foi possível carregar os dispositivos." });
  }
});

router.get("/devices/:mac", async (req: Request, res: Response) => {
  const device = await findDevice(req.params.mac);
  if (!device) {
    res.status(404).json({ error: "Dispositivo não encontrado." });
    return;
  }
  res.json(device);
});

router.put("/devices/:mac", async (req: Request, res: Response) => {
  const mac = normalizeMac(req.params.mac);
  if (!mac) {
    res.status(400).json({ error: "MAC inválido." });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;

  let boundServerId: string | null | undefined;
  if (body.boundServerId === null || body.boundServerId === "") {
    boundServerId = null;
  } else if (typeof body.boundServerId === "string") {
    const user = await findUser(body.boundServerId);
    if (!user) {
      res.status(400).json({ error: "Servidor vinculado não existe." });
      return;
    }
    boundServerId = body.boundServerId;
  }

  const status =
    body.status === "pending" || body.status === "active" || body.status === "disabled"
      ? body.status
      : undefined;

  try {
    const updated = await updateDevice(mac, {
      name: typeof body.name === "string" ? body.name : undefined,
      boundServerId,
      status,
    });
    res.json(updated);
  } catch {
    res.status(500).json({ error: "Erro ao atualizar o dispositivo." });
  }
});

router.delete("/devices/:mac", async (req: Request, res: Response) => {
  const ok = await deleteDevice(req.params.mac);
  if (!ok) {
    res.status(404).json({ error: "Dispositivo não encontrado." });
    return;
  }
  res.status(204).end();
});

export default router;
