/* Month calendar + time-slot picker, shared by Availability, Book,
   My Bookings (reschedule) and Admin. Availability comes live from the
   database functions get_availability_calendar / get_day_availability. */
(() => {
  'use strict';
  const { h, icon, todayKL, addDays, fmtDate, fmtTime, check, errMsg } = window.AAD;
  const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  function createScheduler({ host, getDuration, ignoreId = null, date = null, time = null, onChange = () => {} }) {
    const db = window.AAD.db;
    const settings = window.AAD.state.catalog.settings;
    const today = todayKL();
    const last = addDays(today, settings.max_days_ahead);
    let month = (date || today).slice(0, 7);
    let selDate = date, selTime = time, calData = new Map(), calToken = 0, slotToken = 0;

    const monthLabel = h('div', { class: 'cal-month' });
    const prev = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Previous month' }, icon('back'));
    const next = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Next month' }, icon('arrow'));
    const grid = h('div', { class: 'cal-grid', role: 'grid' });
    const slotsTitle = h('h4', { class: 'slots-title' });
    const slots = h('div', { class: 'slots', role: 'listbox', 'aria-label': 'Start times' });
    const legend = h('div', { class: 'cal-legend' },
      h('span', {}, h('i', { class: 'dot dot-open' }), 'Available'),
      h('span', {}, h('i', { class: 'dot dot-low' }), 'Few slots'),
      h('span', {}, h('i', { class: 'dot dot-full' }), 'Full / closed'));
    host.replaceChildren(h('div', { class: 'scheduler' },
      h('div', { class: 'cal' }, h('div', { class: 'cal-head' }, prev, monthLabel, next),
        h('div', { class: 'cal-week' }, WEEK.map(d => h('span', { text: d }))), grid, legend),
      h('div', { class: 'slot-panel' }, slotsTitle, slots)));

    prev.addEventListener('click', () => { month = shiftMonth(month, -1); drawCalendar(); });
    next.addEventListener('click', () => { month = shiftMonth(month, 1); drawCalendar(); });

    function shiftMonth(m, n) {
      const d = new Date(m + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n);
      return d.toISOString().slice(0, 7);
    }
    function daysInMonth(m) { const d = new Date(m + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0); return d.getUTCDate(); }

    async function drawCalendar() {
      const dur = getDuration();
      const first = month + '-01', count = daysInMonth(month);
      monthLabel.textContent = fmtDate(first, { month: 'long', year: 'numeric' });
      prev.disabled = month <= today.slice(0, 7);
      next.disabled = month >= last.slice(0, 7);
      const lead = (new Date(first + 'T00:00:00Z').getUTCDay() + 6) % 7;
      grid.replaceChildren(...Array.from({ length: lead }, () => h('span', { class: 'cal-pad' })));
      const cells = [];
      for (let i = 0; i < count; i++) {
        const d = addDays(first, i);
        const b = h('button', { type: 'button', class: 'cal-day is-loading', disabled: true, dataset: { date: d } },
          h('span', { class: 'cal-num', text: String(i + 1) }), h('span', { class: 'cal-sub', text: '' }));
        if (d === today) b.classList.add('is-today');
        b.addEventListener('click', () => selectDate(d));
        cells.push(b);
      }
      grid.append(...cells);
      if (!dur) { cells.forEach(c => { c.classList.remove('is-loading'); }); slotsTitle.textContent = ''; slots.replaceChildren(h('p', { class: 'muted', text: 'Choose a package or add-on to see open times.' })); return; }
      const from = first < today ? today : first;
      const to = addDays(first, count - 1) > last ? last : addDays(first, count - 1);
      const token = ++calToken;
      let rows = [];
      if (from <= to) {
        const span = Math.round((new Date(to) - new Date(from)) / 864e5) + 1;
        try {
          rows = check(await db.rpc('get_availability_calendar', { p_from: from, p_days: span, p_duration: dur, p_ignore: ignoreId }));
        } catch (e) { if (token === calToken) slots.replaceChildren(h('p', { class: 'error-text', text: errMsg(e) })); return; }
      }
      if (token !== calToken) return;
      calData = new Map(rows.map(r => [r.cal_date, r]));
      for (const c of cells) {
        const r = calData.get(c.dataset.date);
        c.classList.remove('is-loading');
        const sub = c.querySelector('.cal-sub');
        if (!r || r.is_closed) { c.classList.add('is-closed'); sub.textContent = r ? 'Closed' : ''; continue; }
        if (r.open_slots === 0) { c.classList.add('is-full'); sub.textContent = c.dataset.date === today ? 'No slots' : 'Full'; continue; }
        c.disabled = false;
        c.classList.add(r.open_slots <= 3 ? 'is-low' : 'is-open');
        sub.textContent = `${r.open_slots} slot${r.open_slots > 1 ? 's' : ''}`;
      }
      // Keep the chosen day if still bookable, otherwise jump to the first open day.
      if (selDate && calData.get(selDate) && !calData.get(selDate).is_closed && calData.get(selDate).open_slots > 0) markSelected();
      else if (!selDate || selDate.slice(0, 7) === month) {
        const firstOpen = rows.find(r => !r.is_closed && r.open_slots > 0);
        if (firstOpen) { await selectDate(firstOpen.cal_date, true); return; }
        selDate = null; selTime = null; onChange({ date: null, time: null });
        slotsTitle.textContent = '';
        slots.replaceChildren(h('p', { class: 'muted', text: rows.length ? 'No open times this month. Try the next month.' : 'Bookings are not open for this month yet.' }));
      }
      if (selDate) drawSlots();
    }
    function markSelected() {
      grid.querySelectorAll('.cal-day').forEach(c => {
        const on = c.dataset.date === selDate;
        c.classList.toggle('is-selected', on);
        c.setAttribute('aria-pressed', String(on));
      });
    }
    async function selectDate(d, auto = false) {
      if (selDate !== d) { selTime = null; }
      selDate = d;
      markSelected();
      onChange({ date: selDate, time: selTime });
      await drawSlots();
      if (!auto) slots.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    async function drawSlots() {
      const dur = getDuration();
      if (!selDate || !dur) return;
      slotsTitle.textContent = fmtDate(selDate, { weekday: 'long', day: 'numeric', month: 'long' });
      slots.replaceChildren(...Array.from({ length: 8 }, () => h('span', { class: 'slot skeleton' })));
      const token = ++slotToken;
      let rows;
      try { rows = check(await db.rpc('get_day_availability', { p_date: selDate, p_duration: dur, p_ignore: ignoreId })); }
      catch (e) { if (token === slotToken) slots.replaceChildren(h('p', { class: 'error-text', text: errMsg(e) })); return; }
      if (token !== slotToken) return;
      if (selTime && !rows.some(r => r.slot_time.slice(0, 5) === selTime && r.free_bays > 0)) { selTime = null; onChange({ date: selDate, time: null }); }
      if (!rows.length) { slots.replaceChildren(h('p', { class: 'muted', text: 'No start times left on this day.' })); return; }
      const groups = [['Morning', r => r.slot_time < '12:00'], ['Afternoon', r => r.slot_time >= '12:00' && r.slot_time < '17:00'], ['Evening', r => r.slot_time >= '17:00']];
      const out = [];
      for (const [label, test] of groups) {
        const list = rows.filter(test);
        if (!list.length) continue;
        out.push(h('div', { class: 'slot-group' }, h('span', { class: 'slot-group-label', text: label }),
          h('div', { class: 'slot-row' }, list.map(r => {
            const t = r.slot_time.slice(0, 5), full = r.free_bays <= 0;
            const b = h('button', { type: 'button', class: 'slot' + (full ? ' is-full' : '') + (t === selTime ? ' is-selected' : ''), disabled: full, role: 'option', 'aria-selected': String(t === selTime) },
              h('strong', { text: fmtTime(t) }), h('small', { text: full ? 'Full' : r.free_bays === 1 ? '1 bay left' : `${r.free_bays} bays free` }));
            b.addEventListener('click', () => {
              selTime = t;
              slots.querySelectorAll('.slot').forEach(s => { s.classList.remove('is-selected'); s.setAttribute('aria-selected', 'false'); });
              b.classList.add('is-selected'); b.setAttribute('aria-selected', 'true');
              onChange({ date: selDate, time: selTime });
            });
            return b;
          }))));
      }
      slots.replaceChildren(...out);
    }

    drawCalendar();
    return {
      refresh: () => drawCalendar(),
      get value() { return { date: selDate, time: selTime }; }
    };
  }
  window.AAD.createScheduler = createScheduler;
})();
