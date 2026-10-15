# ⚔️ Dungeon Legends

RPG de ação 2D em pixel art feito com **HTML + CSS + JavaScript puro** (Canvas, sem frameworks) e um backend robusto em **C# / ASP.NET Core 8** para saves na nuvem, ranking global, desafio diário e antitrapaça.

![Gameplay](docs/gameplay.png)

## ✨ O que tem no jogo

- **5 fases** com história, bioma próprio (cores, música, inimigos) e **13 andares procedurais** — cada partida é um mapa novo
- **5 chefes** com padrões de ataque (pancada em área, investida, leque de projéteis, anel, espiral, teleporte, invocação) e **2ª fase de fúria** abaixo de 50% de vida
- **4 classes** jogáveis, cada uma com ataque e habilidade especial:
  | Classe | Ataque | Habilidade |
  |---|---|---|
  | Cavaleiro | Espada em arco (destrói projéteis) | Escudo Sagrado — reduz 80% do dano e reflete |
  | Feiticeira | Bolas de fogo explosivas | Nova Arcana — explosão em área |
  | Elfo Ranger | Adagas perfurantes | Chuva de Lâminas — 16 adagas em círculo |
  | Berserker Lagarto | Machado | Furacão — gira causando dano contínuo (mais dano com pouca vida) |
- **14 tipos de inimigo** com IAs diferentes: perseguidor, arqueiro, investida, invocador, explosivo, que se divide, **mímico** disfarçado de baú…
- **Inimigos elite** brilhantes, e o **Elite Dourado** que guarda a chave de cada andar
- **RPG de verdade**: XP e níveis, **12 bênçãos** (perks) para escolher a cada nível, **21 armas** em 4 raridades, ouro, poções, baús e **loja do mercador** entre fases
- Esquiva com invencibilidade, críticos, roubo de vida, veneno, lentidão, armadilhas de espinhos
- Iluminação dinâmica, névoa de guerra, minimapa, partículas, tremor de tela, números de dano, hit-stop
- **Trilha sonora e efeitos 100% gerados por código** (WebAudio) — cada fase tem sua música, chefes têm tema próprio
- **Gamepad**, mira automática, opções de volume, save automático em cada andar
- **Funciona offline** (saves e ranking no navegador) e **online** com a API C#

| | |
|---|---|
| ![Classes](docs/classes.png) | ![Chefe](docs/boss.png) |
| ![Pântano](docs/pantano.png) | ![Loja](docs/loja.png) |

---

## 🚀 Como rodar no VS Code

### 1. O jogo (só precisa do Live Server)

1. Abra a pasta do projeto no VS Code (`File > Open Folder`)
2. Instale a extensão **Live Server** (o VS Code vai sugerir automaticamente)
3. Clique em **Go Live** no canto inferior direito

O jogo abre em `http://127.0.0.1:5500` — já está configurado em `.vscode/settings.json` para servir a pasta `client/`. Pronto, dá pra jogar! 🎮

> ⚠️ Não abra o `index.html` com duplo clique (`file://`): o navegador bloqueia módulos JavaScript assim. Use o Live Server.

### 2. A API C# (opcional — libera ranking global, desafio diário e saves na nuvem)

Requer o [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0). Em um terminal do VS Code:

```bash
cd server/src/DungeonLegends.Api
dotnet run
```

A API sobe em `http://localhost:5080`. Recarregue o jogo: o menu vai mostrar **"● Servidor C# online"**.
Também dá para usar `Ctrl+Shift+P > Tasks: Run Task > API C#: rodar (watch)` ou apertar **F5** com a configuração "API C# (Debug)".

Rodar os testes:

```bash
dotnet test server/DungeonLegends.sln
```

---

## 🎮 Controles

| Ação | Teclado / Mouse | Gamepad |
|---|---|---|
| Mover | `W A S D` / setas | Analógico esquerdo |
| Mirar | Mouse | Analógico direito |
| Atacar | Clique esquerdo / `J` (segure) | RT |
| Habilidade | Clique direito / `Q` | X |
| Esquiva | `Espaço` / `Shift` | A |
| Interagir / pegar arma / descer | `E` | Y |
| Poção de vida / mana | `1` / `2` | LB / RB |
| Pausar | `Esc` / `P` | Start |
| Mudo | `M` | — |

**Objetivo:** em cada andar, derrote o **Elite Dourado** para pegar a chave e desça pela escada (▼ no minimapa). O último andar de cada fase é o covil do chefe.

---

## 🏗️ Arquitetura

