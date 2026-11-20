'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { applySave } = require('../lib/rules'), fakeDao = require('./fakeDao'), sec = require('../lib/security');

const ana = { id: 100, name: 'Ana', role: 'sordo' }, luis = { id: 200, name: 'Luis', role: 'oyente' }, adm = { id: 1, name: 'Administrador', role: 'admin' };
const setup = () => { const d = fakeDao(); [ana, luis, adm].forEach(u => d.T.users.set(u.id, u)); return d; };
const save = (d, name, u, body) => applySave(name, d, u, body);
const status = async p => { try { await p; return 200; } catch (e) { return e.status || 500; } };
const newChat = (id, owner) => ({ id, title: 'Chat', owner, members: [owner], membersAdd: [owner], membersRemove: [], msgs: [] });

test('usuarios: nadie escribe la colección users', async () => {
  assert.equal(await status(save(setup(), 'users', adm, { upsert: [{ id: 5 }] })), 403);
});

test('chats: crear, invitar, salir y no acceder a chats ajenos', async () => {
  const d = setup();
  await save(d, 'chats', ana, { upsert: [newChat(10, 100)] });
  assert.deepEqual(await d.chatMembers(10), [100]);
  assert.equal(await status(save(d, 'chats', luis, { upsert: [{ id: 10, title: 'x', owner: 200, membersAdd: [], membersRemove: [], msgs: [{ id: 'm1', uid: 200, sordo: 'x' }] }] })), 403, 'no miembro');
  await save(d, 'chats', ana, { upsert: [{ id: 10, title: 'Chat', owner: 100, membersAdd: [200], membersRemove: [], msgs: [] }] });
  assert.deepEqual((await d.chatMembers(10)).sort(), [100, 200]);
  assert.equal(await status(save(d, 'chats', luis, { upsert: [{ id: 10, membersAdd: [], membersRemove: [100] }] })), 403, 'no puede sacar al dueño');
  assert.equal(await status(save(d, 'chats', luis, { remove: [10] })), 403, 'solo el dueño elimina');
  await save(d, 'chats', luis, { upsert: [{ id: 10, membersAdd: [], membersRemove: [200], msgs: [] }] });
  assert.deepEqual(await d.chatMembers(10), [100]);
  assert.equal(await status(save(d, 'chats', ana, { upsert: [{ id: 11, title: 'x', owner: 100, membersAdd: [100, 200], membersRemove: [], msgs: [] }] })), 403, 'un chat nuevo no agrega a otros');
  assert.equal(await status(save(d, 'chats', ana, { upsert: [{ id: 10, membersAdd: [999], membersRemove: [], msgs: [] }] })), 400, 'invitado inexistente');
  await save(d, 'chats', ana, { remove: [10] });
  assert.equal(await d.chat(10), null);
});

test('mensajes: solo en nombre propio; editar y borrar solo lo propio', async () => {
  const d = setup();
  await save(d, 'chats', ana, { upsert: [newChat(10, 100)] });
  await save(d, 'chats', ana, { upsert: [{ id: 10, membersAdd: [200], membersRemove: [], msgs: [] }] });
  const send = (u, m) => save(d, 'chats', u, { upsert: [{ id: 10, membersAdd: [], membersRemove: [], msgs: [m] }] });
  await send(ana, { id: 'a1', uid: 100, sordo: 'YO AGUA QUERER', oyente: 'Yo quiero agua.', orig: 'secreto', src: 'lsc', t: Date.now() });
  assert.equal(await status(send(luis, { id: 'b1', uid: 100, sordo: 'suplantar', t: 1 })), 403, 'suplantar autoría');
  assert.equal(await status(send(luis, { id: 'a1', uid: 200, sordo: 'HACKEADO', oyente: 'hack' })), 200);
  assert.equal((await d.message('a1')).sordo, 'YO AGUA QUERER', 'otra persona no edita');
  await send(luis, { id: 'a1', hiddenFor: [200, 100] });
  assert.deepEqual((await d.message('a1')).hidden_for, [200], 'solo se oculta para quien lo pide');
  await send(ana, { id: 'a1', deleted: true, sordo: 'x' });
  const m = await d.message('a1');
  assert.equal(m.deleted, true); assert.equal(m.sordo, ''); assert.equal(m.orig, null, 'el texto original se elimina');
  await save(d, 'chats', ana, { upsert: [newChat(12, 100)] });
  assert.equal(await status(save(d, 'chats', ana, { upsert: [{ id: 12, membersAdd: [], membersRemove: [], msgs: [{ id: 'a1', uid: 100, sordo: 'mover' }] }] })), 403, 'no reutilizar mensajes de otro chat');
  assert.equal(await status(save(d, 'chats', ana, { upsert: [{ id: 10, membersAdd: [], membersRemove: [], msgs: [{ id: 'z', uid: 100, sordo: 'x'.repeat(6000) }] }] })), 400);
});

