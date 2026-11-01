/* Booking wizard: 1 Car → 2 Package → 3 Customise → 4 Date & time → 5 Details & payment. */
(() => {
  'use strict';
  const A = window.AAD;
  const { $, h, icon, money, duration, fmtDate, fmtTime, klParts, check, run, toast } = A;
  const STEPS = ['Your car', 'Package', 'Customise', 'Date & time', 'Confirm'];
  const DRAFT = 'aad-draft';
  const PLATE = /^[A-Z0-9 ]{2,12}$/;

  let cat, d, root, panel, summaryHost, mobileBar, stepper, vehicles = [], customers = [], sched = null;

  const blank = () => ({
    step: 0, typeId: null, packageId: null, addons: [], date: null, time: null,
    vehicleId: null, plate: '', make: '', color: '', saveCar: true,
    name: '', phone: '', notes: '', payment: null, reference: '',
    mode: 'self', customerId: '', requestKey: null
  });
  const save = () => { try { sessionStorage.setItem(DRAFT, JSON.stringify(d)); } catch { /* ignore */ } };
  const load = () => { try { return { ...blank(), ...JSON.parse(sessionStorage.getItem(DRAFT) || '{}') }; } catch { return blank(); } };

  // ---------- derived values ----------
  function items() {
    const ids = [d.packageId, ...d.addons].filter(Boolean);
    return ids.map(id => cat.service(id)).filter(s => s && s.active).map(s => ({
      id: s.id, name: s.name, kind: s.kind, duration: s.duration_minutes, price: d.typeId ? cat.price(s.id, d.typeId) : null
    }));
  }
  const totalMinutes = () => items().reduce((n, i) => n + i.duration, 0);
  const totalCents = () => items().reduce((n, i) => n + (i.price || 0), 0);
  const settings = () => cat.settings;
  const qrReady = () => settings().allow_qr && !!settings().qr_path && !!settings().payee_name?.trim();
  const shopReady = () => settings().allow_pay_at_shop || A.state.admin;

  function stepError(step) {
    if (step === 0) {
      if (!d.typeId) return 'Choose your vehicle size.';
      if (!PLATE.test(d.plate.trim())) return 'Enter your plate number (letters and numbers only).';
      if (!d.make.trim()) return 'Enter your car make and model.';
    }
    if (step === 2) {
      const list = items();
      if (!list.length) return 'Choose a package or at least one add-on.';
      const missing = list.find(i => i.price == null);
      if (missing) return `${missing.name} is not available for ${cat.type(d.typeId)?.name || 'this size'}.`;
      if (totalMinutes() > 720) return 'That is more than 12 hours of work. Please remove something or split into two bookings.';
    }
    if (step === 3 && (!d.date || !d.time)) return 'Choose a date and start time.';
    return null;
  }
  // Furthest step the customer may jump to (the first step that still needs input).
  function reachable() {
    for (let s = 0; s < 4; s++) if (stepError(s)) return s;
    return 4;
  }

  // ---------- boot ----------
  A.start(async state => {
    cat = state.catalog;
    d = load();
    const q = new URLSearchParams(location.search);
    if (q.get('size') && cat.activeTypes.some(t => t.id === q.get('size'))) d.typeId = q.get('size');
    if (q.get('package') && cat.packages.some(p => p.id === q.get('package'))) { d.packageId = q.get('package'); d.step = Math.min(d.step, 0); }
    if (q.get('date')) { d.date = q.get('date'); d.time = q.get('time') || null; }
    if (q.toString()) history.replaceState(null, '', '/book');
    if (!d.typeId) { try { const s = localStorage.getItem('aad-size'); if (cat.activeTypes.some(t => t.id === s)) d.typeId = s; } catch { /* ignore */ } }
    if (!d.typeId && cat.activeTypes.length === 1) d.typeId = cat.activeTypes[0].id;
    // Drop services that are gone.
    if (d.packageId && !cat.packages.some(p => p.id === d.packageId)) d.packageId = null;
    d.addons = d.addons.filter(id => cat.addons.some(a => a.id === id));

    if (state.user) {
      const p = state.profile || {};
      if (!d.name) d.name = p.full_name || '';
      if (!d.phone) d.phone = p.phone || '';
      vehicles = check(await A.db.from('vehicles').select('*').eq('owner_id', state.user.id).order('created_at'));
      if (!d.plate && !d.vehicleId && vehicles.length) useVehicle(vehicles[0], false);
    }
    if (state.admin) customers = check(await A.db.from('profiles').select('id,username,full_name,phone,booking_enabled').order('full_name'));
    if (!cat.packages.length && !cat.addons.length) {
      $('#book-root').replaceChildren(h('div', { class: 'empty' }, icon('sparkle'), h('h2', { text: 'Booking opens soon' }), h('p', { class: 'muted', text: 'We are setting up our services. Please check back shortly or WhatsApp us.' })));
      return;
    }
    d.step = Math.min(d.step || 0, reachable());
    layout();
    render();
  });

  function useVehicle(v, redraw = true) {
    d.vehicleId = v.id; d.plate = v.plate; d.make = v.make_model; d.color = v.color || '';
    if (v.vehicle_type_id && cat.activeTypes.some(t => t.id === v.vehicle_type_id)) d.typeId = v.vehicle_type_id;
    save(); if (redraw) render();
  }

  // ---------- layout ----------
  function layout() {
    root = $('#book-root');
    stepper = h('div', { class: 'stepper' });
    panel = h('div', { class: 'step-host' });
    summaryHost = h('aside', { class: 'summary', 'aria-label': 'Booking summary' });
    mobileBar = h('div', { class: 'mobile-bar' });
    root.replaceChildren(
      h('div', { class: 'booking-layout' },
        h('div', {}, h('span', { class: 'eyebrow', text: 'Book a slot' }), stepper, panel),
        summaryHost),
      mobileBar);
  }

  function go(step) {
    if (step > d.step) {
      for (let s = d.step; s < step; s++) {
        const err = stepError(s);
        if (err) { toast(err, 'error'); return; }
      }
    }
    d.step = step; save(); render();
    scrollTo({ top: 0, behavior: 'smooth' });
  }

  function render() {
    stepper.replaceChildren(...STEPS.map((label, i) => h('button', {
      type: 'button', 'data-state': i < d.step ? 'done' : i === d.step ? 'current' : 'todo',
      disabled: i > reachable(), onclick: () => go(i), 'aria-current': i === d.step ? 'step' : null
    }, `${i + 1}. ${label}`)));
    const views = [stepCar, stepPackage, stepAddons, stepTime, stepConfirm];
    const view = views[d.step]();
    view.classList.add('step-panel');
    panel.replaceChildren(view);
    renderSummary();
  }

  function nav(back, nextLabel = 'Continue', onNext = () => go(d.step + 1)) {
    return h('div', { class: 'step-nav' },
      back ? h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => go(d.step - 1) }, icon('back'), 'Back') : h('span'),
      nextLabel ? h('button', { class: 'btn btn-primary', type: 'button', onclick: onNext }, nextLabel, icon('arrow')) : null);
  }

  // ---------- step 1: car ----------
  function stepCar() {
    const garage = A.state.user && vehicles.length ? h('div', {},
      h('span', { class: 'label', text: 'From your garage' }),
      h('div', { class: 'garage-pick' },
        vehicles.map(v => h('button', { type: 'button', 'aria-pressed': String(d.vehicleId === v.id), onclick: () => useVehicle(v) },
          icon('car'), h('span', {}, h('b', { text: v.plate }), v.make_model))),
        h('button', { type: 'button', 'aria-pressed': String(!d.vehicleId), onclick: () => { d.vehicleId = null; d.plate = ''; d.make = ''; d.color = ''; save(); render(); } }, icon('plus'), 'Another car'))) : null;

    const sizes = h('div', { class: 'choices cols-4' }, cat.activeTypes.map(t => h('label', { class: 'choice compact' },
      h('input', { type: 'radio', name: 'size', value: t.id, checked: d.typeId === t.id, onchange: () => setSize(t.id) }),
      h('strong', { text: t.name }), h('small', { text: t.description }))));

    const plate = h('input', { id: 'plate', value: d.plate, maxlength: '12', autocomplete: 'off', placeholder: 'e.g. WXY 1234', style: { textTransform: 'uppercase', letterSpacing: '2px' },
      oninput: e => { d.plate = e.target.value.toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trimStart(); e.target.value = d.plate; d.vehicleId = null; save(); renderSummary(); } });
    const make = h('input', { id: 'make', value: d.make, maxlength: '60', placeholder: 'e.g. Honda City', oninput: e => { d.make = e.target.value; d.vehicleId = null; save(); renderSummary(); } });
    const color = h('input', { id: 'color', value: d.color, maxlength: '30', placeholder: 'e.g. Pearl white', oninput: e => { d.color = e.target.value; save(); } });

    return h('div', {},
      h('h2', { text: 'Tell us about your car' }),
      h('p', { class: 'muted', text: 'Prices and available services depend on your vehicle size.' }),
      garage,
      h('span', { class: 'label', text: 'Vehicle size' }), sizes,
      h('div', { class: 'form-grid-3', style: { marginTop: '22px' } },
        h('div', { class: 'field' }, h('label', { for: 'plate', text: 'Plate number' }), plate),
        h('div', { class: 'field' }, h('label', { for: 'make', text: 'Make & model' }), make),
        h('div', { class: 'field' }, h('label', { for: 'color', text: 'Colour (optional)' }), color)),
      A.state.user && !d.vehicleId ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: d.saveCar, onchange: e => { d.saveCar = e.target.checked; save(); } }), 'Save this car to my garage') : null,
      nav(false));
  }
  function setSize(id) {
    d.typeId = id;
    try { localStorage.setItem('aad-size', id); } catch { /* ignore */ }
    const dropped = items().filter(i => i.price == null);
    if (dropped.length) {
      if (dropped.some(i => i.id === d.packageId)) d.packageId = null;
      d.addons = d.addons.filter(a => !dropped.some(x => x.id === a));
      toast(`${dropped.map(i => i.name).join(', ')} not offered for this size — removed.`, 'error');
    }
    save(); render();
  }

  // ---------- step 2: package ----------
  function stepPackage() {
    const opts = cat.packages.map(p => {
      const price = cat.price(p.id, d.typeId);
      return h('label', { class: 'choice' },
        h('input', { type: 'radio', name: 'pkg', value: p.id, checked: d.packageId === p.id, disabled: price == null, onchange: () => { d.packageId = p.id; save(); renderSummary(); } }),
        h('span', { class: 'tick' }, icon('check')),
        h('span', { class: 'choice-body' },
          h('span', { class: 'choice-title' }, h('strong', { text: p.name }), h('b', { text: price == null ? 'N/A' : money(price) })),
          h('p', { class: 'choice-desc', text: p.description }),
          h('span', { class: 'chip' }, icon('clock'), duration(p.duration_minutes)), p.popular ? h('span', { class: 'chip', style: { marginLeft: '6px', color: 'var(--gold)' } }, icon('star'), 'Popular') : null));
    });
    opts.push(h('label', { class: 'choice' },
      h('input', { type: 'radio', name: 'pkg', value: '', checked: !d.packageId, onchange: () => { d.packageId = null; save(); renderSummary(); } }),
      h('span', { class: 'tick' }, icon('check')),
      h('span', { class: 'choice-body' }, h('span', { class: 'choice-title' }, h('strong', { text: 'No package' })),
        h('p', { class: 'choice-desc', text: 'Skip the package and pick only the add-ons you need in the next step.' }))));
    return h('div', {},
      h('h2', { text: 'Choose your package' }),
      h('p', { class: 'muted', text: `Prices shown for ${cat.type(d.typeId)?.name || 'your car'}. You can customise with add-ons next.` }),
      h('div', { class: 'choices' }, opts),
      nav(true));
  }

  // ---------- step 3: customise ----------
  function stepAddons() {
    const pkg = d.packageId ? cat.service(d.packageId) : null;
    const opts = cat.addons.map(a => {
      const price = cat.price(a.id, d.typeId);
      return h('label', { class: 'choice is-check' },
        h('input', { type: 'checkbox', value: a.id, checked: d.addons.includes(a.id), disabled: price == null,
          onchange: e => { d.addons = e.target.checked ? [...new Set([...d.addons, a.id])] : d.addons.filter(x => x !== a.id); save(); renderSummary(); } }),
        h('span', { class: 'tick' }, icon('check')),
        h('span', { class: 'choice-body' },
          h('span', { class: 'choice-title' }, h('strong', { text: a.name }), h('b', { text: price == null ? 'N/A' : '+' + money(price) })),
          a.description ? h('p', { class: 'choice-desc', text: a.description }) : null,
          h('span', { class: 'chip' }, icon('clock'), '+' + duration(a.duration_minutes))));
    });
    return h('div', {},
      h('h2', { text: pkg ? `Customise your ${pkg.name}` : 'Pick your services' }),
      h('p', { class: 'muted', text: pkg ? 'Add extras to your package. Each add-on extends your bay time.' : 'Choose one or more services.' }),
      opts.length ? h('div', { class: 'choices cols-2' }, opts) : h('p', { class: 'muted', text: 'No add-ons available right now.' }),
      nav(true, 'Choose a time'));
  }

  // ---------- step 4: time ----------
  function stepTime() {
    const host = h('div', {});
    const note = h('div', { class: 'notice notice-info', style: { marginTop: '0' } },
      icon('clock'), ' ', h('span', {}, `We'll reserve a bay for `, h('strong', { text: duration(totalMinutes()) }), '. Times are in Malaysia time.'));
    const view = h('div', {},
      h('h2', { text: 'Pick a date & time' }),
      h('p', { class: 'muted', text: 'Only start times where your whole job fits are shown.' }),
      note, host, nav(true, 'Continue'));
    queueMicrotask(() => {
      sched = A.createScheduler({
        host, getDuration: totalMinutes, date: d.date, time: d.time,
        onChange: v => { d.date = v.date; d.time = v.time; save(); renderSummary(); }
      });
    });
    return view;
  }

  // ---------- step 5: details, payment, confirm ----------
  function stepConfirm() {
    const user = A.state.user;
    if (!user) {
      return h('div', {},
        h('h2', { text: 'Almost there' }),
        h('p', { class: 'muted', text: 'Log in or create a free account to confirm. Your selections are saved.' }),
        h('div', { class: 'card', style: { display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' } },
          h('div', {}, h('h3', { text: 'Your account keeps you in control', style: { fontSize: '22px' } }),
            h('p', { class: 'muted', style: { margin: 0 }, text: 'Track, reschedule or cancel bookings and save your cars for next time.' })),
          h('div', { class: 'action-row' },
            h('a', { class: 'btn btn-primary', href: '/account?next=/book' }, 'Log in'),
            h('a', { class: 'btn btn-ghost', href: '/account?mode=register&next=/book' }, 'Create account'))),
        nav(true, null));
    }

    const form = h('form', { novalidate: true });
    // Admin: book for someone else
    if (A.state.admin) {
      const sel = h('select', { id: 'for-customer', onchange: e => {
        d.customerId = e.target.value; const c = customers.find(x => x.id === d.customerId);
        if (c) { d.name = c.full_name || d.name; d.phone = c.phone || d.phone; }
        save(); render();
      } }, h('option', { value: '', text: 'Choose a customer…' }), customers.map(c => h('option', { value: c.id, selected: c.id === d.customerId, text: `${c.full_name || c.username || 'No name'} · ${c.phone || c.username || c.id.slice(0, 8)}` })));
      form.append(h('div', { class: 'notice notice-warn' },
        h('strong', { text: 'Admin booking. ' }), 'Admin bookings are confirmed immediately and may skip the receipt.',
        h('div', { class: 'segment', style: { marginTop: '12px', display: 'flex' } },
          [['self', 'For me'], ['account', 'Registered customer'], ['walkin', 'Walk-in / phone']].map(([k, l]) =>
            h('button', { type: 'button', 'aria-pressed': String(d.mode === k), onclick: () => { d.mode = k; save(); render(); } }, l))),
        d.mode === 'account' ? h('div', { class: 'field', style: { marginTop: '12px' } }, h('label', { for: 'for-customer', text: 'Customer account' }), sel) : null));
    }

    const name = h('input', { id: 'name', value: d.name, maxlength: '80', autocomplete: 'name', required: true, oninput: e => { d.name = e.target.value; save(); } });
    const phone = h('input', { id: 'phone', type: 'tel', value: d.phone, maxlength: '24', autocomplete: 'tel', placeholder: '0123456789', required: true, oninput: e => { d.phone = e.target.value; save(); } });
    const notes = h('textarea', { id: 'notes', maxlength: '500', rows: '3', placeholder: 'Anything we should know? e.g. pet hair, stains, arriving early.', oninput: e => { d.notes = e.target.value; save(); } });
    notes.value = d.notes;
    form.append(
      h('h3', { text: 'Your details', style: { fontSize: '22px' } }),
      h('div', { class: 'form-grid' },
        h('div', { class: 'field' }, h('label', { for: 'name', text: 'Full name' }), name),
        h('div', { class: 'field' }, h('label', { for: 'phone', text: 'WhatsApp number' }), phone, h('small', { text: 'We use this to contact you about your booking.' }))),
      h('div', { class: 'field' }, h('label', { for: 'notes', text: 'Notes for our team (optional)' }), notes));

    // Payment
    const methods = [];
    if (shopReady()) methods.push(['shop', 'Pay at the shop', 'Cash, card or e-wallet when you collect your car.']);
    if (qrReady()) methods.push(['qr', 'Pay now by QR', 'Scan our DuitNow QR, then upload your receipt. We verify it before your visit.']);
    if (!methods.length) methods.push(['shop', 'Pay at the shop', 'Pay when you collect your car.']);
    if (!methods.some(m => m[0] === d.payment)) d.payment = methods[0][0];
    const qrPanel = h('div', {});
    const receipt = h('input', { id: 'receipt', type: 'file', accept: 'image/jpeg,image/png,image/webp' });
    const ref = h('input', { id: 'reference', value: d.reference, maxlength: '120', placeholder: 'Optional', oninput: e => { d.reference = e.target.value; save(); } });
    const drawQr = () => {
      qrPanel.replaceChildren(d.payment === 'qr' ? h('div', { class: 'qr-box' },
        h('img', { src: A.imageUrl(settings().qr_path), alt: 'Payment QR code' }),
        h('div', {},
          h('h3', { text: `Pay ${money(totalCents())}`, style: { fontSize: '30px' } }),
          h('p', { class: 'muted', text: `Recipient: ${settings().payee_name}` }),
          settings().payment_instructions ? h('p', { class: 'pre', text: settings().payment_instructions }) : null,
          h('div', { class: 'field' }, h('label', { for: 'receipt', text: A.state.admin ? 'Receipt screenshot (optional for admin)' : 'Receipt screenshot (required)' }), receipt, h('small', { text: 'JPG, PNG or WebP, max 5 MB. Payment is confirmed once we check it.' })),
          h('div', { class: 'field' }, h('label', { for: 'reference', text: 'Transaction reference' }), ref))) : '');
    };
    form.append(h('h3', { text: 'Payment', style: { fontSize: '22px', marginTop: '10px' } }),
      h('div', { class: 'choices cols-2' }, methods.map(([k, l, desc]) => h('label', { class: 'choice' },
        h('input', { type: 'radio', name: 'payment', value: k, checked: d.payment === k, onchange: () => { d.payment = k; save(); drawQr(); } }),
        h('span', { class: 'tick' }, icon('check')),
        h('span', { class: 'choice-body' }, h('span', { class: 'choice-title' }, h('strong', { text: l })), h('p', { class: 'choice-desc', text: desc }))))),
      qrPanel);
    drawQr();

    const cut = settings().cancel_cutoff_hours;
    form.append(h('p', { class: 'hint', style: { marginTop: '18px' }, text: `You can reschedule or cancel online up to ${cut} hour${cut === 1 ? '' : 's'} before your slot. Please arrive on time — late arrivals may shorten the service.` }));

    const submit = h('button', { class: 'btn btn-primary btn-lg', type: 'submit' }, 'Confirm booking', icon('check'));
    form.append(h('div', { class: 'step-nav' }, h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => go(3) }, icon('back'), 'Back'), submit));
    form.addEventListener('submit', e => { e.preventDefault(); run(() => confirm(receipt.files[0]), form); });

    return h('div', {}, h('h2', { text: 'Confirm your booking' }), h('p', { class: 'muted', text: 'Check your details and choose how to pay.' }), form);
  }

  async function confirm(file) {
    for (const s of [0, 2, 3]) { const err = stepError(s); if (err) { toast(err, 'error'); return; } }
    if (!d.name.trim() || !/^\+?[0-9][0-9 ()-]{6,23}$/.test(d.phone.trim())) throw new Error('Enter your name and a valid WhatsApp number.');
    if (A.state.admin && d.mode === 'account' && !d.customerId) throw new Error('Choose the customer account.');
    if (!d.requestKey) { d.requestKey = crypto.randomUUID(); save(); }
    let receiptPath = null;
    if (d.payment === 'qr' && file) receiptPath = await A.uploadReceipt(file, d.requestKey);
    else if (d.payment === 'qr' && !A.state.admin) throw new Error('Upload your payment receipt screenshot.');

    const list = items();
    let id;
    try {
      id = check(await A.db.rpc('place_booking', {
        p_request_key: d.requestKey, p_vehicle_type: d.typeId, p_services: list.map(i => i.id),
        p_date: d.date, p_time: d.time, p_plate: d.plate, p_make_model: d.make.trim(), p_color: d.color.trim(),
        p_name: d.name.trim(), p_phone: d.phone.trim(), p_notes: d.notes.trim(), p_payment: d.payment,
        p_receipt: receiptPath, p_reference: d.reference.trim() || null, p_expected_total: totalCents(),
        p_customer_id: A.state.admin && d.mode === 'account' ? d.customerId : null,
        p_walk_in: A.state.admin && d.mode === 'walkin'
      }));
    } catch (e) {
      if (/Prices were just updated|no longer available|not offered/i.test(e.message || '')) {
        A.clearCatalogCache(); cat = await A.loadCatalog(true); render();
      }
      if (/taken|fully booked|too soon|passed/i.test(e.message || '')) { d.time = null; save(); d.step = 3; render(); }
      throw e;
    }

    // Save the car to the garage (best effort).
    if (d.saveCar && !d.vehicleId && (!A.state.admin || d.mode === 'self')) {
      await A.db.from('vehicles').insert({ plate: d.plate, make_model: d.make.trim(), color: d.color.trim(), vehicle_type_id: d.typeId });
    }
    const booking = check(await A.db.from('bookings').select('*, booking_items(*)').eq('id', id).single());
    try { sessionStorage.removeItem(DRAFT); } catch { /* ignore */ }
    showSuccess(booking);
  }

  function showSuccess(b) {
    const p = klParts(b.start_at);
    const wa = A.shopWa(`Hi ${A.BRAND}! I just booked ${A.bookingSummaryText(b)}.`);
    const items = (b.booking_items || []).map(i => i.service_name).join(' + ');
    root.replaceChildren(h('div', { class: 'success step-panel' },
      h('div', { class: 'success-mark' }, icon('check')),
      h('span', { class: 'eyebrow', text: b.status === 'confirmed' ? 'Booking confirmed' : 'Booking received' }),
      h('h1', { style: { fontSize: 'clamp(36px,5vw,56px)' }, text: 'See you soon!' }),
      h('p', { class: 'muted', text: b.status === 'confirmed' ? 'Your bay is reserved.' : 'Your bay is reserved. We will confirm shortly — you can follow the status in My Bookings.' }),
      h('div', { class: 'code-box', text: b.code }),
      h('dl', { class: 'detail-list' },
        row('When', `${fmtDate(p.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}, ${fmtTime(p.time)}`),
        row('Bay time', duration(b.duration_minutes)),
        row('Car', `${b.plate} · ${b.make_model} (${b.vehicle_type_name})`),
        row('Services', items),
        row('Total', money(b.total_cents)),
        row('Payment', b.payment_method === 'qr' ? (b.payment_status === 'submitted' ? 'QR · receipt submitted, awaiting verification' : 'QR') : 'Pay at the shop')),
      h('div', { class: 'action-row' },
        h('button', { class: 'btn btn-gold', type: 'button', onclick: () => A.downloadIcs(b) }, icon('calendar'), 'Add to calendar'),
        wa ? h('a', { class: 'btn btn-ghost', href: wa, target: '_blank', rel: 'noopener' }, icon('whatsapp'), 'WhatsApp us') : null,
        h('a', { class: 'btn btn-primary', href: A.state.admin && b.customer_id !== A.state.user.id ? '/admin#schedule' : '/my-bookings' }, A.state.admin && b.customer_id !== A.state.user.id ? 'Open schedule' : 'My bookings'))));
    scrollTo({ top: 0, behavior: 'smooth' });
  }
  const row = (k, v) => h('div', {}, h('dt', { text: k }), h('dd', { text: v }));

  // ---------- summary ----------
  function renderSummary() {
    const list = items(), type = cat.type(d.typeId);
    const body = h('div', { class: 'summary-body' });
    if (type || d.plate) body.append(h('div', { class: 'sum-row' }, h('span', { text: 'Car' }), h('span', { text: [d.plate, type?.name].filter(Boolean).join(' · ') || '—' })));
    if (list.length) {
      body.append(h('div', { class: 'sum-sep' }));
      list.forEach(i => body.append(h('div', { class: 'sum-row item' }, h('span', { text: (i.kind === 'addon' ? '+ ' : '') + i.name }), h('span', { text: i.price == null ? 'N/A' : money(i.price) }))));
      body.append(h('div', { class: 'sum-sep' }), h('div', { class: 'sum-row' }, h('span', { text: 'Bay time' }), h('span', { text: duration(totalMinutes()) })));
    } else body.append(h('p', { class: 'sum-empty', text: 'Your package and add-ons will appear here.' }));
    if (d.date) body.append(h('div', { class: 'sum-row' }, h('span', { text: 'When' }), h('span', { text: `${fmtDate(d.date)}${d.time ? ', ' + fmtTime(d.time) : ''}` })));
    summaryHost.replaceChildren(
      h('div', { class: 'summary-head' }, h('h3', { text: 'Your booking' })), body,
      h('div', { class: 'sum-total' }, h('span', { class: 'muted', text: 'Total' }), h('strong', { text: money(totalCents()) })));
    mobileBar.replaceChildren(
      h('div', {}, h('strong', { text: money(totalCents()) }), h('small', { text: list.length ? `${list.length} service${list.length > 1 ? 's' : ''} · ${duration(totalMinutes())}` : 'Nothing selected yet' })),
      ...(d.step < 4 ? [h('button', { class: 'btn btn-primary', type: 'button', onclick: () => go(d.step + 1) }, 'Next', icon('arrow'))]
        : A.state.user ? [h('button', { class: 'btn btn-primary', type: 'button', onclick: () => panel.querySelector('form')?.requestSubmit() }, 'Confirm', icon('check'))] : []));
  }
})();
