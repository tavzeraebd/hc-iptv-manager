export const DEFAULT_IMPORT_URL = "https://explouddev.com/api/canais/todos";

const FETCH_TIMEOUT_MS = 10000;

// Painéis Xtream Codes reais sempre expõem porta explícita no host
// (ex.: dns.exemplo.com:80). Links de CDN genéricos (Cloudfront, players
// de terceiros) seguem um caminho parecido (host/segmento/segmento/arquivo)
// mas sem porta — exigir porta é o que separa credenciais reais de ruído.
const XTREAM_LINK_RE =
  /^(https?):\/\/([^/]+:\d+)\/(?:(?:live|movie|series)\/)?([^/]+)\/([^/]+)\/([^/?]+?)(?:\.[a-z0-9]+)?(?:\?.*)?$/i;

// Domínios que aparecem nesses JSON de canais no formato host:porta/user/pass
// mas NÃO são painéis Xtream — são CDNs / players de terceiros / canais
// avulsos. O link casa com a regex acima mas a "credencial" é lixo.
const NON_PANEL_DOMAINS = ["vivatele.com", "streamlock.net", "zas.media"];

function isNonPanelHost(hostWithPort: string): boolean {
  const host = hostWithPort.split(":")[0].toLowerCase();
  return NON_PANEL_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

export interface ImportCandidate {
  host: string;
  username: string;
  password: string;
  channelCount: number;
  sampleChannel: string;
}

interface RawChannel {
  name?: unknown;
  sources?: { name?: unknown; link?: unknown }[];
}

export async function fetchImportCandidates(sourceUrl: string): Promise<ImportCandidate[]> {
  const response = await fetch(sourceUrl, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Falha ao buscar a fonte (HTTP ${response.status}).`);
  }

  const data: unknown = await response.json();
  if (!Array.isArray(data)) {
    throw new Error("Formato inesperado: esperava uma lista de canais.");
  }

  const grouped = new Map<string, ImportCandidate>();

  for (const rawChannel of data as RawChannel[]) {
    const sources = Array.isArray(rawChannel?.sources) ? rawChannel.sources : [];
    for (const source of sources) {
      if (typeof source?.link !== "string") continue;
      const match = source.link.match(XTREAM_LINK_RE);
      if (!match) continue;

      const host = match[2];
      if (isNonPanelHost(host)) continue;
      const username = match[3];
      const password = match[4];
      const key = `${host}|${username}|${password}`;

      const existing = grouped.get(key);
      if (existing) {
        existing.channelCount += 1;
      } else {
        grouped.set(key, {
          host,
          username,
          password,
          channelCount: 1,
          sampleChannel:
            typeof source.name === "string" && source.name
              ? source.name
              : typeof rawChannel.name === "string"
                ? rawChannel.name
                : "",
        });
      }
    }
  }

  return [...grouped.values()].sort((a, b) => b.channelCount - a.channelCount);
}
