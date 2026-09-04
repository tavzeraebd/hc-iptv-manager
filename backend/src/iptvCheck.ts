import http from "http";
import type { CheckResult, IptvStatus } from "./types";

const TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

// Alguns painéis IPTV usam um WAF que bloqueia requisições sem cara de
// navegador: sem User-Agent conhecido, ou com "Accept-Encoding" de
// compressão (que o fetch() nativo do Node sempre adiciona e não permite
// sobrescrever, por ser um header protegido pela spec). Por isso usamos o
// módulo http nativo aqui, com controle total dos headers enviados.
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function buildUrl(host: string, username: string, password: string): string {
  const cleanHost = host.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  const params = new URLSearchParams({ username, password });
  return `http://${cleanHost}/player_api.php?${params.toString()}`;
}

function computeStatus(expDate: number, now: number): IptvStatus {
  if (expDate <= now) return "EXPIRADO";
  if (expDate <= now + 86400) return "VENCE_EM_BREVE";
  return "ATIVO";
}

// Contas revenda / "só M3U" não respondem `player_api.php` (200 com corpo
// vazio), mas o `get.php` devolve a playlist normalmente. Lê só o começo e
// aborta: se vier `#EXTM3U`, a conta está no ar (mas sem validade conhecida).
function m3uPlaylistLoads(host: string, username: string, password: string): Promise<boolean> {
  const cleanHost = host.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  const params = new URLSearchParams({ username, password, type: "m3u_plus", output: "ts" });
  const url = `http://${cleanHost}/get.php?${params.toString()}`;
  return new Promise((resolve) => {
    let done = false;
    const finish = (result: boolean) => {
      if (done) return;
      done = true;
      resolve(result);
    };
    const req = http.get(
      url,
      { headers: { "User-Agent": BROWSER_USER_AGENT, Accept: "*/*" } },
      (res) => {
        const code = res.statusCode ?? 0;
        if (code < 200 || code >= 300) {
          req.destroy();
          finish(false);
          return;
        }
        let acc = "";
        res.on("data", (chunk: Buffer) => {
          acc += chunk.toString("utf-8");
          if (acc.length >= 8192) {
            req.destroy();
            finish(/#EXTM3U/i.test(acc));
          }
        });
        res.on("end", () => finish(/#EXTM3U/i.test(acc)));
      }
    );
    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy();
      finish(false);
    });
    req.on("error", () => finish(false));
  });
}

interface RawResponse {
  statusCode: number;
  body: string;
}

function fetchRaw(url: string, timeoutMs: number): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      url,
      {
        headers: {
          "User-Agent": BROWSER_USER_AGENT,
          Accept: "*/*",
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        res.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > MAX_BODY_BYTES) {
            req.destroy(new Error("Resposta excedeu o tamanho máximo permitido"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          resolve({ statusCode: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf-8") });
        });
      }
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("TIMEOUT"));
    });

    req.on("error", (err) => reject(err));
  });
}

export async function checkIptvUser(
  host: string,
  username: string,
  password: string
): Promise<CheckResult> {
  const now = Math.floor(Date.now() / 1000);
  const url = buildUrl(host, username, password);

  // player_api.php sem resposta útil (vazio / JSON quebrado / sem user_info):
  // pode ser conta revenda que só serve M3U. Confere a playlist antes de
  // cravar OFFLINE.
  const m3uFallback = async (message: string): Promise<CheckResult> => {
    if (await m3uPlaylistLoads(host, username, password)) {
      return { status: "ATIVO", expDate: null, checkedAt: now, message: "Painel só serve M3U (sem validade)" };
    }
    return { status: "OFFLINE", expDate: null, checkedAt: now, message };
  };

  try {
    const response = await fetchRaw(url, TIMEOUT_MS);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      return { status: "OFFLINE", expDate: null, checkedAt: now, message: `HTTP ${response.statusCode}` };
    }

    if (!response.body || !response.body.trim()) {
      return m3uFallback("Sem resposta do player_api");
    }

    let data: { user_info?: { exp_date?: string | number | null; auth?: number; status?: string } };
    try {
      data = JSON.parse(response.body);
    } catch {
      return m3uFallback("Resposta inválida da API");
    }

    const userInfo = data?.user_info;
    if (!userInfo || typeof userInfo.exp_date === "undefined" || userInfo.exp_date === null) {
      return m3uFallback("Resposta inválida da API");
    }

    const expDate = Number(userInfo.exp_date);
    if (!Number.isFinite(expDate)) {
      return { status: "OFFLINE", expDate: null, checkedAt: now, message: "Data de expiração inválida" };
    }

    if (userInfo.auth === 0 && userInfo.status !== "Active") {
      return { status: "EXPIRADO", expDate, checkedAt: now, message: userInfo.status };
    }

    return { status: computeStatus(expDate, now), expDate, checkedAt: now };
  } catch (err) {
    const message =
      err instanceof Error && err.message === "TIMEOUT"
        ? "Tempo de resposta excedido"
        : "Não foi possível conectar ao servidor";
    return { status: "OFFLINE", expDate: null, checkedAt: now, message };
  }
}
