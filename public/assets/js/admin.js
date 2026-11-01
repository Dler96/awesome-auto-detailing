/* Workshop admin dashboard. Every action is re-checked by Supabase
   (is_shop_admin in RLS policies and database functions). */
(() => {
  'use strict';
  const A = window.AAD;
  const { $, h, icon, money, duration, todayKL, addDays, fmtDate, fmtTime, klParts, fmtStamp, check, run, toast, modal, confirmBox, badge, STATUS, PAY } = A;

  const SECTIONS = [
    ['schedule', 'Today & schedule', 'calendar'],
    ['bookings', 'All bookings', 'list'],
    ['services', 'Services & prices', 'sparkle'],
    ['sizes', 'Vehicle sizes', 'car'],
    ['hours', 'Hours & capacity', 'clock'],
    ['payments', 'Payments', 'wallet'],
    ['promotions', 'Promotions', 'image'],
    ['customers', 'Customers', 'users'],
    ['reports', 'Reports', 'chart']
  ];
  let cat, main, pendingCount = 0, schedDate = todayKL();
  const bookingFilters = { status: 'active', payment: 'all', from: addDays(todayKL(), -7), to: addDays(todayKL(), 30), q: '' };

  A.start(async state => {
    cat = state.catalog;
    main = $('#admin-main');
    window.addEventListener('hashchange', route);
    await refreshBadge();
    route();
  }, { requireAdmin: true, freshCatalog: true });

  const fill = (el, ...kids) => el.replaceChildren(...kids.flat().filter(k => k != null && k !== false));
  const section = () => SECTIONS.some(s => s[0] === location.hash.slice(1)) ? location.hash.slice(1) : 'schedule';
  function drawSide() {
    $('#admin-side').replaceChildren(h('h4', { text: 'WORKSHOP' }), ...SECTIONS.map(([k, label, ic]) =>
      h('a', { href: '#' + k, 'aria-current': section() === k ? 'page' : null }, icon(ic), label,
        k === 'schedule' && pendingCount ? h('span', { class: 'count', title: 'Need attention', text: String(pendingCount) }) : null)));
  }
  async function refreshBadge() {
    const { count } = await A.db.from('bookings').select('id', { count: 'exact', head: true })
      .gte('end_at', new Date().toISOString()).or('status.eq.pending,payment_status.eq.submitted').not('status', 'in', '(cancelled,no_show)');
    pendingCount = count || 0;
    drawSide();
  }
  async function reloadCatalog() { A.clearCatalogCache(); cat = await A.loadCatalog(true); }
  function route() {
    drawSide();
    const k = section();
    main.classList.remove('step-panel'); void main.offsetWidth; main.classList.add('step-panel');
    const views = { schedule, bookings, services, sizes, hours, payments, promotions, customers, reports };
    run(() => views[k]());
    scrollTo({ top: 0 });
  }
  const head = (title, sub, ...actions) => h('div', { class: 'admin-head' },
    h('div', {}, h('span', { class: 'eyebrow', text: 'Admin' }), h('h1', { text: title, style: { margin: 0 } }), sub ? h('p', { class: 'muted', style: { margin: '6px 0 0' }, text: sub }) : null),
    actions.length ? h('div', { class: 'action-row' }, actions) : null);
  const stat = (label, value) => h('div', { class: 'stat' }, h('small', { text: label }), h('strong', { text: String(value) }));
  const dayRange = date => [new Date(`${date}T00:00:00+08:00`).toISOString(), new Date(`${addDays(date, 1)}T00:00:00+08:00`).toISOString()];
  const svcNames = b => (b.booking_items || []).map(i => i.service_name).join(' + ');

  // =================================================================
  // Schedule (day view)
  // =================================================================
  async function schedule() {
    const [from, to] = dayRange(schedDate);
    const rows = check(await A.db.from('bookings').select('*, booking_items(*)').gte('start_at', from).lt('start_at', to).order('start_at'));
    const active = rows.filter(b => !['cancelled', 'no_show'].includes(b.status));
    const hours = cat.hours.find(x => x.weekday === new Date(schedDate + 'T00:00:00Z').getUTCDay());
    const openMin = hours?.is_open ? toMin(hours.open_time) : 8 * 60;
    const closeMin = hours?.is_open ? toMin(hours.close_time) : 20 * 60;
    const bookedMin = active.reduce((n, b) => n + b.duration_minutes, 0);
    const capacity = Math.max(1, (closeMin - openMin) * cat.settings.bays);
    const dateInput = h('input', { type: 'date', value: schedDate, style: { width: 'auto' }, onchange: e => { if (e.target.value) { schedDate = e.target.value; run(schedule); } } });
    const closedDay = cat.closed.find(c => c.day === schedDate);

    fill(main, 
      head(schedDate === todayKL() ? 'Today' : fmtDate(schedDate, { weekday: 'long', day: 'numeric', month: 'long' }),
        `${fmtDate(schedDate, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · ${hours?.is_open ? `${fmtTime(hours.open_time)} – ${fmtTime(hours.close_time)}` : 'Closed'} · ${cat.settings.bays} bay${cat.settings.bays > 1 ? 's' : ''}`,
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Previous day', onclick: () => { schedDate = addDays(schedDate, -1); run(schedule); } }, icon('back')),
        dateInput,
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Next day', onclick: () => { schedDate = addDays(schedDate, 1); run(schedule); } }, icon('arrow')),
        schedDate !== todayKL() ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { schedDate = todayKL(); run(schedule); } }, 'Today') : null,
        h('a', { class: 'btn btn-primary btn-sm', href: '/book' }, icon('plus'), 'New booking')),
      closedDay ? h('div', { class: 'notice notice-warn', text: `Marked closed${closedDay.reason ? ': ' + closedDay.reason : ''}.` }) : null,
      h('div', { class: 'stats' },
        stat('Bookings', active.length),
        stat('Expected revenue', money(active.reduce((n, b) => n + b.total_cents, 0))),
        stat('Paid', money(active.filter(b => b.payment_status === 'paid').reduce((n, b) => n + b.total_cents, 0))),
        stat('Bay utilisation', Math.round(100 * bookedMin / capacity) + '%')),
      timeline(active, openMin, closeMin),
      h('h3', { text: 'Agenda' }),
      rows.length ? h('div', {}, rows.map(agendaItem)) : h('div', { class: 'empty' }, icon('calendar'), h('p', { class: 'muted', text: 'No bookings on this day.' })));
  }
  const toMin = t => { const [a, b] = String(t).split(':').map(Number); return a * 60 + b; };
  function timeline(list, openMin, closeMin) {
    const span = Math.max(60, closeMin - openMin), hoursN = Math.ceil(span / 60);
    const lanes = [];
    for (let bay = 1; bay <= cat.settings.bays; bay++) {
      const lane = h('div', { class: 'tl-lane', style: { '--hr': `${100 / hoursN}%` } });
      lane.style.setProperty('--hr', `${100 / (span / 60)}%`);
      for (const b of list.filter(x => x.bay === bay)) {
        const s = toMin(klParts(b.start_at).time), e = s + b.duration_minutes;
        const left = Math.max(0, (s - openMin) / span * 100), width = Math.max(2, (Math.min(e, closeMin) - Math.max(s, openMin)) / span * 100);
        lane.append(h('button', { type: 'button', class: `tl-block s-${b.status}`, style: { left: left + '%', width: width + '%' }, title: `${b.customer_name} · ${svcNames(b)}`, onclick: () => detail(b.id) },
          h('strong', { text: `${fmtTime(klParts(b.start_at).time)} ${b.plate}` }), h('span', { text: svcNames(b) })));
      }
      if (schedDate === todayKL()) {
        const now = toMin(klParts(new Date()).time);
        if (now >= openMin && now <= closeMin) lane.append(h('i', { class: 'tl-now', style: { left: ((now - openMin) / span * 100) + '%' } }));
      }
      lanes.push(h('div', { class: 'tl-row' }, h('div', { class: 'tl-label', text: `Bay ${bay}` }), lane));
    }
    const ticks = h('div', { class: 'tl-hours', style: { gridTemplateColumns: `repeat(${hoursN}, 1fr)` } },
      Array.from({ length: hoursN }, (_, i) => { const m = openMin + i * 60; return h('span', { text: fmtTime(`${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`) }); }));
    return h('div', { class: 'timeline' }, h('div', { class: 'tl-inner' }, ticks, lanes));
  }
  function agendaItem(b) {
    const p = klParts(b.start_at), e = klParts(b.end_at);
    const quick = [];
    const set = (status, payment, msg) => run(async () => {
      check(await A.db.rpc('admin_update_booking', { p_id: b.id, p_status: status, p_payment_status: payment, p_admin_notes: b.admin_notes || '' }));
      toast(msg); await refreshBadge(); await schedule();
    });
    if (b.status === 'pending') quick.push(h('button', { class: 'btn btn-primary btn-xs', type: 'button', onclick: () => set('confirmed', b.payment_status, 'Booking confirmed.') }, 'Confirm'));
    if (b.status === 'confirmed') quick.push(h('button', { class: 'btn btn-ghost btn-xs', type: 'button', onclick: () => set('in_progress', b.payment_status, 'Job started.') }, 'Start job'));
    if (b.status === 'in_progress') quick.push(h('button', { class: 'btn btn-primary btn-xs', type: 'button', onclick: async () => {
      const markPaid = b.payment_status !== 'paid' && await confirmBox('Job complete', `Was ${money(b.total_cents)} received? Choose “Mark paid” to record the payment now.`, 'Mark paid');
      set('completed', markPaid ? 'paid' : b.payment_status, 'Job completed.');
    } }, 'Complete'));
    if (b.payment_status !== 'paid' && !['cancelled', 'no_show'].includes(b.status)) quick.push(h('button', { class: 'btn btn-gold btn-xs', type: 'button', onclick: async () => {
      if (await confirmBox('Mark as paid?', `Only confirm after you have received ${money(b.total_cents)}${b.payment_method === 'qr' ? ' in your bank / e-wallet' : ''}.`, 'Mark paid')) set(b.status, 'paid', 'Payment recorded.');
    } }, b.payment_status === 'submitted' ? 'Verify receipt' : 'Mark paid'));
    quick.push(h('button', { class: 'btn btn-ghost btn-xs', type: 'button', onclick: () => detail(b.id) }, 'Details'));
    return h('div', { class: 'agenda-item' },
      h('div', { class: 'agenda-time' }, h('strong', { text: fmtTime(p.time) }), h('small', { text: `to ${fmtTime(e.time)} · Bay ${b.bay}` })),
      h('div', { class: 'agenda-body' },
        h('h4', {}, h('span', { class: 'plate', text: b.plate, style: { marginRight: '10px', fontSize: '13px' } }), `${b.make_model}`),
        h('p', { class: 'muted', style: { margin: '6px 0' }, text: `${b.customer_name} · ${b.customer_phone} · ${b.vehicle_type_name}` }),
        h('p', { style: { margin: '0 0 8px' }, text: svcNames(b) }),
        h('div', { class: 'bk-badges' }, badge(STATUS, b.status), badge(PAY, b.payment_status), h('span', { class: 'chip', text: `${money(b.total_cents)} · ${b.payment_method === 'qr' ? 'QR' : 'At shop'}` }), h('span', { class: 'chip', text: b.code })),
        b.customer_notes ? h('p', { class: 'hint', text: '“' + b.customer_notes + '”' }) : null),
      h('div', { class: 'agenda-actions' }, quick));
  }

  // =================================================================
  // Booking detail (modal)
  // =================================================================
  async function detail(id) {
    const b = check(await A.db.from('bookings').select('*, booking_items(*)').eq('id', id).single());
    const p = klParts(b.start_at), e = klParts(b.end_at);
    const status = h('select', {}, Object.keys(STATUS).map(k => h('option', { value: k, text: STATUS[k][0], selected: k === b.status })));
    const pay = h('select', {}, Object.keys(PAY).map(k => h('option', { value: k, text: PAY[k][0], selected: k === b.payment_status })));
    const notes = h('textarea', { maxlength: '1000', rows: '3', placeholder: 'Internal notes (customer cannot see)' }); notes.value = b.admin_notes || '';
    const save = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save changes');
    const form = h('form', {},
      h('div', { class: 'form-grid' }, h('div', { class: 'field' }, h('label', { text: 'Booking status' }), status), h('div', { class: 'field' }, h('label', { text: 'Payment' }), pay)),
      h('div', { class: 'field' }, h('label', { text: 'Admin notes' }), notes), h('div', { class: 'row-end' }, save));
    const receiptBox = h('div', {});
    if (b.receipt_path) {
      receiptBox.append(h('p', { class: 'muted', text: 'Loading receipt…' }));
      A.receiptUrl(b.receipt_path).then(url => receiptBox.replaceChildren(h('h4', { text: 'Payment receipt' }), h('a', { href: url, target: '_blank', rel: 'noopener' }, h('img', { class: 'receipt-img', src: url, alt: 'Payment receipt' })),
        h('p', { class: 'hint', text: 'Check your bank / e-wallet before marking as paid. A screenshot alone is not proof.' }))).catch(err => receiptBox.replaceChildren(h('p', { class: 'error-text', text: A.errMsg(err) })));
    }
    const name = b.customer_name.split(' ')[0];
    const when = `${fmtDate(p.date, { weekday: 'long', day: 'numeric', month: 'long' })} at ${fmtTime(p.time)}`;
    const templates = [
      ['Confirm', `Hi ${name}, your booking ${b.code} at ${A.BRAND} is confirmed for ${when}. Car: ${b.plate}. Services: ${svcNames(b)}. Total ${money(b.total_cents)}. See you!`],
      ['Reminder', `Hi ${name}, a friendly reminder of your detailing appointment (${b.code}) on ${when}. Please arrive on time. Reply here if you need to change it.`],
      ['Car ready', `Hi ${name}, your ${b.make_model} (${b.plate}) is ready for collection! Total ${money(b.total_cents)}${b.payment_status === 'paid' ? ' — already paid, thank you.' : ', payable at the counter.'}`],
      ['Payment verified', `Hi ${name}, we have received your payment of ${money(b.total_cents)} for booking ${b.code}. Thank you!`]
    ];
    const waBtns = templates.map(([l, t]) => { const link = A.waLink(b.customer_phone, t); return link ? h('a', { class: 'btn btn-ghost btn-xs', href: link, target: '_blank', rel: 'noopener' }, icon('whatsapp'), l) : null; });
    const m = modal(`${b.code} · ${b.plate}`, h('div', {},
      h('div', { class: 'bk-badges', style: { marginBottom: '16px' } }, badge(STATUS, b.status), badge(PAY, b.payment_status), h('span', { class: 'chip', text: b.source === 'admin' ? 'Entered by admin' : 'Online booking' })),
      h('div', { class: 'grid-2' },
        h('dl', { class: 'detail-list' },
          row('When', `${fmtDate(p.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}, ${fmtTime(p.time)} – ${fmtTime(e.time)}`),
          row('Bay', `Bay ${b.bay} · ${duration(b.duration_minutes)}`),
          row('Customer', b.customer_name), row('WhatsApp', b.customer_phone),
          row('Car', `${b.plate} · ${b.make_model}${b.color ? ' · ' + b.color : ''}`), row('Size', b.vehicle_type_name)),
        h('dl', { class: 'detail-list' },
          (b.booking_items || []).map(i => row(i.service_name, money(i.price_cents))),
          row('Total', money(b.total_cents)),
          row('Payment', b.payment_method === 'qr' ? `QR${b.payment_reference ? ' · ref ' + b.payment_reference : ''}` : 'At shop'),
          row('Booked', fmtStamp(b.created_at)),
          b.cancelled_at ? row('Cancelled', fmtStamp(b.cancelled_at) + (b.cancel_reason ? ` — ${b.cancel_reason}` : '')) : null)),
      b.customer_notes ? h('div', { class: 'notice', text: 'Customer notes: ' + b.customer_notes }) : null,
      receiptBox,
      h('h4', { text: 'Message customer', style: { marginTop: '18px' } }),
      h('div', { class: 'action-row', style: { justifyContent: 'flex-start' } }, waBtns,
        h('a', { class: 'btn btn-ghost btn-xs', href: `tel:${b.customer_phone.replace(/[^0-9+]/g, '')}` }, icon('phone'), 'Call')),
      h('h4', { text: 'Update', style: { marginTop: '22px' } }), form,
      ['pending', 'confirmed'].includes(b.status) ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { m.close(); reschedule(b); } }, icon('refresh'), 'Reschedule') : null), { wide: true });
    form.addEventListener('submit', ev => { ev.preventDefault(); run(async () => {
      if (pay.value === 'paid' && b.payment_status !== 'paid' && !(await confirmBox('Mark as paid?', `Confirm you have received ${money(b.total_cents)}.`, 'Yes, received'))) return;
      check(await A.db.rpc('admin_update_booking', { p_id: b.id, p_status: status.value, p_payment_status: pay.value, p_admin_notes: notes.value.trim() }));
      m.close(); toast('Booking updated.'); await refreshBadge(); route();
    }, form); });
  }
  const row = (k, v) => h('div', {}, h('dt', { text: k }), h('dd', { text: v }));
  function reschedule(b) {
    const host = h('div', {});
    let pick = {};
    const btn = h('button', { class: 'btn btn-primary', type: 'button', disabled: true }, 'Move booking');
    const m = modal(`Reschedule ${b.code}`, h('div', {}, host, h('div', { class: 'row-end' }, btn)), { wide: true });
    A.createScheduler({ host, getDuration: () => b.duration_minutes, ignoreId: b.id, date: klParts(b.start_at).date, onChange: v => { pick = v; btn.disabled = !(v.date && v.time); } });
    btn.addEventListener('click', () => run(async () => {
      check(await A.db.rpc('reschedule_booking', { p_id: b.id, p_date: pick.date, p_time: pick.time }));
      m.close(); toast('Booking moved. Let the customer know on WhatsApp.'); route();
    }, btn));
  }

  // =================================================================
  // All bookings
  // =================================================================
  async function bookings() {
    const f = bookingFilters;
    const sel = (key, opts) => h('select', { onchange: e => { f[key] = e.target.value; run(bookings); } }, opts.map(([v, l]) => h('option', { value: v, text: l, selected: f[key] === v })));
    const toolbar = h('div', { class: 'toolbar' },
      h('div', { class: 'field grow' }, h('label', { text: 'Search' }), h('input', { type: 'search', value: f.q, placeholder: 'Code, name, phone or plate', oninput: e => { f.q = e.target.value; drawTable(); } })),
      h('div', { class: 'field' }, h('label', { text: 'Status' }), sel('status', [['active', 'Active (pending → in progress)'], ['all', 'All statuses'], ...Object.entries(STATUS).map(([k, v]) => [k, v[0]])])),
      h('div', { class: 'field' }, h('label', { text: 'Payment' }), sel('payment', [['all', 'All'], ...Object.entries(PAY).map(([k, v]) => [k, v[0]])])),
      h('div', { class: 'field' }, h('label', { text: 'From' }), h('input', { type: 'date', value: f.from, onchange: e => { f.from = e.target.value; run(bookings); } })),
      h('div', { class: 'field' }, h('label', { text: 'To' }), h('input', { type: 'date', value: f.to, onchange: e => { f.to = e.target.value; run(bookings); } })));
    let q = A.db.from('bookings').select('*, booking_items(*)').order('start_at', { ascending: true }).limit(1000);
    if (f.from) q = q.gte('start_at', dayRange(f.from)[0]);
    if (f.to) q = q.lt('start_at', dayRange(f.to)[1]);
    if (f.status === 'active') q = q.in('status', ['pending', 'confirmed', 'in_progress']);
    else if (f.status !== 'all') q = q.eq('status', f.status);
    if (f.payment !== 'all') q = q.eq('payment_status', f.payment);
    const rows = check(await q);
    const tbody = h('tbody', {}), count = h('p', { class: 'muted' });
    const drawTable = () => {
      const s = f.q.trim().toLowerCase();
      const list = rows.filter(b => !s || `${b.code} ${b.customer_name} ${b.customer_phone} ${b.plate} ${b.make_model}`.toLowerCase().includes(s));
      count.textContent = `${list.length} booking${list.length === 1 ? '' : 's'} · ${money(list.filter(b => !['cancelled', 'no_show'].includes(b.status)).reduce((n, b) => n + b.total_cents, 0))} value`;
      tbody.replaceChildren(...(list.length ? list.map(b => { const p = klParts(b.start_at); return h('tr', {},
        h('td', {}, h('strong', { text: fmtDate(p.date) }), h('small', { text: `${fmtTime(p.time)} · Bay ${b.bay}` })),
        h('td', {}, h('strong', { text: b.code }), h('small', { text: b.source === 'admin' ? 'Admin entry' : 'Online' })),
        h('td', {}, h('strong', { text: b.customer_name }), h('small', { text: b.customer_phone })),
        h('td', {}, h('span', { class: 'plate', text: b.plate, style: { fontSize: '12px' } }), h('small', { text: b.make_model })),
        h('td', { text: svcNames(b) }),
        h('td', { class: 'num' }, h('strong', { text: money(b.total_cents) }), h('small', { text: b.payment_method === 'qr' ? 'QR' : 'At shop' })),
        h('td', {}, badge(STATUS, b.status)), h('td', {}, badge(PAY, b.payment_status)),
        h('td', {}, h('button', { class: 'btn btn-ghost btn-xs', type: 'button', onclick: () => run(() => detail(b.id)) }, 'Open'))); })
        : [h('tr', {}, h('td', { colspan: '9', class: 'muted', text: 'No bookings match these filters.' }))]));
    };
    drawTable();
    fill(main, 
      head('All bookings', 'Search, filter and update any booking.',
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => exportCsv(rows) }, icon('download'), 'Export CSV'),
        h('a', { class: 'btn btn-primary btn-sm', href: '/book' }, icon('plus'), 'New booking')),
      toolbar, count,
      h('div', { class: 'table-wrap' }, h('table', { class: 'data-table' },
        h('thead', {}, h('tr', {}, ['When', 'Code', 'Customer', 'Car', 'Services', 'Total', 'Status', 'Payment', ''].map(t => h('th', { text: t })))), tbody)));
  }
  function exportCsv(rows) {
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Code', 'Date', 'Time', 'Bay', 'Customer', 'Phone', 'Plate', 'Car', 'Size', 'Services', 'Minutes', 'Total (RM)', 'Payment method', 'Payment status', 'Status', 'Customer notes', 'Admin notes'].join(',')];
    for (const b of rows) {
      const p = klParts(b.start_at);
      lines.push([b.code, p.date, p.time, b.bay, b.customer_name, b.customer_phone, b.plate, b.make_model, b.vehicle_type_name, svcNames(b), b.duration_minutes,
        (b.total_cents / 100).toFixed(2), b.payment_method, b.payment_status, b.status, b.customer_notes, b.admin_notes].map(esc).join(','));
    }
    const a = h('a', { href: URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' })), download: `bookings-${todayKL()}.csv` });
    document.body.append(a); a.click(); setTimeout(() => a.remove(), 500);
  }

  // =================================================================
  // Services & prices
  // =================================================================
  async function services() {
    const all = check(await A.db.from('services').select('*').order('kind', { ascending: false }).order('sort_order').order('name'));
    const prices = check(await A.db.from('service_prices').select('*'));
    const price = (sid, tid) => prices.find(p => p.service_id === sid && p.vehicle_type_id === tid)?.price_cents;
    const table = kind => h('div', { class: 'table-wrap', style: { marginBottom: '30px' } }, h('table', { class: 'data-table' },
      h('thead', {}, h('tr', {}, h('th', { text: '' }), h('th', { text: kind === 'package' ? 'Package' : 'Add-on' }), h('th', { text: 'Time' }), cat.types.map(t => h('th', { class: 'num', text: t.name })), h('th', { text: '' }))),
      h('tbody', {}, all.filter(s => s.kind === kind).map(s => h('tr', {},
        h('td', {}, s.image_path ? h('img', { class: 'thumb', src: A.imageUrl(s.image_path), alt: '' }) : h('div', { class: 'thumb' })),
        h('td', {}, h('strong', { text: s.name }), h('small', { text: [s.active ? null : 'Hidden', s.popular ? 'Popular' : null, `Order ${s.sort_order}`].filter(Boolean).join(' · ') })),
        h('td', { text: duration(s.duration_minutes) }),
        cat.types.map(t => { const p = price(s.id, t.id); return h('td', { class: 'num', text: p == null ? '—' : money(p) }); }),
        h('td', {}, h('button', { class: 'btn btn-ghost btn-xs', type: 'button', onclick: () => serviceEditor(s, prices) }, 'Edit')))))));
    fill(main, 
      head('Services & prices', 'Packages are the main service; add-ons let customers customise. Leave a price empty if a size is not offered.',
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => serviceEditor({ kind: 'addon' }, prices) }, icon('plus'), 'Add-on'),
        h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => serviceEditor({ kind: 'package' }, prices) }, icon('plus'), 'Package')),
      h('h3', { text: 'Packages' }), table('package'), h('h3', { text: 'Add-ons' }), table('addon'));
  }
  function serviceEditor(s, prices) {
    const durOpts = []; for (let m = 15; m <= 720; m += 15) durOpts.push(m);
    const name = h('input', { maxlength: '80', value: s.name || '', required: true });
    const kind = h('select', {}, [['package', 'Package (main service)'], ['addon', 'Add-on']].map(([v, l]) => h('option', { value: v, text: l, selected: s.kind === v })));
    const dur = h('select', {}, durOpts.map(m => h('option', { value: m, text: duration(m), selected: (s.duration_minutes || 60) === m })));
    const desc = h('textarea', { maxlength: '600', rows: '3' }); desc.value = s.description || '';
    const sort = h('input', { type: 'number', min: '0', max: '9999', value: s.sort_order ?? 0 });
    const active = h('input', { type: 'checkbox', checked: s.id ? s.active : true });
    const popular = h('input', { type: 'checkbox', checked: !!s.popular });
    const image = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp' });
    let imagePath = s.image_path || null;
    const preview = h('div', {}, imagePath ? h('img', { class: 'thumb', src: A.imageUrl(imagePath), alt: '', style: { width: '120px', height: '80px' } }) : null);
    const priceInputs = cat.types.map(t => {
      const cur = prices.find(p => p.service_id === s.id && p.vehicle_type_id === t.id)?.price_cents;
      return { t, input: h('input', { type: 'number', min: '0', max: '100000', step: '0.01', placeholder: 'Not offered', value: cur == null ? '' : (cur / 100).toFixed(2) }) };
    });
    const btn = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save service');
    const form = h('form', {},
      h('div', { class: 'form-grid' },
        h('div', { class: 'field' }, h('label', { text: 'Name' }), name),
        h('div', { class: 'field' }, h('label', { text: 'Type' }), kind),
        h('div', { class: 'field' }, h('label', { text: 'Bay time needed' }), dur),
        h('div', { class: 'field' }, h('label', { text: 'Display order (lower first)' }), sort)),
      h('div', { class: 'field' }, h('label', { text: 'Description' }), desc),
      h('div', { class: 'field' }, h('label', { text: 'Photo (optional)' }), image, preview, imagePath ? h('button', { class: 'link-btn', type: 'button', style: { fontSize: '13px' }, onclick: e => { imagePath = null; preview.replaceChildren(); e.target.remove(); } }, 'Remove photo') : null),
      h('label', { class: 'check' }, active, 'Visible and bookable'),
      h('label', { class: 'check' }, popular, 'Mark as popular (shown first on the home page)'),
      h('h4', { text: 'Price by vehicle size (RM)', style: { marginTop: '18px' } }),
      h('div', { class: 'form-grid' }, priceInputs.map(({ t, input }) => h('div', { class: 'field' }, h('label', { text: t.name + (t.active ? '' : ' (hidden size)') }), input))),
      h('div', { class: 'row-end', style: { justifyContent: 'space-between' } },
        s.id ? h('button', { class: 'btn btn-danger', type: 'button', onclick: async () => {
          if (!(await confirmBox('Delete service?', `${s.name} will be removed. Past bookings keep their records. To hide it temporarily, untick “Visible” instead.`, 'Delete', true))) return;
          run(async () => { check(await A.db.from('services').delete().eq('id', s.id)); m.close(); await reloadCatalog(); toast('Service deleted.'); services(); });
        } }, icon('trash'), 'Delete') : h('span'), btn));
    const m = modal(s.id ? `Edit ${s.name}` : `New ${s.kind === 'addon' ? 'add-on' : 'package'}`, form, { wide: true });
    form.addEventListener('submit', e => { e.preventDefault(); run(async () => {
      if (!name.value.trim()) throw new Error('Enter a name.');
      if (image.files[0]) imagePath = await A.uploadImage(image.files[0], 'services');
      const list = priceInputs.map(({ t, input }) => {
        if (input.value === '') return { vehicle_type_id: t.id, price_cents: null };
        const v = Math.round(Number(input.value) * 100);
        if (!Number.isFinite(v) || v < 0) throw new Error(`Check the price for ${t.name}.`);
        return { vehicle_type_id: t.id, price_cents: v };
      });
      if (!list.some(x => x.price_cents != null)) throw new Error('Enter a price for at least one vehicle size.');
      check(await A.db.rpc('admin_save_service', { p_id: s.id || null, p_name: name.value.trim(), p_description: desc.value.trim(), p_kind: kind.value,
        p_duration: Number(dur.value), p_image: imagePath, p_active: active.checked, p_popular: popular.checked, p_sort: Number(sort.value) || 0, p_prices: list }));
      m.close(); await reloadCatalog(); toast('Service saved.'); services();
    }, form); });
  }

  // =================================================================
  // Vehicle sizes
  // =================================================================
  async function sizes() {
    const list = check(await A.db.from('vehicle_types').select('*').order('sort_order').order('name'));
    const rowFor = t => {
      const name = h('input', { maxlength: '40', value: t.name || '', placeholder: 'e.g. SUV / MPV' });
      const desc = h('input', { maxlength: '120', value: t.description || '', placeholder: 'Example models' });
      const sort = h('input', { type: 'number', value: t.sort_order ?? list.length + 1, style: { width: '80px' } });
      const active = h('input', { type: 'checkbox', checked: t.id ? t.active : true });
      const save = h('button', { class: 'btn btn-primary btn-xs', type: 'button' }, t.id ? 'Save' : 'Add');
      save.addEventListener('click', () => run(async () => {
        const row = { name: name.value.trim(), description: desc.value.trim(), sort_order: Number(sort.value) || 0, active: active.checked };
        if (!row.name) throw new Error('Enter a size name.');
        check(await (t.id ? A.db.from('vehicle_types').update(row).eq('id', t.id) : A.db.from('vehicle_types').insert(row)));
        await reloadCatalog(); toast(t.id ? 'Size saved.' : 'Size added. Now set its prices in Services.'); sizes();
      }, save));
      const del = t.id ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Delete', onclick: async () => {
        if (!(await confirmBox('Delete size?', `All prices for “${t.name}” will be removed. Past bookings keep their records. Untick Active to hide it instead.`, 'Delete', true))) return;
        run(async () => { check(await A.db.from('vehicle_types').delete().eq('id', t.id)); await reloadCatalog(); toast('Size deleted.'); sizes(); });
      } }, icon('trash')) : null;
      return h('tr', {}, h('td', {}, name), h('td', {}, desc), h('td', {}, sort), h('td', {}, h('label', { class: 'check', style: { margin: 0 } }, active, 'Active')), h('td', {}, h('div', { class: 'action-row', style: { justifyContent: 'flex-end', flexWrap: 'nowrap' } }, save, del)));
    };
    fill(main, head('Vehicle sizes', 'Customers pick one of these. Every service can have a different price per size.'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'data-table' },
        h('thead', {}, h('tr', {}, ['Name', 'Examples shown to customers', 'Order', 'Status', ''].map(t => h('th', { text: t })))),
        h('tbody', {}, list.map(rowFor), rowFor({})))));
  }

  // =================================================================
  // Hours, capacity, closures, business info
  // =================================================================
  async function hours() {
    const s = cat.settings;
    const hrs = check(await A.db.from('opening_hours').select('*').order('weekday'));
    const closed = check(await A.db.from('closed_dates').select('*').gte('day', todayKL()).order('day'));
    const hourRows = [1, 2, 3, 4, 5, 6, 0].map(d => {
      const r = hrs.find(x => x.weekday === d) || { weekday: d, is_open: false, open_time: '09:00', close_time: '18:00' };
      return { d, open: h('input', { type: 'checkbox', checked: r.is_open }), from: h('input', { type: 'time', value: r.open_time.slice(0, 5), step: '900' }), to: h('input', { type: 'time', value: r.close_time.slice(0, 5), step: '900' }) };
    });
    const hoursForm = h('form', { class: 'card' }, h('h2', { text: 'Opening hours' }),
      h('div', { class: 'hours-grid' }, hourRows.map(r => [h('strong', { text: A.DAYS[r.d] }), h('label', { class: 'check' }, r.open, 'Open'), r.from, r.to])),
      h('div', { class: 'row-end' }, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save hours')));
    hoursForm.addEventListener('submit', e => { e.preventDefault(); run(async () => {
      for (const r of hourRows) {
        if (r.open.checked && !(r.to.value > r.from.value)) throw new Error(`${A.DAYS[r.d]}: closing time must be after opening time.`);
        check(await A.db.from('opening_hours').update({ is_open: r.open.checked, open_time: r.from.value || '09:00', close_time: r.to.value > r.from.value ? r.to.value : '18:00' }).eq('weekday', r.d));
      }
      await reloadCatalog(); toast('Opening hours saved.');
    }, hoursForm); });

    const num = (v, min, max) => h('input', { type: 'number', min: String(min), max: String(max), value: v, required: true });
    const bays = num(s.bays, 1, 20), lead = num(s.lead_minutes, 0, 10080), ahead = num(s.max_days_ahead, 1, 180), cut = num(s.cancel_cutoff_hours, 0, 168);
    const step = h('select', {}, [15, 30, 60].map(m => h('option', { value: m, text: `Every ${m} minutes`, selected: s.slot_step_minutes === m })));
    const capForm = h('form', { class: 'card' }, h('h2', { text: 'Capacity & booking rules' }),
      h('div', { class: 'form-grid' },
        h('div', { class: 'field' }, h('label', { text: 'Number of bays' }), bays, h('small', { text: 'How many cars you can work on at the same time.' })),
        h('div', { class: 'field' }, h('label', { text: 'Start times offered' }), step),
        h('div', { class: 'field' }, h('label', { text: 'Minimum notice (minutes)' }), lead, h('small', { text: 'e.g. 60 = customers cannot book a slot starting in the next hour.' })),
        h('div', { class: 'field' }, h('label', { text: 'Book up to (days ahead)' }), ahead),
        h('div', { class: 'field' }, h('label', { text: 'Online change / cancel cut-off (hours)' }), cut, h('small', { text: 'Customers must WhatsApp you after this.' }))),
      h('div', { class: 'row-end' }, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save rules')));
    capForm.addEventListener('submit', e => { e.preventDefault(); run(async () => {
      check(await A.db.from('business_settings').update({ bays: +bays.value, slot_step_minutes: +step.value, lead_minutes: +lead.value, max_days_ahead: +ahead.value, cancel_cutoff_hours: +cut.value, updated_at: new Date().toISOString() }).eq('id', 1));
      await reloadCatalog(); toast('Booking rules saved.');
    }, capForm); });

    const cDate = h('input', { type: 'date', min: todayKL(), required: true }), cReason = h('input', { maxlength: '120', placeholder: 'e.g. Hari Raya, staff training' });
    const closedForm = h('form', { class: 'card' }, h('h2', { text: 'Special closures' }),
      h('p', { class: 'muted', text: 'Block whole days (public holidays, leave). Existing bookings on that day are not cancelled automatically.' }),
      h('div', { class: 'toolbar' }, h('div', { class: 'field' }, h('label', { text: 'Date' }), cDate), h('div', { class: 'field grow' }, h('label', { text: 'Reason (shown to customers)' }), cReason),
        h('button', { class: 'btn btn-primary', type: 'submit' }, 'Add')),
      closed.length ? h('ul', { class: 'info-list' }, closed.map(c => h('li', {}, h('span', { text: `${fmtDate(c.day, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}${c.reason ? ' · ' + c.reason : ''}` }),
        h('button', { class: 'link-btn', type: 'button', onclick: () => run(async () => { check(await A.db.from('closed_dates').delete().eq('day', c.day)); await reloadCatalog(); hours(); }) }, 'Remove')))) : h('p', { class: 'dim', text: 'No closures planned.' }));
    closedForm.addEventListener('submit', e => { e.preventDefault(); run(async () => {
      check(await A.db.from('closed_dates').upsert({ day: cDate.value, reason: cReason.value.trim() }));
      await reloadCatalog(); toast('Closure added.'); hours();
    }, closedForm); });

    const address = h('textarea', { maxlength: '300', rows: '3' }); address.value = s.address || '';
    const maps = h('input', { type: 'url', maxlength: '500', value: s.maps_url || '', placeholder: 'https://maps.app.goo.gl/…' });
    const about = h('textarea', { maxlength: '1000', rows: '3' }); about.value = s.about || '';
    const infoForm = h('form', { class: 'card' }, h('h2', { text: 'Business info' }),
      h('div', { class: 'field' }, h('label', { text: 'Address' }), address),
      h('div', { class: 'field' }, h('label', { text: 'Google Maps link' }), maps),
      h('div', { class: 'field' }, h('label', { text: 'About text (home page)' }), about),
      h('div', { class: 'row-end' }, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save info')));
    infoForm.addEventListener('submit', e => { e.preventDefault(); run(async () => {
      if (maps.value && !/^https:\/\//.test(maps.value.trim())) throw new Error('The maps link must start with https://');
      check(await A.db.from('business_settings').update({ address: address.value.trim(), maps_url: maps.value.trim(), about: about.value.trim(), updated_at: new Date().toISOString() }).eq('id', 1));
      await reloadCatalog(); toast('Business info saved.');
    }, infoForm); });

    fill(main, head('Hours & capacity', 'These settings control which start times customers can book.'),
      h('div', { class: 'account-grid' }, h('div', { style: { display: 'grid', gap: '24px' } }, hoursForm, closedForm), h('div', { style: { display: 'grid', gap: '24px' } }, capForm, infoForm)));
  }

  // =================================================================
  // Payments
  // =================================================================
  async function payments() {
    const s = cat.settings;
    const shop = h('input', { type: 'checkbox', checked: s.allow_pay_at_shop });
    const qr = h('input', { type: 'checkbox', checked: s.allow_qr });
    const payee = h('input', { maxlength: '120', value: s.payee_name || '', placeholder: 'Name shown on the QR / bank account' });
    const instr = h('textarea', { maxlength: '500', rows: '3', placeholder: 'e.g. Scan with any banking app. Put your booking plate number as reference.' }); instr.value = s.payment_instructions || '';
    const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp' });
    const form = h('form', { class: 'card', style: { maxWidth: '720px' } },
      h('h2', { text: 'Payment options' }),
      h('label', { class: 'check' }, shop, 'Allow “Pay at the shop”'),
      h('label', { class: 'check' }, qr, 'Allow “Pay now by QR” (customer uploads a receipt)'),
      h('div', { class: 'form-grid', style: { marginTop: '16px' } },
        h('div', { class: 'field' }, h('label', { text: 'QR recipient name' }), payee),
        h('div', { class: 'field' }, h('label', { text: 'DuitNow / bank QR image' }), file)),
      s.qr_path ? h('img', { src: A.imageUrl(s.qr_path), alt: 'Current QR', style: { width: '200px', background: '#fff', padding: '8px', borderRadius: '12px', marginBottom: '18px' } }) : h('p', { class: 'hint', text: 'Upload a QR image to enable QR payments.' }),
      h('div', { class: 'field' }, h('label', { text: 'Payment instructions' }), instr),
      h('div', { class: 'notice notice-info', text: 'Receipts are private. Only admins and the customer can view them. Always check your bank / e-wallet before marking a booking as paid.' }),
      h('div', { class: 'row-end' }, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save payment settings')));
    form.addEventListener('submit', e => { e.preventDefault(); run(async () => {
      if (!shop.checked && !qr.checked) throw new Error('Keep at least one payment option on.');
      let qrPath = s.qr_path;
      if (file.files[0]) qrPath = await A.uploadImage(file.files[0], 'qr');
      if (qr.checked && (!qrPath || !payee.value.trim())) throw new Error('Upload a QR image and enter the recipient name to allow QR payments.');
      check(await A.db.from('business_settings').update({ allow_pay_at_shop: shop.checked, allow_qr: qr.checked, payee_name: payee.value.trim(), payment_instructions: instr.value.trim(), qr_path: qrPath, updated_at: new Date().toISOString() }).eq('id', 1));
      await reloadCatalog(); toast('Payment settings saved.'); payments();
    }, form); });
    fill(main, head('Payments', 'Choose how customers can pay.'), form);
  }

  // =================================================================
  // Promotions
  // =================================================================
  async function promotions() {
    const list = check(await A.db.from('promotions').select('*').order('sort_order').order('created_at', { ascending: false }));
    fill(main, 
      head('Promotions', 'Posters and news shown on the home page.', h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => promoEditor({}) }, icon('plus'), 'New promotion')),
      list.length ? h('div', { class: 'grid-3' }, list.map(p => h('article', { class: 'pkg' },
        h('div', { class: 'pkg-media' }, h('img', { src: A.imageUrl(p.image_path), alt: p.title })),
        h('div', { class: 'pkg-body' }, h('h3', { text: p.title }), h('p', { text: p.caption }),
          h('div', { class: 'action-row', style: { justifyContent: 'space-between' } }, badge({ true: ['Visible', 'green'], false: ['Hidden', 'grey'] }, String(p.active)),
            h('button', { class: 'btn btn-ghost btn-xs', type: 'button', onclick: () => promoEditor(p) }, 'Edit')))))) :
        h('div', { class: 'empty' }, icon('image'), h('p', { class: 'muted', text: 'No promotions yet. Add a poster to show on your home page.' })));
  }
  function promoEditor(p) {
    const title = h('input', { maxlength: '120', value: p.title || '', required: true });
    const caption = h('textarea', { maxlength: '500', rows: '3' }); caption.value = p.caption || '';
    const sort = h('input', { type: 'number', min: '0', max: '9999', value: p.sort_order ?? 0 });
    const active = h('input', { type: 'checkbox', checked: p.id ? p.active : true });
    const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp' });
    const form = h('form', {},
      h('div', { class: 'field' }, h('label', { text: 'Title' }), title),
      h('div', { class: 'field' }, h('label', { text: 'Caption' }), caption),
      h('div', { class: 'form-grid' }, h('div', { class: 'field' }, h('label', { text: p.id ? 'Replace image (optional)' : 'Image' }), file), h('div', { class: 'field' }, h('label', { text: 'Display order' }), sort)),
      h('label', { class: 'check' }, active, 'Show on home page'),
      h('div', { class: 'row-end', style: { justifyContent: 'space-between' } },
        p.id ? h('button', { class: 'btn btn-danger', type: 'button', onclick: async () => {
          if (!(await confirmBox('Delete promotion?', p.title, 'Delete', true))) return;
          run(async () => { check(await A.db.from('promotions').delete().eq('id', p.id)); m.close(); await reloadCatalog(); promotions(); });
        } }, 'Delete') : h('span'),
        h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save')));
    const m = modal(p.id ? 'Edit promotion' : 'New promotion', form);
    form.addEventListener('submit', e => { e.preventDefault(); run(async () => {
      let path = p.image_path;
      if (file.files[0]) path = await A.uploadImage(file.files[0], 'promotions');
      if (!path) throw new Error('Choose an image.');
      const row = { title: title.value.trim(), caption: caption.value.trim(), sort_order: Number(sort.value) || 0, active: active.checked, image_path: path };
      if (!row.title) throw new Error('Enter a title.');
      check(await (p.id ? A.db.from('promotions').update(row).eq('id', p.id) : A.db.from('promotions').insert(row)));
      m.close(); await reloadCatalog(); toast('Promotion saved.'); promotions();
    }, form); });
  }

  // =================================================================
  // Customers
  // =================================================================
  async function customers() {
    const [profiles, stats] = await Promise.all([
      A.db.from('profiles').select('*').order('created_at', { ascending: false }).limit(2000),
      A.db.from('bookings').select('customer_id,total_cents,payment_status,status,start_at').not('customer_id', 'is', null).limit(10000)
    ]);
    const list = check(profiles), bk = check(stats);
    const agg = new Map();
    for (const b of bk) {
      const a = agg.get(b.customer_id) || { n: 0, spent: 0, last: null };
      if (!['cancelled', 'no_show'].includes(b.status)) a.n++;
      if (b.payment_status === 'paid' && b.status !== 'cancelled') a.spent += b.total_cents;
      if (!a.last || b.start_at > a.last) a.last = b.start_at;
      agg.set(b.customer_id, a);
    }
    let q = '';
    const tbody = h('tbody', {}), count = h('p', { class: 'muted' });
    const draw = () => {
      const s = q.toLowerCase();
      const rows = list.filter(p => !s || `${p.full_name || ''} ${p.username || ''} ${p.phone || ''}`.toLowerCase().includes(s));
      count.textContent = `${rows.length} of ${list.length} accounts`;
      tbody.replaceChildren(...rows.slice(0, 300).map(p => {
        const a = agg.get(p.id) || { n: 0, spent: 0, last: null };
        const wa = A.waLink(p.phone, `Hi ${(p.full_name || '').split(' ')[0] || 'there'}, `);
        return h('tr', {},
          h('td', {}, h('strong', { text: p.full_name || '—' }), h('small', { text: p.username ? '@' + p.username : 'Email account' })),
          h('td', { text: p.phone || '—' }),
          h('td', { class: 'num', text: String(a.n) }), h('td', { class: 'num', text: money(a.spent) }),
          h('td', { text: a.last ? fmtDate(klParts(a.last).date, { day: 'numeric', month: 'short', year: 'numeric' }) : '—' }),
          h('td', {}, badge({ true: ['Can book', 'green'], false: ['Paused', 'red'] }, String(p.booking_enabled))),
          h('td', {}, h('div', { class: 'action-row', style: { justifyContent: 'flex-end', flexWrap: 'nowrap' } },
            wa ? h('a', { class: 'btn btn-ghost btn-xs', href: wa, target: '_blank', rel: 'noopener' }, icon('whatsapp')) : null,
            h('button', { class: 'btn btn-ghost btn-xs', type: 'button', onclick: () => { Object.assign(bookingFilters, { q: p.phone || p.full_name || '', status: 'all', from: '', to: '' }); location.hash = 'bookings'; } }, 'Bookings'),
            h('button', { class: 'btn btn-ghost btn-xs', type: 'button', onclick: async () => {
              if (!(await confirmBox(p.booking_enabled ? 'Pause online booking?' : 'Allow online booking?', p.booking_enabled ? 'This customer will not be able to make new online bookings. Existing bookings stay.' : 'This customer can book online again.', p.booking_enabled ? 'Pause' : 'Allow', p.booking_enabled))) return;
              run(async () => { check(await A.db.rpc('admin_set_booking_access', { p_customer: p.id, p_enabled: !p.booking_enabled })); p.booking_enabled = !p.booking_enabled; draw(); toast('Updated.'); });
            } }, p.booking_enabled ? 'Pause' : 'Allow'))));
      }));
    };
    draw();
    fill(main, head('Customers', 'Registered accounts, visits and spend.'),
      h('div', { class: 'stats' }, stat('Accounts', list.length), stat('With bookings', [...agg.values()].filter(a => a.n).length), stat('Repeat customers', [...agg.values()].filter(a => a.n > 1).length), stat('Paused', list.filter(p => !p.booking_enabled).length)),
      h('div', { class: 'toolbar' }, h('div', { class: 'field grow' }, h('label', { text: 'Search' }), h('input', { type: 'search', placeholder: 'Name, username or phone', oninput: e => { q = e.target.value; draw(); } }))),
      count,
      h('div', { class: 'table-wrap' }, h('table', { class: 'data-table' },
        h('thead', {}, h('tr', {}, ['Customer', 'WhatsApp', 'Bookings', 'Paid', 'Last visit', 'Status', ''].map(t => h('th', { class: ['Bookings', 'Paid'].includes(t) ? 'num' : '', text: t })))), tbody)));
  }

  // =================================================================
  // Reports
  // =================================================================
  let reportPeriod = 'month', reportDate = todayKL();
  async function reports() {
    const r = check(await A.db.rpc('admin_revenue_report', { p_period: reportPeriod, p_date: reportDate }));
    const period = h('select', { onchange: e => { reportPeriod = e.target.value; run(reports); } }, [['day', 'Daily'], ['month', 'Monthly'], ['year', 'Yearly']].map(([v, l]) => h('option', { value: v, text: l, selected: v === reportPeriod })));
    const date = h('input', { type: 'date', value: reportDate, onchange: e => { if (e.target.value) { reportDate = e.target.value; run(reports); } } });
    const max = Math.max(1, ...r.buckets.map(b => b.revenue_cents));
    const sc = r.status_counts || {};
    const label = reportPeriod === 'day' ? fmtDate(reportDate, { day: 'numeric', month: 'long', year: 'numeric' }) : reportPeriod === 'month' ? fmtDate(reportDate, { month: 'long', year: 'numeric' }) : reportDate.slice(0, 4);
    fill(main, 
      head('Reports', `Revenue from paid bookings (by payment date, Malaysia time) · ${label}`),
      h('div', { class: 'toolbar' }, h('div', { class: 'field' }, h('label', { text: 'Period' }), period), h('div', { class: 'field' }, h('label', { text: 'Date in period' }), date)),
      h('div', { class: 'stats' },
        stat('Revenue', money(r.summary.revenue_cents)),
        stat('Paid bookings', r.summary.paid_bookings),
        stat('Average ticket', money(r.summary.paid_bookings ? Math.round(r.summary.revenue_cents / r.summary.paid_bookings) : 0)),
        stat('Cancelled / no-show', (sc.cancelled || 0) + (sc.no_show || 0))),
      h('div', { class: 'grid-2', style: { alignItems: 'start' } },
        h('div', { class: 'card' }, h('h3', { text: 'Revenue over time' }),
          r.buckets.length ? h('div', { class: 'mini-bars' }, r.buckets.map(b => h('div', { class: 'mini-bar' },
            h('span', { text: b.bucket }), h('div', { class: 'track' }, h('div', { class: 'fill', style: { width: (100 * b.revenue_cents / max) + '%' } })), h('strong', { text: money(b.revenue_cents) })))) : h('p', { class: 'muted', text: 'No paid bookings in this period.' })),
        h('div', { class: 'card' }, h('h3', { text: 'Top services' }),
          r.services.length ? h('table', { class: 'data-table' }, h('thead', {}, h('tr', {}, h('th', { text: 'Service' }), h('th', { class: 'num', text: 'Sold' }), h('th', { class: 'num', text: 'Revenue' }))),
            h('tbody', {}, r.services.map(s => h('tr', {}, h('td', {}, h('strong', { text: s.service_name }), h('small', { text: s.kind === 'addon' ? 'Add-on' : 'Package' })), h('td', { class: 'num', text: String(s.count) }), h('td', { class: 'num', text: money(s.revenue_cents) }))))) : h('p', { class: 'muted', text: '—' }),
          h('h3', { text: 'Bookings by status', style: { marginTop: '24px' } }),
          h('div', { class: 'bk-badges' }, Object.keys(STATUS).map(k => h('span', { class: 'chip', text: `${STATUS[k][0]}: ${sc[k] || 0}` }))))));
  }
})();
