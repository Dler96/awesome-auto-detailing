(() => {
  'use strict';
  const A = window.AAD;
  const { $, h, icon, check, run, toast, confirmBox } = A;
  const params = new URLSearchParams(location.search);
  const nextUrl = () => { const n = params.get('next'); return n && n.startsWith('/') && !n.startsWith('//') ? n : null; };
  const USERNAME = /^(?=.*[a-z])[a-z0-9]{3,12}$/;

  A.start(async state => {
    if (!state.user) authScreen(params.get('mode') === 'register' ? 'register' : 'login');
    else await accountScreen();
  });

  // ---------------- logged out ----------------
  function authScreen(mode) {
    const art = h('div', { class: 'auth-art' },
      h('img', { src: '/assets/logo.webp', alt: A.BRAND }),
      h('div', {}, h('h2', { text: mode === 'register' ? 'Join the club' : 'Welcome back', style: { fontSize: '44px' } }),
        h('ul', {},
          h('li', {}, icon('calendar'), 'Book and reschedule in seconds'),
          h('li', {}, icon('car'), 'Save your cars for one-tap booking'),
          h('li', {}, icon('receipt'), 'Track payments and booking history'),
          h('li', {}, icon('whatsapp'), 'Message us straight from your booking'))),
      h('p', { class: 'dim', text: A.cfg.ownerLine || '' }));
    const box = h('div', { class: 'auth-box' }, mode === 'register' ? registerForm() : loginForm());
    $('#account-root').replaceChildren(h('div', { class: 'auth-shell' }, art, h('div', { class: 'auth-panel' }, box)));
  }
  function pwField(id, auto, placeholder) {
    const input = h('input', { id, type: 'password', autocomplete: auto, required: true, placeholder });
    const t = h('button', { type: 'button', 'aria-label': 'Show password', onclick: () => { const show = input.type === 'password'; input.type = show ? 'text' : 'password'; t.textContent = show ? 'Hide' : 'Show'; } }, 'Show');
    return { input, el: h('div', { class: 'pw-wrap' }, input, t) };
  }
  const switchLink = (to, text, link) => h('p', { class: 'auth-switch' }, text + ' ',
    h('button', { class: 'link-btn', type: 'button', onclick: () => { history.replaceState(null, '', '/account' + (to === 'register' ? '?mode=register' : '') + (nextUrl() ? (to === 'register' ? '&' : '?') + 'next=' + encodeURIComponent(nextUrl()) : '')); authScreen(to); } }, link));

  function loginForm() {
    let emailMode = false;
    const idLabel = h('label', { for: 'login-id', text: 'Username' });
    const id = h('input', { id: 'login-id', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true, placeholder: 'Your username' });
    const pw = pwField('login-pw', 'current-password', 'Your password');
    const toggle = h('button', { class: 'link-btn', type: 'button', style: { fontSize: '13px' } }, 'Admin / email login');
    toggle.addEventListener('click', () => {
      emailMode = !emailMode;
      idLabel.textContent = emailMode ? 'Email' : 'Username';
      id.type = emailMode ? 'email' : 'text'; id.placeholder = emailMode ? 'you@example.com' : 'Your username';
      toggle.textContent = emailMode ? 'Use username instead' : 'Admin / email login';
    });
    const form = h('form', {},
      h('h1', { text: 'Log in' }), h('p', { text: nextUrl() === '/book' ? 'Log in to confirm your booking — your selections are saved.' : 'Manage your bookings and saved cars.' }),
      h('div', { class: 'field' }, idLabel, id),
      h('div', { class: 'field' }, h('label', { for: 'login-pw', text: 'Password' }), pw.el),
      h('button', { class: 'btn btn-primary btn-block btn-lg', type: 'submit' }, 'Log in', icon('arrow')),
      h('div', { class: 'row-end', style: { justifyContent: 'space-between' } }, toggle,
        h('button', { class: 'link-btn', type: 'button', style: { fontSize: '13px' }, onclick: () => forgot(emailMode, id.value) }, 'Forgot password?')),
      switchLink('register', 'New here?', 'Create an account'));
    form.addEventListener('submit', e => { e.preventDefault(); run(async () => {
      const raw = id.value.trim();
      let email;
      if (emailMode || raw.includes('@')) email = raw;
      else { const u = raw.toLowerCase(); if (!USERNAME.test(u)) throw new Error('Enter your username (3–12 letters and numbers).'); email = `${u}@${A.USER_DOMAIN}`; }
      const res = await A.db.auth.signInWithPassword({ email, password: pw.input.value });
      if (res.error) throw new Error(/invalid/i.test(res.error.message) ? 'Wrong username or password.' : res.error.message);
      A.clearCatalogCache();
      toast('Welcome back!');
      location.href = nextUrl() || '/my-bookings';
    }, form); });
    return form;
  }
  async function forgot(emailMode, value) {
    if (!emailMode || !value.includes('@')) {
      const wa = A.shopWa(`Hi ${A.BRAND}, I forgot the password for my booking account. My username is: `);
      toast('Username accounts are reset by our team — message us on WhatsApp.', 'ok', 7000);
      if (wa) window.open(wa, '_blank', 'noopener');
      return;
    }
    await run(async () => {
      check(await A.db.auth.resetPasswordForEmail(value.trim(), { redirectTo: location.origin + '/account?reset=1' }));
      toast('If that email is registered, a reset link is on its way.');
    });
  }

  function registerForm() {
    const name = h('input', { id: 'reg-name', autocomplete: 'name', maxlength: '80', required: true, placeholder: 'Your name' });
    const phone = h('input', { id: 'reg-phone', type: 'tel', autocomplete: 'tel', maxlength: '24', required: true, placeholder: '0123456789' });
    const user = h('input', { id: 'reg-user', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', maxlength: '12', required: true, placeholder: 'e.g. amir88' });
    const pw = pwField('reg-pw', 'new-password', '8+ characters with a number');
    const form = h('form', {},
      h('h1', { text: 'Create account' }), h('p', { text: 'Takes 20 seconds. No email needed.' }),
      h('div', { class: 'form-grid' },
        h('div', { class: 'field' }, h('label', { for: 'reg-name', text: 'Name' }), name),
        h('div', { class: 'field' }, h('label', { for: 'reg-phone', text: 'WhatsApp number' }), phone)),
      h('div', { class: 'field' }, h('label', { for: 'reg-user', text: 'Choose a username' }), user, h('small', { text: '3–12 lowercase letters and numbers, e.g. amir88. You will log in with this.' })),
      h('div', { class: 'field' }, h('label', { for: 'reg-pw', text: 'Create a password' }), pw.el, h('small', { text: 'At least 8 characters, including a letter and a number.' })),
      h('button', { class: 'btn btn-primary btn-block btn-lg', type: 'submit' }, 'Create account', icon('arrow')),
      switchLink('login', 'Already have an account?', 'Log in'));
    form.addEventListener('submit', e => { e.preventDefault(); run(async () => {
      const u = user.value.trim().toLowerCase(), p = pw.input.value;
      if (!name.value.trim()) throw new Error('Enter your name.');
      if (!/^\+?[0-9][0-9 ()-]{6,23}$/.test(phone.value.trim())) throw new Error('Enter a valid WhatsApp number.');
      if (!USERNAME.test(u)) throw new Error('Username: 3–12 lowercase letters and numbers, with at least one letter.');
      if (p.length < 8 || !/[a-zA-Z]/.test(p) || !/[0-9]/.test(p)) throw new Error('Password needs 8+ characters with a letter and a number.');
      const res = await A.db.auth.signUp({ email: `${u}@${A.USER_DOMAIN}`, password: p, options: { data: { username: u, full_name: name.value.trim(), phone: phone.value.trim() } } });
      if (res.error) throw new Error(/registered|exists/i.test(res.error.message) ? 'That username is taken. Try another.' : res.error.message);
      if (!res.data.session) {
        if (res.data.user?.identities?.length === 0) throw new Error('That username is taken. Try another.');
        throw new Error('Account created but sign-in is waiting for activation. Please contact us.');
      }
      toast('Account created — welcome!');
      location.href = nextUrl() || '/book';
    }, form); });
    return form;
  }

  // ---------------- logged in ----------------
  async function accountScreen() {
    const s = A.state, p = s.profile || {};
    const cat = s.catalog;
    const name = h('input', { id: 'p-name', maxlength: '80', value: p.full_name || '', required: true });
    const phone = h('input', { id: 'p-phone', type: 'tel', maxlength: '24', value: p.phone || '', required: true });
    const profileForm = h('form', { class: 'card' },
      h('h2', { text: 'My details' }),
      h('p', { class: 'muted', text: p.username ? `Username: ${p.username}` : `Signed in as ${s.user.email}` }),
      h('div', { class: 'field' }, h('label', { for: 'p-name', text: 'Name' }), name),
      h('div', { class: 'field' }, h('label', { for: 'p-phone', text: 'WhatsApp number' }), phone),
      h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save details'));
    profileForm.addEventListener('submit', e => { e.preventDefault(); run(async () => {
      if (!/^\+?[0-9][0-9 ()-]{6,23}$/.test(phone.value.trim())) throw new Error('Enter a valid WhatsApp number.');
      check(await A.db.from('profiles').update({ full_name: name.value.trim(), phone: phone.value.trim() }).eq('id', s.user.id));
      s.profile = { ...p, full_name: name.value.trim(), phone: phone.value.trim() };
      A.renderHeader(); toast('Details saved.');
    }, profileForm); });

    const pw1 = h('input', { type: 'password', autocomplete: 'new-password', minlength: '8', required: true });
    const pwForm = h('form', { class: 'card' },
      h('h2', { text: params.get('reset') ? 'Set a new password' : 'Change password' }),
      h('div', { class: 'field' }, h('label', { text: 'New password' }), pw1, h('small', { text: 'At least 8 characters, including a letter and a number.' })),
      h('button', { class: 'btn btn-ghost', type: 'submit' }, 'Update password'));
    pwForm.addEventListener('submit', e => { e.preventDefault(); run(async () => {
      const v = pw1.value;
      if (v.length < 8 || !/[a-zA-Z]/.test(v) || !/[0-9]/.test(v)) throw new Error('Password needs 8+ characters with a letter and a number.');
      check(await A.db.auth.updateUser({ password: v }));
      pwForm.reset(); toast('Password updated.');
    }, pwForm); });

    const garage = h('div', { class: 'card' });
    const drawGarage = async () => {
      const list = check(await A.db.from('vehicles').select('*').eq('owner_id', s.user.id).order('created_at'));
      garage.replaceChildren(
        h('div', { class: 'admin-head', style: { marginBottom: '6px' } }, h('h2', { text: 'My garage', style: { margin: 0 } }),
          h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => vehicleModal(null, drawGarage) }, icon('plus'), 'Add car')),
        list.length ? h('div', {}, list.map(v => h('div', { class: 'vehicle-item' },
          h('span', { class: 'plate', text: v.plate }),
          h('div', {}, h('strong', { text: v.make_model }), h('small', { text: [v.color, cat.type(v.vehicle_type_id)?.name].filter(Boolean).join(' · ') })),
          h('a', { class: 'btn btn-primary btn-xs', href: `/book${v.vehicle_type_id ? '?size=' + v.vehicle_type_id : ''}`, onclick: () => {
            try { sessionStorage.setItem('aad-draft', JSON.stringify({ ...JSON.parse(sessionStorage.getItem('aad-draft') || '{}'), vehicleId: v.id, plate: v.plate, make: v.make_model, color: v.color, typeId: v.vehicle_type_id, step: 0 })); } catch { /* ignore */ }
          } }, 'Book'),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Edit', onclick: () => vehicleModal(v, drawGarage) }, icon('edit')),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Remove', onclick: async () => {
            if (!(await confirmBox('Remove this car?', `${v.plate} will be removed from your garage. Past bookings are kept.`, 'Remove', true))) return;
            run(async () => { check(await A.db.from('vehicles').delete().eq('id', v.id)); toast('Car removed.'); drawGarage(); });
          } }, icon('trash'))))) : h('p', { class: 'muted', text: 'No saved cars yet. Cars you book are saved here automatically.' }));
    };

    $('#account-root').replaceChildren(
      h('section', { class: 'page-hero' }, h('div', { class: 'wrap' },
        h('span', { class: 'eyebrow', text: 'My account' }), h('h1', { text: `Hi, ${(p.full_name || p.username || 'there').split(' ')[0]}` }),
        h('p', {}, 'Manage your details and saved cars. ', h('a', { href: '/my-bookings' }, 'View my bookings →')))),
      h('section', { class: 'wrap page-pad' },
        p.booking_enabled === false ? h('div', { class: 'notice notice-warn', text: 'Online booking is paused for this account. Please WhatsApp us.' }) : null,
        h('div', { class: 'account-grid' }, h('div', { style: { display: 'grid', gap: '24px' } }, profileForm, pwForm), garage),
        h('div', { class: 'row-end' }, h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => A.signOut() }, icon('logout'), 'Log out'))));
    await drawGarage();
    if (params.get('reset')) pwForm.scrollIntoView({ behavior: 'smooth' });
  }

  function vehicleModal(v, done) {
    const cat = A.state.catalog;
    const plate = h('input', { maxlength: '12', value: v?.plate || '', style: { textTransform: 'uppercase' }, required: true });
    const make = h('input', { maxlength: '60', value: v?.make_model || '', required: true });
    const color = h('input', { maxlength: '30', value: v?.color || '' });
    const size = h('select', {}, cat.activeTypes.map(t => h('option', { value: t.id, text: t.name, selected: v?.vehicle_type_id === t.id })));
    const btn = h('button', { class: 'btn btn-primary', type: 'submit' }, v ? 'Save car' : 'Add car');
    const form = h('form', {},
      h('div', { class: 'form-grid' },
        h('div', { class: 'field' }, h('label', { text: 'Plate number' }), plate),
        h('div', { class: 'field' }, h('label', { text: 'Vehicle size' }), size),
        h('div', { class: 'field' }, h('label', { text: 'Make & model' }), make),
        h('div', { class: 'field' }, h('label', { text: 'Colour' }), color)),
      h('div', { class: 'row-end' }, btn));
    const m = A.modal(v ? 'Edit car' : 'Add a car', form);
    form.addEventListener('submit', e => { e.preventDefault(); run(async () => {
      const row = { plate: plate.value.toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim(), make_model: make.value.trim(), color: color.value.trim(), vehicle_type_id: size.value };
      if (!/^[A-Z0-9 ]{2,12}$/.test(row.plate)) throw new Error('Enter a valid plate number.');
      if (!row.make_model) throw new Error('Enter the make and model.');
      check(await (v ? A.db.from('vehicles').update(row).eq('id', v.id) : A.db.from('vehicles').insert(row)));
      m.close(); toast(v ? 'Car updated.' : 'Car added.'); done();
    }, form); });
  }
})();
