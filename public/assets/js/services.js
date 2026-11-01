(() => {
  'use strict';
  const A = window.AAD;
  const { $, h, icon, money, duration } = A;

  A.start(async () => {
    const cat = A.state.catalog;
    let size = null;
    try { size = localStorage.getItem('aad-size'); } catch { /* ignore */ }
    if (!cat.activeTypes.some(t => t.id === size)) size = cat.activeTypes[0]?.id || null;

    const sw = $('#size-switch');
    const draw = () => {
      sw.replaceChildren(...cat.activeTypes.map(t => h('button', { type: 'button', 'aria-pressed': String(t.id === size), onclick: () => { size = t.id; try { localStorage.setItem('aad-size', size); } catch { /* ignore */ } draw(); } }, t.name)));
      const type = cat.type(size);
      $('#size-hint').textContent = type?.description ? `e.g. ${type.description}` : '';
      $('#book-size').href = '/book' + (size ? `?size=${size}` : '');

      $('#packages').replaceChildren(...(cat.packages.length ? cat.packages.map(p => {
        const price = cat.price(p.id, size);
        return h('article', { class: 'pkg' },
          p.popular ? h('span', { class: 'ribbon', text: 'Popular' }) : null,
          h('div', { class: 'pkg-media' }, p.image_path ? h('img', { src: A.imageUrl(p.image_path), alt: p.name, loading: 'lazy' }) : icon('sparkle')),
          h('div', { class: 'pkg-body' },
            h('h3', { text: p.name }), h('p', { text: p.description }),
            h('div', { class: 'pkg-meta' },
              h('div', { class: 'price' }, h('small', { text: type?.name || '' }), price == null ? 'N/A' : money(price)),
              h('span', { class: 'chip' }, icon('clock'), duration(p.duration_minutes))),
            price == null
              ? h('button', { class: 'btn btn-ghost btn-block', disabled: true }, 'Not available for this size')
              : h('a', { class: 'btn btn-primary btn-block', href: `/book?package=${p.id}&size=${size}` }, 'Book & customise')));
      }) : [h('p', { class: 'muted', text: 'No packages yet.' })]));

      $('#addons').replaceChildren(...(cat.addons.length ? cat.addons.map(a => {
        const price = cat.price(a.id, size);
        return h('tr', {},
          h('td', {}, h('strong', { text: a.name }), a.description ? h('div', { class: 'muted', style: { fontSize: '13px' }, text: a.description }) : null),
          h('td', {}, h('span', { class: 'chip' }, icon('clock'), '+' + duration(a.duration_minutes))),
          h('td', {}, h('strong', { class: 'price', style: { fontSize: '24px' }, text: price == null ? '—' : '+' + money(price) })));
      }) : [h('tr', {}, h('td', { colspan: '3', class: 'muted', text: 'No add-ons yet.' }))]));
    };
    draw();

    // Full matrix
    const all = [...cat.packages, ...cat.addons];
    $('#matrix').replaceChildren(
      h('thead', {}, h('tr', {}, h('th', { text: 'Service' }), h('th', { text: 'Time' }), cat.activeTypes.map(t => h('th', { text: t.name })))),
      h('tbody', {}, all.map(s => h('tr', {},
        h('td', {}, h('strong', { text: s.name }), ' ', h('span', { class: 'dim', text: s.kind === 'addon' ? '(add-on)' : '' })),
        h('td', { text: duration(s.duration_minutes) }),
        cat.activeTypes.map(t => { const p = cat.price(s.id, t.id); return h('td', { text: p == null ? '—' : money(p) }); })))));
  });
})();
