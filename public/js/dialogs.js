/* Ventanas modales (Bootstrap) que reemplazan alert(), confirm() y prompt() del navegador. */
const Dlg = (() => {
  const EMO = '😀 😂 😍 😎 🥳 😊 🤗 🤔 😢 😡 🤟 👋 👍 🙏 💪 ❤️ 💜 💙 💚 🌟 🔥 🎉 🌈 🐶 🐱 🏠 📚 ⚽ 🎵'.split(' ');
  let el, queue = Promise.resolve();
  const build = () => {
    if (el) return;
    document.body.insertAdjacentHTML('beforeend', `
<div class="modal fade" id="dlgModal" tabindex="-1" aria-hidden="true" aria-labelledby="dlgTitle"><div class="modal-dialog modal-dialog-centered"><div class="modal-content" style="border-radius:24px">
  <div class="modal-header"><h3 class="modal-title fs-5" id="dlgTitle">Aviso</h3><button type="button" class="btn-close" id="dlgX" aria-label="Cerrar"></button></div>
  <div class="modal-body"><p id="dlgMsg" class="mb-2" style="white-space:pre-line"></p><input id="dlgInput" class="form-control" hidden autocomplete="off"><div id="dlgEmoji" class="dlg-emoji" hidden></div></div>
  <div class="modal-footer"><button type="button" class="btn btn-soft" id="dlgNo">Cancelar</button><button type="button" class="btn btn-grad" id="dlgOk">Aceptar</button></div>
</div></div></div>`);
    el = document.getElementById('dlgModal');
  };
  const open = o => {
    const run = () => new Promise(res => {
      build();
      const $ = id => el.querySelector(id), emo = el.querySelector('#dlgEmoji'), inp = $('#dlgInput'), ok = $('#dlgOk'), no = $('#dlgNo');
      const modal = bootstrap.Modal.getOrCreateInstance(el, { backdrop: 'static' });
      let result = o.input ? null : false;
      $('#dlgTitle').textContent = o.title; $('#dlgMsg').textContent = o.msg;
      inp.hidden = !o.input; inp.type = o.type || 'text'; inp.value = o.value || '';
      emo.hidden = !o.emoji;
      if (o.emoji) {
        emo.innerHTML = EMO.map(e => `<button type="button">${e}</button>`).join('');
        emo.onclick = ev => { const b = ev.target.closest('button'); if (!b) return; const a = inp.selectionStart ?? inp.value.length, z = inp.selectionEnd ?? a;
          inp.value = inp.value.slice(0, a) + b.textContent + inp.value.slice(z); inp.focus(); const q = a + b.textContent.length; inp.setSelectionRange(q, q); };
      }
      no.hidden = o.single; ok.textContent = o.ok || 'Aceptar';
      ok.className = 'btn ' + (o.danger ? 'btn-danger' : 'btn-grad');
      const done = v => { result = v; modal.hide(); };
      ok.onclick = () => done(o.input ? inp.value : true);
      no.onclick = $('#dlgX').onclick = () => done(o.input ? null : false);
      inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); ok.click(); } };
      el.addEventListener('shown.bs.modal', () => (o.input ? inp : ok).focus(), { once: true });
      el.addEventListener('hidden.bs.modal', () => res(o.single ? undefined : result), { once: true });
      modal.show();
    });
    const p = queue.then(run); queue = p.then(() => {}, () => {}); return p;
  };
  const clean = m => String(m).replace(/:\s*$/, '');
  return {
    alert: (msg, title = 'Aviso') => open({ msg, title, single: true }),
    confirm: (msg, o = {}) => open({ msg, title: o.title || 'Confirmar', ok: o.ok || 'Aceptar', danger: o.danger ?? /elimin|borr/i.test(msg) }),
    prompt: (msg, value = '', o = {}) => open({
      msg: clean(msg), value, input: true, emoji: !!o.emoji, ok: o.ok || 'Guardar',
      type: o.type || (/contraseña/i.test(msg) ? 'password' : /correo/i.test(msg) ? 'email' : 'text'),
      title: o.title || (/contraseña/i.test(msg) ? 'Contraseña' : /correo/i.test(msg) ? 'Correo electrónico' : /nombre/i.test(msg) ? 'Nombre' : /respuesta/i.test(msg) ? 'Responder' : 'Editar')
    })
  };
})();