test('publicaciones y comentarios', async () => {
  const d = setup(); d.T.posts.set(1, { id: 1, uid: 'ejemplo', text: 'ejemplo', pinned: 1 });
  await save(d, 'posts', ana, { upsert: [{ id: 50, uid: 100, name: 'FALSO', role: 'admin', text: 'Hola', pinned: true, r: { like: [], love: [] } }] });
  assert.equal(d.T.posts.get(50).name, 'Ana'); assert.equal(d.T.posts.get(50).role, 'sordo'); assert.equal(d.T.posts.get(50).pinned, 0);
  assert.equal(await status(save(d, 'posts', luis, { upsert: [{ id: 51, uid: 100, text: 'suplanto' }] })), 403);
  await save(d, 'posts', luis, { upsert: [{ id: 50, uid: 100, text: 'EDITADO', r: { like: [200, 100, 300], love: [] } }] });
  assert.equal(d.T.posts.get(50).text, 'Hola');
  assert.deepEqual(d.T.reactions.map(r => r.uid), [200], 'solo cuenta la reacción propia');
  await save(d, 'posts', luis, { upsert: [{ id: 50, r: { like: [], love: [] } }] });
  assert.equal(d.T.reactions.length, 0);
  assert.equal(await status(save(d, 'posts', luis, { remove: [50] })), 403);
  assert.equal(await status(save(d, 'posts', adm, { remove: [1] })), 403, 'ejemplo protegido');
  assert.equal(await status(save(d, 'posts', ana, { upsert: [{ id: 1, uid: 100, text: 'x' }] })), 200); assert.equal(d.T.posts.get(1).text, 'ejemplo');
  await save(d, 'cmts', luis, { upsert: [{ id: 60, postId: 50, parentId: null, uid: 200, text: 'c1' }] });
  await save(d, 'cmts', ana, { upsert: [{ id: 61, postId: 50, parentId: 60, uid: 100, text: 'c2' }] });
  assert.equal(await status(save(d, 'cmts', ana, { upsert: [{ id: 62, postId: 999, parentId: null, uid: 100, text: 'x' }] })), 400);
  assert.equal(await status(save(d, 'cmts', ana, { remove: [60] })), 403, 'otra persona no borra');
  await save(d, 'cmts', luis, { remove: [60] });
  assert.equal(d.T.comments.size, 0, 'se borran también las respuestas');
  await save(d, 'cmts', luis, { upsert: [{ id: 70, postId: 50, parentId: null, uid: 200, text: 'otra' }] });
  await save(d, 'cmts', adm, { remove: [70] }); assert.equal(d.T.comments.size, 0, 'moderación');
  await save(d, 'posts', ana, { remove: [50] }); assert.equal(d.T.posts.has(50), false);
});

test('contacto: privado; solo admin responde', async () => {
  const d = setup();
  const c = { id: 80, uid: 100, name: 'Ana', email: 'a@a.co', subject: 's', message: 'Hola', wantsLsc: true };
  await save(d, 'contacts', ana, { upsert: [c] });
  assert.equal(await status(save(d, 'contacts', adm, { upsert: [{ ...c, id: 81 }] })), 403, 'el admin no envía');
  assert.equal(await status(save(d, 'contacts', luis, { upsert: [{ ...c, id: 82 }] })), 403, 'suplantar');
  assert.equal(await status(save(d, 'contacts', ana, { upsert: [{ ...c, reply: { text: 'me respondo', media: [] } }] })), 403);
  assert.equal(await status(save(d, 'contacts', adm, { upsert: [{ id: 80, reply: { text: 'x', media: [{ type: 'video', src: 'http://malo' }] } }] })), 400);
  await save(d, 'contacts', adm, { upsert: [{ id: 80, reply: { text: 'listo', media: [{ type: 'image', src: 'data:image/png;base64,AAA', name: 'a.png' }] } }] });
  assert.equal(d.T.contacts.get(80).reply.text, 'listo');
  assert.equal(await status(save(d, 'contacts', luis, { remove: [80] })), 403);
});

