(() => {
  'use strict';
  const A = window.AAD;
  const { $, h, icon, money, duration, fmtDate, fmtTime, klParts, check, run, toast, modal, confirmBox, badge, STATUS, PAY } = A;
  let all = [], tab = 'upcoming';

  A.start(async () => {
    await load();
    window.addEventListener('focus', () => run(load));
  }, { requireAuth: true });

  async function load() {
    all = check(await A.db.from('bookings').select('*, booking_items(*)').eq('customer_id', A.state.user.id).order('start_at', { ascending: false }).limit(200));
    draw();
  }
  const isUpcoming = b => ['pending', 'confirmed', 'in_progress'].includes(b.status) && new Date(b.end_at) > new Date();

  function draw() {
    const upcoming = all.filter(isUpcoming).sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
    const past = all.filter(b => !isUpcoming(b));
    const tabs = [['upcoming', 'Upcoming', upcoming.length], ['past', 'History', past.length]];
    $('#tabs').replaceChildren(...tabs.map(([k, l, n]) => h('button', { role: 'tab', 'aria-selected': String(tab === k), onclick: () => { tab = k; draw(); } }, l, h('span', { class: 'count', text: String(n) }))));
    const list = tab === 'upcoming' ? upcoming : past;
    if (!list.length) {
      $('#list').replaceChildren(h('div', { class: 'empty' }, icon('calendar'),
        h('h3', { text: tab === 'upcoming' ? 'No upcoming bookings' : 'No past bookings yet' }),
        h('p', { class: 'muted', text: 'Ready for a fresh shine?' }),
        h('a', { class: 'btn btn-primary', href: '/book' }, 'Book a slot')));
      return;
    }
    const spent = past.filter(b => b.payment_status === 'paid').reduce((n, b) => n + b.total_cents, 0);
    $('#list').replaceChildren(
      tab === 'past' && spent ? h('p', { class: 'muted', text: `Total paid with us: ${money(spent)} across ${past.filter(b => b.payment_status === 'paid').length} visits.` }) : '',
      ...list.map(card));
  }

  function card(b) {
    const p = klParts(b.start_at), end = klParts(b.end_at);
    const cutoff = A.state.catalog.settings.cancel_cutoff_hours;
    const canChange = ['pending', 'confirmed'].includes(b.status) && new Date(b.start_at) - Date.now() > cutoff * 3600e3;
    const canPay = ['unpaid', 'submitted'].includes(b.payment_status) && !['cancelled', 'no_show'].includes(b.status) && A.state.catalog.settings.allow_qr && A.state.catalog.settings.qr_path;
    const wa = A.shopWa(`Hi ${A.BRAND}, about my booking ${A.bookingSummaryText(b)}: `);
    const actions = [];
    if (isUpcoming(b)) actions.push(h('button', { class: 'btn btn-ghost btn-xs', type: 'button', onclick: () => A.downloadIcs(b) }, icon('calendar'), 'Calendar'));
    if (canPay && b.payment_status === 'unpaid') actions.push(h('button', { class: 'btn btn-gold btn-xs', type: 'button', onclick: () => payModal(b) }, icon('wallet'), 'Pay by QR'));
    if (canPay && b.payment_status === 'submitted') actions.push(h('button', { class: 'btn btn-ghost btn-xs', type: 'button', onclick: () => payModal(b) }, icon('receipt'), 'Replace receipt'));
    if (canChange) actions.push(
      h('button', { class: 'btn btn-ghost btn-xs', type: 'button', onclick: () => rescheduleModal(b) }, icon('refresh'), 'Reschedule'),
      h('button', { class: 'btn btn-danger btn-xs', type: 'button', onclick: () => cancelModal(b) }, icon('x'), 'Cancel'));
    if (wa && isUpcoming(b)) actions.push(h('a', { class: 'btn btn-ghost btn-xs', href: wa, target: '_blank', rel: 'noopener' }, icon('whatsapp'), 'Message'));
    if (!isUpcoming(b)) actions.push(h('a', { class: 'btn btn-ghost btn-xs', href: rebookLink(b) }, icon('refresh'), 'Book again'));
    return h('article', { class: 'booking-card reveal in' },
      h('div', { class: 'date-tile' },
        h('small', { text: fmtDate(p.date, { weekday: 'short' }) }), h('strong', { text: String(Number(p.date.slice(8))) }),
        h('span', { text: fmtDate(p.date, { month: 'short', year: 'numeric' }) })),
      h('div', { class: 'bk-main' },
        h('h3', { text: (b.booking_items || []).map(i => i.service_name).join(' + ') || 'Booking' }),
        h('div', { class: 'bk-meta' },
          h('span', {}, icon('clock'), `${fmtTime(p.time)} – ${fmtTime(end.time)}`),
          h('span', {}, icon('car'), `${b.plate} · ${b.make_model}`),
          h('span', {}, icon('tag'), b.code)),
        h('div', { class: 'bk-badges' }, badge(STATUS, b.status), badge(PAY, b.payment_status), h('span', { class: 'chip', text: b.payment_method === 'qr' ? 'QR' : 'Pay at shop' })),
        b.status === 'cancelled' && b.cancel_reason ? h('p', { class: 'hint', text: 'Reason: ' + b.cancel_reason }) : null,
        ['pending', 'confirmed'].includes(b.status) && !canChange && isUpcoming(b) ? h('p', { class: 'hint', text: `Online changes close ${cutoff}h before your slot — WhatsApp us for help.` }) : null),
      h('div', { class: 'bk-side' }, h('div', { class: 'price', text: money(b.total_cents) }), h('div', { class: 'bk-actions' }, actions)));
  }
  function rebookLink(b) {
    const pkg = (b.booking_items || []).find(i => i.kind === 'package' && i.service_id);
    const q = new URLSearchParams();
    if (pkg) q.set('package', pkg.service_id);
    if (b.vehicle_type_id) q.set('size', b.vehicle_type_id);
    return '/book' + (q.toString() ? '?' + q : '');
  }

  function rescheduleModal(b) {
    const host = h('div', {});
    let pick = { date: null, time: null };
    const save = h('button', { class: 'btn btn-primary', type: 'button', disabled: true }, 'Move my booking');
    const label = h('span', { class: 'muted', text: 'Choose a new day and time.' });
    const m = modal(`Reschedule ${b.code}`, h('div', {},
      h('p', { class: 'muted', text: `Same services, ${duration(b.duration_minutes)} of bay time. Only times that fit are shown.` }),
      host, h('div', { class: 'row-end', style: { alignItems: 'center', justifyContent: 'space-between' } }, label, save)), { wide: true });
    A.createScheduler({
      host, getDuration: () => b.duration_minutes, ignoreId: b.id, date: klParts(b.start_at).date,
      onChange: v => { pick = v; save.disabled = !(v.date && v.time); label.textContent = v.date && v.time ? `New time: ${fmtDate(v.date)} at ${fmtTime(v.time)}` : 'Choose a new day and time.'; }
    });
    save.addEventListener('click', () => run(async () => {
      check(await A.db.rpc('reschedule_booking', { p_id: b.id, p_date: pick.date, p_time: pick.time }));
      m.close(); toast('Booking moved. We will confirm the new time.'); await load();
    }, save));
  }

  function cancelModal(b) {
    const reason = h('textarea', { maxlength: '300', rows: '3', placeholder: 'Optional — helps us improve' });
    const btn = h('button', { class: 'btn btn-danger', type: 'button' }, 'Cancel booking');
    const m = modal('Cancel this booking?', h('div', {},
      h('p', { class: 'muted', text: `${A.bookingSummaryText(b)}. This frees your bay for other customers.` }),
      b.payment_status === 'paid' || b.payment_status === 'submitted' ? h('div', { class: 'notice notice-warn', text: 'You have paid or submitted a receipt for this booking. We will contact you on WhatsApp about your refund.' }) : null,
      h('div', { class: 'field' }, h('label', { text: 'Reason' }), reason),
      h('div', { class: 'row-end' }, h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => m.close() }, 'Keep booking'), btn)));
    btn.addEventListener('click', () => run(async () => {
      check(await A.db.rpc('cancel_booking', { p_id: b.id, p_reason: reason.value.trim() }));
      m.close(); toast('Booking cancelled.'); await load();
    }, btn));
  }

  function payModal(b) {
    const s = A.state.catalog.settings;
    const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', required: true });
    const ref = h('input', { maxlength: '120', placeholder: 'Optional', value: b.payment_reference || '' });
    const btn = h('button', { class: 'btn btn-primary', type: 'button' }, 'Submit receipt');
    const m = modal(`Pay ${money(b.total_cents)} by QR`, h('div', {},
      h('div', { class: 'qr-box', style: { marginTop: 0 } },
        h('img', { src: A.imageUrl(s.qr_path), alt: 'Payment QR' }),
        h('div', {}, h('p', { text: `Recipient: ${s.payee_name}` }), s.payment_instructions ? h('p', { class: 'muted pre', text: s.payment_instructions }) : null,
          h('div', { class: 'field' }, h('label', { text: 'Receipt screenshot' }), file),
          h('div', { class: 'field' }, h('label', { text: 'Transaction reference' }), ref))),
      h('div', { class: 'row-end' }, btn)), { wide: true });
    btn.addEventListener('click', () => run(async () => {
      if (!file.files[0]) throw new Error('Choose your receipt screenshot.');
      const path = await A.uploadReceipt(file.files[0], b.id);
      check(await A.db.rpc('submit_booking_receipt', { p_id: b.id, p_receipt: path, p_reference: ref.value.trim() }));
      m.close(); toast('Receipt submitted. We will verify it shortly.'); await load();
    }, btn));
  }
})();
