/* Capa de datos: mantiene la interfaz store.get / store.set, pero guarda en MySQL a través de server.js.
   Cada petición lleva el token de sesión; el servidor decide qué datos recibe y qué cambios acepta cada persona. */
(async () => {
  const clone = x => JSON.parse(JSON.stringify(x)), J = JSON.stringify;
  const NAMES = { lsc_users: 'users', lsc_chats: 'chats', lsc_posts: 'posts', lsc_cmts: 'cmts', lsc_contacts: 'contacts', lsc_presence: 'presence' };
  const resolve = k => NAMES[k] ? { n: NAMES[k] } : /^lsc_gl_(\d+)$/.test(k) ? { n: 'gl', a: +k.slice(7) } : null;
  const mkey = m => String(m.id || m.t);
  const EMPTY = () => ({ users: [], chats: [], posts: [], cmts: [], contacts: [], presence: {}, gl: {} });
  let ending = false, DB = EMPTY(), pending = 0, revision = 0, queue = Promise.resolve();

  const token = () => sessionStorage.getItem('lsc_token');
  const authH = () => (token() ? { Authorization: 'Bearer ' + token() } : {});
  const dlg = (msg, title) => (typeof Dlg !== 'undefined' ? Dlg.alert(msg, title) : Promise.resolve());
  const endSession = () => { sessionStorage.removeItem('lsc_token'); sessionStorage.removeItem('lsc_session'); location.hash = '#login'; location.reload(); };

  const fail = e => {
    const st = e && e.status;
    if (st === 401) { if (ending) return; ending = true; return dlg('Tu sesión venció. Inicia sesión de nuevo.', 'Sesión vencida').then(endSession); }
    if (st === 403) { refresh(true); return dlg('No tienes permiso para realizar esa acción. Se restauraron los datos guardados.', 'Acción no permitida'); }
    if (st === 400 || st === 413 || st === 429) { refresh(true); return dlg('El servidor no aceptó el cambio (datos no válidos, demasiado grandes o demasiadas solicitudes).', 'No se guardó'); }
    return dlg('No se pudo guardar en la base de datos. Revisa que el servidor y MySQL estén encendidos.', 'Error de conexión');
  };
  const post = (name, body, keepalive) => fetch('/api/save/' + name, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authH() }, body: J(body), keepalive })
    .then(r => { if (!r.ok) { const e = new Error(r.status); e.status = r.status; throw e; } });

  window.DBSTORE = {
    get(k, d) {
      const r = resolve(k);
      if (!r) return JSON.parse(localStorage.getItem(k) || J(d));            // ej. tamaño de letra (preferencia local)
      const v = r.n === 'gl' ? DB.gl[r.a] : DB[r.n];
      return v === undefined ? d : clone(v);
    },
    set(k, v) {
      const r = resolve(k);
      if (!r) return localStorage.setItem(k, J(v));
      revision++;
      if (r.n === 'users') return;                                           // los usuarios solo se crean desde el registro (servidor)
      if (r.n === 'presence') {
        const prev = DB.presence;
        const body = { upsert: Object.entries(v).filter(([id, x]) => J(x) !== J(prev[id])).map(([id, x]) => ({ id: +id, last: x.last, online: !!x.online })), remove: [] };
        DB.presence = clone(v);
        if (body.upsert.length) post('presence', body, true).catch(() => {});
        return;
      }
      const prev = r.n === 'gl' ? (DB.gl[r.a] || []) : DB[r.n];
      const pm = new Map(prev.map(x => [String(x.id), x])), ids = new Set(v.map(x => String(x.id)));
      let upsert = v.filter(x => J(x) !== J(pm.get(String(x.id))));
      if (r.n === 'chats') upsert = upsert.map(c => {
        const old = pm.get(String(c.id)), om = new Map(((old && old.msgs) || []).map(m => [mkey(m), m])), oldM = (old && old.members) || [];
        return { ...c, membersAdd: (c.members || []).filter(id => !oldM.includes(id)), membersRemove: oldM.filter(id => !(c.members || []).includes(id)),
          msgs: c.msgs.filter(m => J(m) !== J(om.get(mkey(m)))) };            // solo mensajes nuevos o cambiados
      });
      const remove = [...pm.keys()].filter(i => !ids.has(i));
      if (r.n === 'gl') DB.gl[r.a] = clone(v); else DB[r.n] = clone(v);
      if (!upsert.length && !remove.length) return;
      pending++;
      queue = queue.then(() => post(r.n, { upsert, remove, arg: r.a ?? null })).catch(fail).finally(() => pending--);
    },
    async reload() { DB = await load(false); },
    headers: authH
  };

  async function load(initial) {
    const r = await fetch('/api/bootstrap', { headers: authH(), cache: 'no-store' });
    if (r.status === 401) {
      sessionStorage.removeItem('lsc_token'); sessionStorage.removeItem('lsc_session');   // token vencido: se vuelve a la pantalla de ingreso
      if (initial) return load(false);
      throw Object.assign(new Error('401'), { status: 401 });
    }
    if (!r.ok) throw new Error(r.status);
    return r.json();
  }
  try { DB = await load(true); } catch {
    document.body.insertAdjacentHTML('afterbegin', '<div style="padding:2rem;font:700 1.1rem sans-serif;color:#b00">No hay conexión con la base de datos. Inicia el servidor (npm start) y recarga la página.</div>');
    return;
  }
  const s = document.createElement('script'); s.src = 'js/app.js?v=6'; document.body.appendChild(s);

  /* Sincronización: cada 4 s trae los cambios de otras personas (chats, comunidad, contacto, panel admin) */
  async function refresh(force) {
    if (!token() || (!force && (pending || document.hidden))) return;
    try {
      const before = revision, f = await load(false);
      if (pending || before !== revision) return;                            // hubo cambios locales mientras llegaba la respuesta
      const changed = k => J(f[k]) !== J(DB[k]);
      const ch = changed('chats') || changed('users'), po = changed('posts') || changed('cmts'), co = changed('contacts');
      const adm = Object.keys(f).some(changed);
      DB = f;
      const typing = /INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '');
      const h = location.hash;
      if (ch && h === '#traductor' && typeof renderTrad === 'function' && !(typeof rec !== 'undefined' && rec)) renderTrad();
      if (po && h === '#comunidad' && !typing && typeof renderPosts === 'function') renderPosts();
      if (co && h === '#contacto' && !typing && typeof renderContact === 'function') renderContact();
      if (adm && h === '#admin' && !typing && typeof renderAdmin === 'function') renderAdmin();
    } catch (e) { if (e && e.status === 401) fail(e); }
  }
  setInterval(refresh, 4000);
})();
