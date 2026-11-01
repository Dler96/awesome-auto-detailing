/* Awesome Auto Detailing — shared site core.
   Every page loads this first. It draws the header/footer, connects to
   Supabase, restores the login session and loads the service catalogue.
   All security is enforced by Supabase row-level security and database
   functions; nothing here is trusted by the server. */
(() => {
  'use strict';

  const cfg = window.SITE_CONFIG || {};
  const TZ = 'Asia/Kuala_Lumpur';
  const USER_DOMAIN = 'accounts.awesomeauto.invalid';
  const BRAND = cfg.businessName || 'Awesome Auto Detailing';

  // ------------------------------------------------------------------
  // DOM helpers
  // ------------------------------------------------------------------
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'hidden', 'required', 'multiple']);

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;            // static, trusted markup only
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (PROPS.has(k)) el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : String(c));
    }
    return el;
  }

  const ICONS = {
    car: '<path d="M5 17h14M3 13l2-5a2 2 0 0 1 2-1h10a2 2 0 0 1 2 1l2 5v4a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-1H7v1a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><circle cx="7.5" cy="13.5" r="1"/><circle cx="16.5" cy="13.5" r="1"/>',
    sparkle: '<path d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6z"/><path d="M19 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    wallet: '<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18M16 15h2"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
    pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    drop: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
    bay: '<path d="M3 21V9l9-5 9 5v12"/><path d="M7 21v-7h10v7"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    whatsapp: '<path d="M4 20l1.3-4A8 8 0 1 1 8 18.7z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 .8a4 4 0 0 1-1.8-1.8l.8-1-1-2z"/>',
    receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.3l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2.2-1.3L14 3h-4l-.3 2.4a7 7 0 0 0-2.2 1.3l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2.6l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2.2 1.3L10 21h4l.3-2.4a7 7 0 0 0 2.2-1.3l2.4 1 2-3.4-2-1.6c.1-.4.1-.9.1-1.3z"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/>',
    list: '<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
    tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/>',
    logout: '<path d="M9 4H4v16h5M9 12h12M16 7l5 5-5 5"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M4 20h16"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
    edit: '<path d="M4 20h4L20 8l-4-4L4 16z"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    star: '<path d="M12 3l2.8 5.8 6.2.9-4.5 4.4 1 6.3L12 17.5 6.5 20.4l1-6.3L3 9.7l6.2-.9z"/>'
  };
  function icon(name, cls = '') {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('class', 'ico ' + cls);
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = ICONS[name] || '';
    return s;
  }

  // ------------------------------------------------------------------
  // Formatting (always Malaysia time)
  // ------------------------------------------------------------------
  const money = cents => {
    const rm = (Number(cents) || 0) / 100;
    return 'RM' + (Number.isInteger(rm) ? rm.toLocaleString('en-MY') : rm.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  };
  const duration = mins => {
    const hrs = Math.floor(mins / 60), m = mins % 60;
    return hrs && m ? `${hrs}h ${m}m` : hrs ? `${hrs} hr${hrs > 1 ? 's' : ''}` : `${m} min`;
  };
  const todayKL = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
  const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const fmtDate = (iso, opts = { weekday: 'short', day: 'numeric', month: 'short' }) =>
    new Date(iso + 'T00:00:00Z').toLocaleDateString('en-MY', { timeZone: 'UTC', ...opts });
  const fmtTime = t => {
    const [hh, mm] = String(t).split(':').map(Number);
    return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;
  };
  const klParts = ts => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(ts)).map(x => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
  };
  const fmtStamp = (ts, opts) => {
    const p = klParts(ts);
    return `${fmtDate(p.date, opts)} · ${fmtTime(p.time)}`;
  };
  const STATUS = {
    pending: ['Awaiting confirmation', 'amber'], confirmed: ['Confirmed', 'green'], in_progress: ['In progress', 'blue'],
    completed: ['Completed', 'grey'], cancelled: ['Cancelled', 'red'], no_show: ['No-show', 'red']
  };
  const PAY = { unpaid: ['Unpaid', 'grey'], submitted: ['Receipt submitted', 'amber'], paid: ['Paid', 'green'], refunded: ['Refunded', 'blue'] };
  const badge = (map, key) => h('span', { class: `badge badge-${(map[key] || [key, 'grey'])[1]}`, text: (map[key] || [key])[0] });

  const waNumber = phone => {
    const d = String(phone || '').replace(/\D/g, '');
    const intl = d.startsWith('0') ? '60' + d.slice(1) : d;
    return /^[1-9]\d{7,14}$/.test(intl) ? intl : null;
  };
  const waLink = (phone, text) => { const n = waNumber(phone); return n ? `https://wa.me/${n}?text=${encodeURIComponent(text || '')}` : null; };
  const shopWa = text => cfg.whatsapp && !String(cfg.whatsapp).includes('REPLACE') ? waLink(cfg.whatsapp, text) : null;

  // ------------------------------------------------------------------
  // Feedback: toasts, top loading bar, busy buttons, dialogs
  // ------------------------------------------------------------------
  function toast(msg, type = 'ok', ms = 4200) {
    let host = $('#toasts');
    if (!host) { host = h('div', { id: 'toasts', 'aria-live': 'polite' }); document.body.append(host); }
    const t = h('div', { class: `toast toast-${type}`, role: type === 'error' ? 'alert' : 'status' }, icon(type === 'error' ? 'x' : 'check'), h('span', { text: msg }));
    host.append(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, ms);
  }
  const errMsg = e => (e && (e.message || e.error_description || e.details)) || 'Something went wrong. Please try again.';
  let loadingCount = 0;
  function loading(on) {
    loadingCount = Math.max(0, loadingCount + (on ? 1 : -1));
    document.documentElement.classList.toggle('is-loading', loadingCount > 0);
  }
  async function run(fn, btn) {
    const btns = btn ? (btn instanceof HTMLFormElement ? $$('button', btn) : [btn]) : [];
    const prev = btns.map(b => b.disabled);
    btns.forEach(b => { b.disabled = true; });
    if (btn && !(btn instanceof HTMLFormElement)) btn.classList.add('is-busy');
    else if (btn) { const sub = $('button[type=submit],button:not([type])', btn); sub && sub.classList.add('is-busy'); }
    loading(true);
    try { return await fn(); }
    catch (e) { console.error(e); toast(errMsg(e), 'error', 6500); }
    finally {
      loading(false);
      btns.forEach((b, i) => { b.disabled = prev[i]; b.classList.remove('is-busy'); });
    }
  }
  const check = res => { if (res.error) throw res.error; return res.data; };

  function modal(title, body, { wide = false, onClose } = {}) {
    const close = () => { dlg.close(); };
    const dlg = h('dialog', { class: 'modal' + (wide ? ' modal-wide' : '') },
      h('div', { class: 'modal-head' }, h('h3', { text: title }), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: close }, icon('x'))),
      h('div', { class: 'modal-body' }, body));
    dlg.addEventListener('close', () => { dlg.remove(); onClose && onClose(); });
    dlg.addEventListener('click', e => { if (e.target === dlg) close(); });
    document.body.append(dlg);
    dlg.showModal();
    return { dialog: dlg, close };
  }
  function confirmBox(title, text, okLabel = 'Confirm', danger = false) {
    return new Promise(resolve => {
      let answered = false;
      const m = modal(title, h('div', {},
        h('p', { class: 'muted', text }),
        h('div', { class: 'row-end' },
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => m.close() }, 'Go back'),
          h('button', { class: 'btn ' + (danger ? 'btn-danger' : 'btn-primary'), type: 'button', onclick: () => { answered = true; m.close(); resolve(true); } }, okLabel))),
        { onClose: () => { if (!answered) resolve(false); } });
    });
  }

  // ------------------------------------------------------------------
  // Supabase connection, session and role
  // ------------------------------------------------------------------
  const configured = cfg.supabaseUrl && !cfg.supabaseUrl.includes('YOUR_PROJECT') && cfg.supabaseKey && !cfg.supabaseKey.includes('YOUR_PUBLIC');
  let db = null;
  const state = { user: null, profile: null, admin: false, catalog: null };

  async function initAuth() {
    const { data } = await db.auth.getSession();
    state.user = data.session?.user || null;
    if (!state.user) return;
    const [profile, admin] = await Promise.all([
      db.from('profiles').select('*').eq('id', state.user.id).maybeSingle(),
      db.rpc('is_shop_admin')
    ]);
    state.profile = profile.data || null;
    state.admin = !!admin.data;
  }
  const displayName = () => state.profile?.full_name || state.profile?.username ||
    (state.user?.email?.endsWith('@' + USER_DOMAIN) ? state.user.email.split('@')[0] : state.user?.email) || 'Account';

  // ------------------------------------------------------------------
  // Catalogue (cached briefly so moving between pages feels instant)
  // ------------------------------------------------------------------
  const CACHE_KEY = 'aad-catalog-v1';
  async function loadCatalog(fresh = false) {
    if (!fresh && !state.admin) {
      try {
        const c = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
        if (c && Date.now() - c.at < 60000) return hydrate(c.data);
      } catch { /* ignore broken cache */ }
    }
    const today = todayKL();
    const [settings, hours, closed, types, services, prices, promos] = await Promise.all([
      db.from('business_settings').select('*').eq('id', 1).single(),
      db.from('opening_hours').select('*').order('weekday'),
      db.from('closed_dates').select('*').gte('day', today).order('day'),
      db.from('vehicle_types').select('*').order('sort_order').order('name'),
      db.from('services').select('*').order('sort_order').order('name'),
      db.from('service_prices').select('*'),
      db.from('promotions').select('*').order('sort_order').order('created_at', { ascending: false })
    ]);
    const data = {
      settings: check(settings), hours: check(hours), closed: check(closed), types: check(types),
      services: check(services), prices: check(prices), promos: check(promos)
    };
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data })); } catch { /* storage full */ }
    return hydrate(data);
  }
  function hydrate(d) {
    const priceMap = new Map(d.prices.map(p => [p.service_id + '|' + p.vehicle_type_id, p.price_cents]));
    const activeTypes = d.types.filter(t => t.active);
    const cat = {
      ...d, priceMap, activeTypes,
      packages: d.services.filter(s => s.kind === 'package' && s.active),
      addons: d.services.filter(s => s.kind === 'addon' && s.active),
      price: (sid, tid) => priceMap.has(sid + '|' + tid) ? priceMap.get(sid + '|' + tid) : null,
      fromPrice(sid) {
        const list = activeTypes.map(t => cat.price(sid, t.id)).filter(v => v != null);
        return list.length ? Math.min(...list) : null;
      },
      service: id => d.services.find(s => s.id === id),
      type: id => d.types.find(t => t.id === id)
    };
    state.catalog = cat;
    return cat;
  }
  const clearCatalogCache = () => { try { sessionStorage.removeItem(CACHE_KEY); } catch { /* ignore */ } };
  const imageUrl = path => path ? db.storage.from('site-images').getPublicUrl(path).data.publicUrl : null;
  async function uploadImage(file, folder) {
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type];
    if (!ext || file.size > 5 * 1024 * 1024) throw new Error('Choose a JPG, PNG or WebP image up to 5 MB.');
    const path = `${folder}/${crypto.randomUUID()}.${ext}`;
    check(await db.storage.from('site-images').upload(path, file, { contentType: file.type, upsert: false }));
    return path;
  }
  async function uploadReceipt(file, scopeId) {
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file?.type];
    if (!ext || file.size > 5 * 1024 * 1024) throw new Error('Upload your receipt as a JPG, PNG or WebP image up to 5 MB.');
    const path = `${state.user.id}/${scopeId}/${crypto.randomUUID()}.${ext}`;
    check(await db.storage.from('payment-receipts').upload(path, file, { contentType: file.type, upsert: false }));
    return path;
  }
  async function receiptUrl(path) {
    return check(await db.storage.from('payment-receipts').createSignedUrl(path, 600)).signedUrl;
  }

  // ------------------------------------------------------------------
  // Opening-hours helpers
  // ------------------------------------------------------------------
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  function hoursSummary(hours) {
    // Groups consecutive days with identical hours: "Mon – Sat · 9:00 AM – 6:00 PM"
    const order = [1, 2, 3, 4, 5, 6, 0];
    const label = d => { const r = hours.find(x => x.weekday === d); return r && r.is_open ? `${fmtTime(r.open_time)} – ${fmtTime(r.close_time)}` : 'Closed'; };
    const groups = [];
    for (const d of order) {
      const l = label(d), last = groups[groups.length - 1];
      if (last && last.label === l) last.days.push(d); else groups.push({ label: l, days: [d] });
    }
    return groups.map(g => ({
      days: g.days.length === 1 ? DAYS[g.days[0]].slice(0, 3) : `${DAYS[g.days[0]].slice(0, 3)} – ${DAYS[g.days[g.days.length - 1]].slice(0, 3)}`,
      label: g.label
    }));
  }
  function openNow(hours, closed) {
    const now = klParts(new Date());
    if (closed?.some(c => c.day === now.date)) return false;
    const r = hours.find(x => x.weekday === new Date(now.date + 'T00:00:00Z').getUTCDay());
    return !!(r && r.is_open && now.time >= r.open_time.slice(0, 5) && now.time < r.close_time.slice(0, 5));
  }

  // ------------------------------------------------------------------
  // Site chrome: header, mobile menu, footer, floating WhatsApp
  // ------------------------------------------------------------------
  const page = () => document.body.dataset.page || '';
  function navLinks() {
    const links = [['/', 'Home', 'home'], ['/services', 'Services & Prices', 'services'], ['/availability', 'Availability', 'availability']];
    if (state.user) links.push(['/my-bookings', 'My Bookings', 'my-bookings']);
    if (state.admin) links.push(['/admin', 'Admin', 'admin']);
    return links.map(([href, label, key]) => h('a', { href, class: 'nav-link', 'aria-current': page() === key ? 'page' : null }, label));
  }
  function renderHeader() {
    const host = $('#site-header');
    if (!host) return;
    const account = state.user
      ? h('a', { class: 'nav-account', href: '/account', 'aria-current': page() === 'account' ? 'page' : null }, icon('user'), h('span', { text: displayName() }))
      : h('a', { class: 'nav-account', href: '/account' }, icon('user'), h('span', { text: 'Log in' }));
    const menuBtn = h('button', { class: 'icon-btn nav-toggle', type: 'button', 'aria-label': 'Open menu', 'aria-expanded': 'false' }, icon('menu'));
    const header = h('header', { class: 'site-header' },
      h('div', { class: 'wrap header-inner' },
        h('a', { class: 'brand', href: '/', 'aria-label': BRAND + ' home' }, h('img', { src: '/assets/logo-sm.webp', alt: BRAND, width: '210', height: '58' })),
        h('nav', { class: 'nav', 'aria-label': 'Main' }, navLinks()),
        h('div', { class: 'header-actions' }, account, h('a', { class: 'btn btn-primary btn-sm', href: '/book' }, 'Book now'), menuBtn)));
    const drawer = h('div', { class: 'drawer', hidden: true },
      h('nav', { 'aria-label': 'Mobile' }, navLinks(), h('a', { class: 'nav-link', href: '/account' }, state.user ? 'My account' : 'Log in / Register')),
      h('a', { class: 'btn btn-primary btn-block', href: '/book' }, 'Book a slot'));
    menuBtn.addEventListener('click', () => {
      const open = drawer.hidden;
      drawer.hidden = !open;
      menuBtn.setAttribute('aria-expanded', String(open));
      menuBtn.replaceChildren(icon(open ? 'x' : 'menu'));
      document.body.classList.toggle('menu-open', open);
    });
    host.replaceChildren(header, drawer);
    renderTabbar();
    const onScroll = () => header.classList.toggle('scrolled', scrollY > 8);
    addEventListener('scroll', onScroll, { passive: true }); onScroll();
  }
  // Phone-style bottom tab bar (shown on small screens only, via CSS).
  function renderTabbar() {
    let bar = $('#tabbar');
    if (!bar) { bar = h('nav', { id: 'tabbar', class: 'tabbar', 'aria-label': 'Quick navigation' }); document.body.append(bar); }
    const p = page();
    const tab = (href, label, ic, key) => h('a', { href, 'aria-current': p === key ? 'page' : null }, icon(ic), h('span', { text: label }));
    bar.replaceChildren(
      tab('/', 'Home', 'bay', 'home'),
      tab('/services', 'Prices', 'tag', 'services'),
      h('a', { href: '/book', class: 'tab-book', 'aria-current': p === 'book' ? 'page' : null }, h('span', { class: 'bubble' }, icon('plus')), h('span', { text: 'Book' })),
      state.admin ? tab('/admin', 'Admin', 'settings', 'admin') : tab('/availability', 'Slots', 'calendar', 'availability'),
      state.user ? tab('/my-bookings', 'Bookings', 'list', 'my-bookings') : tab('/account', 'Log in', 'user', 'account'));
  }

  function renderFooter() {
    const host = $('#site-footer');
    if (!host) return;
    const cat = state.catalog;
    const social = [['instagram', 'Instagram'], ['tiktok', 'TikTok'], ['facebook', 'Facebook']]
      .filter(([k]) => cfg[k] && /^https:\/\//.test(cfg[k])).map(([k, l]) => h('a', { href: cfg[k], target: '_blank', rel: 'noopener' }, l));
    const wa = shopWa(`Hi ${BRAND}, I have a question.`);
    host.replaceChildren(h('footer', { class: 'site-footer' },
      h('div', { class: 'wrap footer-grid' },
        h('div', { class: 'footer-brand' },
          h('img', { src: '/assets/logo-sm.webp', alt: BRAND, width: '210', height: '58', loading: 'lazy' }),
          h('p', { class: 'muted', text: 'Professional car wash, interior and paint detailing. Book your bay online and drive in on time.' }),
          social.length ? h('div', { class: 'footer-social' }, social) : null),
        h('div', {}, h('h4', { text: 'Explore' }),
          h('a', { href: '/services' }, 'Services & prices'), h('a', { href: '/availability' }, 'Check availability'),
          h('a', { href: '/book' }, 'Book a slot'), h('a', { href: '/my-bookings' }, 'My bookings')),
        h('div', {}, h('h4', { text: 'Opening hours' }),
          cat ? hoursSummary(cat.hours).map(g => h('p', { class: 'hours-line' }, h('span', { text: g.days }), h('span', { text: g.label }))) : h('p', { class: 'muted', text: '—' })),
        h('div', {}, h('h4', { text: 'Visit us' }),
          cat?.settings.address ? h('p', { class: 'muted pre', text: cat.settings.address }) : null,
          cat?.settings.maps_url ? h('a', { href: cat.settings.maps_url, target: '_blank', rel: 'noopener' }, 'Get directions →') : null,
          wa ? h('a', { href: wa, target: '_blank', rel: 'noopener' }, 'WhatsApp us →') : null)),
      h('div', { class: 'wrap footer-base' },
        h('span', { text: `© ${new Date().getFullYear()} ${BRAND}` }),
        h('span', { text: cfg.ownerLine || '' }))));
  }
  function renderFloatingWa() {
    const wa = shopWa(`Hi ${BRAND}! I'd like to ask about detailing.`);
    if (!wa || $('.wa-float') || ['admin'].includes(page())) return;
    document.body.append(h('a', { class: 'wa-float', href: wa, target: '_blank', rel: 'noopener', 'aria-label': 'Chat on WhatsApp' }, icon('whatsapp')));
  }

  // Sections fade up as they scroll into view.
  let revealObserver;
  function reveal(root = document) {
    const els = $$('.reveal:not(.in)', root);
    if (!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) { els.forEach(e => e.classList.add('in')); return; }
    revealObserver = revealObserver || new IntersectionObserver(entries => {
      entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); revealObserver.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    els.forEach(e => revealObserver.observe(e));
  }

  // Prefetch internal pages on hover so the next page opens instantly.
  const prefetched = new Set();
  document.addEventListener('pointerover', e => {
    const a = e.target.closest && e.target.closest('a[href^="/"]');
    if (!a) return;
    const url = a.getAttribute('href').split('#')[0].split('?')[0];
    if (!url || prefetched.has(url) || url === location.pathname) return;
    prefetched.add(url);
    document.head.append(h('link', { rel: 'prefetch', href: url }));
  }, { passive: true });

  function setupBanner() {
    const main = $('#main');
    if (main) main.prepend(h('div', { class: 'wrap' }, h('div', { class: 'notice notice-warn' },
      h('strong', { text: 'Setup needed. ' }),
      'Open config.js and add your Supabase project URL and publishable key, then run database/01-setup.sql. See README.md.')));
  }

  // ------------------------------------------------------------------
  // Page boot
  // ------------------------------------------------------------------
  function start(pageFn, opts = {}) {
    const go = async () => {
      renderHeader(); renderFooter(); reveal();
      if (!configured) { setupBanner(); document.body.classList.add('ready'); return; }
      if (!window.supabase) { toast('Could not connect. Check your internet and refresh.', 'error', 10000); return; }
      db = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);
      api.db = db;
      loading(true);
      try {
        await initAuth();
        renderHeader();
        if ((opts.requireAuth || opts.requireAdmin) && !state.user) {
          location.replace('/account?next=' + encodeURIComponent(location.pathname + location.search));
          return;
        }
        if (opts.requireAdmin && !state.admin) {
          $('#main').replaceChildren(h('section', { class: 'wrap page-pad' }, h('div', { class: 'empty' },
            h('h2', { text: 'Admins only' }), h('p', { class: 'muted', text: 'This account does not have admin access.' }), h('a', { class: 'btn btn-primary', href: '/' }, 'Back to home'))));
          return;
        }
        if (opts.catalog !== false) { await loadCatalog(opts.freshCatalog); renderFooter(); }
        await pageFn(state);
        reveal();
      } catch (e) {
        console.error(e);
        toast(errMsg(e), 'error', 8000);
      } finally {
        loading(false);
        document.body.classList.add('ready');
        renderFloatingWa();
      }
      db.auth.onAuthStateChange(ev => {
        if (ev === 'SIGNED_OUT' && state.user && !api.signingOut) location.href = '/';
      });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
  }

  // Calendar file + WhatsApp text for a booking.
  function downloadIcs(b) {
    const stamp = ts => new Date(ts).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const esc = s => String(s || '').replace(/[\\,;]/g, m => '\\' + m).replace(/\n/g, '\\n');
    const items = (b.booking_items || []).map(i => i.service_name).join(', ');
    const where = state.catalog?.settings.address || BRAND;
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Awesome Auto Detailing//Booking//EN', 'BEGIN:VEVENT',
      `UID:${b.id}@awesomeautodetailing`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(b.start_at)}`, `DTEND:${stamp(b.end_at)}`,
      `SUMMARY:${esc(BRAND + ' · ' + b.code)}`, `DESCRIPTION:${esc(`${items}\nCar: ${b.plate} ${b.make_model}\nTotal: ${money(b.total_cents)}`)}`,
      `LOCATION:${esc(where)}`, 'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', 'DESCRIPTION:Detailing appointment', 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const a = h('a', { href: URL.createObjectURL(new Blob([ics], { type: 'text/calendar' })), download: `${b.code}.ics` });
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function bookingSummaryText(b) {
    const p = klParts(b.start_at);
    return `${b.code} · ${fmtDate(p.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} ${fmtTime(p.time)} · ${b.plate} (${b.make_model})`;
  }

  async function signOut() {
    api.signingOut = true;
    clearCatalogCache();
    try { sessionStorage.removeItem('aad-draft'); } catch { /* ignore */ }
    await db.auth.signOut();
    location.href = '/';
  }

  const api = {
    cfg, BRAND, TZ, USER_DOMAIN, state, db,
    $, $$, h, icon, money, duration, todayKL, addDays, fmtDate, fmtTime, klParts, fmtStamp,
    STATUS, PAY, badge, waNumber, waLink, shopWa, toast, errMsg, loading, run, check, modal, confirmBox,
    loadCatalog, clearCatalogCache, imageUrl, uploadImage, uploadReceipt, receiptUrl,
    hoursSummary, openNow, DAYS, reveal, start, signOut, displayName, renderHeader,
    downloadIcs, bookingSummaryText
  };
  window.AAD = api;
})();
