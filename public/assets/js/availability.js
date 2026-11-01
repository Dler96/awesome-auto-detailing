(() => {
  'use strict';
  const A = window.AAD;
  const { $, h, icon, duration, fmtDate, fmtTime } = A;

  A.start(async () => {
    const cat = A.state.catalog;
    const params = new URLSearchParams(location.search);
    const need = $('#need');
    const options = [
      ...cat.packages.map(p => ({ value: 'p:' + p.id, label: `${p.name} (${duration(p.duration_minutes)})`, minutes: p.duration_minutes, pkg: p.id })),
      ...[30, 60, 90, 120, 180, 240].map(m => ({ value: 'm:' + m, label: `Add-ons / custom job · about ${duration(m)}`, minutes: m }))
    ];
    need.replaceChildren(
      h('optgroup', { label: 'Packages' }, options.filter(o => o.pkg).map(o => h('option', { value: o.value, text: o.label }))),
      h('optgroup', { label: 'Custom length' }, options.filter(o => !o.pkg).map(o => h('option', { value: o.value, text: o.label }))));
    const initial = params.get('package') ? 'p:' + params.get('package') : null;
    if (initial && options.some(o => o.value === initial)) need.value = initial;

    const current = () => options.find(o => o.value === need.value) || options[0];
    const pick = { date: null, time: null };
    const update = () => {
      const o = current();
      $('#need-time').replaceChildren(icon('clock'), ` Bay held for ${duration(o?.minutes || 0)}`);
      $('#pick-label').textContent = pick.date && pick.time ? `${fmtDate(pick.date, { weekday: 'long', day: 'numeric', month: 'long' })} at ${fmtTime(pick.time)}` : pick.date ? 'Now choose a start time' : 'Pick a day and time';
      const q = new URLSearchParams();
      if (o?.pkg) q.set('package', o.pkg);
      if (pick.date) q.set('date', pick.date);
      if (pick.time) q.set('time', pick.time);
      $('#continue').href = '/book' + (q.toString() ? '?' + q : '');
      $('#continue').textContent = pick.time ? 'Book this time →' : 'Continue to booking →';
    };
    if (!options.length) { $('#scheduler').replaceChildren(h('div', { class: 'empty' }, h('p', { class: 'muted', text: 'Services are being set up. Please check back soon.' }))); return; }
    const sched = A.createScheduler({
      host: $('#scheduler'),
      getDuration: () => current()?.minutes || 0,
      date: params.get('date'),
      onChange: v => { pick.date = v.date; pick.time = v.time; update(); }
    });
    need.addEventListener('change', () => { update(); sched.refresh(); });
    update();
  });
})();
