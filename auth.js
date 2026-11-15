'use strict';

(() => {
  const DB = window.FinancasDB;
  const state = {
    session: null,
    user: null,
    profile: null,
    subscription: null,
    initialized: false
  };

  const $ = (selector) => document.querySelector(selector);
  const authScreen = $('#authScreen');
  const appShell = $('#appShell');
  const loginForm = $('#loginForm');
  const signupForm = $('#signupForm');
  const signupDialog = $('#signupDialog');
  const loginButton = $('#loginButton');
  const authMessage = $('#authMessage');
  const signupMessage = $('#signupMessage');

  const normalizeName = (value) => String(value || '').trim().replace(/\s+/g, ' ');
  const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
  const initials = (name) => normalizeName(name)
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'FC';

  const defaultThemeForName = (name) => {
    const firstName = normalizeName(name).split(' ')[0].toLocaleLowerCase('pt-BR');
    if (firstName === 'amanda') return 'rose';
    if (firstName === 'marcel') return 'blue';
    return 'system';
  };

  const friendlyError = (error) => {
    const message = String(error?.message || error || 'Erro inesperado.');
    const lower = message.toLowerCase();
    if (lower.includes('invalid login credentials')) return 'E-mail ou senha inválidos.';
    if (lower.includes('email not confirmed')) return 'Confirme seu e-mail antes de entrar.';
    if (lower.includes('user already registered')) return 'Este e-mail já possui uma conta.';
    if (lower.includes('password should be')) return 'A senha deve ter pelo menos 6 caracteres.';
    if (lower.includes('unable to validate email')) return 'Informe um e-mail válido.';
    if (lower.includes('rate limit')) return 'Muitas tentativas. Aguarde alguns minutos.';
    if (lower.includes('failed to fetch') || lower.includes('network')) return 'Falha de conexão. Verifique sua internet.';
    return message;
  };

  const setMessage = (element, message = '', type = 'error') => {
    if (!element) return;
    element.textContent = message;
    element.dataset.type = type;
    element.hidden = !message;
  };

  const setBusy = (button, busy, busyText = 'Aguarde...') => {
    if (!button) return;
    if (busy) {
      button.dataset.originalText = button.textContent;
      button.textContent = busyText;
    } else if (button.dataset.originalText) {
      button.textContent = button.dataset.originalText;
      delete button.dataset.originalText;
    }
    button.disabled = busy;
    button.setAttribute('aria-busy', String(busy));
  };

  const applyTheme = (theme) => {
    const normalized = ['rose', 'blue', 'system'].includes(theme) ? theme : 'system';
    if (normalized === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.dataset.theme = normalized;
    localStorage.setItem('financas-da-casa-v4:theme', normalized);
    const label = $('#themeLabel');
    if (label) label.textContent = ({ rose: 'Rosé Elegante', blue: 'Azul Executivo', system: 'Tema do sistema' })[normalized];
  };

  const updateIdentity = (user, profile) => {
    const name = normalizeName(profile?.name || user?.user_metadata?.name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Usuário');
    const email = user?.email || '';
    const userInitials = initials(name);
    const map = {
      '#headerName': name,
      '#profileName': name,
      '#profileEmail': email,
      '#headerAvatar': userInitials,
      '#profileAvatar': userInitials
    };
    Object.entries(map).forEach(([selector, value]) => {
      const element = $(selector);
      if (element) element.textContent = value;
    });
    const profileInput = $('#profileNameInput');
    if (profileInput) profileInput.value = name;
  };

  const showAuthenticated = () => {
    if (authScreen) authScreen.hidden = true;
    if (appShell) appShell.hidden = false;
    document.body.classList.add('authenticated');
  };

  const showAnonymous = () => {
    if (appShell) appShell.hidden = true;
    if (authScreen) authScreen.hidden = false;
    document.body.classList.remove('authenticated');
    state.session = null;
    state.user = null;
    state.profile = null;
  };

  const loadOrCreateProfile = async (user) => {
    let profile = await DB.queryOne('profiles', { id: user.id });
    if (profile) return profile;
    const name = normalizeName(user.user_metadata?.name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'Usuário');
    profile = await DB.upsert('profiles', {
      id: user.id,
      name,
      email: user.email,
      theme: defaultThemeForName(name),
      updated_at: new Date().toISOString()
    }, 'id');
    return profile;
  };

  const ensureSettings = async (user, profile) => {
    const theme = profile?.theme || defaultThemeForName(profile?.name);
    const settings = await DB.queryOne('settings', { user_id: user.id });
    if (settings) return settings;
    return DB.upsert('settings', {
      user_id: user.id,
      theme,
      updated_at: new Date().toISOString()
    }, 'user_id');
  };

  const establishSession = async (session) => {
    if (!session?.user) {
      showAnonymous();
      window.dispatchEvent(new CustomEvent('financas:session', { detail: null }));
      return;
    }
    state.session = session;
    state.user = session.user;
    try {
      state.profile = await loadOrCreateProfile(session.user);
      const settings = await ensureSettings(session.user, state.profile);
      const selectedTheme = settings?.theme || state.profile?.theme || defaultThemeForName(state.profile?.name);
      applyTheme(selectedTheme);
      updateIdentity(session.user, state.profile);
      showAuthenticated();
      window.dispatchEvent(new CustomEvent('financas:session', {
        detail: { session, user: session.user, profile: state.profile, settings }
      }));
    } catch (error) {
      showAuthenticated();
      updateIdentity(session.user, null);
      applyTheme(defaultThemeForName(session.user.user_metadata?.name));
      window.dispatchEvent(new CustomEvent('financas:session', {
        detail: { session, user: session.user, profile: null, error }
      }));
    }
  };

  const validateLogin = (email, password) => {
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) return 'Informe um e-mail válido.';
    if (!password || password.length < 6) return 'Informe uma senha com pelo menos 6 caracteres.';
    return '';
  };

  const handleLogin = async (event) => {
    event.preventDefault();
    const email = normalizeEmail($('#loginEmail')?.value);
    const password = $('#loginPassword')?.value || '';
    const validation = validateLogin(email, password);
    setMessage(authMessage, validation);
    if (validation) return;
    setBusy(loginButton, true, 'Entrando...');
    try {
      const data = await DB.signIn(email, password);
      await establishSession(data.session);
      loginForm.reset();
    } catch (error) {
      setMessage(authMessage, friendlyError(error));
    } finally {
      setBusy(loginButton, false);
    }
  };

  const handleSignup = async (event) => {
    event.preventDefault();
    const name = normalizeName($('#signupName')?.value);
    const email = normalizeEmail($('#signupEmail')?.value);
    const password = $('#signupPassword')?.value || '';
    const submitButton = signupForm?.querySelector('[type="submit"]');
    let validation = '';
    if (name.length < 2) validation = 'Informe seu nome.';
    else validation = validateLogin(email, password);
    setMessage(signupMessage, validation);
    if (validation) return;
    setBusy(submitButton, true, 'Criando conta...');
    try {
      const data = await DB.signUp({ name, email, password });
      if (data.session) {
        await establishSession(data.session);
        signupDialog?.close();
        signupForm.reset();
      } else {
        setMessage(signupMessage, 'Conta criada. Confirme o e-mail enviado para concluir o cadastro.', 'success');
      }
    } catch (error) {
      setMessage(signupMessage, friendlyError(error));
    } finally {
      setBusy(submitButton, false);
    }
  };

  const logout = async () => {
    const button = $('#logoutButton');
    setBusy(button, true, 'Saindo...');
    try {
      await DB.signOut();
      showAnonymous();
      window.dispatchEvent(new CustomEvent('financas:logout'));
    } catch (error) {
      window.dispatchEvent(new CustomEvent('financas:toast', { detail: { message: friendlyError(error), type: 'error' } }));
    } finally {
      setBusy(button, false);
    }
  };

  const updateProfile = async (name) => {
    if (!state.user) throw new Error('Sessão não encontrada.');
    const normalizedName = normalizeName(name);
    if (normalizedName.length < 2) throw new Error('Informe um nome válido.');
    const profile = await DB.upsert('profiles', {
      id: state.user.id,
      name: normalizedName,
      email: state.user.email,
      theme: state.profile?.theme || defaultThemeForName(normalizedName),
      updated_at: new Date().toISOString()
    }, 'id');
    state.profile = profile;
    updateIdentity(state.user, profile);
    return profile;
  };

  const saveTheme = async (theme) => {
    if (!state.user) throw new Error('Sessão não encontrada.');
    if (!['rose', 'blue', 'system'].includes(theme)) throw new Error('Tema inválido.');
    applyTheme(theme);
    const [settings, profile] = await Promise.all([
      DB.upsert('settings', { user_id: state.user.id, theme, updated_at: new Date().toISOString() }, 'user_id'),
      DB.upsert('profiles', {
        id: state.user.id,
        name: state.profile?.name || state.user.email?.split('@')[0] || 'Usuário',
        email: state.user.email,
        theme,
        updated_at: new Date().toISOString()
      }, 'id')
    ]);
    state.profile = profile;
    return settings;
  };

  const bindEvents = () => {
    loginForm?.addEventListener('submit', handleLogin);
    signupForm?.addEventListener('submit', handleSignup);
    $('#openSignupButton')?.addEventListener('click', () => {
      setMessage(signupMessage);
      signupDialog?.showModal();
    });
    $('#logoutButton')?.addEventListener('click', logout);
    document.addEventListener('click', (event) => {
      const toggle = event.target.closest('[data-toggle-password]');
      if (toggle) {
        const input = document.getElementById(toggle.dataset.togglePassword);
        if (input) {
          const show = input.type === 'password';
          input.type = show ? 'text' : 'password';
          toggle.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
        }
      }
      const closer = event.target.closest('[data-close]');
      if (closer) document.getElementById(closer.dataset.close)?.close();
    });
  };

  const init = async () => {
    if (state.initialized) return;
    state.initialized = true;
    bindEvents();
    const cachedTheme = localStorage.getItem('financas-da-casa-v4:theme');
    if (cachedTheme) applyTheme(cachedTheme);
    if (!DB?.isConfigured) {
      showAnonymous();
      setMessage(authMessage, DB?.configurationErrors?.join(' ') || 'Configure o Supabase para iniciar.');
      loginButton.disabled = true;
      return;
    }
    try {
      const session = await DB.getSession();
      await establishSession(session);
      state.subscription = DB.onAuthStateChange(async (event, nextSession) => {
        if (event === 'SIGNED_OUT') showAnonymous();
        else if (nextSession && nextSession.access_token !== state.session?.access_token) await establishSession(nextSession);
      });
    } catch (error) {
      showAnonymous();
      setMessage(authMessage, friendlyError(error));
    }
  };

  window.FinancasAuth = Object.freeze({
    init,
    logout,
    updateProfile,
    saveTheme,
    applyTheme,
    getState: () => ({ ...state })
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
