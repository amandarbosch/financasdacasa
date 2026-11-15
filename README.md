# FINANÇAS DA CASA V4

Aplicação PWA mobile first para gestão financeira familiar compartilhada entre Amanda e Marcel, construída com HTML5, CSS3, JavaScript Vanilla, Supabase JS v2, Supabase Auth, Supabase Realtime e Chart.js.

## Arquivos

```text
index.html
styles.css
supabase.js
auth.js
app.js
service-worker.js
manifest.webmanifest
README.md
```

## Configuração do Supabase

Crie um projeto no Supabase e abra o SQL Editor. Execute integralmente o SQL abaixo.

```sql
begin;

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 80),
  email text not null,
  theme text not null default 'system' check (theme in ('rose', 'blue', 'system')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cards (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(trim(nome)) between 1 and 80),
  descricao text not null check (char_length(trim(descricao)) between 1 and 160),
  valor numeric(14,2) not null check (valor > 0),
  parcela_atual integer not null default 1 check (parcela_atual >= 1),
  total_parcelas integer not null default 1 check (total_parcelas >= 1),
  usuario text not null,
  user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cards_parcelas_validas check (parcela_atual <= total_parcelas)
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('receita', 'despesa', 'parcela', 'reembolso')),
  descricao text not null check (char_length(trim(descricao)) between 1 and 160),
  categoria text not null check (
    categoria in (
      'Moradia',
      'Cartões',
      'Transporte',
      'Contas da Casa',
      'Educação',
      'Alimentação',
      'Saúde',
      'Lazer',
      'Outros'
    )
  ),
  valor numeric(14,2) not null check (valor > 0),
  data date not null default current_date,
  usuario text not null,
  user_id uuid not null references auth.users(id) on delete restrict,
  card_id uuid references public.cards(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.school_fund (
  id uuid primary key default gen_random_uuid(),
  descricao text not null check (char_length(trim(descricao)) between 1 and 160),
  valor numeric(14,2) not null check (valor > 0),
  data date not null default current_date,
  usuario text not null,
  user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  key text not null default 'reserve_total' check (key = 'reserve_total'),
  value numeric(14,2) not null default 0 check (value >= 0),
  theme text not null default 'system' check (theme in ('rose', 'blue', 'system')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint settings_user_key_unique unique (user_id, key)
);

create index if not exists transactions_data_idx on public.transactions(data desc);
create index if not exists transactions_tipo_idx on public.transactions(tipo);
create index if not exists transactions_categoria_idx on public.transactions(categoria);
create index if not exists transactions_user_id_idx on public.transactions(user_id);
create index if not exists cards_user_id_idx on public.cards(user_id);
create index if not exists school_fund_data_idx on public.school_fund(data desc);
create index if not exists school_fund_user_id_idx on public.school_fund(user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_name text;
  profile_theme text;
begin
  profile_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    split_part(new.email, '@', 1),
    'Usuário'
  );

  profile_theme := case lower(split_part(profile_name, ' ', 1))
    when 'amanda' then 'rose'
    when 'marcel' then 'blue'
    else 'system'
  end;

  insert into public.profiles (id, name, email, theme)
  values (new.id, profile_name, new.email, profile_theme)
  on conflict (id) do update
    set name = excluded.name,
        email = excluded.email,
        updated_at = now();

  insert into public.settings (user_id, key, value, theme)
  values (new.id, 'reserve_total', 0, profile_theme)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists transactions_set_updated_at on public.transactions;
create trigger transactions_set_updated_at
before update on public.transactions
for each row execute function public.set_updated_at();

drop trigger if exists cards_set_updated_at on public.cards;
create trigger cards_set_updated_at
before update on public.cards
for each row execute function public.set_updated_at();

drop trigger if exists school_fund_set_updated_at on public.school_fund;
create trigger school_fund_set_updated_at
before update on public.school_fund
for each row execute function public.set_updated_at();

drop trigger if exists settings_set_updated_at on public.settings;
create trigger settings_set_updated_at
before update on public.settings
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.transactions enable row level security;
alter table public.cards enable row level security;
alter table public.school_fund enable row level security;
alter table public.settings enable row level security;

alter table public.profiles force row level security;
alter table public.transactions force row level security;
alter table public.cards force row level security;
alter table public.school_fund force row level security;
alter table public.settings force row level security;

drop policy if exists profiles_select_authenticated on public.profiles;
create policy profiles_select_authenticated
on public.profiles
for select
to authenticated
using (true);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own
on public.profiles
for insert
to authenticated
with check (id = auth.uid());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists profiles_delete_own on public.profiles;
create policy profiles_delete_own
on public.profiles
for delete
to authenticated
using (id = auth.uid());

drop policy if exists transactions_select_authenticated on public.transactions;
create policy transactions_select_authenticated
on public.transactions
for select
to authenticated
using (true);

drop policy if exists transactions_insert_authenticated on public.transactions;
create policy transactions_insert_authenticated
on public.transactions
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists transactions_update_authenticated on public.transactions;
create policy transactions_update_authenticated
on public.transactions
for update
to authenticated
using (true)
with check (user_id is not null);

drop policy if exists transactions_delete_authenticated on public.transactions;
create policy transactions_delete_authenticated
on public.transactions
for delete
to authenticated
using (true);

drop policy if exists cards_select_authenticated on public.cards;
create policy cards_select_authenticated
on public.cards
for select
to authenticated
using (true);

drop policy if exists cards_insert_authenticated on public.cards;
create policy cards_insert_authenticated
on public.cards
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists cards_update_authenticated on public.cards;
create policy cards_update_authenticated
on public.cards
for update
to authenticated
using (true)
with check (user_id is not null);

drop policy if exists cards_delete_authenticated on public.cards;
create policy cards_delete_authenticated
on public.cards
for delete
to authenticated
using (true);

drop policy if exists school_fund_select_authenticated on public.school_fund;
create policy school_fund_select_authenticated
on public.school_fund
for select
to authenticated
using (true);

drop policy if exists school_fund_insert_authenticated on public.school_fund;
create policy school_fund_insert_authenticated
on public.school_fund
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists school_fund_update_authenticated on public.school_fund;
create policy school_fund_update_authenticated
on public.school_fund
for update
to authenticated
using (true)
with check (user_id is not null);

drop policy if exists school_fund_delete_authenticated on public.school_fund;
create policy school_fund_delete_authenticated
on public.school_fund
for delete
to authenticated
using (true);

drop policy if exists settings_select_authenticated on public.settings;
create policy settings_select_authenticated
on public.settings
for select
to authenticated
using (true);

drop policy if exists settings_insert_own on public.settings;
create policy settings_insert_own
on public.settings
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists settings_update_authenticated on public.settings;
create policy settings_update_authenticated
on public.settings
for update
to authenticated
using (true)
with check (user_id is not null);

drop policy if exists settings_delete_own on public.settings;
create policy settings_delete_own
on public.settings
for delete
to authenticated
using (user_id = auth.uid());

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.transactions to authenticated;
grant select, insert, update, delete on public.cards to authenticated;
grant select, insert, update, delete on public.school_fund to authenticated;
grant select, insert, update, delete on public.settings to authenticated;

revoke all on public.profiles from anon;
revoke all on public.transactions from anon;
revoke all on public.cards from anon;
revoke all on public.school_fund from anon;
revoke all on public.settings from anon;

alter publication supabase_realtime add table public.profiles;
alter publication supabase_realtime add table public.transactions;
alter publication supabase_realtime add table public.cards;
alter publication supabase_realtime add table public.school_fund;
alter publication supabase_realtime add table public.settings;

commit;
```

