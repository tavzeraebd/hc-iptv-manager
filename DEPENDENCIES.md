# IPTV Manager — dependências

Nenhum pacote é compartilhado com o IPTV Player; cada projeto tem seu próprio
`package.json` e `node_modules`.

## frontend/ (runtime)

| Pacote | Uso |
|--------|-----|
| react, react-dom `^19.2.8` | UI |
| @capacitor/core, @capacitor/android `^8.5.0` | shell mobile |
| @capacitor/app `^8.1.1` | ciclo de vida do app |
| @capawesome/capacitor-nodejs `^0.1.0` | backend Express embarcado no APK |
| @radix-ui/react-{alert-dialog,dialog,dropdown-menu,label,select,separator,slot,tooltip} | primitivos dos componentes `ui/*` |
| class-variance-authority `^0.7.1`, clsx `^2.1.1`, tailwind-merge `^3.6.0` | variantes / `cn()` |
| lucide-react `^1.33.0` | ícones |
| sonner `^2.0.8` | toasts |
| tailwindcss `^4.3.3`, @tailwindcss/vite `^4.3.3`, tw-animate-css `^1.4.0` | estilos |

## frontend/ (dev)

`@capacitor/assets`, `@capacitor/cli`, `@types/node`, `@types/react`,
`@types/react-dom`, `@vitejs/plugin-react`, `oxlint`, `sharp`, `typescript`,
`vite`.

Sem `patch-package` — o Manager não aplica nenhum patch nativo.

## backend/ (runtime)

| Pacote | Uso |
|--------|-----|
| express `^4.21.2` | HTTP / rotas |
| cors `^2.8.5` | CORS |

## backend/ (dev)

`@types/cors`, `@types/express`, `@types/node`, `esbuild` (bundle mobile),
`tsx` (dev/exec), `typescript`.

## Removido em relação ao monólito

`hls.js`, `@capgo/capacitor-video-player`, e no backend `xtreamClient` /
`hlsProxy` / `vodProxy` / `tvLogos` (eram só do player).
