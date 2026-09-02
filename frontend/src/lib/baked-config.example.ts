// TEMPLATE — copie para `baked-config.ts` (que é git-ignored) e preencha o BLOB.
//
// `baked-config.ts` embute o endereço do portal + o token de admin de forma
// ofuscada (XOR keystream + base64) para não ficarem em texto puro no APK.
// NÃO é criptografia de verdade (a semente está no arquivo) — só evita
// `strings`/grep. Este arquivo (o real) fica FORA do repositório porque o
// token guarda a API do portal.
//
// Para gerar o BLOB, rode um script Node equivalente a:
//   const j = JSON.stringify({ portalUrl: "...", portalToken: "..." });
//   // XOR com keystream(SEED, j.length) e base64 -> cole em BLOB abaixo
// (veja a função `keystream` abaixo; a mesma precisa ser usada na geração).
//
// Com BLOB = "" o app cai no backend embarcado / sem token (comportamento
// padrão de dev).

const SEED = "hc-iptv::baked::v1::9d4f7a2c8e1b";

const BLOB = "";

function keystream(seed: string, len: number): Uint8Array {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const out = new Uint8Array(len);
  let x = h || 1;
  for (let i = 0; i < len; i++) {
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17; x >>>= 0;
    x ^= x << 5; x >>>= 0;
    out[i] = x & 0xff;
  }
  return out;
}

function reveal<T>(blob: string): T | null {
  try {
    if (!blob) return null;
    const bin = atob(blob);
    const ks = keystream(SEED, bin.length);
    let s = "";
    for (let i = 0; i < bin.length; i++) s += String.fromCharCode(bin.charCodeAt(i) ^ ks[i]);
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

const baked = reveal<{ portalUrl?: string; portalToken?: string }>(BLOB);

export const BAKED_PORTAL_URL = (baked?.portalUrl ?? "").trim().replace(/\/+$/, "");
export const BAKED_PORTAL_TOKEN = (baked?.portalToken ?? "").trim();