```
dungeon-legends/
├── client/                      ← jogo (HTML/CSS/JS) — servido pelo Live Server
│   ├── index.html
│   ├── css/style.css            ← interface pixel-art escalável
│   ├── data/content.json        ← TODO o conteúdo: classes, inimigos, fases, armas, perks, regras
│   ├── assets/sprites/          ← spritesheet 0x72 (CC0) + atlas.json
│   └── js/
│       ├── main.js              ← ponto de entrada
│       ├── game.js              ← máquina de estados, laço, combate, progressão
│       ├── core/                ← math (RNG determinístico), assets, input, audio
│       ├── world/dungeon.js     ← geração procedural, campo de fluxo (pathfinding)
│       ├── entities/            ← player, enemy (IA + chefes), projectile, pickup, effects
│       ├── systems/rules.js     ← fórmulas de XP e pontuação (espelhadas no C#)
│       ├── net/api.js           ← cliente da API com fallback offline
│       └── ui/ui.js             ← HUD, menus, loja, perks, ranking
│
└── server/                      ← API C# (.NET 8) — Clean Architecture
    ├── DungeonLegends.sln
    ├── src/
    │   ├── DungeonLegends.Domain/          ← regras puras: pontuação, XP, antitrapaça, validação de saves,
    │   │                                     desafio diário, RNG Mulberry32 idêntico ao JS
    │   ├── DungeonLegends.Application/     ← casos de uso: jogadores, partidas, saves, ranking
    │   ├── DungeonLegends.Infrastructure/  ← persistência JSON atômica, tokens SHA-256, conteúdo embutido
    │   └── DungeonLegends.Api/             ← Minimal APIs, ProblemDetails, CORS, rate limit, health checks
    └── tests/DungeonLegends.Tests/         ← 61 testes xUnit
```

### Destaques do backend C#

- **Fonte única de verdade:** o `client/data/content.json` é **embutido no assembly** no build. Cliente e servidor usam exatamente os mesmos dados — e a API valida a integridade do conteúdo ao subir.
- **Paridade cliente/servidor:** o gerador aleatório (Mulberry32), o hash FNV-1a, a curva de XP e a fórmula de pontuação são implementados de forma idêntica em JS e C#, com testes que comparam valores gerados pelo próprio JavaScript.
- **Antitrapaça:** o servidor gera a semente da masmorra, **recalcula a pontuação** e checa plausibilidade (tempo de jogo vs. tempo real, andares rápidos demais, abates/ouro impossíveis, chefes sem chegar na arena, vitória falsa, nível improvável). Partidas suspeitas são gravadas, mas ficam fora do ranking.
- **Validação de saves:** perks vs. nível, XP vs. curva, bônus só com compras na loja, armas existentes, posição na campanha consistente, impede "voltar no tempo".
- **Segurança:** token aleatório de 256 bits por jogador, armazenado só como hash SHA-256, comparação em tempo constante; filtro de autenticação por endpoint; rate limiting por IP; CORS restrito.
- **Persistência robusta sem banco:** arquivos JSON com escrita atômica (temp + rename), backup `.bak` com recuperação automática de corrupção, lock assíncrono para concorrência. Repositórios atrás de interfaces — troque por EF Core/SQL sem mexer no domínio.
- **Zero pacotes NuGet** na API: compila só com o SDK do .NET.
- Erros no padrão **RFC 7807 (ProblemDetails)**, health check em `/api/health`, índice de rotas em `/api`, cabeçalho `Server-Timing`.

### Endpoints

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api` | Lista de endpoints |
| GET | `/api/health` | Saúde da API |
| GET | `/api/content` | Conteúdo do jogo |
| GET | `/api/daily` | Desafio diário (semente + modificador) |
| GET | `/api/stats` | Estatísticas globais |
| POST | `/api/players` | Cadastra jogador → `{ id, name, token }` |
| GET | `/api/players/{id}` 🔒 | Perfil e histórico |
| POST | `/api/runs` 🔒 | Inicia partida → `{ runId, seed, modifier }` |
| POST | `/api/runs/{id}/finish` 🔒 | Finaliza, valida e pontua |
| GET | `/api/runs/{id}` | Detalhes de uma partida |
| GET/PUT/DELETE | `/api/saves/{playerId}` 🔒 | Save na nuvem |
| GET | `/api/leaderboard?top=10&heroClass=&daily=` | Ranking |

🔒 = cabeçalho `X-Player-Token` (e `X-Player-Id` quando o id não está na rota). Exemplos prontos em `server/DungeonLegends.http` (extensão REST Client).

---

## 📤 Subindo para o GitHub

```bash
git init
git add .
git commit -m "Dungeon Legends: RPG de ação 2D + API C#"
git branch -M main
git remote add origin https://github.com/pedrosoaresdev/dungeon-legends.git
git push -u origin main
```

Já vem com GitHub Actions:
- **CI** (`.github/workflows/ci.yml`): build + testes da API e checagem do JavaScript a cada push.
- **GitHub Pages** (`.github/workflows/pages.yml`): publica o jogo. Ative em **Settings → Pages → Source: GitHub Actions** e o jogo fica em `https://pedrosoaresdevO.github.io/dungeon-legends/` (no Pages ele roda no modo offline, a menos que você hospede a API e configure a URL em *Opções*; adicione o domínio do Pages em `Cors:AllowedOrigins` no `appsettings.json`).

---

## 🛠️ Modificando o jogo

Quase tudo é dado, não código — edite `client/data/content.json`:
- mude vida/dano das classes, crie armas, ajuste quantos andares cada fase tem, troque o chefe de uma fase, mexa na fórmula de pontuação…
- o servidor C# pega as mudanças automaticamente no próximo build.

Dica: no console do navegador, `game` dá acesso ao estado do jogo (ex.: `game.player.gold += 999`).

## 📜 Créditos e licença

Código: MIT. Arte: **16x16 DungeonTileset II por [0x72](https://0x72.itch.io/dungeontileset-ii)** — CC0 (domínio público). Detalhes em [CREDITS.md](CREDITS.md).
