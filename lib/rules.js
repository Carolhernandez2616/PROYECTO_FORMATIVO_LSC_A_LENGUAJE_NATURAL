'use strict';
/* Reglas de autorización de /api/save/:colección. Trabajan sobre un "dao" (ver dao.js) y sobre el usuario ya autenticado.
   El servidor NUNCA confía en el id, nombre o rol que envía el navegador. */
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const deny = (m = 'No tienes permiso para realizar esta acción.') => { throw new HttpError(403, m); };
const invalid = (m = 'Los datos enviados no son válidos.') => { throw new HttpError(400, m); };

const toId = v => {
  const n = typeof v === 'string' && /^\d{1,18}$/.test(v) ? Number(v) : v;
  if (!Number.isSafeInteger(n) || n <= 0) invalid('Identificador no válido.');
  return n;
};
const arr = v => (Array.isArray(v) ? v : []);
const raw = (v, max) => { if (v == null) return null; if (typeof v !== 'string' || v.length > max) invalid('Un texto es demasiado largo o no es válido.'); return v; };
const text = (v, max, required = false) => {
  if (v == null || (typeof v === 'string' && !v.trim())) { if (required) invalid('Falta un dato obligatorio.'); return null; }
  if (typeof v !== 'string' || v.length > max) invalid('Un texto es demasiado largo o no es válido.');
  return v.trim();
};
const flag = v => (v ? 1 : 0);
const mergeHidden = (existing, submitted, me) => {
  const base = arr(existing).map(Number);
  if (arr(submitted).some(v => Number(v) === me) && !base.includes(me)) base.push(me);
  return base.length ? base : null; // nadie puede "des-ocultar" ni tocar lo oculto por otras personas
};
const mergeNames = (curJson, submitted, me) => {
  let cur = {}; try { cur = curJson ? JSON.parse(curJson) : {}; } catch { cur = {}; }
  const v = submitted && typeof submitted === 'object' ? submitted[String(me)] : undefined;
  if (typeof v === 'string' && v.trim()) cur[String(me)] = v.trim().slice(0, 160); // solo tu propio nombre para el chat
  return Object.keys(cur).length ? JSON.stringify(cur) : null;
};
const clampTime = t => (Number.isSafeInteger(t) && t > 0 && t < Date.now() + 86400e3 ? t : Date.now());

async function applyReactions(dao, kind, target, uid, r) {
  if (!r || typeof r !== 'object') return;
  for (const type of ['like', 'love']) {
    if (!Array.isArray(r[type])) continue;
    await dao.setReaction(kind, target, uid, type, r[type].some(v => Number(v) === uid)); // solo cuenta tu propia reacción
  }
}

async function presence(dao, u, up) {
  for (const p of up) {
    if (toId(p.id) !== u.id) deny('Solo puedes registrar tu propia presencia.');
    const last = Number.isSafeInteger(p.last) && p.last <= Date.now() + 60000 ? p.last : Date.now();
    await dao.upsertPresence(u.id, last, !!p.online);
  }
}

async function chats(dao, u, up, rm) {
  for (const x of up) {
    const id = toId(x.id), add = arr(x.membersAdd).map(toId), rem = arr(x.membersRemove).map(toId);
    const cur = await dao.chat(id);
    if (!cur) {
      if (toId(x.owner) !== u.id || add.length !== 1 || add[0] !== u.id || rem.length) deny('Un chat nuevo solo puede crearse contigo como único miembro.');
      await dao.insertChat({ id, title: text(x.title, 160, true), owner: u.id, names: mergeNames(null, x.names, u.id) });
      await dao.addMembers(id, [u.id]);
    } else {
      const members = (await dao.chatMembers(id)).map(Number);
      if (!members.includes(u.id)) deny('No perteneces a este chat.');
      const isOwner = Number(cur.owner) === u.id;
      const title = isOwner && text(x.title, 160) ? text(x.title, 160) : cur.title;
      await dao.updateChat(id, { title, names: mergeNames(cur.names, x.names, u.id) });
      for (const r of rem) {
        if (r === Number(cur.owner)) deny('La persona creadora no puede salir; debe eliminar el chat.');
        if (r !== u.id && !isOwner) deny('Solo puedes salir tú o, si creaste el chat, quitar a otra persona.');
      }
      if (rem.length) await dao.removeMembers(id, rem);
      if (add.length) {
        if ((await dao.usersExist([...new Set(add)])) !== new Set(add).size) invalid('Alguna persona invitada no existe.');
        await dao.addMembers(id, add);
      }
    }
    for (const m of arr(x.msgs)) await message(dao, u, id, m);
  }
  for (const idRaw of rm) {
    const id = toId(idRaw), cur = await dao.chat(id);
    if (!cur) continue;
    if (Number(cur.owner) !== u.id) deny('Solo quien creó el chat puede eliminarlo para todos.');
    await dao.deleteChat(id);
  }
}

