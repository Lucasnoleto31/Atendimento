-- Promove um usuário já existente a admin.
-- Cole no SQL Editor do Supabase e execute.
-- O usuário precisa já ter sido criado em Authentication > Users.

update public.profiles
set papel = 'admin',
    nome  = coalesce(nullif(nome, ''), 'Lucas')
where email = 'lucas@zeve.com.br';

-- Confere o resultado:
select id, nome, email, papel, ativo
from public.profiles
where email = 'lucas@zeve.com.br';
