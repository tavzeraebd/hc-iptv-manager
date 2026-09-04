import type { PortalDevice } from "./api";

// "Conexões" é 100% dado NOSSO (portal/Player via heartbeat) — nunca o
// active_cons/max_connections do painel do provedor. Painéis de terceiro
// atrasam, falham ou simplesmente não contam direito TV ao vivo por HLS (visto
// na prática: 0/0 num device que estava assistindo, 1/1 numa credencial sem
// nenhum device nosso vinculado). O Player pinga a cada ~60s enquanto assiste
// (pareado) — folga de 3 min pra considerar "online agora" sem marcar offline
// por um ping perdido.
export const ONLINE_MS = 3 * 60 * 1000;

export function isDeviceOnline(d: Pick<PortalDevice, "lastSeenAt">): boolean {
  return Date.now() - d.lastSeenAt < ONLINE_MS;
}

/** Dispositivos NOSSOS vinculados a uma linha e, entre eles, quantos estão
 * online agora e realmente assistindo algo (nowPlaying) — a "conexão" real,
 * apurada só com o que o portal sabe. */
export function lineConnectionStats(devices: PortalDevice[], serverId: string) {
  const bound = devices.filter((d) => d.boundServerIds.includes(serverId));
  const online = bound.filter(isDeviceOnline);
  const watching = online.filter((d) => d.nowPlaying != null);
  return { bound: bound.length, online: online.length, watching: watching.length };
}
