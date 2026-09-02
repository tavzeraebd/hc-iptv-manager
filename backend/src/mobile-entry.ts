import path from "path";

// "bridge" é um módulo virtual injetado pelo runtime Node.js embarcado
// (nodejs-mobile via @capawesome/capacitor-nodejs) — não existe como pacote
// npm, por isso é resolvido em tempo de execução via require() e mantido
// fora do bundle (ver esbuild --external:bridge em build:mobile).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const bridge = require("bridge");

// No app Android, cada usuário tem sua própria pasta de dados interna do
// app (app.datadir()) — persiste entre aberturas, mas é apagada se o app
// for desinstalado. HOST fica restrito a 127.0.0.1: o backend embarcado
// não deve ficar acessível por outros dispositivos na rede.
process.env.DATA_DIR = path.join(bridge.app.datadir(), "data");
process.env.HOST = "127.0.0.1";
process.env.PORT = process.env.PORT || "8891";

require("./server");
