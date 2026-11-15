'use strict';

(() => {
  const DB = window.FinancasDB;
  const Auth = window.FinancasAuth;
  const SCHOOL_GOAL = 2000;
  const TABLES = ['transactions', 'cards', 'school_fund', 'settings', 'profiles'];
  const CATEGORY_COLORS = ['#7c3aed', '#ec4899', '#1559a4', '#22a06b', '#f59e0b', '#06b6d4', '#ef4444', '#8b5cf6', '#64748b'];
  const state = {
    user: null,
    profile: null,
    transactions: [],
    cards: [],
    schoolFund: [],
    settings: [],
    realtime: null,
    categoriesChart: null,
    incomeExpenseChart: null,
    transactionType: 'todos',
    valuesHidden: false,
    deferredInstallPrompt: null,
    initialized: false,
    reloadTimer: null
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const dateFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const currency = (value) => state.valuesHidden ? '••••••' : money.format(Number(value) || 0);
  const today = () => new Date().toISOString().slice(0, 10);
  const currentMonth = () => today().slice(0, 7);
  const safeText = (value) => String(value ?? '').trim();
  const parseMoney = (value) => {
    const text = String(value || '').replace(/\s/g, '').replace(/R\$/gi, '');
    if (!text) return 0;
    const normalized = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text;
    const number = Number(normalized.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
  };
  const monthOf = (value) => safeText(value).slice(0, 7);
  const isIncome = (type) => ['receita', 'reembolso'].includes(safeText(type).toLowerCase());
  const isExpense = (type) => ['despesa', 'parcela'].includes(safeText(type).toLowerCase());
  const transactionDate = (item) => item.data || item.date || item.created_at || today();
  const transactionValue = (item) => Number(item.valor ?? item.value) || 0;
  const transactionType = (item) => safeText(item.tipo || item.type).toLowerCase();
  const transactionCategory = (item) => safeText(item.categoria || item.category || 'Outros');
  const transactionDescription = (item) => safeText(item.descricao || item.description || 'Movimentação');
  const cacheKey = (name) => `financas-da-casa-v4:cache:${name}`;

  const toast = (message, type = 'info') => {
    const container = $('#toastContainer');
    if (!container) return;
    const element = document.createElement('div');
    element.className = `toast ${type}`;
    element.textContent = message;
    container.append(element);
    setTimeout(() => element.remove(), 3600);
  };

  const cacheWrite = (name, data) => {
    try { localStorage.setItem(cacheKey(name), JSON.stringify(data)); } catch { /* armazenamento indisponível */ }
  };
  const cacheRead = (name) => {
    try { return JSON.parse(localStorage.getItem(cacheKey(name)) || '[]'); } catch { return []; }
  };

  const setView = (name) => {
    $$('.view').forEach((view) => {
      const active = view.dataset.view === name;
      view.hidden = !active;
      view.classList.toggle('active', active);
    });
    $$('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.target === name));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const formatDate = (value) => {
    try { return dateFormatter.format(new Date(`${safeText(value).slice(0, 10)}T12:00:00Z`)); }
    catch { return safeText(value); }
  };

  const monthTransactions = (month = $('#dashboardMonth')?.value || currentMonth()) =>
    state.transactions.filter((item) => monthOf(transactionDate(item)) === month);

  const getReserveValue = () => {
    const shared = state.settings.find((item) => item.key === 'reserve_total' || item.setting_key === 'reserve_total');
    const raw = shared?.value ?? shared?.setting_value ?? shared?.reserve_total ?? 0;
    if (typeof raw === 'object' && raw !== null) return Number(raw.total) || 0;
    return Number(raw) || 0;
  };

  const getSchoolCovered = (month) => state.schoolFund
    .filter((item) => !month || monthOf(item.data || item.date || item.created_at) === month)
    .reduce((sum, item) => sum + (Number(item.valor ?? item.value) || 0), 0);

  const calculateSummary = (items) => {
    const income = items.filter((item) => isIncome(transactionType(item))).reduce((sum, item) => sum + transactionValue(item), 0);
    const expense = items.filter((item) => isExpense(transactionType(item))).reduce((sum, item) => sum + transactionValue(item), 0);
    return { income, expense, balance: income - expense };
  };

  const setText = (selector, value) => { const element = $(selector); if (element) element.textContent = value; };

  const renderDashboard = () => {
    const month = $('#dashboardMonth')?.value || currentMonth();
    const items = monthTransactions(month);
    const summary = calculateSummary(items);
    const cardTotal = state.cards.reduce((sum, item) => sum + (Number(item.valor ?? item.value) || 0), 0);
    const schoolCovered = getSchoolCovered(month);
    const reserve = getReserveValue();
    setText('#projectedBalance', currency(summary.balance));
    setText('#incomeTotal', currency(summary.income));
    setText('#expenseTotal', currency(summary.expense));
    setText('#cardsTotal', currency(cardTotal));
    setText('#cardsCount', `${state.cards.length} ${state.cards.length === 1 ? 'lançamento' : 'lançamentos'}`);
    setText('#schoolSummary', currency(schoolCovered));
    setText('#schoolSummaryProgress', `${Math.min(100, Math.round((schoolCovered / SCHOOL_GOAL) * 100))}% da meta`);
    setText('#reserveSummary', currency(reserve));
    renderCharts(items);
    renderTransactionList('#recentTransactions', items.slice().sort(sortNewest).slice(0, 5), '#recentEmpty');
  };

  const renderPlanning = () => {
    const month = $('#dashboardMonth')?.value || currentMonth();
    const covered = getSchoolCovered(month);
    const missing = Math.max(0, SCHOOL_GOAL - covered);
    const percent = Math.min(100, (covered / SCHOOL_GOAL) * 100);
    const reserve = getReserveValue();
    setText('#schoolCovered', currency(covered));
    setText('#schoolMissing', currency(missing));
    setText('#schoolPercent', `${Math.round(percent)}%`);
    const progress = $('#schoolProgress');
    if (progress) progress.style.width = `${percent}%`;
    progress?.parentElement?.setAttribute('aria-valuenow', String(Math.round(percent)));
    setText('#reserveTotal', currency(reserve));
    setText('#reserve75', currency(reserve * .75));
    setText('#reserve15', currency(reserve * .15));
    setText('#reserve10', currency(reserve * .10));
  };

  const sortNewest = (a, b) => new Date(transactionDate(b)) - new Date(transactionDate(a));

  const filteredTransactions = () => {
    const search = safeText($('#transactionSearch')?.value).toLocaleLowerCase('pt-BR');
    const month = $('#transactionsMonth')?.value || '';
    const category = $('#categoryFilter')?.value || 'todas';
    return state.transactions.filter((item) => {
      const type = transactionType(item);
      const textMatches = !search || `${transactionDescription(item)} ${transactionCategory(item)}`.toLocaleLowerCase('pt-BR').includes(search);
      const monthMatches = !month || monthOf(transactionDate(item)) === month;
      const categoryMatches = category === 'todas' || transactionCategory(item) === category;
      const typeMatches = state.transactionType === 'todos' || type === state.transactionType;
      return textMatches && monthMatches && categoryMatches && typeMatches;
    }).sort(sortNewest);
  };

  const renderTransactions = () => renderTransactionList('#transactionsList', filteredTransactions(), '#transactionsEmpty');

  const iconFor = (item) => {
    const type = transactionType(item);
    if (type === 'receita') return '↑';
    if (type === 'reembolso') return '↺';
    if (type === 'parcela') return '▤';
    return '↓';
  };

  const renderTransactionList = (selector, items, emptySelector) => {
    const container = $(selector);
    const empty = $(emptySelector);
    const template = $('#transactionTemplate');
    if (!container || !template) return;
    container.replaceChildren();
    empty && (empty.hidden = items.length > 0);
    items.forEach((item) => {
      const fragment = template.content.cloneNode(true);
      const article = $('.transaction-item', fragment);
      const type = transactionType(item);
      article.classList.add(isIncome(type) ? 'income' : 'expense');
      article.dataset.id = item.id;
      $('.transaction-icon', fragment).textContent = iconFor(item);
      $('.transaction-description', fragment).textContent = transactionDescription(item);
      $('.transaction-meta', fragment).textContent = `${transactionCategory(item)} • ${formatDate(transactionDate(item))}`;
      const sign = isIncome(type) ? '+' : '-';
      $('.transaction-value', fragment).textContent = `${sign} ${currency(transactionValue(item))}`;
      const action = $('.transaction-actions', fragment);
      action.dataset.id = item.id;
      action.addEventListener('click', () => deleteTransaction(item));
      container.append(fragment);
    });
  };

  const chartColors = () => ({
    text: getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || '#746e80',
    grid: getComputedStyle(document.documentElement).getPropertyValue('--border').trim() || 'rgba(55,40,79,.1)',
    primary: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#7c3aed',
    success: getComputedStyle(document.documentElement).getPropertyValue('--success').trim() || '#149b6c',
    danger: getComputedStyle(document.documentElement).getPropertyValue('--danger').trim() || '#dc3654'
  });

  const renderCharts = (items) => {
    if (!window.Chart) return;
    const colors = chartColors();
    const expenses = items.filter((item) => isExpense(transactionType(item)));
    const grouped = expenses.reduce((acc, item) => {
      const category = transactionCategory(item);
      acc[category] = (acc[category] || 0) + transactionValue(item);
      return acc;
    }, {});
    const labels = Object.keys(grouped);
    const values = Object.values(grouped);
    state.categoriesChart?.destroy();
    state.incomeExpenseChart?.destroy();
    const categoryCanvas = $('#categoriesChart');
    if (categoryCanvas) state.categoriesChart = new Chart(categoryCanvas, {
      type: 'doughnut',
      data: { labels: labels.length ? labels : ['Sem despesas'], datasets: [{ data: values.length ? values : [1], backgroundColor: values.length ? CATEGORY_COLORS.slice(0, values.length) : [colors.grid], borderWidth: 0, hoverOffset: 5 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '68%', plugins: { legend: { position: 'bottom', labels: { color: colors.text, usePointStyle: true, padding: 16 } }, tooltip: { callbacks: { label: (context) => values.length ? `${context.label}: ${money.format(context.raw)}` : 'Sem despesas' } } } }
    });
    const summary = calculateSummary(items);
    const comparisonCanvas = $('#incomeExpenseChart');
    if (comparisonCanvas) state.incomeExpenseChart = new Chart(comparisonCanvas, {
      type: 'bar',
      data: { labels: ['Receitas', 'Despesas'], datasets: [{ data: [summary.income, summary.expense], backgroundColor: [colors.success, colors.danger], borderRadius: 10, maxBarThickness: 76 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (context) => money.format(context.raw) } } }, scales: { x: { grid: { display: false }, ticks: { color: colors.text } }, y: { beginAtZero: true, grid: { color: colors.grid }, ticks: { color: colors.text, callback: (value) => money.format(value) } } } }
    });
  };

  const renderAll = () => {
    renderDashboard();
    renderTransactions();
    renderPlanning();
  };

  const loadData = async ({ quiet = false } = {}) => {
    if (!state.user) return;
    try {
      const [transactions, cards, schoolFund, settings] = await Promise.all([
        DB.queryAll('transactions', { orderBy: 'data', ascending: false }),
        DB.queryAll('cards', { orderBy: 'created_at', ascending: false }),
        DB.queryAll('school_fund', { orderBy: 'data', ascending: false }),
        DB.queryAll('settings', { orderBy: 'updated_at', ascending: false })
      ]);
      Object.assign(state, { transactions, cards, schoolFund, settings });
      cacheWrite('transactions', transactions);
      cacheWrite('cards', cards);
      cacheWrite('school_fund', schoolFund);
      cacheWrite('settings', settings);
      renderAll();
    } catch (error) {
      state.transactions = cacheRead('transactions');
      state.cards = cacheRead('cards');
      state.schoolFund = cacheRead('school_fund');
      state.settings = cacheRead('settings');
      renderAll();
      if (!quiet) toast(error.message || 'Dados locais exibidos.', 'error');
    }
  };

  const openEntry = (type = 'receita') => {
    const dialog = $('#entryDialog');
    const form = $('#entryForm');
    form?.reset();
    $('#entryDate').value = today();
    selectEntryType(type);
    dialog?.showModal();
  };

  const selectEntryType = (type) => {
    $('#entryType').value = type;
    $$('#entryTypes [data-entry]').forEach((button) => button.classList.toggle('active', button.dataset.entry === type));
    const installment = type === 'parcela';
    const school = type === 'escola';
    $('#installmentFields').hidden = !installment;
    $('#cardNameField').hidden = !installment;
    $('#categoryField').hidden = school;
    $('#entryCategory').required = !school;
    if (installment) $('#entryCategory').value = 'Cartões';
    if (school) $('#entryCategory').value = 'Educação';
  };

  const saveEntry = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('[type="submit"]');
    const type = $('#entryType').value;
    const description = safeText($('#entryDescription').value);
    const value = parseMoney($('#entryValue').value);
    const date = $('#entryDate').value;
    const category = type === 'escola' ? 'Educação' : $('#entryCategory').value;
    if (!description || value <= 0 || !date || !category) return toast('Preencha todos os campos obrigatórios.', 'error');
    button.disabled = true;
    try {
      if (type === 'escola') {
        await DB.insert('school_fund', { valor: value, data: date, descricao: description, user_id: state.user.id, usuario: state.profile?.name || state.user.email });
      } else if (type === 'parcela') {
        const card = await DB.insert('cards', {
          nome: safeText($('#cardName').value) || 'Cartão', descricao: description, valor: value,
          parcela_atual: Number($('#currentInstallment').value) || 1,
          total_parcelas: Number($('#totalInstallments').value) || 1,
          user_id: state.user.id, usuario: state.profile?.name || state.user.email
        });
        await DB.insert('transactions', { tipo: 'parcela', descricao: description, categoria: 'Cartões', valor: value, data: date, usuario: state.profile?.name || state.user.email, user_id: state.user.id, card_id: card.id });
      } else {
        await DB.insert('transactions', { tipo: type, descricao: description, categoria: category, valor: value, data: date, usuario: state.profile?.name || state.user.email, user_id: state.user.id });
      }
      $('#entryDialog').close();
      await loadData({ quiet: true });
      toast('Movimentação salva com sucesso.', 'success');
    } catch (error) { toast(error.message, 'error'); }
    finally { button.disabled = false; }
  };

  const saveReserve = async (event) => {
    event.preventDefault();
    const value = parseMoney($('#reserveValue').value);
    if (value < 0) return toast('Informe um valor válido.', 'error');
    const button = event.currentTarget.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      await DB.upsert('settings', { user_id: state.user.id, key: 'reserve_total', value, updated_at: new Date().toISOString() }, 'user_id,key');
      $('#reserveDialog').close();
      await loadData({ quiet: true });
      toast('Reserva atualizada.', 'success');
    } catch (error) { toast(error.message, 'error'); }
    finally { button.disabled = false; }
  };

  const deleteTransaction = async (item) => {
    if (!confirm(`Excluir “${transactionDescription(item)}”?`)) return;
    try {
      await DB.remove('transactions', item.id);
      state.transactions = state.transactions.filter((entry) => entry.id !== item.id);
      renderAll();
      toast('Transação excluída.', 'success');
    } catch (error) { toast(error.message, 'error'); }
  };

  const subscribeRealtime = () => {
    if (state.realtime) DB.unsubscribe(state.realtime);
    state.realtime = DB.subscribe('financas-da-casa-v4-shared', TABLES, () => {
      clearTimeout(state.reloadTimer);
      state.reloadTimer = setTimeout(() => loadData({ quiet: true }), 180);
    }, (status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') toast('Sincronização em tempo real temporariamente indisponível.', 'error');
    });
  };

  const bindEvents = () => {
    $$('.nav-item[data-target]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.target)));
    $$('[data-go]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.go)));
    $('#addButton')?.addEventListener('click', () => openEntry());
    $$('[data-entry-type]').forEach((button) => button.addEventListener('click', () => openEntry(button.dataset.entryType)));
    $$('#entryTypes [data-entry]').forEach((button) => button.addEventListener('click', () => selectEntryType(button.dataset.entry)));
    $('#entryForm')?.addEventListener('submit', saveEntry);
    $('#reserveForm')?.addEventListener('submit', saveReserve);
    $('#openReserveButton')?.addEventListener('click', () => { $('#reserveValue').value = getReserveValue().toFixed(2).replace('.', ','); $('#reserveDialog').showModal(); });
    $('#dashboardMonth')?.addEventListener('change', () => { renderDashboard(); renderPlanning(); });
    $('#transactionSearch')?.addEventListener('input', renderTransactions);
    $('#transactionsMonth')?.addEventListener('change', renderTransactions);
    $('#categoryFilter')?.addEventListener('change', renderTransactions);
    $$('.chip[data-type]').forEach((button) => button.addEventListener('click', () => {
      state.transactionType = button.dataset.type;
      $$('.chip[data-type]').forEach((chip) => chip.classList.toggle('active', chip === button));
      renderTransactions();
    }));
    $('#toggleValues')?.addEventListener('click', () => { state.valuesHidden = !state.valuesHidden; renderAll(); });
    $('#openThemeButton')?.addEventListener('click', () => $('#themeDialog').showModal());
    $$('#themeDialog [data-theme]').forEach((button) => button.addEventListener('click', async () => {
      try { await Auth.saveTheme(button.dataset.theme); $('#themeDialog').close(); renderAll(); toast('Tema atualizado.', 'success'); }
      catch (error) { toast(error.message, 'error'); }
    }));
    $('#editProfileButton')?.addEventListener('click', () => $('#profileDialog').showModal());
    $('#profileForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      try { state.profile = await Auth.updateProfile($('#profileNameInput').value); $('#profileDialog').close(); toast('Perfil atualizado.', 'success'); }
      catch (error) { toast(error.message, 'error'); }
    });
    window.addEventListener('online', () => { $('#offlineBanner').hidden = true; loadData({ quiet: true }); });
    window.addEventListener('offline', () => { $('#offlineBanner').hidden = false; });
    window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); state.deferredInstallPrompt = event; $('#installButton').hidden = false; });
    $('#installButton')?.addEventListener('click', async () => {
      if (!state.deferredInstallPrompt) return;
      state.deferredInstallPrompt.prompt();
      await state.deferredInstallPrompt.userChoice;
      state.deferredInstallPrompt = null;
      $('#installButton').hidden = true;
    });
    window.addEventListener('financas:toast', (event) => toast(event.detail?.message || '', event.detail?.type));
    window.addEventListener('financas:logout', () => { if (state.realtime) DB.unsubscribe(state.realtime); state.user = null; });
  };

  const registerServiceWorker = () => {
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('./service-worker.js', { scope: './' }).catch(() => {});
    }
  };

  const onSession = async (detail) => {
    if (!detail?.user) return;
    state.user = detail.user;
    state.profile = detail.profile;
    $('#dashboardMonth').value ||= currentMonth();
    $('#transactionsMonth').value ||= currentMonth();
    $('#entryDate').value ||= today();
    await loadData();
    subscribeRealtime();
  };

  const init = () => {
    if (state.initialized) return;
    state.initialized = true;
    bindEvents();
    registerServiceWorker();
    $('#offlineBanner').hidden = navigator.onLine;
    $('#dashboardMonth').value = currentMonth();
    $('#transactionsMonth').value = currentMonth();
    $('#entryDate').value = today();
    window.addEventListener('financas:session', (event) => onSession(event.detail));
    const authState = Auth?.getState?.();
    if (authState?.user) onSession({ user: authState.user, profile: authState.profile });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
