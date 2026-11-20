'use strict';
module.exports = function fakeDao() {
  const T = { users: new Map(), chats: new Map(), members: [], messages: new Map(), posts: new Map(), comments: new Map(), reactions: [], contacts: new Map(), gl: new Map(), presence: new Map() };
  return {
    T,
    usersExist: async ids => ids.filter(i => T.users.has(i)).length,
    upsertPresence: async (uid, last, online) => T.presence.set(uid, { last, online }),
    chat: async id => T.chats.get(id) || null,
    chatMembers: async id => T.members.filter(m => m.c === id).map(m => m.u),
    insertChat: async x => T.chats.set(x.id, { ...x }),
    updateChat: async (id, x) => Object.assign(T.chats.get(id), x),
    addMembers: async (id, ids) => ids.forEach(u => { if (!T.members.some(m => m.c === id && m.u === u)) T.members.push({ c: id, u }); }),
    removeMembers: async (id, ids) => { T.members = T.members.filter(m => !(m.c === id && ids.includes(m.u))); },
    deleteChat: async id => { T.chats.delete(id); T.members = T.members.filter(m => m.c !== id); [...T.messages].forEach(([k, m]) => m.chat_id === id && T.messages.delete(k)); },
    message: async id => (T.messages.has(id) ? { ...T.messages.get(id) } : null),
    insertMessage: async r => T.messages.set(r.id, { ...r, deleted: !!r.deleted }),
    updateMessage: async (id, patch) => { const m = T.messages.get(id); Object.assign(m, patch); if ('deleted' in patch) m.deleted = !!patch.deleted; },
    post: async id => T.posts.get(id) || null,
    insertPost: async x => T.posts.set(x.id, { ...x, pinned: 0 }),
    updatePostText: async (id, t) => { T.posts.get(id).text = t; },
    deletePost: async id => { T.posts.delete(id); [...T.comments].forEach(([k, c]) => c.post_id === id && T.comments.delete(k)); },
    comment: async id => T.comments.get(id) || null,
    insertComment: async x => T.comments.set(x.id, { ...x }),
    updateCommentText: async (id, t) => { T.comments.get(id).text = t; },
    commentsIn: async ids => ids.filter(i => T.comments.has(i)).map(i => T.comments.get(i)),
    childrenOf: async ids => [...T.comments.values()].filter(c => ids.includes(Number(c.parent_id))),
    deleteComments: async ids => ids.forEach(i => T.comments.delete(i)),
    setReaction: async (kind, target, uid, type, on) => {
      T.reactions = T.reactions.filter(r => !(r.kind === kind && r.target === target && r.uid === uid && r.type === type));
      if (on) T.reactions.push({ kind, target, uid, type });
    },
    contact: async id => T.contacts.get(id) || null,
    insertContact: async x => T.contacts.set(x.id, { ...x, has_reply: 0 }),
    setContactReply: async (id, r) => { T.contacts.get(id).reply = r; },
    deleteContact: async id => T.contacts.delete(id),
    glRow: async id => T.gl.get(id) || null,
    upsertGl: async (uid, x) => T.gl.set(x.id, { ...x, user_id: uid }),
    deleteGl: async (uid, ids) => ids.forEach(i => T.gl.get(i) && T.gl.get(i).user_id === uid && T.gl.delete(i))
  };
};