async function message(dao, u, chatId, m) {
  if (!m || typeof m !== 'object') invalid();
  const mid = String(m.id || m.t || '');
  if (!mid || mid.length > 40) invalid('Identificador de mensaje no válido.');
  const ex = await dao.message(mid);
  if (!ex) {
    if (m.uid == null || Number(m.uid) !== u.id) deny('Solo puedes enviar mensajes en tu propio nombre.');
    return dao.insertMessage({
      id: mid, chat_id: chatId, uid: u.id, from_role: u.role,
      sordo: raw(m.sordo, 5000), oyente: raw(m.oyente, 5000), orig: raw(m.orig, 5000), src: raw(m.src, 5),
      t: clampTime(m.t), type: m.type === 'call' ? 'call' : null,
      dur: Number.isSafeInteger(m.dur) && m.dur >= 0 && m.dur <= 86400 ? m.dur : null,
      deleted: flag(m.deleted), edited: flag(m.edited), fwd: flag(m.fwd), audio: null,
      hidden_for: mergeHidden(null, m.hiddenFor, u.id)
    });
  }
  if (Number(ex.chat_id) !== chatId) deny();
  const patch = { hidden_for: mergeHidden(ex.hidden_for, m.hiddenFor, u.id) };
  if (Number(ex.uid) === u.id && !ex.deleted) {
    if (m.deleted) Object.assign(patch, { deleted: 1, sordo: '', oyente: '', orig: null, audio: null });
    else Object.assign(patch, { sordo: raw(m.sordo, 5000), oyente: raw(m.oyente, 5000), orig: raw(m.orig, 5000), src: raw(m.src, 5), edited: flag(m.edited) });
  }
  return dao.updateMessage(mid, patch);
}

async function posts(dao, u, up, rm) {
  for (const x of up) {
    const id = toId(x.id), cur = await dao.post(id);
    if (!cur) {
      if (id === 1) deny();
      if (String(x.uid) !== String(u.id)) deny('Solo puedes publicar en tu propio nombre.');
      await dao.insertPost({ id, uid: String(u.id), name: u.name, role: u.role, text: text(x.text, 5000, true) });
    } else if (String(cur.uid) === String(u.id) && !cur.pinned) {
      const t = text(x.text, 5000); if (t && t !== cur.text) await dao.updatePostText(id, t);
    }
    await applyReactions(dao, 'p', id, u.id, x.r);
  }
  for (const idRaw of rm) {
    const id = toId(idRaw), cur = await dao.post(id);
    if (!cur) continue;
    if (cur.pinned || cur.uid === 'ejemplo') deny('La publicación de ejemplo no se puede borrar.');
    if (String(cur.uid) !== String(u.id) && u.role !== 'admin') deny('Solo quien publicó o el administrador puede borrar una publicación.');
    await dao.deletePost(id);
  }
}

