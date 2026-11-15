'use strict';

(() => {
  const STORAGE_PREFIX = 'financas-da-casa-v4';
  const REQUIRED_TABLES = Object.freeze([
    'profiles',
    'transactions',
    'cards',
    'school_fund',
    'settings'
  ]);

  const readMeta = (name) =>
    document.querySelector(`meta[name="${name}"]`)?.content?.trim() || '';

  const readStoredConfig = () => {
    try {
      return JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}:supabase-config`) || '{}');
    } catch {
      return {};
    }
  };

  const storedConfig = readStoredConfig();
  const SUPABASE_URL = String(
    window.SUPABASE_URL ||
    readMeta('supabase-url') ||
    storedConfig.SUPABASE_URL ||
    ''
  ).trim();
  const SUPABASE_PUBLISHABLE_KEY = String(
    window.SUPABASE_PUBLISHABLE_KEY ||
    readMeta('supabase-publishable-key') ||
    storedConfig.SUPABASE_PUBLISHABLE_KEY ||
    ''
  ).trim();

  const isValidUrl = (value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && Boolean(url.hostname);
    } catch {
      return false;
    }
  };

  const validateConfiguration = () => {
    const errors = [];
    if (!isValidUrl(SUPABASE_URL)) {
      errors.push('SUPABASE_URL ausente ou inválida.');
    }
    if (!SUPABASE_PUBLISHABLE_KEY || SUPABASE_PUBLISHABLE_KEY.length < 20) {
      errors.push('SUPABASE_PUBLISHABLE_KEY ausente ou inválida.');
    }
    if (/service_role|secret/i.test(SUPABASE_PUBLISHABLE_KEY)) {
      errors.push('Use somente a chave publicável do Supabase no navegador.');
    }
    if (!window.supabase?.createClient) {
      errors.push('A biblioteca Supabase JS v2 não foi carregada.');
    }
    return errors;
  };

  const configurationErrors = validateConfiguration();
  let client = null;

  if (configurationErrors.length === 0) {
    client = window.supabase.createClient(
      SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY,
      {
        db: { schema: 'public' },
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storageKey: `${STORAGE_PREFIX}:auth`
        },
        realtime: {
          params: { eventsPerSecond: 20 }
        },
        global: {
          headers: { 'x-application-name': 'financas-da-casa-v4' }
        }
      }
    );
  }

  const requireClient = () => {
    if (client) return client;
    throw new Error(configurationErrors.join(' '));
  };

  const normalizeError = (error, fallback = 'Não foi possível concluir a operação.') => {
    if (!error) return new Error(fallback);
    const normalized = new Error(error.message || fallback);
    normalized.code = error.code || null;
    normalized.details = error.details || null;
    normalized.hint = error.hint || null;
    normalized.status = error.status || null;
    return normalized;
  };

  const execute = async (operation, fallback) => {
    if (!navigator.onLine) {
      throw new Error('Sem conexão com a internet. Tente novamente quando estiver online.');
    }
    try {
      const result = await operation(requireClient());
      if (result?.error) throw normalizeError(result.error, fallback);
      return result;
    } catch (error) {
      throw normalizeError(error, fallback);
    }
  };

  const getSession = async () => {
    const { data } = await execute(
      (supabaseClient) => supabaseClient.auth.getSession(),
      'Não foi possível recuperar a sessão.'
    );
    return data.session;
  };

  const getUser = async () => {
    const { data } = await execute(
      (supabaseClient) => supabaseClient.auth.getUser(),
      'Não foi possível recuperar o usuário.'
    );
    return data.user;
  };

  const signIn = async (email, password) => {
    const { data } = await execute(
      (supabaseClient) => supabaseClient.auth.signInWithPassword({
        email: String(email).trim().toLowerCase(),
        password: String(password)
      }),
      'Não foi possível entrar.'
    );
    return data;
  };

  const signUp = async ({ name, email, password }) => {
    const normalizedName = String(name).trim();
    const { data } = await execute(
      (supabaseClient) => supabaseClient.auth.signUp({
        email: String(email).trim().toLowerCase(),
        password: String(password),
        options: {
          data: {
            name: normalizedName,
            full_name: normalizedName
          }
        }
      }),
      'Não foi possível criar a conta.'
    );
    return data;
  };

  const signOut = async () => {
    await execute(
      (supabaseClient) => supabaseClient.auth.signOut({ scope: 'local' }),
      'Não foi possível sair da conta.'
    );
  };

  const onAuthStateChange = (callback) => {
    const { data } = requireClient().auth.onAuthStateChange((event, session) => {
      queueMicrotask(() => callback(event, session));
    });
    return data.subscription;
  };

  const queryAll = async (table, options = {}) => {
    if (!REQUIRED_TABLES.includes(table)) throw new Error('Tabela não permitida.');
    const {
      select = '*',
      orderBy = 'created_at',
      ascending = false,
      filters = []
    } = options;

    const { data } = await execute((supabaseClient) => {
      let query = supabaseClient.from(table).select(select);
      for (const filter of filters) {
        const { method = 'eq', column, value } = filter;
        if (!column || typeof query[method] !== 'function') continue;
        query = query[method](column, value);
      }
      if (orderBy) query = query.order(orderBy, { ascending });
      return query;
    }, `Não foi possível carregar ${table}.`);

    return data || [];
  };

  const queryOne = async (table, filters, select = '*') => {
    if (!REQUIRED_TABLES.includes(table)) throw new Error('Tabela não permitida.');
    const { data } = await execute((supabaseClient) => {
      let query = supabaseClient.from(table).select(select);
      for (const [column, value] of Object.entries(filters || {})) {
        query = query.eq(column, value);
      }
      return query.maybeSingle();
    }, `Não foi possível carregar o registro de ${table}.`);
    return data;
  };

  const insert = async (table, payload) => {
    if (!REQUIRED_TABLES.includes(table)) throw new Error('Tabela não permitida.');
    const { data } = await execute(
      (supabaseClient) => supabaseClient
        .from(table)
        .insert(payload)
        .select()
        .single(),
      `Não foi possível salvar em ${table}.`
    );
    return data;
  };

  const upsert = async (table, payload, onConflict) => {
    if (!REQUIRED_TABLES.includes(table)) throw new Error('Tabela não permitida.');
    const { data } = await execute(
      (supabaseClient) => supabaseClient
        .from(table)
        .upsert(payload, { onConflict, ignoreDuplicates: false })
        .select()
        .single(),
      `Não foi possível atualizar ${table}.`
    );
    return data;
  };

  const update = async (table, id, payload) => {
    if (!REQUIRED_TABLES.includes(table)) throw new Error('Tabela não permitida.');
    const { data } = await execute(
      (supabaseClient) => supabaseClient
        .from(table)
        .update(payload)
        .eq('id', id)
        .select()
        .single(),
      `Não foi possível atualizar o registro de ${table}.`
    );
    return data;
  };

  const remove = async (table, id) => {
    if (!REQUIRED_TABLES.includes(table)) throw new Error('Tabela não permitida.');
    await execute(
      (supabaseClient) => supabaseClient.from(table).delete().eq('id', id),
      `Não foi possível excluir o registro de ${table}.`
    );
  };

  const subscribe = (channelName, tables, callback, onStatus) => {
    const supabaseClient = requireClient();
    let channel = supabaseClient.channel(channelName, {
      config: { broadcast: { self: false }, presence: { key: '' } }
    });

    for (const table of tables) {
      if (!REQUIRED_TABLES.includes(table)) continue;
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        (payload) => callback({ table, ...payload })
      );
    }

    channel.subscribe((status, error) => {
      if (typeof onStatus === 'function') onStatus(status, error || null);
    });
    return channel;
  };

  const unsubscribe = async (channel) => {
    if (!client || !channel) return;
    await client.removeChannel(channel);
  };

  const setConfiguration = ({ url, publishableKey }) => {
    const nextUrl = String(url || '').trim();
    const nextKey = String(publishableKey || '').trim();
    if (!isValidUrl(nextUrl)) throw new Error('SUPABASE_URL inválida.');
    if (nextKey.length < 20 || /service_role|secret/i.test(nextKey)) {
      throw new Error('SUPABASE_PUBLISHABLE_KEY inválida.');
    }
    localStorage.setItem(`${STORAGE_PREFIX}:supabase-config`, JSON.stringify({
      SUPABASE_URL: nextUrl,
      SUPABASE_PUBLISHABLE_KEY: nextKey
    }));
    window.location.reload();
  };

  const clearConfiguration = () => {
    localStorage.removeItem(`${STORAGE_PREFIX}:supabase-config`);
    window.location.reload();
  };

  window.FinancasDB = Object.freeze({
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY,
    isConfigured: configurationErrors.length === 0,
    configurationErrors: Object.freeze([...configurationErrors]),
    client,
    requireClient,
    getSession,
    getUser,
    signIn,
    signUp,
    signOut,
    onAuthStateChange,
    queryAll,
    queryOne,
    insert,
    upsert,
    update,
    remove,
    subscribe,
    unsubscribe,
    setConfiguration,
    clearConfiguration
  });
})();