Se alguma tabela já estiver na publicação `supabase_realtime`, remova somente a linha `alter publication` correspondente antes de executar novamente.

## Configuração das credenciais públicas

No início de `supabase.js`, as constantes são lidas de `window.SUPABASE_URL` e `window.SUPABASE_PUBLISHABLE_KEY`. Inclua o bloco abaixo no `index.html`, imediatamente antes da importação de `supabase.js`, usando os valores públicos exibidos em **Supabase > Project Settings > API**:

```html
<script>
  window.SUPABASE_URL = 'COLE_AQUI_A_URL_PUBLICA_DO_PROJETO';
  window.SUPABASE_PUBLISHABLE_KEY = 'COLE_AQUI_A_CHAVE_PUBLICAVEL_DO_PROJETO';
</script>
```

Use exclusivamente a chave publicável. Nunca publique `service_role`, secret key ou qualquer chave com privilégios administrativos.

## Autenticação

No painel do Supabase:

1. Abra **Authentication > Providers > Email**.
2. Ative o provedor de e-mail.
3. Em **Authentication > URL Configuration**, defina a URL do GitHub Pages como Site URL.
4. Adicione a mesma origem em Redirect URLs.
5. Crie as contas de Amanda e Marcel pela tela do aplicativo.

O primeiro nome `Amanda` recebe automaticamente o tema `Rosé Elegante`. O primeiro nome `Marcel` recebe automaticamente o tema `Azul Executivo`. Cada usuário pode alterar o próprio tema na tela **Mais**.

## Publicação no GitHub Pages

1. Crie um repositório.
2. Envie todos os arquivos para a raiz da branch principal.
3. Abra **Settings > Pages**.
4. Em **Build and deployment**, selecione **Deploy from a branch**.
5. Selecione a branch principal e a pasta `/root`.
6. Salve e aguarde a publicação.
7. Cadastre a URL publicada nas configurações de autenticação do Supabase.

## Funcionamento offline

O service worker armazena o shell da aplicação, os arquivos locais, o manifesto e os recursos públicos utilizados pela interface. As últimas listas carregadas são mantidas no armazenamento local para consulta sem conexão. Inclusões, alterações, exclusões, login e sincronização Realtime exigem conexão com a internet.

## Realtime

As tabelas `profiles`, `transactions`, `cards`, `school_fund` e `settings` fazem parte da publicação `supabase_realtime`. Qualquer alteração feita por Amanda ou Marcel atualiza automaticamente o outro dispositivo autenticado.

## Segurança

- A aplicação usa somente Supabase Auth e a chave publicável.
- Todas as tabelas possuem RLS habilitado e forçado.
- Usuários anônimos não possuem acesso às tabelas.
- Usuários autenticados compartilham os dados financeiros da casa.
- Perfil, criação de conta e tema permanecem vinculados ao usuário autenticado.
- A chave `service_role` nunca deve ser enviada ao navegador.

## Desenvolvimento local

O service worker e os módulos remotos exigem uma origem HTTP. Execute a aplicação por um servidor local:

```bash
python3 -m http.server 8080
```

Abra `http://localhost:8080` no navegador e cadastre essa URL nas Redirect URLs do Supabase durante o desenvolvimento.

## Categorias disponíveis

- Moradia
- Cartões
- Transporte
- Contas da Casa
- Educação
- Alimentação
- Saúde
- Lazer
- Outros

## Distribuição da reserva

- 75% Reserva intocável
- 15% Despesas anuais
- 10% Ponte temporária

## Meta escolar

A meta fixa da Escola Bernardo é de R$ 2.000,00 por mês. O painel calcula automaticamente o valor coberto, o valor faltante, o percentual e a barra de progresso.