async function comments(dao, u, up, rm) {
  for (const x of [...up].sort((a, b) => Number(a.id) - Number(b.id))) {
    const id = toId(x.id), cur = await dao.comment(id);
    if (!cur) {
      if (id === 2) deny();
      if (String(x.uid) !== String(u.id)) deny('Solo puedes comentar en tu propio nombre.');
      const postId = toId(x.postId);
      if (!(await dao.post(postId))) invalid('La publicación ya no existe.');
      const parentId = x.parentId == null ? null : toId(x.parentId);
      if (parentId) { const p = await dao.comment(parentId); if (!p || Number(p.post_id) !== postId) invalid('El comentario al que respondes ya no existe.'); }
      await dao.insertComment({ id, post_id: postId, parent_id: parentId, uid: String(u.id), name: u.name, role: u.role, text: text(x.text, 2000, true) });
    } else if (String(cur.uid) === String(u.id)) {
      const t = text(x.text, 2000); if (t && t !== cur.text) await dao.updateCommentText(id, t);
    }
    await applyReactions(dao, 'c', id, u.id, x.r);
  }
  const ids = [...new Set(rm.map(toId))];
  if (!ids.length) return;
  const rows = await dao.commentsIn(ids), set = new Set(rows.map(r => Number(r.id)));
  const roots = rows.filter(r => !set.has(Number(r.parent_id)));
  for (const r of roots) {
    if (r.uid === 'ejemplo') deny('Ese comentario no se puede borrar.');
    if (String(r.uid) !== String(u.id) && u.role !== 'admin') deny('Solo quien comentó o el administrador puede borrar un comentario.');
  }
  const all = new Set(roots.map(r => Number(r.id)));
  let frontier = [...all];
  while (frontier.length) {
    const kids = (await dao.childrenOf(frontier)).map(r => Number(r.id)).filter(i => !all.has(i));
    kids.forEach(i => all.add(i)); frontier = kids;
  }
  if (all.size) await dao.deleteComments([...all]);
}

const mediaOf = reply => {
  if (!reply) return null;
  if (typeof reply === 'string') return { text: raw(reply, 5000) || '', t: Date.now(), media: [] };
  const media = arr(reply.media).slice(0, 6).map(m => {
    if (!m || !['image', 'video'].includes(m.type) || typeof m.src !== 'string' || !m.src.startsWith('data:' + m.type + '/') || m.src.length > 40e6) invalid('Archivo adjunto no válido.');
    return { type: m.type, src: m.src, name: raw(m.name, 190) };
  });
  return { text: raw(reply.text, 5000) || '', t: clampTime(reply.t), media };
};
async function contacts(dao, u, up, rm) {
  for (const x of up) {
    const id = toId(x.id), cur = await dao.contact(id);
    if (!cur) {
      if (u.role === 'admin') deny('El administrador no envía solicitudes.');
      if (toId(x.uid) !== u.id) deny('Solo puedes enviar solicitudes en tu propio nombre.');
      await dao.insertContact({ id, uid: u.id, name: text(x.name, 120, true), email: text(x.email, 190, true), role: text(x.role, 40), urole: u.role,
        subject: text(x.subject, 160), message: text(x.message, 5000, true), wants_lsc: flag(x.wantsLsc) });
    } else {
      if (u.role !== 'admin') deny('Solo el administrador puede responder solicitudes.');
      await dao.setContactReply(id, mediaOf(x.reply));
    }
  }
  for (const idRaw of rm) {
    const id = toId(idRaw), cur = await dao.contact(id);
    if (cur && Number(cur.uid) !== u.id && u.role !== 'admin') deny();
    if (cur) await dao.deleteContact(id);
  }
}

async function glossary(dao, u, up, rm, arg) {
  if (toId(arg) !== u.id) deny('Solo puedes modificar tu propio glosario.');
  for (const x of up) {
    const id = toId(x.id), ex = await dao.glRow(id);
    if (ex && Number(ex.user_id) !== u.id) deny();
    await dao.upsertGl(u.id, { id, es: text(x.es, 255, true), lsc: text(x.lsc, 255, true), cat: text(x.cat, 60) });
  }
  if (rm.length) await dao.deleteGl(u.id, rm.map(toId));
}

const RULES = { presence, chats, posts, cmts: comments, contacts, gl: glossary };
async function applySave(name, dao, user, body) {
  const rule = RULES[name];
  if (!rule) throw new HttpError(name === 'users' ? 403 : 404, name === 'users' ? 'Los usuarios solo se gestionan desde el inicio de sesión.' : 'Colección desconocida.');
  const b = body || {}, up = b.upsert === undefined ? [] : b.upsert, rm = b.remove === undefined ? [] : b.remove;
  if (!Array.isArray(up) || !Array.isArray(rm) || up.length > 500 || rm.length > 500 || up.some(x => !x || typeof x !== 'object')) invalid('Formato de datos no válido.');
  await rule(dao, user, up, rm, b.arg);
}
module.exports = { applySave, HttpError };
