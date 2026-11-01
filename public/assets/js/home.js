(() => {
  'use strict';
  const A = window.AAD;
  const { $, h, icon, money, duration, todayKL, addDays, fmtDate, fmtTime, check } = A;

  A.start(async () => {
    const cat = A.state.catalog, s = cat.settings;

    // Packages: popular first, then by sort order (max 3)
    const list = [...cat.packages].sort((a, b) => (b.popular - a.popular) || (a.sort_order - b.sort_order)).slice(0, 3);
    $('#packages').replaceChildren(...(list.length ? list.map((p, i) => card(p, i)) : [h('div', { class: 'empty', style: { gridColumn: '1/-1' } }, h('p', { class: 'muted', text: 'Packages will appear here soon.' }))]));

    // Promotions
    const promos = cat.promos.filter(p => p.active);
    if (promos.length) {
      $('#promos-section').hidden = false;
      $('#promos').replaceChildren(...promos.map(p => h('article', { class: 'promo' },
        h('img', { src: A.imageUrl(p.image_path), alt: p.title, loading: 'lazy' }),
        h('div', {}, h('h3', { text: p.title }), p.caption ? h('p', { text: p.caption }) : null))));
    }

    // Hours
    const todayDow = new Date(todayKL() + 'T00:00:00Z').getUTCDay();
    $('#hours').replaceChildren(...[1, 2, 3, 4, 5, 6, 0].map(d => {
      const r = cat.hours.find(x => x.weekday === d);
      return h('li', { class: d === todayDow ? 'today' : '' }, h('span', { text: A.DAYS[d] + (d === todayDow ? ' (today)' : '') }),
        h('span', { text: r && r.is_open ? `${fmtTime(r.open_time)} – ${fmtTime(r.close_time)}` : 'Closed' }));
    }));
    const upcoming = cat.closed.slice(0, 3);
    $('#closed-note').textContent = upcoming.length ? 'Special closures: ' + upcoming.map(c => fmtDate(c.day) + (c.reason ? ` (${c.reason})` : '')).join(', ') : '';

    // Location
    if (s.address) $('#address').textContent = s.address;
    if (s.about) $('#about-text').textContent = s.about;
    const actions = [];
    if (s.maps_url) actions.push(h('a', { class: 'btn btn-gold', href: s.maps_url, target: '_blank', rel: 'noopener' }, icon('pin'), 'Get directions'));
    const wa = A.shopWa(`Hi ${A.BRAND}, I'd like to ask about your detailing services.`);
    if (wa) actions.push(h('a', { class: 'btn btn-ghost', href: wa, target: '_blank', rel: 'noopener' }, icon('whatsapp'), 'WhatsApp us'));
    $('#visit-actions').replaceChildren(...actions);

    // Live status
    const pill = $('#open-pill');
    const open = A.openNow(cat.hours, cat.closed);
    pill.textContent = open ? 'Open now' : 'Closed now · book ahead';
    pill.classList.toggle('closed', !open);
    findNextSlot();
  });

  function card(p, i) {
    const from = A.state.catalog.fromPrice(p.id);
    return h('article', { class: `pkg reveal d${i + 1}` },
      p.popular ? h('span', { class: 'ribbon', text: 'Popular' }) : null,
      h('div', { class: 'pkg-media' }, p.image_path ? h('img', { src: A.imageUrl(p.image_path), alt: p.name, loading: 'lazy' }) : icon('sparkle')),
      h('div', { class: 'pkg-body' },
        h('h3', { text: p.name }), h('p', { text: p.description }),
        h('div', { class: 'pkg-meta' },
          h('div', { class: 'price' }, h('small', { text: 'From' }), from == null ? '—' : money(from)),
          h('span', { class: 'chip' }, icon('clock'), duration(p.duration_minutes))),
        h('a', { class: 'btn btn-primary btn-block', href: `/book?package=${p.id}` }, 'Book this package')));
  }

  async function findNextSlot() {
    const cat = A.state.catalog;
    const quickest = [...cat.packages].sort((a, b) => a.duration_minutes - b.duration_minutes)[0];
    const out = $('#next-slot'), link = $('#next-slot-link');
    if (!quickest) { out.textContent = 'Coming soon'; return; }
    const today = todayKL();
    for (let i = 0; i < Math.min(14, cat.settings.max_days_ahead + 1); i++) {
      const d = addDays(today, i);
      try {
        const rows = check(await A.db.rpc('get_day_availability', { p_date: d, p_duration: quickest.duration_minutes }));
        const first = rows.find(r => r.free_bays > 0);
        if (first) {
          const t = first.slot_time.slice(0, 5);
          out.textContent = `${i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : fmtDate(d)} · ${fmtTime(t)}`;
          link.textContent = `Book ${quickest.name} at this time`;
          link.href = `/book?package=${quickest.id}&date=${d}&time=${t}`;
          return;
        }
      } catch { break; }
    }
    out.textContent = 'Fully booked — see calendar';
  }
})();
