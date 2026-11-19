# Fila do GTA VI · Noite de Jogos Vice City

## Subir (≈10 min)
1. Supabase: reative/crie o projeto → SQL Editor → cole `supabase/schema.sql` → Run.
2. Defina os PINs de cada estação (troque os valores):
   `insert into fila_secrets values (1,'0000'),(2,'0000'),(3,'0000'),(4,'0000') on conflict (station) do update set pin = excluded.pin;`
3. `config.js` → preencha SUPABASE_URL e SUPABASE_KEY (chave publishable/anon).
4. Publique este repositório na Vercel (projeto estático, sem build, raiz do repositório). Páginas:
   - `/` jogador (o QR aponta para cá) · `/staff.html` painel · `/telao.html` dashboard · `/qr.html` cartaz do QR
5. Teste visual sem backend: `?mock=1` em qualquer página.

## Regras
- 20 min por pessoa; +10 min pelo staff; fast-pass sobe para a frente (nome dourado); ao fim do tempo o próximo começa em 30 s.
- A fila de cada pessoa é a que o sistema escolheu na entrada (menor espera estimada). Não há redistribuição.
- Ausente → fim da fila (o próximo começa em 10 s).
- Zerar para outro dia: `truncate fila_tickets;`