test('glosario y presencia: solo los propios', async () => {
  const d = setup();
  await save(d, 'gl', ana, { arg: 100, upsert: [{ id: 5, es: 'agua', lsc: 'AGUA', cat: 'x' }] });
  assert.equal(await status(save(d, 'gl', luis, { arg: 100, upsert: [{ id: 6, es: 'a', lsc: 'b' }] })), 403);
  assert.equal(await status(save(d, 'gl', luis, { arg: 200, upsert: [{ id: 5, es: 'robo', lsc: 'ROBO' }] })), 403, 'no pisar filas ajenas');
  assert.equal(d.T.gl.get(5).es, 'agua');
  await save(d, 'gl', luis, { arg: 200, remove: [5] }); assert.equal(d.T.gl.has(5), true);
  await save(d, 'presence', ana, { upsert: [{ id: 100, last: Date.now(), online: true }] });
  assert.equal(await status(save(d, 'presence', ana, { upsert: [{ id: 200, last: 1, online: true }] })), 403);
  assert.equal(await status(save(d, 'inexistente', ana, {})), 404);
  assert.equal(await status(save(d, 'posts', ana, { upsert: 'x' })), 400);
});

test('seguridad: contraseñas, tokens y límites', async () => {
  const h = await sec.hashPassword('UnaClaveLarga123');
  assert.ok(h.startsWith('s1$')); assert.notEqual(h, await sec.hashPassword('UnaClaveLarga123'), 'sal distinta');
  assert.equal(await sec.verifyPassword('UnaClaveLarga123', h), true); assert.equal(await sec.verifyPassword('otra', h), false);
  const legacy = sec.sha256('Antigua#1'); assert.ok(sec.isLegacyHash(legacy));
  assert.equal(await sec.verifyPassword('Antigua#1', legacy), true); assert.equal(await sec.verifyPassword('x', legacy), false);
  const tk = sec.createTokens('s'.repeat(40)), t = tk.sign({ uid: 7 });
  assert.equal(tk.verify(t).uid, 7);
  assert.equal(tk.verify(t.slice(0, -2) + 'xx'), null); assert.equal(tk.verify(sec.createTokens('z'.repeat(40)).sign({ uid: 7 })), null);
  const forged = Buffer.from(JSON.stringify({ uid: 1, exp: Date.now() + 1e6 })).toString('base64url') + '.' + t.split('.')[1];
  assert.equal(tk.verify(forged), null);
  const exp = sec.createTokens('s'.repeat(40), -1000); assert.equal(exp.verify(exp.sign({ uid: 7 })), null);
  const l = sec.createLimiter(); for (let i = 0; i < 3; i++) assert.equal(l.tooMany('k', 3, 1000), false);
  assert.equal(l.tooMany('k', 3, 1000), true); l.clear('k'); assert.equal(l.tooMany('k', 3, 1000), false);
});

test('seguridad: verificación reCAPTCHA', async () => {
  assert.equal(await sec.verifyRecaptcha('', '', '127.0.0.1'), true, 'desactivado sin secreto');
  assert.equal(await sec.verifyRecaptcha('sec', '', '127.0.0.1'), false, 'token vacío');
  assert.equal(await sec.verifyRecaptcha('sec', null, '127.0.0.1'), false, 'token nulo');
  const okFetch = async (url, opts) => {
    assert.equal(url, 'https://www.google.com/recaptcha/api/siteverify');
    assert.match(opts.body, /secret=sec/);
    assert.match(opts.body, /response=tok123/);
    return { ok: true, json: async () => ({ success: true }) };
  };
  assert.equal(await sec.verifyRecaptcha('sec', 'tok123', '127.0.0.1', okFetch), true);
  const failFetch = async () => ({ ok: true, json: async () => ({ success: false }) });
  assert.equal(await sec.verifyRecaptcha('sec', 'bad', '127.0.0.1', failFetch), false);
  const errFetch = async () => { throw new Error('network'); };
  assert.equal(await sec.verifyRecaptcha('sec', 'tok123', '127.0.0.1', errFetch), false);
});
