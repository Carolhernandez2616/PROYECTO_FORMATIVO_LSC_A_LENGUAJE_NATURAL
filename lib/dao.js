'use strict';
/* Acceso a MySQL para las reglas de lib/rules.js. Recibe una conexión que ya está dentro de una transacción. */
const COLS = new Set(['sordo', 'oyente', 'orig', 'src', 'deleted', 'edited', 'audio', 'hidden_for']);
const one = async (c, sql, p) => { const [r] = await c.query(sql, p); return r[0] || null; };

module.exports = c => ({
  usersExist: async ids => { const [r] = await c.query('SELECT COUNT(*) n FROM users WHERE id IN (?)', [ids]); return Number(r[0].n); },
  upsertPresence: (uid, last, online) => c.query('INSERT INTO presence(user_id,last,online) VALUES(?,?,?) ON DUPLICATE KEY UPDATE last=VALUES(last),online=VALUES(online)', [uid, last, online ? 1 : 0]),

  chat: id => one(c, 'SELECT id,title,owner,names FROM chats WHERE id=? FOR UPDATE', [id]),
  chatMembers: async id => (await c.query('SELECT user_id FROM chat_members WHERE chat_id=?', [id]))[0].map(r => r.user_id),
  insertChat: x => c.query('INSERT INTO chats(id,title,owner,names) VALUES(?,?,?,?)', [x.id, x.title, x.owner, x.names]),
  updateChat: (id, x) => c.query('UPDATE chats SET title=?,names=? WHERE id=?', [x.title, x.names, id]),
  addMembers: (id, ids) => c.query('INSERT IGNORE INTO chat_members(chat_id,user_id) VALUES ?', [ids.map(u => [id, u])]),
  removeMembers: (id, ids) => c.query('DELETE FROM chat_members WHERE chat_id=? AND user_id IN (?)', [id, ids]),
  deleteChat: id => c.query('DELETE FROM chats WHERE id=?', [id]),

  message: async id => {
    const r = await one(c, 'SELECT id,chat_id,uid,deleted,hidden_for FROM messages WHERE id=? FOR UPDATE', [id]);
    return r && { ...r, deleted: !!r.deleted, hidden_for: r.hidden_for ? JSON.parse(r.hidden_for) : null };
  },
  insertMessage: r => c.query('INSERT INTO messages(id,chat_id,uid,from_role,sordo,oyente,orig,src,t,type,dur,deleted,edited,fwd,audio,hidden_for) VALUES(?)',
    [[r.id, r.chat_id, r.uid, r.from_role, r.sordo, r.oyente, r.orig, r.src, r.t, r.type, r.dur, r.deleted, r.edited, r.fwd, r.audio, r.hidden_for ? JSON.stringify(r.hidden_for) : null]]),
  updateMessage: (id, patch) => {
    const keys = Object.keys(patch).filter(k => COLS.has(k));
    if (!keys.length) return;
    return c.query(`UPDATE messages SET ${keys.map(k => `\`${k}\`=?`).join(',')} WHERE id=?`,
      [...keys.map(k => (k === 'hidden_for' ? (patch[k] ? JSON.stringify(patch[k]) : null) : patch[k])), id]);
  },

  post: id => one(c, 'SELECT id,uid,text,pinned FROM posts WHERE id=? FOR UPDATE', [id]),
  insertPost: x => c.query('INSERT INTO posts(id,uid,name,role,text,pinned) VALUES(?,?,?,?,?,0)', [x.id, x.uid, x.name, x.role, x.text]),
  updatePostText: (id, t) => c.query('UPDATE posts SET text=? WHERE id=?', [t, id]),
  deletePost: async id => {
    await c.query("DELETE FROM reactions WHERE kind='c' AND target_id IN (SELECT id FROM comments WHERE post_id=?)", [id]);
    await c.query("DELETE FROM reactions WHERE kind='p' AND target_id=?", [id]);
    await c.query('DELETE FROM posts WHERE id=?', [id]);
  },
  comment: id => one(c, 'SELECT id,post_id,parent_id,uid,text FROM comments WHERE id=? FOR UPDATE', [id]),
  insertComment: x => c.query('INSERT INTO comments(id,post_id,parent_id,uid,name,role,text) VALUES(?,?,?,?,?,?,?)', [x.id, x.post_id, x.parent_id, x.uid, x.name, x.role, x.text]),
  updateCommentText: (id, t) => c.query('UPDATE comments SET text=? WHERE id=?', [t, id]),
  commentsIn: async ids => (await c.query('SELECT id,parent_id,uid FROM comments WHERE id IN (?)', [ids]))[0],
  childrenOf: async ids => (await c.query('SELECT id FROM comments WHERE parent_id IN (?)', [ids]))[0],
  deleteComments: async ids => {
    await c.query("DELETE FROM reactions WHERE kind='c' AND target_id IN (?)", [ids]);
    await c.query('DELETE FROM comments WHERE id IN (?)', [ids]);
  },
  setReaction: (kind, target, uid, type, on) => on
    ? c.query('INSERT IGNORE INTO reactions(kind,target_id,user_id,type) VALUES(?,?,?,?)', [kind, target, uid, type])
    : c.query('DELETE FROM reactions WHERE kind=? AND target_id=? AND user_id=? AND type=?', [kind, target, uid, type]),

  contact: id => one(c, 'SELECT id,uid FROM contacts WHERE id=? FOR UPDATE', [id]),
  insertContact: x => c.query('INSERT INTO contacts(id,uid,name,email,role,urole,subject,message,wants_lsc,has_reply) VALUES(?,?,?,?,?,?,?,?,?,0)',
    [x.id, x.uid, x.name, x.email, x.role, x.urole, x.subject, x.message, x.wants_lsc]),
  setContactReply: async (id, r) => {
    await c.query('UPDATE contacts SET has_reply=?,reply_text=?,reply_t=? WHERE id=?', [r ? 1 : 0, r ? r.text : null, r ? r.t : null, id]);
    await c.query('DELETE FROM contact_media WHERE contact_id=?', [id]);
    if (r && r.media.length) await c.query('INSERT INTO contact_media(contact_id,type,src,name) VALUES ?', [r.media.map(m => [id, m.type, m.src, m.name])]);
  },
  deleteContact: id => c.query('DELETE FROM contacts WHERE id=?', [id]),

  glRow: id => one(c, 'SELECT id,user_id FROM glossary WHERE id=? FOR UPDATE', [id]),
  upsertGl: (uid, x) => c.query('INSERT INTO glossary(id,user_id,es,lsc,cat) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE es=VALUES(es),lsc=VALUES(lsc),cat=VALUES(cat)', [x.id, uid, x.es, x.lsc, x.cat]),
  deleteGl: (uid, ids) => c.query('DELETE FROM glossary WHERE user_id=? AND id IN (?)', [uid, ids])
});
