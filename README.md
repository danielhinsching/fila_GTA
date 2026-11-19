# Fila do GTA VI · Noite de Jogos Vice City

App da fila das 5 estações: HTML/CSS/JS puro (Vercel) + Supabase (Postgres + Realtime).

## Telas

| URL | Quem usa |
|---|---|
| `/` | Jogador (QR da parede): entra com o nome, vê fila, posição, tempo e alertas |
| `/staff.html` | Staff de cada estação (escolhe a estação + PIN) |
| `/telao.html` | Telão (TV), deixar em tela cheia |
| `/qr.html` | QR code para imprimir |

Modo demo (sem banco): acrescente `?mock=1` em qualquer tela.

## Estrutura

```
index.html  staff.html  telao.html  qr.html
css/   base.css  player.css  staff.css  board.css
js/    config.js  format.js  api.js  alerts.js  player.js  staff.js  board.js  analytics.js
assets/  fontes, logos, fundo
supabase/schema.sql   banco (v2, seguro)
```

## Segurança

As tabelas são privadas (RLS sem acesso anônimo). O navegador só chama funções `fila_*`
(`security definer`). O staff usa PIN por estação (5 erros = bloqueio de 60 s) e só **um aparelho por vez** pode abrir cada estação (outro só entra após "Sair" ou 40 s sem sinal).

## Publicar

1. Supabase → SQL Editor → rodar `supabase/schema.sql` (pode rodar mais de uma vez).
2. Definir os PINs:
   ```sql
   insert into fila_secrets values (1,'XXXX'),(2,'XXXX'),(3,'XXXX'),(4,'XXXX'),(5,'XXXX')
   on conflict (station) do update set pin = excluded.pin;
   ```
3. `js/config.js` com a URL e a chave publishable do projeto.
4. Push na `main` → deploy automático no Vercel.
5. Vercel → projeto → Analytics → Enable (opcional).

## Regras

20 min por jogador · +10 min pelo staff · fast-pass entra a cada 2 jogadores normais (nome dourado, posição original registrada) ·
próximo começa 30 s após o anterior · alertas de 5 e 1 min para quem joga e para o #2 · tela **WASTED** quando o tempo acaba.
Alertas exigem a tela aberta (sem notificação com tela bloqueada).
