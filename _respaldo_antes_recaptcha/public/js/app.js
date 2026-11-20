/* =====================================================================
   Manos que Hablan · Prototipo LSC ⇄ Español
   Datos en MySQL (API Express). Ver db.js y server.js.
   ===================================================================== */
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const store=window.DBSTORE; // datos en MySQL vía db.js (antes: localStorage)
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
/* Ventana modal que reemplaza a los alert() del navegador */
function notify(msg,title='Aviso'){return Dlg.alert(msg,title)}
let session=JSON.parse(sessionStorage.getItem('lsc_session')||'null'); // la sesión es por pestaña: sirve para probar dos cuentas a la vez
if(session&&!sessionStorage.getItem('lsc_token')){session=null;sessionStorage.removeItem('lsc_session')} // sin token no hay sesión
const users=()=>store.get('lsc_users',[]);
/* ---------- AUTENTICACIÓN: el servidor valida las credenciales y entrega un token por pestaña ---------- */
let registering = false;
function setAuthMode(reg) {
  registering = reg;
  $('#authTitle').textContent = reg ? 'Crear cuenta' : 'Iniciar sesión';
  $('#aName').hidden = $('#aRole').hidden = !reg;
  $('#authToggle').innerHTML = reg ? '¿Ya tienes cuenta? <b>Inicia sesión</b>' : '¿No tienes cuenta? <b>Regístrate aquí</b>';
}
$('#authToggle').onclick = () => setAuthMode(!registering);
$('#authForm').onsubmit = async e => {
  e.preventDefault();
  const msg = t => $('#authMsg').textContent = t, pass = $('#aPass').value;
  if (registering && (pass.length < 8 || pass.length > 128)) return msg('La contraseña debe tener entre 8 y 128 caracteres.');
  let r, j;
  try {
    r = await fetch('/api/auth/' + (registering ? 'register' : 'login'), { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: $('#aName').value.trim(), email: $('#aEmail').value.trim().toLowerCase(), password: pass, role: $('#aRole').value }) });
    j = await r.json().catch(() => ({}));
  } catch { return msg('No hay conexión con el servidor.'); }
  if (!r.ok) return msg(j.error || 'No se pudo iniciar sesión.');
  sessionStorage.setItem('lsc_token', j.token); session = j.user; sessionStorage.setItem('lsc_session', JSON.stringify(session));
  $('#aPass').value = '';
  try { await store.reload(); } catch { return msg('Entraste, pero no se pudieron cargar tus datos. Recarga la página.'); }
  msg(''); beat(true); renderAuth(); wsOpen(); location.hash = session.role === 'admin' ? '#admin' : '#inicio'; route();
};
function renderAuth() {
  $('#authArea').innerHTML = session
    ? `<span class="text-white me-2">${session.role === 'admin' ? '🛡️' : session.role === 'sordo' ? '🧏' : '👂'} ${esc(session.name)}</span><button class="btn btn-sm btn-outline-light" id="logout">Salir</button>`
    : `<a class="btn btn-sm btn-grad" href="#login">Entrar</a>`;
  $('#navAdmin').hidden = !(session && session.role === 'admin');
  const lo = $('#logout'); if (lo) lo.onclick = async () => { beat(false); session = null; sessionStorage.removeItem('lsc_session'); try { WS && WS.close(); } catch {} await new Promise(r => setTimeout(r, 150)); sessionStorage.removeItem('lsc_token'); try { await store.reload(); } catch {} renderAuth(); location.hash = '#login'; route(); };
}

/* ---------- MOTOR DE TRADUCCIÓN (reglas) ----------
   LSC (persona sorda)  = [TIEMPO] SUJETO + OBJETO + VERBO en infinitivo [+ NO] [+ PREGUNTA]   → S-O-V
   Español (oyente)     = [Tiempo] sujeto + VERBO conjugado + objeto                           → S-V-O
   Cubre ~100 verbos (presente, pasado y futuro), verbos con modal (quiero comer),
   negación, preguntas, "me gusta", artículos y lugares (voy a la casa).                       */
const cap = s => s.charAt(0).toUpperCase() + s.slice(1), U = w => w.toUpperCase();
const PRON = { yo: 0, 'tú': 1, 'él': 2, ella: 2, usted: 2, nosotros: 3, nosotras: 3, ellos: 4, ellas: 4, ustedes: 4 };
const PRON_L = { ...PRON, tu: 1, el: 2 }; // al escribir en LSC suelen omitirse las tildes
const SUBJ_DEF = ['YO', 'TÚ', 'ÉL', 'NOSOTROS', 'ELLOS'], CLITIC = ['me', 'te', 'le', 'nos', 'les'];
const POSS = ['mi', 'tu', 'su', 'mis', 'tus', 'sus', 'nuestro', 'nuestra'];
const TIMEW = { ayer: 'pret', anoche: 'pret', antes: 'pret', hoy: 'pres', ahora: 'pres', 'mañana': 'fut' };
const QW = ['qué', 'dónde', 'quién', 'cuándo', 'cómo', 'cuánto', 'porqué'];
const STOP = ['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'a', 'al', 'en', 'por', 'para', 'que'];
const NOUNS = { pan: 'el', agua: 'el', casa: 'la', baño: 'el', ayuda: 'la', comida: 'la', familia: 'la', amigo: 'el', escuela: 'la', trabajo: 'el', libro: 'el', leche: 'la', café: 'el', dinero: 'el', médico: 'el', carne: 'la', teléfono: 'el', celular: 'el', colegio: 'el', hospital: 'el', parque: 'el', cocina: 'la', ropa: 'la', mesa: 'la', silla: 'la', puerta: 'la', ventana: 'la', perro: 'el', gato: 'el', carro: 'el', moto: 'la', bicicleta: 'la', tarea: 'la', clase: 'la', música: 'la', computador: 'el', cuarto: 'el', habitación: 'la', ciudad: 'la', universidad: 'la' };
const LOCV = ['estudiar', 'trabajar', 'vivir', 'estar', 'jugar'], PLACES = ['casa', 'escuela', 'colegio', 'hospital', 'parque', 'baño'];
const withArt = (w, dest) => !NOUNS[w] ? w : dest ? (NOUNS[w] === 'el' ? 'al ' : 'a la ') + w : NOUNS[w] + ' ' + w;
// Presente y pretérito: [yo, tú, él/ella, nosotros, ellos]
const IRR = {
  querer: { pres: ['quiero', 'quieres', 'quiere', 'queremos', 'quieren'], pret: ['quise', 'quisiste', 'quiso', 'quisimos', 'quisieron'] },
  poder: { pres: ['puedo', 'puedes', 'puede', 'podemos', 'pueden'], pret: ['pude', 'pudiste', 'pudo', 'pudimos', 'pudieron'] },
  tener: { pres: ['tengo', 'tienes', 'tiene', 'tenemos', 'tienen'], pret: ['tuve', 'tuviste', 'tuvo', 'tuvimos', 'tuvieron'] },
  ir: { pres: ['voy', 'vas', 'va', 'vamos', 'van'], pret: ['fui', 'fuiste', 'fue', 'fuimos', 'fueron'] },
  ser: { pres: ['soy', 'eres', 'es', 'somos', 'son'], pret: ['fui', 'fuiste', 'fue', 'fuimos', 'fueron'] },
  estar: { pres: ['estoy', 'estás', 'está', 'estamos', 'están'], pret: ['estuve', 'estuviste', 'estuvo', 'estuvimos', 'estuvieron'] },
  ver: { pres: ['veo', 'ves', 've', 'vemos', 'ven'], pret: ['vi', 'viste', 'vio', 'vimos', 'vieron'] },
  saber: { pres: ['sé', 'sabes', 'sabe', 'sabemos', 'saben'], pret: ['supe', 'supiste', 'supo', 'supimos', 'supieron'] },
  hacer: { pres: ['hago', 'haces', 'hace', 'hacemos', 'hacen'], pret: ['hice', 'hiciste', 'hizo', 'hicimos', 'hicieron'] },
  decir: { pres: ['digo', 'dices', 'dice', 'decimos', 'dicen'], pret: ['dije', 'dijiste', 'dijo', 'dijimos', 'dijeron'] },
  venir: { pres: ['vengo', 'vienes', 'viene', 'venimos', 'vienen'], pret: ['vine', 'viniste', 'vino', 'vinimos', 'vinieron'] },
  dar: { pres: ['doy', 'das', 'da', 'damos', 'dan'], pret: ['di', 'diste', 'dio', 'dimos', 'dieron'] },
  poner: { pres: ['pongo', 'pones', 'pone', 'ponemos', 'ponen'], pret: ['puse', 'pusiste', 'puso', 'pusimos', 'pusieron'] },
  salir: { pres: ['salgo', 'sales', 'sale', 'salimos', 'salen'] },
  conocer: { pres: ['conozco', 'conoces', 'conoce', 'conocemos', 'conocen'] },
  jugar: { pres: ['juego', 'juegas', 'juega', 'jugamos', 'juegan'] },
  dormir: { pres: ['duermo', 'duermes', 'duerme', 'dormimos', 'duermen'], pret: ['dormí', 'dormiste', 'durmió', 'dormimos', 'durmieron'] },
  pedir: { pres: ['pido', 'pides', 'pide', 'pedimos', 'piden'], pret: ['pedí', 'pediste', 'pidió', 'pedimos', 'pidieron'] },
  entender: { pres: ['entiendo', 'entiendes', 'entiende', 'entendemos', 'entienden'] },
  volver: { pres: ['vuelvo', 'vuelves', 'vuelve', 'volvemos', 'vuelven'] },
  doler: { pres: ['duelo', 'dueles', 'duele', 'dolemos', 'duelen'] }, costar: { pres: ['cuesto', 'cuestas', 'cuesta', 'costamos', 'cuestan'] }, leer: { pres: ['leo', 'lees', 'lee', 'leemos', 'leen'], pret: ['leí', 'leíste', 'leyó', 'leímos', 'leyeron'] }
};
const REG = 'hablar comprar ayudar necesitar trabajar estudiar caminar llamar buscar mirar escuchar cocinar bailar cantar pagar llevar tomar usar viajar esperar enseñar practicar cuidar olvidar recordar preguntar contestar gustar amar limpiar lavar abrazar saludar visitar invitar ayudar comer beber aprender vender correr deber comprender responder vivir escribir abrir recibir subir compartir decidir'.split(' ');
const VERBS = new Set([...Object.keys(IRR), ...REG]), MODAL = ['querer', 'poder', 'necesitar', 'deber', 'ir', 'tener', 'saber'];
const NOT_V = new Set(['ayer', 'mujer', 'lugar', 'hogar', 'taller', 'celular', 'azúcar', 'azucar', 'dólar', 'militar', 'familiar', 'particular', 'popular', 'regular', 'pilar', 'bar', 'mar', 'par']);
const looseInf = w => VERBS.has(w) || (/^[a-záéíóúñ]{3,}(ar|er|ir)$/.test(w) && !NOT_V.has(w));
const FUT_STEM = { tener: 'tendr', poder: 'podr', hacer: 'har', decir: 'dir', querer: 'querr', saber: 'sabr', venir: 'vendr', salir: 'saldr', poner: 'pondr' };
const IMPF_IRR = { ir: ['iba', 'ibas', 'iba', 'íbamos', 'iban'], ser: ['era', 'eras', 'era', 'éramos', 'eran'], ver: ['veía', 'veías', 'veía', 'veíamos', 'veían'] };
const strip = w => w.replace(/[áéíóúü]/g, c => ({ á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ü: 'u' }[c]));
function conj(inf, t, p) { // conjuga cualquier infinitivo (regulares por terminación, irregulares por tabla)
  if (IRR[inf] && IRR[inf][t]) return IRR[inf][t][p];
  if (t === 'fut') return (FUT_STEM[inf] || inf) + ['é', 'ás', 'á', 'emos', 'án'][p]; // iré, comeré, tendré…
  if (t === 'impf') return IMPF_IRR[inf] ? IMPF_IRR[inf][p] : inf.slice(0, -2) + (inf.endsWith('ar') ? ['aba', 'abas', 'aba', 'ábamos', 'aban'] : ['ía', 'ías', 'ía', 'íamos', 'ían'])[p]; // caminaba, comía…
  const st = inf.slice(0, -2), k = inf.slice(-2);
  if (t === 'pres') return st + { ar: ['o', 'as', 'a', 'amos', 'an'], er: ['o', 'es', 'e', 'emos', 'en'], ir: ['o', 'es', 'e', 'imos', 'en'] }[k][p];
  if (p === 0 && /gar$/.test(inf)) return st + 'ué';
  if (p === 0 && /car$/.test(inf)) return st.slice(0, -1) + 'qué';
  return st + { ar: ['é', 'aste', 'ó', 'amos', 'aron'], er: ['í', 'iste', 'ió', 'imos', 'ieron'], ir: ['í', 'iste', 'ió', 'imos', 'ieron'] }[k][p];
}
const FORMS = {}; // forma conjugada → [infinitivo, persona, tiempo]
VERBS.forEach(v => ['pres', 'pret', 'fut', 'impf'].forEach(t => [0, 1, 2, 3, 4].forEach(p => { const f = conj(v, t, p); if (!FORMS[f]) FORMS[f] = [v, p, t]; const g = strip(f); if (t !== 'pres' && !FORMS[g]) FORMS[g] = [v, p, t]; }))); // también sin tilde: «ire», «comere»
const clean = t => t.toLowerCase().replace(/por qué/g, 'porqué').replace(/[¿?¡!.,;:]/g, ' ').split(/\s+/).filter(Boolean);
const guess = w => [w.replace(/(aron|amos|ó|an|as|a|o)$/, '') + 'ar', /(aron|ó)$/.test(w) ? 'pret' : 'pres']; // verbo no listado

/* Español (S-V-O) → LSC (S-O-V) */
function esToLsc(text) {
  const isQ = /[¿?]/.test(text); let toks = clean(text);
  const times = toks.filter(w => TIMEW[w]); toks = toks.filter(w => !TIMEW[w]);
  const q = toks.find(w => QW.includes(w)); toks = toks.filter(w => w !== q);
  const neg = toks.includes('no'); toks = toks.filter(w => w !== 'no' && !STOP.includes(w));
  let voc = []; // vocativo: «hola nubia, iré…» → NUBIA no es el sujeto
  const fin = (tm, s, o, v) => [...voc, ...tm, s, ...o, ...v, neg ? 'NO' : '', q ? (q === 'porqué' ? 'POR QUÉ' : U(q)) : (isQ ? '?' : '')].filter(Boolean).join(' ');
  const gi = toks.findIndex(w => w === 'gusta' || w === 'gustan'); // "me gusta el pan" → YO PAN GUSTAR
  if (gi > 0 && CLITIC.includes(toks[gi - 1])) return fin(times.map(U), SUBJ_DEF[CLITIC.indexOf(toks[gi - 1])], toks.filter((_, i) => i !== gi && i !== gi - 1).map(U), ['GUSTAR']);
  toks = toks.filter(w => !['me', 'te', 'se', 'nos'].includes(w)); // reflexivos: «me llamo» → YO … LLAMAR
  let vi = toks.findIndex(w => FORMS[w]), inf, p, t;
  if (vi >= 0) [inf, p, t] = FORMS[toks[vi]];
  else if (toks.length > 1 && PRON[toks[0]] !== undefined) { vi = 1; [inf, t] = guess(toks[1]); p = PRON[toks[0]]; }
  if (vi < 0) return text.trim().toUpperCase();
  let comp = null, after = toks.slice(vi + 1);
  if (MODAL.includes(inf) && after.length && looseInf(after[0])) { comp = after[0]; after = after.slice(1); }
  if (inf === 'ir' && comp) { inf = comp; comp = null; t = 'fut'; } // "voy a comer" = futuro
  const before = toks.slice(0, vi); let s, o = [];
  if (before.length && PRON[before[0]] !== undefined) { s = U(before[0]); o = before.slice(1); }
  else if (before.length && [0, 1, 3].includes(p)) { voc = before.map(U); s = SUBJ_DEF[p]; } // un nombre no puede ser sujeto de «iré», «como», «vamos»
  else s = before.length ? before.map(U).join(' ') : SUBJ_DEF[p];
  let tm = times.map(U); if (!tm.length && (t === 'pret' || t === 'impf')) tm = ['ANTES'];
  return fin(tm, s, [...o, ...after].map(U), comp ? [U(comp), U(inf)] : [U(inf)]);
}


/* LSC sin verbo (ej.: «YO NOMBRE CAROL», «YO CANSADO», «BAÑO DÓNDE») → español con ser / estar / tener */
const POSS_P = ['mi', 'tu', 'su', 'nuestro', 'su'], TENER_W = ['hambre', 'sed', 'frío', 'frio', 'calor', 'sueño', 'miedo', 'fiebre', 'tos', 'gripa', 'prisa'], ESTAR_W = ['cansado', 'cansada', 'feliz', 'triste', 'enojado', 'enojada', 'enfermo', 'enferma', 'bien', 'mal', 'contento', 'contenta', 'ocupado', 'ocupada', 'aquí', 'allá', 'listo', 'lista', 'nervioso', 'nerviosa', 'preocupado', 'preocupada'];
function copula(toks, q, neg, isQ, text) {
  const done = (s, question) => question ? '¿' + cap(s) + '?' : cap(s) + '.';
  const no = neg ? 'no ' : '';
  if (!toks.length) return cap(text.trim());
  if (PRON_L[toks[0]] !== undefined) {
    const p = PRON_L[toks[0]], rest = toks.slice(1).filter(w => !STOP.includes(w)), r0 = rest[0];
    if (!rest.length) return cap(text.trim());
    if (r0 === 'nombre' && q) return done(`cuál es ${POSS_P[p]} nombre`, true);
    if (r0 === 'nombre') return done(`${POSS_P[p]} nombre ${neg ? 'no ' : ''}es ${rest.slice(1).map(cap).join(' ')}`.trim());
    if (TENER_W.includes(r0)) return done(`${no}${conj('tener', 'pres', p)} ${rest.join(' ')}`, isQ);
    return done(`${no}${conj(ESTAR_W.includes(r0) ? 'estar' : 'ser', 'pres', p)} ${rest.join(' ')}`, isQ);
  }
  const noun = toks.filter(w => !STOP.includes(w) && w !== q);
  if (q === 'qué' && noun.includes('nombre')) return done(`cuál es ${noun[0] === 'nombre' ? 'tu' : noun[0]} nombre`, true);
  if (POSS.includes(noun[0]) && noun.length > 2) return done(`${noun[0]} ${noun[1]} ${no}${ESTAR_W.includes(noun[noun.length - 1]) ? 'está' : 'es'} ${noun.slice(2).join(' ')}`);
  const nn = noun.length ? withArt(noun[0]) + (noun.length > 1 ? ' ' + noun.slice(1).join(' ') : '') : '';
  if (q === 'dónde') return done(`dónde ${no}está ${nn}`, true);
  if (q === 'quién') return done(`quién ${no}es ${nn}`, true);
  if (q === 'qué') return done(`qué ${noun.join(' ')} ${no}es`, true);
  if (q === 'cómo') return done(`cómo ${no}está ${nn}`, true);
  if (q) return done(`${q} ${no}${nn}`, true);
  const w0 = noun[noun.length - 1];
  if (noun.length > 1 && (ESTAR_W.includes(w0) || /^(grande|pequeñ[oa]|bonit[oa]|bueno|buena|rico|rica|alt[oa]|baj[oa]|nuev[oa]|viej[oa])$/.test(w0)))
    return done(`${withArt(noun[0])} ${no}${ESTAR_W.includes(w0) ? 'está' : 'es'} ${noun.slice(1).join(' ')}`);
  return cap(text.trim());
}
/* LSC (S-O-V) → Español (S-V-O) */
function lscToEs(text) {
  const isQ = /\?/.test(text); let toks = clean(text);
  const times = toks.filter(w => TIMEW[w]); toks = toks.filter(w => !TIMEW[w]);
  let q = toks.find(w => QW.includes(w)); toks = toks.filter(w => w !== q); if (q === 'porqué') q = 'por qué';
  const neg = toks.includes('no'); toks = toks.filter(w => w !== 'no');
  let vi = -1; toks.forEach((w, i) => { if (looseInf(w)) vi = i; }); // el verbo va al final
  if (vi < 0) return copula(toks, q, neg, isQ, text);
  const main = toks[vi]; let comp = null, fi = vi;
  if (MODAL.includes(main) && vi > 0 && looseInf(toks[vi - 1])) { comp = toks[vi - 1]; fi = vi - 1; }
  let before = toks.slice(0, fi); const after = toks.slice(vi + 1); let voc = [];
  const pk = before.findIndex(w => PRON_L[w] !== undefined); if (pk > 0) { voc = before.slice(0, pk).map(cap); before = before.slice(pk); } // «NUBIA YO …»: Nubia es a quien se habla
  let person = 2, subj = '', obj = [], pron = false;
  if (before.length && PRON_L[before[0]] !== undefined) { person = PRON_L[before[0]]; subj = before[0]; obj = before.slice(1); pron = true; }
  else if (before.length) { const n = POSS.includes(before[0]) && before.length > 1 ? 2 : 1; subj = before.slice(0, n).join(' '); obj = before.slice(n); subj = NOUNS[subj] ? withArt(subj) : subj; }
  obj = obj.concat(after);
  const tense = times.length ? TIMEW[times[0]] : 'pres', dest = (main === 'ir' && !comp) || comp === 'ir';   // «CASA IR QUERER» → «quiero ir a la casa»
  let vp;
  if (main === 'gustar' && !comp) { const pl = /s$/.test(obj[obj.length - 1] || ''); return fin(`${CLITIC[person]} ${pl ? 'gustan' : 'gusta'} ${obj.map(w => withArt(w)).join(' ')}`); }
  if (comp) vp = main === 'ir' ? conj('ir', 'pres', person) + ' a ' + comp : conj(main, tense === 'fut' ? 'pres' : tense, person) + (main === 'tener' ? ' que ' : ' ') + comp;
  else vp = tense === 'fut' && main !== 'ir' ? conj('ir', 'pres', person) + ' a ' + main : conj(main, tense === 'fut' ? 'pres' : tense, person);
  if (main === 'llamar' && !comp) vp = ['me', 'te', 'se', 'nos', 'se'][person] + ' ' + vp; // llamarse
  if (neg) vp = 'no ' + vp;
  const MASS = ['agua', 'pan', 'ayuda', 'leche', 'café', 'comida', 'dinero', 'carne']; // sin artículo como objeto: "como pan"
  const o = obj.map((w, i) => MASS.includes(w) && !dest ? w : i === 0 && LOCV.includes(main) && !comp && PLACES.includes(w) ? 'en ' + withArt(w) : withArt(w, dest && i === 0)), tw = times.length ? [times[0]] : [];
  const subjTxt = !pron && subj && !NOUNS[subj.split(' ').pop()] && !/ /.test(subj) && !subj.includes(' ') ? subj : subj;
  const vc = voc.length ? [voc.join(' ') + ','] : [];
  const names = !pron && subj && !NOUNS[subj] && !subj.includes(' ') ? cap(subj) : subj; // nombre propio
  const sj = pron ? [] : [names];
  if (q) return fin2([...vc, ...tw, q, vp, ...sj, ...o], true);
  if (isQ) return fin2([...vc, ...tw, vp, ...sj, ...o], true);
  return fin2([...vc, ...tw, ...(pron ? [subj] : sj), vp, ...o], false);
  function fin(s) { return cap(s) + '.'; }
  function fin2(parts, question) { const s = cap(parts.filter(Boolean).join(' ')); return question ? `¿${s}?` : s + '.'; }
}

/* ---------- ¿LSC o español? Se decide por la FRASE escrita, no por el rol (sordo, oyente o admin) ----------
   LSC (S-O-V): el verbo en infinitivo va al final · Español (S-V-O): verbo conjugado.
   El resultado conserva el estilo de quien escribe: MAYÚSCULAS, minúsculas o frase normal.                  */
const AMB = new Set(['ayuda', 'trabajo', 'estudio', 'compra', 'pago', 'visita', 'baile', 'cuenta']); // sustantivos que parecen verbo
const CHAINV = new Set(['querer', 'poder', 'necesitar', 'deber', 'ir', 'tener', 'gustar', 'saber']); // verbos que llevan otro verbo en infinitivo
const IJ = /^\s*((?:hola|buenos días|buenas tardes|buenas noches|buen día|gracias|adiós|chao|perdón|disculpa|por favor|mucho gusto)[\s,.!¡¿]*)+/i; // saludos al inicio
function detect(text) { // LSC (S-O-V): la frase termina en un verbo en infinitivo · Español (S-V-O): verbo conjugado antes del objeto
  const t = clean(text).filter(w => !TIMEW[w] && !QW.includes(w) && !['no', 'a', 'que', 'de', 'me', 'te', 'se', 'nos'].includes(w));
  if (!t.length) return null;
  const last = t[t.length - 1], prev = FORMS[t[t.length - 2]];
  if (looseInf(last)) return prev && CHAINV.has(prev[0]) && !AMB.has(t[t.length - 2]) ? 'es' : 'lsc'; // «quiero comer» es español; «YO COMER QUERER» es LSC
  return t.some(w => FORMS[w]) ? 'es' : null;
}
const caseMode = s => { const l = /[a-záéíóúüñ]/.test(s), u = /[A-ZÁÉÍÓÚÜÑ]/.test(s); return l && !u ? 'lower' : u && !l ? 'upper' : 'sentence'; };
const WORD = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+/g, norm = w => w.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
/* La traducción conserva el estilo con que se escribió:
   TODO EN MAYÚSCULAS → mayúsculas · todo en minúsculas → minúsculas ·
   mezcla → se respetan los nombres y siglas escritos con mayúscula y la frase empieza con mayúscula. */
function applyCase(out, mode, src, first = true) {
  out = out.trim();
  if (mode === 'upper') return out.toUpperCase();
  if (mode === 'lower') return out.toLowerCase();
  const caps = new Map(), re = new RegExp(WORD.source, 'g'); let n = 0, m;
  while ((m = re.exec(src))) {      // nombres: con mayúscula en medio de la frase, o al inicio si van seguidos de coma (vocativo)
    const w = m[0];
    if (/^[A-ZÁÉÍÓÚÜÑ]/.test(w) && (n > 0 || /^\s*,/.test(src.slice(m.index + w.length))) && !caps.has(norm(w))) caps.set(norm(w), w);
    n++;
  }
  out = out.replace(WORD, w => caps.get(norm(w)) || w.toLowerCase());
  return first ? out.replace(/^([^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]*)([a-záéíóúüñ])/, (_, p, c) => p + c.toUpperCase()) : out;
}
const EMO = /[\p{Extended_Pictographic}\u200d\ufe0f\u{1F3FB}-\u{1F3FF}]+/gu; // los emojis no se traducen: se conservan
async function buildMsg(text, role) { // devuelve las dos versiones del mensaje: sordo (LSC) y oyente (español)
  const em = (text.match(EMO) || []).join(''), plain = text.replace(EMO, '').trim();
  if (!plain) return { sordo: text, oyente: text, src: null };
  const ijm = plain.match(IJ), ij = ijm ? ijm[0].replace(/[\s,.!¡¿]+$/, '').trim() : '', core = ijm ? plain.slice(ijm[0].length).trim() : plain;
  if (!core) return { sordo: text, oyente: text, src: null };
  const src = detect(core) || (role === 'sordo' ? 'lsc' : 'es'), tail = em ? ' ' + em : '', mode = caseMode(plain);
  const ijOut = !ij ? '' : mode === 'upper' ? ij.toUpperCase() : mode === 'lower' ? ij.toLowerCase() : ij;   // el saludo se deja como se escribió
  let sordo, oyente;
  if (src === 'lsc') {            // escribió en LSC (S-O-V): LSC = lo escrito tal cual · Español = traducción (S-V-O) en el mismo estilo
    sordo = plain + tail;
    const t = await aiRefine(core, 'lsc2es', lscToEs(core));
    oyente = (ij ? (mode === 'sentence' ? cap(ij.toLowerCase()) : ijOut) + ', ' + applyCase(t, mode, core, false) : applyCase(t, mode, core)) + tail;
  } else {                        // escribió en español (S-V-O): Español = lo escrito tal cual · LSC = traducción (S-O-V) en el mismo estilo
    oyente = plain + tail;
    const t = await aiRefine(core, 'es2lsc', esToLsc(core));
    sordo = (ij ? ijOut + ' ' : '') + applyCase(t, mode, core, !ij) + tail;
  }
  return { sordo, oyente, src };
}

/* ---------- IA (opcional) ----------
   Conecta un endpoint PROPIO (backend) que llame a la API de Claude.
   Nunca pongas la API key en el frontend.                                  */
const AI = { endpoint: null /* ej: '/api/translate' */ };
async function aiRefine(text, dir, fallback) {
  if (!AI.endpoint) return fallback;
  try {
    const r = await fetch(AI.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, dir }) }); // dir: 'lsc2es' | 'es2lsc'
    return (await r.json()).result || fallback;
  } catch { return fallback; }
}


/* ---------- CHATS: varios por usuario, invitar amigos, eliminar ---------- */
const CK='lsc_chats',chats=()=>store.get(CK,[]);let activeChat=null,chatLang=null;const mid=m=>String(m.id||m.t);
const hideMenu=()=>{['#msgMenu','#chatMenu'].forEach(q=>{const m=$(q);if(m)m.hidden=true})};
const mine=()=>chats().filter(c=>c.members.includes(session.id));
const uname=id=>(users().find(u=>u.id===id)||{name:'Usuario'}).name;
/* Chat personal («Mi primer chat»): solo la persona dueña, sin invitados.
   Nombre del chat por persona: quien lo creó ve el nombre que escribió; quien fue invitado ve, por defecto, el nombre de las otras personas (y puede ponerle el suyo). */
const isPersonal=c=>!!c.personal||(c.title==='Mi primer chat'&&c.members.length===1&&c.members[0]===c.owner);
const chatTitle=(c,uid=session.id)=>{if(c.names&&c.names[uid])return c.names[uid];if(isPersonal(c)||uid===c.owner)return c.title;const o=c.members.filter(id=>id!==uid).map(uname);return o.length?o.join(', '):c.title};
const chatSub=c=>isPersonal(c)?'Solo tú':c.members.length+' persona(s)';
function createChat(title,personal){const c=chats();const n={id:Date.now(),title,owner:session.id,members:[session.id],msgs:[]};if(personal)n.personal=true;c.push(n);store.set(CK,c);activeChat=n.id}
function patchChat(id,fn){const c=chats();const x=c.find(k=>k.id===id);if(x)fn(x);try{store.set(CK,c)}catch{notify('No se pudo preparar el mensaje para guardarlo. Revisa la conexión y vuelve a intentarlo.')}}
async function send(text){
  if(!text.trim())return;const b=await buildMsg(text,session.role);
  patchChat(activeChat,c=>c.msgs.push({id:Date.now()+''+Math.floor(Math.random()*1000),uid:session.id,from:session.role,sordo:b.sordo,oyente:b.oyente,orig:text,src:b.src,t:Date.now()}));renderTrad()}
/* ---------- MODOS DE CHAT ----------
   dd = dos personas sordas → videollamada · ds = sordo(s) y oyente(s) → cámara + traductor en vivo + avatar LSC */
const roleOf=id=>(users().find(u=>u.id===id)||{}).role;
function chatMode(c){const rs=c.members.map(roleOf),s=rs.filter(r=>r==='sordo').length,o=rs.filter(r=>r==='oyente').length;return c.members.length===2&&s===2?'dd':s>=1&&o>=1?'ds':'plain'}
/* Conector del AVATAR 3D: recibe las glosas LSC y las "signa". Por ahora las resalta una a una; aquí se integrará el avatar 3D. */
const AVATAR={timer:null,sign(text){clearInterval(this.timer);const g=$('#avGloss'),f=$('#avFig'),w=(text||'').split(/\s+/).filter(Boolean);if(!g)return;
  g.innerHTML=w.map(x=>`<span>${esc(x)}</span>`).join(' ');f.classList.toggle('signing',w.length>0);if(!w.length)return;const sp=[...g.children];let i=0;
  this.timer=setInterval(()=>{sp.forEach((s,k)=>s.classList.toggle('on',k===i));if(++i>sp.length){clearInterval(this.timer);sp.forEach(s=>s.classList.remove('on'));f.classList.remove('signing')}},700)}};
let avLast='';
const fmtDur=s=>(s>=3600?Math.floor(s/3600)+' h ':'')+Math.floor(s%3600/60)+' min '+s%60+' s';
function renderTrad(){
  if(!mine().some(isPersonal)){const prev=activeChat;createChat('Mi primer chat',true);if(prev&&mine().some(k=>k.id===prev))activeChat=prev}
  const list=mine();if(!list.find(c=>c.id===activeChat))activeChat=list[0].id;
  const c=list.find(k=>k.id===activeChat),role=session.role,mode=chatMode(c),personal=isPersonal(c);
  $('#camCol').className=mode==='ds'?'col-md-5':'col-12';$('#trCol').hidden=$('#avCol').hidden=mode!=='ds';$('#btnCall').hidden=mode!=='dd';
  $('#chatList').innerHTML=list.map(x=>`<div class="chat-row"><button class="chat-item ${x.id===activeChat?'on':''}" data-act="openChat" data-id="${x.id}">${isPersonal(x)?'🔒':'💬'} ${esc(chatTitle(x))}<small>${chatSub(x)}</small></button><button class="dots chat-dots" data-act="chatDots" data-id="${x.id}" aria-label="Opciones del chat">⋯</button></div>`).join('');
  $('#chatTitle').textContent=chatTitle(c);$('#chatMembers').textContent=personal?'Solo tú · chat personal':'Con: '+c.members.map(uname).join(', ');
  document.querySelector('[data-act="invite"]').hidden=document.querySelector('[data-act="delChat"]').hidden=personal;
  // Idioma de lectura: LSC (S-O-V), Español (S-V-O) o ambos. Por defecto, el de cada rol.
  const lang=chatLang||(role==='sordo'?'lsc':'es');
  $$('#langSwitch button').forEach(b=>b.classList.toggle('on',b.dataset.l===lang));
  hideMenu();const vis=c.msgs.filter(m=>!(m.hiddenFor||[]).includes(session.id));
  $('#chat').innerHTML=vis.length?vis.map(m=>{const me=m.uid===session.id;
    if(m.type==='call')return `<div class="callrec">📹 Videollamada · ${fmtDur(m.dur)} · ${new Date(m.t).toLocaleString('es-CO',{dateStyle:'medium',timeStyle:'short'})}</div>`;
    const body=m.deleted?'<em class="text-muted">🚫 Mensaje eliminado</em>':lang==='both'?`<div><span class="tag lsc">LSC</span> <span class="big">${esc(m.sordo)}</span></div><div class="mt-1"><span class="tag es">Español</span> <span class="big">${esc(m.oyente)}</span></div>`:`<span class="big">${esc(lang==='lsc'?m.sordo:m.oyente)}</span>`;
    const dots=!m.deleted?`<button class="dots" data-act="dots" data-id="${mid(m)}" data-own="${me?1:0}" aria-label="Opciones del mensaje">⋯</button>`:'';
    const au=m.audio&&!m.deleted?`<audio controls preload="metadata" src="${m.audio}"></audio>`:'';
    return `<div class="msg ${me?'mine':'other'}"><small>${me?'Tú':esc(uname(m.uid))} · ${m.from==='sordo'?'🧏':m.from==='admin'?'🛡️':'👂'}${m.edited&&!m.deleted?' · editado':''}${m.fwd&&!m.deleted?' · ↪️ Reenviado':''}</small>${au}${body}${dots}</div>`}).join(''):'<p class="text-muted">Escribe el primer mensaje 💬</p>';
  if(mode==='ds'){const real=[...vis].reverse().filter(m=>!m.deleted&&!m.type),ld=real.find(m=>m.from==='sordo'),ln=real.find(m=>m.from!=='sordo');
    $('#trLive').textContent=ld?ld.oyente:'Aquí aparecerá, en español, lo que exprese la persona sorda.';
    const key=c.id+'|'+(ln?mid(ln):'');if(key!==avLast){avLast=key;AVATAR.sign(ln?ln.sordo:'')}}
  $('#chat').scrollTop=1e6;$('#btnMic').hidden=role==='sordo'}
let stream=null;
async function cam(){if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;$('#cam').hidden=true;$('#camPlaceholder').hidden=false;$('#btnCam').textContent='Activar cámara';return}
  try{stream=await navigator.mediaDevices.getUserMedia({video:true});$('#cam').srcObject=stream;$('#cam').hidden=false;$('#camPlaceholder').hidden=true;$('#btnCam').textContent='Apagar cámara'}catch{notify('No se pudo acceder a la cámara. Revisa los permisos.')}}
function mic(){const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR)return notify('Tu navegador no admite micrófono. Usa Chrome o Edge.');
  const r=new SR();r.lang='es-CO';r.onstart=()=>$('#btnMic').classList.add('rec');r.onend=()=>$('#btnMic').classList.remove('rec');
  r.onresult=e=>send(e.results[0][0].transcript);r.start()}

/* ---------- DICTADO POR VOZ (persona oyente): habla → se transcribe → se envía el TEXTO ----------
   No se envían audios: la persona sorda recibe el texto ya convertido a su estructura LSC.
   Controles: pausar/continuar · volver a dictar · eliminar · editar texto · enviar. Requiere Chrome o Edge. */
let rec=null;const clock=s=>Math.floor(s/60)+':'+String(s%60).padStart(2,'0');
function recUI(){const on=!!rec;$('#recBar').hidden=!on;$('#inputRow').hidden=on;if(!on)return;
  $('#recTime').textContent=clock(rec.sec);$('#recState').textContent=rec.paused?'En pausa':'Escuchando…';$('#recPause').textContent=rec.paused?'▶ Continuar':'⏸ Pausar';$('#recBar').classList.toggle('paused',rec.paused);
  $('#recLive').textContent=(rec.text+rec.interim).trim()||'Habla ahora: tu voz se convertirá en texto.'}
function recStart(){if(rec)return;const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR)return notify('Tu navegador no admite dictado por voz. Usa Chrome o Edge.');
  const sr=new SR();sr.lang='es-CO';sr.continuous=true;sr.interimResults=true;const seed=($('#msgInput').value||'').trim();rec={sr,text:seed?seed+' ':'',interim:'',sec:0,paused:false,live:true};
  sr.onresult=e=>{if(!rec)return;let it='';for(let i=e.resultIndex;i<e.results.length;i++){const x=e.results[i];if(x.isFinal)rec.text+=x[0].transcript+' ';else it+=x[0].transcript}rec.interim=it;recUI()};
  sr.onerror=e=>{if(e.error==='not-allowed'||e.error==='service-not-allowed'){notify('No se pudo acceder al micrófono. Revisa los permisos del navegador.');recStop()}};
  sr.onend=()=>{if(rec&&rec.live&&!rec.paused)try{sr.start()}catch{}};
  try{sr.start()}catch{}rec.timer=setInterval(()=>{if(rec&&!rec.paused){rec.sec++;recUI()}},1000);recUI()}
function recStop(){if(!rec)return;const r=rec;rec=null;clearInterval(r.timer);r.live=false;try{r.sr.abort()}catch{}recUI()}
function recPause(){if(!rec)return;if(rec.paused){rec.paused=false;rec.live=true;try{rec.sr.start()}catch{}}else{rec.paused=true;rec.live=false;try{rec.sr.stop()}catch{}}recUI()}
const recDel=()=>recStop();
function recRedo(){recStop();recStart()}
async function recFinish(){const r=rec;r.live=false;try{r.sr.stop()}catch{}await new Promise(res=>setTimeout(res,600));const t=(r.text+' '+r.interim).trim();recStop();return t}
async function recSend(){if(!rec)return;const t=await recFinish();if(!t)return notify('No se escuchó nada. Intenta de nuevo.');send(t);$('#msgInput').value=''}
async function recEdit(){if(!rec)return;const t=await recFinish();$('#msgInput').value=t;$('#msgInput').focus()}

/* ---------- VIDEOLLAMADA (persona sorda ↔ persona sorda) ----------
   La señalización viaja por WebSocket (/ws) a través del servidor, que solo reenvía mensajes entre personas que comparten un chat.
   El video va directo entre navegadores (WebRTC, STUN). En el chat solo queda el registro de la llamada: duración y fecha.                                                                    */
const RTCCFG={iceServers:[{urls:'stun:stun.l.google.com:19302'}]};
let call=null,inc=null;
let WS=null,wsReady=false,wsQ=[];
function wsOpen(){const tk=sessionStorage.getItem('lsc_token');if(!session||!tk||(WS&&WS.readyState<2))return;
  const w=WS=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws');wsReady=false;
  w.onopen=()=>w.send(JSON.stringify({type:'auth',token:tk}));
  w.onmessage=ev=>{let m;try{m=JSON.parse(ev.data)}catch{return}if(m.type==='ready'){wsReady=true;wsQ.splice(0).forEach(x=>w.send(x));return}callHandler(m)};
  w.onclose=()=>{if(WS===w){WS=null;wsReady=false}if(session&&sessionStorage.getItem('lsc_token'))setTimeout(wsOpen,3000)}}
const callSend=m=>{const s=JSON.stringify(m);if(WS&&wsReady)WS.send(s);else{wsQ.push(s);wsOpen()}};
const callUI=(show,state)=>{$('#callUI').hidden=!show;if(state)$('#callState').textContent=state};
async function callMedia(){try{return await navigator.mediaDevices.getUserMedia({video:true,audio:true})}catch{try{return await navigator.mediaDevices.getUserMedia({video:true})}catch{return null}}}
function callPC(){const pc=new RTCPeerConnection(RTCCFG);call.pc=pc;call.q=[];call.stream.getTracks().forEach(t=>pc.addTrack(t,call.stream));
  pc.ontrack=e=>{$('#callRemote').srcObject=e.streams[0]};
  pc.onicecandidate=e=>{if(e.candidate)callSend({type:'ice',to:call.peer,cand:e.candidate.toJSON()})};
  pc.onconnectionstatechange=()=>{if(!call)return;if(pc.connectionState==='connected'&&!call.t0){call.t0=Date.now();call.tick=setInterval(()=>{$('#callTime').textContent=fmtDur(Math.floor((Date.now()-call.t0)/1000))},1000);$('#callState').textContent='En videollamada'}
    if(['failed','closed'].includes(pc.connectionState))callEnd(false)};
  return pc}
function callEnd(local){if(!call)return;const c=call;call=null;clearInterval(c.tick);try{c.pc&&c.pc.close()}catch{}c.stream.getTracks().forEach(t=>t.stop());
  if(local)callSend({type:'end',to:c.peer});callUI(false);
  if(c.caller&&c.t0)patchChat(c.chat,x=>x.msgs.push({id:Date.now()+''+Math.floor(Math.random()*1000),type:'call',uid:session.id,dur:Math.max(1,Math.round((Date.now()-c.t0)/1000)),t:c.t0})); // solo queda el registro
  if(location.hash==='#traductor')renderTrad()}
const callHandler=async m=>{if(!session||m.to!==session.id)return;
  try{
  if(m.type==='invite'){if(call)return callSend({type:'busy',to:m.from});inc=m;$('#callFrom').textContent=m.name;$('#callIn').hidden=false}
  else if(m.type==='end'&&inc&&inc.from===m.from){inc=null;$('#callIn').hidden=true}
  else if(!call||call.peer!==m.from){return}
  else if(m.type==='accept'){const pc=callPC(),o=await pc.createOffer();await pc.setLocalDescription(o);callSend({type:'offer',to:m.from,sdp:{type:o.type,sdp:o.sdp}})}
  else if(m.type==='offer'){const pc=callPC();await pc.setRemoteDescription(m.sdp);for(const q of call.q.splice(0))await pc.addIceCandidate(q);const a=await pc.createAnswer();await pc.setLocalDescription(a);callSend({type:'answer',to:m.from,sdp:{type:a.type,sdp:a.sdp}})}
  else if(m.type==='answer'){await call.pc.setRemoteDescription(m.sdp);for(const q of call.q.splice(0))await call.pc.addIceCandidate(q)}
  else if(m.type==='ice'){if(call.pc&&call.pc.remoteDescription)await call.pc.addIceCandidate(m.cand);else if(call.q)call.q.push(m.cand)}
  else if(m.type==='decline'||m.type==='busy'){const n=uname(m.from);callEnd(false);notify(n+' no pudo atender la videollamada.')}
  else if(m.type==='end'){callEnd(false)}
  }catch(err){console.warn('videollamada',err)}};
addEventListener('beforeunload',()=>{if(call)callSend({type:'end',to:call.peer})});

/* ---------- APRENDIZAJE ----------
   Imágenes OFICIALES de las señas: colócalas en img/senas/abc/a.png … y img/senas/num/0.png … (ver LEEME.txt). */
const GUIDES=[['Yo como pan.','YO PAN COMER','El verbo va al final y en infinitivo.'],['¿Qué quieres?','TÚ QUERER QUÉ','La pregunta va al final.'],['Ella compra agua.','ELLA AGUA COMPRAR','Sin artículos ni preposiciones.'],['Voy a la casa.','YO CASA IR','Primero quién, luego qué, al final la acción.']];
let useLang=null; // idioma de lectura de la guía de uso (por defecto: el de cada rol)
const STEPS=[
 {te:'Crea tu cuenta y elige tu rol',tl:'TÚ CUENTA CREAR, ROL ESCOGER',de:'Presiona «Regístrate aquí», llena tus datos y elige si eres persona sorda u oyente.',dl:'TÚ «REGÍSTRATE AQUÍ» PRESIONAR, DATOS LLENAR, TÚ SORDO U OYENTE ESCOGER.'},
 {te:'Abre el traductor',tl:'TÚ TRADUCTOR ABRIR',de:'Ve al menú «Traductor». Allí están tus chats.',dl:'TÚ MENÚ «TRADUCTOR» IR. AHÍ TUS CHATS ESTAR.'},
 {te:'Crea un chat',tl:'TÚ CHAT NUEVO CREAR',de:'Pulsa «＋ Nuevo» y ponle un nombre. Puedes tener varios y eliminarlos.',dl:'TÚ «NUEVO» PRESIONAR, NOMBRE PONER. TÚ CHATS VARIOS TENER PODER, ELIMINAR PODER.'},
 {te:'Invita a un amigo',tl:'TÚ AMIGO CORREO INVITAR',de:'Pulsa «Invitar amigo» y escribe el correo con el que se registró.',dl:'TÚ «INVITAR AMIGO» PRESIONAR, CORREO AMIGO ESCRIBIR.'},
 {te:'Escribe tu mensaje',tl:'TÚ MENSAJE ESCRIBIR',de:'Persona sorda: escribe en tu estructura Sujeto-Objeto-Verbo (o usa la cámara). Persona oyente: escribe o dicta con el micrófono en Sujeto-Verbo-Objeto.',dl:'SORDO: TÚ MENSAJE ESTRUCTURA SUJETO-OBJETO-VERBO ESCRIBIR (O CÁMARA USAR). OYENTE: MENSAJE ESTRUCTURA SUJETO-VERBO-OBJETO ESCRIBIR (O MICRÓFONO DICTAR).'},
 {te:'Lee la respuesta',tl:'TÚ RESPUESTA LEER',de:'Cada persona lee el mensaje del otro en su propia estructura: la persona sorda en LSC y la oyente en español.',dl:'CADA PERSONA MENSAJE OTRO ESTRUCTURA PROPIA LEER: SORDO LSC, OYENTE ESPAÑOL.'},
 {te:'Guarda tus palabras',tl:'TÚ PALABRA GLOSARIO GUARDAR',de:'En «Glosario» agrega apodos y conceptos; puedes editarlos o borrarlos.',dl:'«GLOSARIO» ENTRAR, APODO CONCEPTO AGREGAR. TÚ EDITAR PODER, BORRAR PODER.'}];
function renderLearn(tab){
  $$('#learnTabs button').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
  // Tarjeta bilingüe: Español (SVO) + LSC (SOV). "mov" = la seña lleva movimiento (flechas del cartel).
  const sc=(dir,k,big,es,lsc,mov)=>`<div class="col-6 col-md-4 col-lg-3"><div class="sign-card"><div class="sign-img"><img src="img/senas/${dir}/${k}.png" alt="Seña ${es}" onerror="this.replaceWith(document.createTextNode('Imagen no disponible'))"></div><b>${big}</b><div class="small text-start mt-1"><div><span class="tag es">Español</span> ${es}</div><div class="mt-1"><span class="tag lsc">LSC</span> ${lsc}</div>${mov?'<div class="mt-1 text-muted">↻ Con movimiento</div>':''}</div></div></div>`;
  const ex=(pairs)=>'<div class="row g-3 mt-3">'+pairs.map((p,i)=>`<div class="col-md-6"><div class="gcard p${i+2}"><span class="tag es">Español · Sujeto-Verbo-Objeto</span><p class="fs-5 mb-2">${p[0]}</p><span class="tag lsc">LSC · Sujeto-Objeto-Verbo</span><p class="fs-5 fw-bold mb-0">${p[1]}</p></div></div>`).join('')+'</div>';
  const NUM=['uno','dos','tres','cuatro','cinco','seis','siete','ocho','nueve','diez','once','doce','trece','catorce','quince','dieciséis','diecisiete','dieciocho','diecinueve','veinte'];
  let h='';
  if(tab==='abc')h='<p class="text-muted">Abecedario de la Lengua de Señas Colombiana. Las flechas indican movimiento.</p><div class="row g-3">'+'ABCDEFGHIJKLMNÑOPQRSTUVWXYZ'.split('').map(l=>`<div class="col-6 col-md-4 col-lg-3"><div class="sign-card"><div class="sign-img tall"><img src="img/senas/abc/${l==='Ñ'?'nn':l.toLowerCase()}.png" alt="Seña de la letra ${l}"></div></div></div>`).join('')+'</div>'+ex([['Yo deletreo mi nombre.','YO NOMBRE DELETREAR'],['Ella escribe su nombre.','ELLA NOMBRE ESCRIBIR']]);
  if(tab==='num'){const NN=['Cero','Uno','Dos','Tres','Cuatro','Cinco','Seis','Siete','Ocho','Nueve','Diez','Once','Doce','Trece','Catorce','Quince','Dieciséis','Diecisiete','Dieciocho','Diecinueve','Veinte','Veintiuno','Veintidós','Veintitrés','Veinticuatro','Veinticinco','Veintiséis','Veintisiete','Veintiocho','Veintinueve'];h='<p class="text-muted">Números del 0 al 29 en Lengua de Señas Colombiana.</p><div class="row g-3">'+NN.map((nm,n)=>`<div class="col-6 col-md-4 col-lg-3"><div class="num-card"><img src="img/senas/num/${n}.jpg" alt="Seña del número ${n}: ${nm}" loading="lazy" onerror="this.replaceWith(document.createTextNode('Imagen no disponible'))"></div></div>`).join('')+'</div>'+ex([['Yo tengo tres amigos.','YO AMIGO TRES TENER'],['Ella compra cinco panes.','ELLA PAN CINCO COMPRAR']])}
  if(tab==='gram')h='<div class="row g-3">'+GUIDES.map((g,i)=>`<div class="col-md-6"><div class="gcard p${i+1}"><span class="tag es">Español</span><p class="fs-5 mb-2">${g[0]}</p><span class="tag lsc">LSC</span><p class="fs-5 fw-bold mb-2">${g[1]}</p><small class="text-muted">💡 ${g[2]}</small></div></div>`).join('')+'</div>';
  if(tab==='uso'){const L=useLang||(session&&session.role==='sordo'?'lsc':'es'),bt=(l,t)=>`<button class="btn btn-sm btn-soft ${L===l?'on':''}" data-act="useLang" data-l="${l}">${t}</button>`;
    h=`<div class="d-flex flex-wrap gap-2 mb-3">${bt('lsc','🤟 LSC')}${bt('es','Español')}${bt('both','⇄ Ambos')}</div>`+STEPS.map((s,i)=>`<div class="step mb-3"><div class="step-n">${i+1}</div><div class="gcard p${i%5+1} flex-fill">${L==='es'?`<b>${s.te}</b><p class="mb-0 mt-1">${s.de}</p>`:L==='lsc'?`<b>${s.tl}</b><p class="mb-0 mt-1 fw-bold">${s.dl}</p>`:`<b>${s.te}</b><div class="row mt-2"><div class="col-md-6"><span class="tag lsc">LSC</span><p class="fw-bold mb-1">${s.dl}</p></div><div class="col-md-6"><span class="tag es">Español</span><p class="mb-1">${s.de}</p></div></div>`}</div></div>`).join('')}
  $('#learnBody').innerHTML=h}

/* ---------- GLOSARIO: propio (arriba, pastel animado) y básico (abajo, solo lectura) ---------- */
const BASE=[['Hola','HOLA','👋'],['Gracias','GRACIAS','🙏'],['Por favor','FAVOR','img/por-favor.png'],['Agua','AGUA','💧'],['Comer','COMER','🍽️'],['Ayuda','AYUDA','🆘'],['Baño','BAÑO','🚻'],['Familia','FAMILIA','👪'],['Amigo','AMIGO','🤝'],['Casa','CASA','🏠'],['Sí','SÍ','✅'],['No','NO','❌']];
const glKey=()=>'lsc_gl_'+session.id;
function renderGl(){
  const q=$('#glSearch').value.toLowerCase(),my=store.get(glKey(),[]).filter(m=>!q||(m.es+m.lsc).toLowerCase().includes(q));
  $('#glMine').innerHTML=my.map((m,i)=>`<div class="col-md-6 col-lg-3"><div class="gcard q${i%5+1}"><div class="ico">${m.cat==='Apodo'?'😎':'⭐'}</div><div class="word">${esc(m.lsc)}</div><div>${esc(m.es)}</div><small class="text-muted">${esc(m.cat)}</small><div class="mt-2 d-flex gap-2"><button class="btn btn-sm btn-soft" data-act="glEdit" data-id="${m.id}">✏️ Editar</button><button class="btn btn-sm btn-soft danger" data-act="glDel" data-id="${m.id}">🗑️ Borrar</button></div></div></div>`).join('')||'<p class="text-muted">Aún no tienes palabras propias. ¡Agrega la primera arriba! ✨</p>';
  $('#glBase').innerHTML=BASE.filter(b=>!q||(b[0]+b[1]).toLowerCase().includes(q)).map(b=>`<div class="col-6 col-lg-2"><div class="base"><div class="ico">${b[2].endsWith('.png')?`<img src="${b[2]}" class="base-img" alt="Seña de ${b[0]}">`:b[2]}</div><b>${b[1]}</b><div class="small">${b[0]}</div></div></div>`).join('')}

/* ---------- COMUNIDAD: publicaciones, comentarios en hilo, reacciones ----------
   Regla: cada persona SOLO edita/borra lo suyo (incluso en su propia publicación).
   Borrar un comentario elimina en cascada sus respuestas y reacciones.            */
const P=()=>store.get('lsc_posts',[]),C=()=>store.get('lsc_cmts',[]);let open=new Set();
const hasR=(x,t)=>(x.r&&x.r[t]||[]).includes(session.id),cnt=(x,t)=>(x.r&&x.r[t]||[]).length;
function rbar(kind,x){return `<button class="rbtn ${hasR(x,'love')?'on':''}" data-act="react" data-k="${kind}" data-id="${x.id}" data-t="love">❤️ ${cnt(x,'love')}</button> <button class="rbtn ${hasR(x,'like')?'on':''}" data-act="react" data-k="${kind}" data-id="${x.id}" data-t="like">👍 ${cnt(x,'like')}</button>`}
function ownerBtns(kind,x){if(x.pinned||x.uid==='ejemplo')return '';if(x.uid===session.id)return `<button class="link-act" data-act="edit" data-k="${kind}" data-id="${x.id}">✏️ Editar</button><button class="link-act" data-act="del" data-k="${kind}" data-id="${x.id}">🗑️ Borrar</button>`;return session.role==='admin'?`<button class="link-act" data-act="del" data-k="${kind}" data-id="${x.id}">🛡️ Moderar: borrar</button>`:''}
let cq=''; // texto del buscador de la comunidad
const hl=s=>{const e=esc(s);if(!cq)return e;const r=esc(cq).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');return e.replace(new RegExp(r,'gi'),m=>`<mark>${m}</mark>`)};
function tree(pid,parent,all,d){return all.filter(c=>c.postId===pid&&c.parentId===parent).map(c=>`<div class="cmt"><b>${hl(c.name)}</b> <small class="text-muted">${c.role==='sordo'?'🧏':'👂'}</small><div>${hl(c.text)}</div>${rbar('c',c)} ${d<3?`<button class="link-act" data-act="reply" data-p="${pid}" data-id="${c.id}">↩️ Responder</button>`:''}${ownerBtns('c',c)}${tree(pid,c.id,all,d+1)}</div>`).join('')}
function renderPosts(){const cm=C(),q=cq.toLowerCase(),has=x=>(x.name+' '+x.text).toLowerCase().includes(q);
  // Con búsqueda: se muestran las publicaciones que coinciden (o cuyos comentarios coinciden) y se abren sus comentarios
  let ps=P().slice().reverse().sort((a,b)=>(b.pinned?1:0)-(a.pinned?1:0));
  if(q)ps=ps.filter(p=>has(p)||cm.some(c=>c.postId===p.id&&has(c)));
  $('#posts').innerHTML=(q?`<p class="text-muted">${ps.length} resultado(s) para “${esc(cq)}”</p>`:'')+(ps.map((p,i)=>{const n=cm.filter(c=>c.postId===p.id).length,show=open.has(p.id)||(q&&cm.some(c=>c.postId===p.id&&has(c)));
  return `<div class="gcard p${i%5+1} mb-3"><b>${p.role==='sordo'?'🧏':'👂'} ${hl(p.name)}</b>${p.pinned?' <span class="tag lsc">📌 Ejemplo</span>':''}<p class="my-2">${hl(p.text)}</p>${rbar('p',p)} <button class="rbtn" data-act="toggle" data-id="${p.id}">☁️ ${n}</button> ${ownerBtns('p',p)}
  ${show?`<div class="mt-2">${tree(p.id,null,cm,0)}<form class="cform input-group mt-2" data-p="${p.id}"><input class="form-control" placeholder="Escribe un comentario…" required><button class="btn btn-grad">Comentar</button></form></div>`:''}</div>`}).join('')||(q?'<p class="text-muted">No encontramos nada 🔎 Prueba con otra palabra.</p>':'<p class="text-muted">Sé la primera persona en publicar 💜</p>'))}
function descendants(id,all){const out=[id];all.filter(c=>c.parentId===id).forEach(c=>out.push(...descendants(c.id,all)));return out}

/* ---------- SOPORTE / ACERCA / INICIO (contenido) ---------- */
const FAQ=[['¿Cómo empiezo?','Crea tu cuenta, elige tu rol y entra al Traductor. En “Aprendizaje → Cómo usar la plataforma” hay una guía paso a paso en LSC y español.'],
['¿Cómo escribo en estructura LSC?','Primero quién, luego qué y al final la acción en infinitivo: YO AGUA QUERER. Las preguntas van al final: TÚ QUERER QUÉ.'],
['¿Cómo invito a un amigo?','En el chat pulsa “Invitar amigo” y escribe el correo con el que esa persona se registró.'],
['El micrófono no funciona','Permite el acceso al micrófono en el navegador y usa Chrome o Edge. El sitio debe abrirse con HTTPS o localhost.'],
['La cámara no enciende','Permite la cámara en el navegador y revisa que ninguna otra aplicación la esté usando.'],
['¿Puedo borrar mi chat?','Sí. Si lo creaste, se elimina para todos; si te invitaron, solo sales del chat.'],
['¿Quién puede borrar o editar mis comentarios?','Solo tú puedes editarlos. Puedes borrarlos tú o el equipo administrador (moderación). Si se borra un comentario, también se borran sus respuestas y reacciones. La publicación de ejemplo no se puede editar ni borrar.'],
['Olvidé mi contraseña','En la pantalla de ingreso pulsa “Olvidé mi contraseña” y escribe tu correo. Recibirás un enlace de un solo uso, válido 15 minutos. Si el correo no está configurado en la instalación, pídele el enlace a quien administra el servidor.'],
['¿Puedo agrandar la letra?','Sí, con los botones A+ / A− en la esquina inferior derecha.'],
['¿Las señas son oficiales?','Debes tomarlas del INSOR y validarlas con la comunidad sorda; la LSC tiene variaciones regionales.']];
const ABOUT=[['🌱','Nuestra historia','Nacimos en el SENA con una pregunta: ¿cómo hacemos que una conversación sea posible para todas las personas?'],['🎯','Misión','Facilitar la comunicación entre personas sordas y oyentes, cada quien en su propia estructura.'],['🔭','Visión','Ser una plataforma construida con la comunidad sorda y usada en aulas, hogares y trabajos.'],['🤝','Valores','Respeto, inclusión, comunidad e innovación con propósito.'],['🧩','Qué hacemos','Traducimos entre LSC y español, enseñamos señas y creamos un glosario propio de cada persona.'],['💬','Compromiso','Validar cada seña con la comunidad sorda y el INSOR, y escuchar sugerencias siempre.']];
const QUICK=[['💬','Traductor','Conversa en tu estructura','#traductor'],['📚','Aprendizaje','Abecedario, números y guías','#aprendizaje'],['🗂️','Glosario','Guarda tus propias señas','#glosario'],['🌈','Comunidad','Comparte y reacciona','#comunidad']];
$('#quick').innerHTML=QUICK.map((q,i)=>`<div class="col-6 col-lg-3"><a href="${q[3]}" class="text-decoration-none text-dark"><div class="gcard p${i+1}"><div class="ico">${q[0]}</div><b>${q[1]}</b><div class="small">${q[2]}</div></div></a></div>`).join('');
$('#aboutGrid').innerHTML=ABOUT.map((a,i)=>`<div class="col-md-6 col-lg-4"><div class="gcard p${i%5+1}"><div class="ico">${a[0]}</div><b>${a[1]}</b><p class="mb-0 small">${a[2]}</p></div></div>`).join('');
$('#faq').innerHTML=FAQ.map((f,i)=>`<div class="accordion-item"><h3 class="accordion-header"><button class="accordion-button ${i?'collapsed':''}" data-bs-toggle="collapse" data-bs-target="#f${i}">${f[0]}</button></h3><div id="f${i}" class="accordion-collapse collapse ${i?'':'show'}"><div class="accordion-body">${f[1]}</div></div></div>`).join('');

const CINFO={mail:'<b>📩 Escríbenos</b><p class="mb-0">hola@manosquehablan.co <span class="text-muted">(demo)</span> · o usa el formulario de abajo.</p>',lsc:'<b>🤟 Respuesta en LSC</b><p class="mb-0">Marca “Prefiero respuesta en video LSC” en el formulario y te responderemos en video.</p>',hor:'<b>🕘 Horario</b><p class="mb-0">Lunes a viernes · 8:00 a. m. – 5:00 p. m.</p>'};
/* ---------- CONTACTO: cada perfil ve solo sus propias solicitudes y respuestas ---------- */
const CRK='lsc_contacts';let cView='new';
const ur=r=>r.urole||(users().find(u=>u.id===r.uid)||{}).role||'oyente';
const pref=r=>r.wantsLsc?'🎥 Prefiere respuesta en video LSC':ur(r)==='sordo'?'📝 Texto en estructura LSC':'📝 Texto en español';
const repOf=r=>!r.reply?null:typeof r.reply==='string'?{text:r.reply,media:[]}:r.reply;
const mediaHTML=m=>(m||[]).map(x=>x.type==='video'?`<video controls src="${x.src}" class="rmedia"></video>`:`<img src="${x.src}" class="rmedia" alt="${esc(x.name||'foto')}">`).join('');
const replyHTML=r=>{const p=repOf(r);return p?`<div class="reply">💬 <b>Respuesta del equipo:</b> ${p.text?esc(p.text):''}<div class="d-flex flex-wrap gap-2 mt-2">${mediaHTML(p.media)}</div></div>`:''};
function renderContact(thanksName){
  const all=store.get(CRK,[]).sort((a,b)=>b.id-a.id),admin=session.role==='admin',box=$('#contactBox');
  const my=all.filter(r=>r.uid===session.id),inbox=all.filter(r=>r.uid!==session.id);
  $('#cOpts').hidden=$('#cInfo').hidden=admin; // el administrador no envía solicitudes: las recibe
  $('#cViews').innerHTML=admin?`<span class="opt on">📥 Solicitudes recibidas (${inbox.length})</span>`:`<button class="opt ${cView==='new'?'on':''}" data-act="cView" data-v="new">✉️ Nueva solicitud</button><button class="opt ${cView==='hist'?'on':''}" data-act="cView" data-v="hist">🕘 Mi historial (${my.length})</button>`;
  if(admin){box.innerHTML=inbox.length?inbox.map(r=>`<div class="req"><div class="d-flex justify-content-between gap-2"><b>${ur(r)==='sordo'?'🧏':'👂'} ${esc(r.name)}</b><span class="tag ${r.reply?'es':'lsc'}">${r.reply?'Respondida':'Pendiente'}</span></div><small class="text-muted">${esc(r.email)} · ${new Date(r.id).toLocaleString('es-CO')}</small><div class="mt-1"><span class="tag lsc">${pref(r)}</span> <small>${esc(r.subject)}</small></div><p class="my-2">${esc(r.message)}</p>${replyHTML(r)}<button class="btn btn-sm btn-grad mt-2" data-act="reqOpen" data-id="${r.id}">${r.reply?'✏️ Editar respuesta':'↩️ Responder'}</button></div>`).join(''):'<p class="text-muted mb-0">Aún no has recibido solicitudes.</p>';return}
  if(cView==='hist'){box.innerHTML=(my.length?my.map(r=>`<div class="req"><div class="d-flex justify-content-between gap-2"><b>${esc(r.subject)}</b><span class="tag ${r.reply?'es':'lsc'}">${r.reply?'Respondida':'Pendiente'}</span></div><small class="text-muted">${new Date(r.id).toLocaleString('es-CO')}${r.wantsLsc?' · Respuesta en video LSC':''}</small><p class="my-2">${esc(r.message)}</p>${r.reply?replyHTML(r):'<small class="text-muted">Esperando respuesta…</small>'}</div>`).join(''):'<p class="text-muted">Aún no has enviado solicitudes.</p>')+'<button class="btn btn-grad mt-2" data-act="cNew">＋ Nueva solicitud</button>';return}
  if(thanksName){box.innerHTML=`<div class="thanks"><div class="ico">💌</div><h3>¡Gracias, ${esc(thanksName)}!</h3><p>Tu mensaje viajó con mucho cariño hasta nuestro equipo. Te responderemos muy pronto; tu respuesta aparecerá en tu historial. Mientras tanto, recuerda: <b>tus manos tienen voz</b> 🤟💜</p><div class="d-flex flex-wrap gap-2"><button class="btn btn-grad" data-act="cNew">＋ Enviar otra solicitud</button><button class="btn btn-soft" data-act="cView" data-v="hist">🕘 Ver mi historial</button></div></div>`;return}
  const u=users().find(x=>x.id===session.id)||{},rl={sordo:'Persona sorda',oyente:'Persona oyente'}[session.role],op=(arr,sel)=>arr.map(x=>`<option ${x===sel?'selected':''}>${x}</option>`).join('');
  box.innerHTML=`<form id="contactForm"><label class="form-label">Nombre</label><input name="name" class="form-control mb-3" value="${esc(session.name)}" required>
  <label class="form-label">Correo</label><input name="email" type="email" class="form-control mb-3" value="${esc(u.email||'')}" required>
  <label class="form-label">Soy…</label><select name="role" class="form-select mb-3">${op(['Persona sorda','Persona oyente','Intérprete / docente'],rl)}</select>
  <label class="form-label">Asunto</label><select name="subject" class="form-select mb-3">${op(['Tengo una duda','Quiero sugerir una seña','Reportar un error','Quiero colaborar'],'')}</select>
  <label class="form-label">Mensaje</label><textarea name="message" class="form-control mb-3" rows="6" required></textarea>
  <div class="form-check mb-3"><input class="form-check-input" type="checkbox" name="lsc" id="vid"><label class="form-check-label" for="vid">Prefiero respuesta en video LSC</label></div>
  <button class="btn btn-grad btn-lg">Enviar mensaje</button></form>`}

/* ---------- RESPUESTA DEL ADMINISTRADOR: texto según el rol del usuario · 📷 cámara · 📎 archivos (fotos o videos) ---------- */
let rp=null;const MAXB=1.5*1024*1024; // límite por archivo en este prototipo (datos enviados a MySQL)
const rpErr=m=>{$('#rpMsg').textContent=m||''};
const findReq=id=>store.get(CRK,[]).find(x=>x.id===id);
function rpMedia(){$('#rpList').innerHTML=rp.media.map((m,i)=>`<div class="rpitem">${m.type==='video'?`<video src="${m.src}" controls></video>`:`<img src="${m.src}" alt="">`}<button class="rpx" data-act="rpDel" data-i="${i}" aria-label="Quitar archivo">✕</button></div>`).join('')}
function rpStopCam(){if(!rp)return;if(rp.rec&&rp.mr){try{rp.mr.stop()}catch{}}if(rp.stream){rp.stream.getTracks().forEach(t=>t.stop());rp.stream=null}$('#rpCamBox').hidden=true}
function addFile(f){if(!/^(image|video)\//.test(f.type))return rpErr('Solo se permiten fotos o videos.');if(f.size>MAXB)return rpErr('«'+f.name+'» pesa más de 1,5 MB (límite del prototipo).');
  const rd=new FileReader();rd.onload=()=>{rp.media.push({type:f.type.startsWith('video')?'video':'image',src:rd.result,name:f.name});rpMedia();rpErr()};rd.readAsDataURL(f)}
function openReply(id){const r=findReq(id);if(!r)return;const old=repOf(r);rp={id,media:old?[...old.media]:[],stream:null,mr:null,rec:false};
  $('#rpTitle').textContent='Responder a '+r.name;
  $('#rpInfo').innerHTML=`<span class="tag lsc">${pref(r)}</span> ${r.wantsLsc?'Debes responder con un video (cámara o archivo). El texto es opcional.':ur(r)==='sordo'?'Escribe tu respuesta en español: se enviará en estructura LSC.':'Escribe tu respuesta: se enviará en español.'}`;
  $('#rpText').value=old?old.text:'';$('#rpPreview').textContent='';rpErr();rpMedia();$('#rpCamBox').hidden=true;bootstrap.Modal.getOrCreateInstance($('#replyModal')).show()}

/* ---------- EMOJIS: botón ＋ del chat ---------- */
let emojiK='😀',fwdId=null;
const EMOJIS={'😀':'😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 😉 😍 🥰 😘 😋 😎 🤩 🥳 😢 😭 😡 😮 😴 🤔 🙄 😬 🤗'.split(' '),'🤟':'🤟 👋 🙌 👏 👍 👎 🙏 ✋ 🤚 👌 ✌️ 🤞 💪 🫶 🤝 👆 👉 👈 🤙 ✊'.split(' '),'❤️':'❤️ 💜 💙 💚 💛 🧡 🖤 🤍 💕 💖 🎉 ✨ 🌟 🔥 ✅ ❌ ❓ ❗ 💬 📷'.split(' '),'🍎':'🍎 🍞 💧 ☕ 🍽️ 🏠 🏫 🚌 📱 💻 📚 ✏️ 🎵 ⚽ 🌞 🌙 🌈 🌳 🐶 🐱'.split(' ')};
function renderEmoji(){$('#emojiPanel').innerHTML='<div class="d-flex gap-1 mb-2">'+Object.keys(EMOJIS).map(k=>`<button type="button" class="btn btn-sm btn-soft ${k===emojiK?'on':''}" data-act="emojiTab" data-k="${k}">${k}</button>`).join('')+'</div><div class="emoji-grid">'+EMOJIS[emojiK].map(e=>`<button type="button" data-act="emojiPick" data-e="${e}">${e}</button>`).join('')+'</div>'}

/* ---------- ACCIONES (delegación de eventos) ---------- */
let fs=+store.get('lsc_fs',16);
const A={
 send(){const i=$('#msgInput');send(i.value);i.value='';$('#emojiPanel').hidden=true;$('#trPreview').textContent='';$('#trPrevLabel').textContent=''},cam,mic(){recStart()},recPause,recRedo,recDel,recSend,recEdit,
 eye(){const i=$('#aPass');i.type=i.type==='password'?'text':'password'},
 async forgot(){const em=(await Dlg.prompt('Escribe el correo de tu cuenta:')||'').trim().toLowerCase();if(!em)return;
  try{const r=await fetch('/api/auth/forgot',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:em})}),j=await r.json().catch(()=>({}));notify(r.ok?j.message:(j.error||'No se pudo procesar la solicitud.'),'Recuperar contraseña')}catch{notify('No hay conexión con el servidor.')}},

 async newChat(){const t=await Dlg.prompt('Nombre del chat (o de la persona que vas a invitar):','Nueva conversación',{emoji:true});if(t&&t.trim()){if(t.trim().toLowerCase()==='mi primer chat')return notify('Ese nombre está reservado para tu chat personal.');createChat(t.trim());renderTrad()}},
 openChat(d){activeChat=+d.id;renderTrad()},
 async invite(){const cc=chats().find(k=>k.id===activeChat);if(cc&&isPersonal(cc))return notify('Tu chat personal es solo para ti: no se puede invitar a nadie.');const em=(await Dlg.prompt('Correo de tu amigo (debe tener cuenta):')||'').trim().toLowerCase();if(!em)return;let u=null;try{const r=await fetch('/api/users/lookup?email='+encodeURIComponent(em),{headers:store.headers()});if(r.ok)u=await r.json();else if(r.status!==404)return notify('No se pudo buscar a esa persona. Inténtalo de nuevo.')}catch{return notify('No hay conexión con el servidor.')}
  if(!u){navigator.clipboard&&navigator.clipboard.writeText(location.href);return notify('Esa persona aún no tiene cuenta. Copiamos el enlace para que la invites a registrarse.')}
  patchChat(activeChat,c=>{if(!c.members.includes(u.id))c.members.push(u.id)});renderTrad()},
 async delChat(){const c=chats().find(k=>k.id===activeChat);if(c.owner===session.id){if(!await Dlg.confirm('¿Eliminar este chat para todos?'))return;store.set(CK,chats().filter(k=>k.id!==c.id))}
  else{if(!await Dlg.confirm('¿Salir de este chat?'))return;patchChat(c.id,k=>k.members=k.members.filter(m=>m!==session.id))}activeChat=null;renderTrad()},
 glEdit(d){const m=store.get(glKey(),[]).find(x=>x.id==d.id);$('#glId').value=m.id;$('#glEs').value=m.es;$('#glLsc').value=m.lsc;$('#glCat').value=m.cat;$('#glForm').scrollIntoView({behavior:'smooth'});$('#glEs').focus()},
 async glDel(d){if(await Dlg.confirm('¿Borrar esta palabra?')){store.set(glKey(),store.get(glKey(),[]).filter(m=>m.id!=d.id));renderGl()}},
 react(d){const L=d.k==='p'?P():C(),x=L.find(i=>i.id==d.id);x.r=x.r||{like:[],love:[]};const a=x.r[d.t]=x.r[d.t]||[];const k=a.indexOf(session.id);k<0?a.push(session.id):a.splice(k,1);store.set(d.k==='p'?'lsc_posts':'lsc_cmts',L);renderPosts()},
 toggle(d){open.has(+d.id)?open.delete(+d.id):open.add(+d.id);renderPosts()},
 async reply(d){const t=await Dlg.prompt('Tu respuesta:');if(!t)return;const c=C();c.push({id:Date.now(),postId:+d.p,parentId:+d.id,uid:session.id,name:session.name,role:session.role,text:t});store.set('lsc_cmts',c);renderPosts()},
 async edit(d){const L=d.k==='p'?P():C(),x=L.find(i=>i.id==d.id);if(x.uid!==session.id)return;const t=await Dlg.prompt('Editar:',x.text);if(t){x.text=t;store.set(d.k==='p'?'lsc_posts':'lsc_cmts',L);renderPosts()}},
 async del(d){const L=d.k==='p'?P():C(),x=L.find(i=>i.id==d.id);if(!x||(x.uid!==session.id&&session.role!=='admin'))return; // solo el autor o el administrador
  if(!await Dlg.confirm(d.k==='p'?'Se borrará la publicación con todos sus comentarios y reacciones.':'Se borrará este comentario con sus respuestas y reacciones.'))return;
  if(d.k==='p'){store.set('lsc_posts',L.filter(i=>i.id!==x.id));store.set('lsc_cmts',C().filter(c=>c.postId!==x.id))}
  else{const ids=descendants(x.id,C());store.set('lsc_cmts',C().filter(c=>!ids.includes(c.id)))}renderPosts()},
 dots(d,b){const cm=$('#chatMenu');if(cm)cm.hidden=true;const ch=chats().find(k=>k.id===activeChat),pe=!!ch&&isPersonal(ch),r=b.getBoundingClientRect(),m=$('#msgMenu');m.dataset.id=d.id;$('#mmEdit').hidden=d.own!=='1';$('#mmAll').hidden=d.own!=='1'||pe;$('#mmHide').textContent=pe?'🗑️ Eliminar mensaje':'🙈 Eliminar para mí';m.style.top=Math.min(r.bottom+4,innerHeight-160)+'px';m.style.left=Math.max(8,r.right-200)+'px';m.hidden=false},
 chatDots(d,b){const r=b.getBoundingClientRect();let m=$('#chatMenu');if(!m){document.body.insertAdjacentHTML('beforeend','<div id="chatMenu" class="msg-menu" hidden><button data-act="renameChat">✏️ Cambiar nombre</button><button data-act="clearChat">🧹 Vaciar chat</button></div>');m=$('#chatMenu')}
   const was=!m.hidden&&m.dataset.id===d.id;hideMenu();if(was)return;const c=chats().find(k=>k.id===+d.id);if(!c)return;m.dataset.id=d.id;const p=isPersonal(c);m.children[0].hidden=p;m.children[1].hidden=!p;
   m.style.top=Math.min(r.bottom+4,innerHeight-90)+'px';m.style.left=Math.max(8,Math.min(r.left,innerWidth-220))+'px';m.hidden=false},
 async renameChat(){const id=+$('#chatMenu').dataset.id,c=chats().find(k=>k.id===id);hideMenu();if(!c||isPersonal(c))return;const cur=chatTitle(c),t=((await Dlg.prompt('Nombre del chat:',cur,{emoji:true}))||'').trim();if(!t||t===cur)return;
   if(t.toLowerCase()==='mi primer chat')return notify('Ese nombre está reservado para tu chat personal.');
   patchChat(id,k=>{if(session.id===k.owner)k.title=t;else k.names={...(k.names||{}),[session.id]:t}});renderTrad()},
 async clearChat(){const id=+$('#chatMenu').dataset.id,c=chats().find(k=>k.id===id);hideMenu();if(!c||!await Dlg.confirm('¿Eliminar todos los mensajes de este chat? Solo se borran para ti.'))return;
   patchChat(id,k=>k.msgs.forEach(x=>{x.hiddenFor=[...new Set([...(x.hiddenFor||[]),session.id])]}));renderTrad()},
 msgHide(){const id=$('#msgMenu').dataset.id;patchChat(activeChat,c=>{const x=c.msgs.find(y=>mid(y)===id);if(x)x.hiddenFor=[...(x.hiddenFor||[]),session.id]});renderTrad()},
 async msgDelAll(){const id=$('#msgMenu').dataset.id;hideMenu();if(!await Dlg.confirm('¿Eliminar este mensaje para todas las personas del chat?'))return;
  patchChat(activeChat,c=>{const x=c.msgs.find(y=>mid(y)===id);if(x&&x.uid===session.id){x.deleted=true;x.audio=null;x.sordo=x.oyente=''}});renderTrad()},
 async msgEdit(){const id=$('#msgMenu').dataset.id;hideMenu();const m=chats().find(k=>k.id===activeChat).msgs.find(x=>mid(x)===id);if(!m||m.uid!==session.id||m.deleted||m.audio)return;
  const cur=m.orig!==undefined?m.orig:(m.from==='sordo'?m.sordo:m.oyente),t=await Dlg.prompt('Editar mensaje:',cur);if(!t||!t.trim()||t===cur)return;
  const nb=await buildMsg(t,m.from);
  patchChat(activeChat,c=>{const x=c.msgs.find(y=>mid(y)===id);if(x){x.sordo=nb.sordo;x.oyente=nb.oyente;x.orig=t;x.src=nb.src;x.edited=true}});renderTrad()},
 async callStart(){const c=chats().find(k=>k.id===activeChat);if(!c||chatMode(c)!=='dd'||call)return;if(!window.RTCPeerConnection||!navigator.mediaDevices)return notify('Tu navegador no admite videollamadas, o la página no se abrió con HTTPS o localhost.');
  const peer=c.members.find(id=>id!==session.id),stream=await callMedia();if(!stream)return notify('No se pudo acceder a la cámara. Revisa los permisos.');
  call={peer,chat:c.id,caller:true,stream,pc:null,t0:0};$('#callLocal').srcObject=stream;$('#callRemote').srcObject=null;$('#callTime').textContent='';callUI(true,'Llamando a '+uname(peer)+'…');callSend({type:'invite',to:peer,chat:c.id,name:session.name})},
 async callAccept(){if(!inc)return;const m=inc;inc=null;$('#callIn').hidden=true;const stream=await callMedia();if(!stream){callSend({type:'decline',to:m.from});return notify('No se pudo acceder a la cámara.')}
  call={peer:m.from,chat:m.chat,caller:false,stream,pc:null,t0:0};$('#callLocal').srcObject=stream;$('#callRemote').srcObject=null;$('#callTime').textContent='';callUI(true,'Conectando…');callSend({type:'accept',to:m.from})},
 callDecline(){if(!inc)return;callSend({type:'decline',to:inc.from});inc=null;$('#callIn').hidden=true},
 callEnd(){callEnd(true)},
 useLang(d){useLang=d.l;renderLearn('uso')},
 lang(d){chatLang=d.l;renderTrad()},
 cView(d){cView=d.v;renderContact()},
 cNew(){cView='new';renderContact()},
 reqOpen(d){openReply(+d.id)},
 async rpCam(){if(!rp||rp.stream)return;try{rp.stream=await navigator.mediaDevices.getUserMedia({video:true,audio:true})}catch{try{rp.stream=await navigator.mediaDevices.getUserMedia({video:true})}catch{return rpErr('No se pudo acceder a la cámara. Revisa los permisos.')}}
  $('#rpVideo').srcObject=rp.stream;$('#rpCamBox').hidden=false;rpErr()},
 rpRec(){if(!rp||!rp.stream)return;if(rp.rec){rp.mr.stop();return}
  const chunks=[],mr=new MediaRecorder(rp.stream,{videoBitsPerSecond:350000});rp.mr=mr;rp.rec=true;$('#rpRecBtn').textContent='⏹ Detener';
  mr.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
  mr.onstop=()=>{if(!rp)return;rp.rec=false;clearTimeout(rp.tm);$('#rpRecBtn').textContent='⏺ Grabar video';const blob=new Blob(chunks,{type:mr.mimeType||'video/webm'});
    if(blob.size>MAXB)return rpErr('El video pesa más de 1,5 MB. Graba uno más corto (máx. 20 s).');const f=new FileReader();f.onload=()=>{rp.media.push({type:'video',src:f.result,name:'video.webm'});rpMedia();rpErr()};f.readAsDataURL(blob)};
  mr.start();rp.tm=setTimeout(()=>{if(rp&&rp.rec)mr.stop()},20000)},
 rpPhoto(){if(!rp||!rp.stream)return;const v=$('#rpVideo'),c=document.createElement('canvas');c.width=v.videoWidth||640;c.height=v.videoHeight||480;c.getContext('2d').drawImage(v,0,0);rp.media.push({type:'image',src:c.toDataURL('image/jpeg',0.7),name:'foto.jpg'});rpMedia()},
 rpCamOff(){rpStopCam()},rpFiles(){$('#rpFile').click()},rpDel(d){rp.media.splice(+d.i,1);rpMedia()},
 async rpSend(){if(!rp)return;const all=store.get(CRK,[]),r=all.find(x=>x.id===rp.id);if(!r)return;const text=$('#rpText').value.trim();
  if(r.wantsLsc&&!rp.media.some(m=>m.type==='video'))return rpErr('Esta persona prefiere respuesta en video: graba un video con la cámara o sube uno.');
  if(!text&&!rp.media.length)return rpErr('Escribe una respuesta o adjunta una foto o un video.');
  let out='';if(text){const b=await buildMsg(text,'admin');out=ur(r)==='sordo'?b.sordo:b.oyente} // sordo → LSC · oyente → español
  r.reply={text:out,media:rp.media,t:Date.now()};try{store.set(CRK,all)}catch{return rpErr('No hay espacio para guardar los archivos. Quita alguno o usa archivos más pequeños.')}
  rpStopCam();bootstrap.Modal.getInstance($('#replyModal')).hide();renderContact()},
 emoji(){const p=$('#emojiPanel');p.hidden=!p.hidden;if(!p.hidden)renderEmoji()},
 emojiTab(d){emojiK=d.k;renderEmoji()},
 emojiPick(d){const i=$('#msgInput'),s=i.selectionStart??i.value.length,e=i.selectionEnd??s;i.value=i.value.slice(0,s)+d.e+i.value.slice(e);i.focus();const p=s+d.e.length;i.setSelectionRange(p,p)},
 msgFwd(){fwdId=$('#msgMenu').dataset.id;hideMenu();$('#fwdList').innerHTML=mine().map(c=>`<button class="chat-item" data-act="fwdTo" data-id="${c.id}">${isPersonal(c)?'🔒':'💬'} ${esc(chatTitle(c))}<small>${chatSub(c)}</small></button>`).join('');bootstrap.Modal.getOrCreateInstance($('#fwdModal')).show()},
 fwdTo(d){const src=chats().find(k=>k.id===activeChat).msgs.find(x=>mid(x)===fwdId);if(!src||src.deleted)return;
  patchChat(+d.id,c=>c.msgs.push({id:Date.now()+''+Math.floor(Math.random()*1000),uid:session.id,from:session.role,sordo:src.sordo,oyente:src.oyente,orig:src.orig,src:src.src,fwd:true,t:Date.now()}));
  bootstrap.Modal.getInstance($('#fwdModal')).hide();activeChat=+d.id;renderTrad()},
 cTab(d){$$('#cOpts .opt').forEach(b=>b.classList.toggle('on',b.dataset.t===d.t));$('#cInfo').innerHTML=CINFO[d.t]},
 zoom(d){fs=d.d==='0'?16:Math.min(24,Math.max(12,fs+2*d.d));store.set('lsc_fs',fs);document.documentElement.style.fontSize=fs+'px'}};
document.addEventListener('click',e=>{if(!e.target.closest('#msgMenu,#chatMenu,.dots'))hideMenu();const b=e.target.closest('[data-act]');if(b&&A[b.dataset.act])A[b.dataset.act](b.dataset,b)});
document.addEventListener('submit',e=>{const f=e.target;if(f.id==='contactForm'){e.preventDefault();if(session.role==='admin')return;const d=Object.fromEntries(new FormData(f)),all=store.get(CRK,[]);all.push({id:Date.now(),uid:session.id,name:d.name,email:d.email,role:d.role,subject:d.subject,message:d.message,wantsLsc:!!d.lsc,urole:session.role,reply:null});store.set(CRK,all);cView='new';renderContact(d.name);return}if(f.classList.contains('cform')){e.preventDefault();const c=C();c.push({id:Date.now(),postId:+f.dataset.p,parentId:null,uid:session.id,name:session.name,role:session.role,text:f.querySelector('input').value});store.set('lsc_cmts',c);renderPosts()}});
$('#rpFile').onchange=e=>{[...e.target.files].forEach(addFile);e.target.value=''};
$('#rpText').oninput=async e=>{const r=rp&&findReq(rp.id),t=e.target.value.trim();if(!r||!t)return $('#rpPreview').textContent='';const b=await buildMsg(t,'admin'),s=ur(r)==='sordo';$('#rpPreview').textContent=(s?'Se enviará en LSC: ':'Se enviará en español: ')+(s?b.sordo:b.oyente)};
$('#replyModal').addEventListener('hidden.bs.modal',rpStopCam);
$('#msgInput').addEventListener('input',async e=>{const c=chats().find(k=>k.id===activeChat);if(!c||chatMode(c)!=='ds')return;const t=e.target.value.trim(),p=$('#trPreview'),l=$('#trPrevLabel');
  if(!t){p.textContent='';l.textContent='';return}const b=await buildMsg(t,session.role),toLsc=b.src!=='lsc';l.textContent=toLsc?'La persona sorda lo leerá en LSC:':'La persona oyente lo leerá en español:';p.textContent=toLsc?b.sordo:b.oyente});
$('#msgInput').onkeydown=e=>{if(e.key==='Enter')A.send()};
$$('#learnTabs button').forEach(b=>b.onclick=()=>renderLearn(b.dataset.tab));
$('#glSearch').oninput=renderGl;
$('#cmSearch').oninput=e=>{cq=e.target.value.trim();renderPosts()};
$('#glForm').onsubmit=e=>{e.preventDefault();const m=store.get(glKey(),[]),id=$('#glId').value,d={es:$('#glEs').value,lsc:$('#glLsc').value,cat:$('#glCat').value};
  if(id)Object.assign(m.find(x=>x.id==id),d);else m.push({id:Date.now(),...d});store.set(glKey(),m);e.target.reset();$('#glId').value='';renderGl()};
$('#postForm').onsubmit=e=>{e.preventDefault();const p=P();p.push({id:Date.now(),uid:session.id,name:session.name,role:session.role,text:$('#postText').value,r:{like:[],love:[]}});store.set('lsc_posts',p);e.target.reset();renderPosts()};

/* La publicación de ejemplo (Karol) y su comentario los crea el servidor al iniciar. */
/* ---------- ADMINISTRADOR: revisa usuarios, actividad y moderación ----------
   DEMO: credenciales en el navegador. En producción: autenticación y roles en el servidor. */
/* El administrador se crea en el servidor con ADMIN_EMAIL y ADMIN_PASSWORD (.env). */
/* Presencia: cada sesión abierta "late" cada 15 s; activo = latido en los últimos 45 s y sesión no cerrada */
const PK='lsc_presence';
function beat(online=true){if(!session)return;const p=store.get(PK,{});p[session.id]={last:Date.now(),online};store.set(PK,p)}
setInterval(()=>{if(session)beat()},15000);addEventListener('beforeunload',()=>beat(false));beat();
function renderAdmin(){
  const us=users().filter(u=>u.role!=='admin'),pr=store.get(PK,{}),now=Date.now(),ch=chats(),po=P(),cm=C();
  const act=u=>{const x=pr[u.id];return !!(x&&x.online&&now-x.last<45000)},on=us.filter(act).length,fmt=t=>t?new Date(t).toLocaleString('es-CO'):'—';
  const card=(i,n,l)=>`<div class="col-6 col-lg-3"><div class="gcard p${i}"><div class="fs-2 fw-bold">${n}</div><div class="small">${l}</div></div></div>`;
  $('#adStats').innerHTML=card(1,us.length,'Usuarios')+card(3,on,'🟢 Activos ahora')+card(2,us.length-on,'⚪ Inactivos')+card(4,po.length+' / '+cm.length,'Publicaciones / comentarios')+card(5,us.filter(u=>u.role==='sordo').length+' / '+us.filter(u=>u.role==='oyente').length,'Sordos / oyentes')+card(1,ch.length,'Chats');
  $('#adUsers').innerHTML=us.map(u=>`<tr><td>${act(u)?'🟢 Activo':'⚪ Inactivo'}</td><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${u.role==='sordo'?'🧏 Sordo':'👂 Oyente'}</td><td>${u.id>1e12?new Date(u.id).toLocaleDateString('es-CO'):'—'}</td><td>${fmt(pr[u.id]&&pr[u.id].last)}</td><td>${ch.filter(c=>c.members.includes(u.id)).length}</td><td>${po.filter(p=>p.uid===u.id).length}</td></tr>`).join('')||'<tr><td colspan="8" class="text-muted">Aún no hay usuarios registrados.</td></tr>';
  $('#adChats').innerHTML=ch.filter(c=>c.members.includes(session.id)).map(c=>`<tr><td>${esc(chatTitle(c))}</td><td>${esc(c.members.map(uname).join(', '))}</td><td>${c.msgs.length}</td></tr>`).join('')||'<tr><td colspan="3" class="text-muted">Sin chats.</td></tr>';
  $('#adReqCount').textContent=store.get(CRK,[]).filter(r=>r.uid!==session.id).length}
setInterval(()=>{if(session&&session.role==='admin'&&location.hash==='#admin')renderAdmin()},5000);
/* ---------- ROUTER ---------- */
const PROTECTED=['traductor','glosario','comunidad'];
function route(){let p=location.hash.slice(1)||'inicio';if(!session)p='login'; // sin sesión no se muestra nada más
  document.body.classList.toggle('out',!session);
  if(p==='admin'&&(!session||session.role!=='admin'))p='inicio';
  if(p!=='traductor')recStop();
  $$('[data-page]').forEach(s=>s.hidden=s.dataset.page!==p);$$('.nav-link').forEach(a=>a.classList.toggle('active',a.getAttribute('href')==='#'+p));
  if(p==='traductor')renderTrad();if(p==='aprendizaje')renderLearn('abc');if(p==='glosario')renderGl();if(p==='comunidad')renderPosts();if(p==='contacto'){cView='new';renderContact()}if(p==='admin')renderAdmin();$('#foot').hidden=p!=='inicio';window.scrollTo(0,0)}
window.addEventListener('hashchange',route);
$('#cInfo').innerHTML=CINFO.mail;document.documentElement.style.fontSize=fs+'px';renderAuth();setAuthMode(false);route();wsOpen();
(async function handleReset(){const m=location.hash.match(/^#reset=([A-Za-z0-9_-]{30,80})$/);if(!m)return;const tk=m[1];history.replaceState(null,'',location.pathname+location.search);route();
  for(let i=0;i<3;i++){const p1=await Dlg.prompt('Escribe tu nueva contraseña (entre 8 y 128 caracteres):','',{ok:'Continuar'});if(!p1)return;
    if(p1.length<8||p1.length>128){await notify('La contraseña debe tener entre 8 y 128 caracteres.');continue}
    const p2=await Dlg.prompt('Repite la nueva contraseña:','',{ok:'Cambiar contraseña'});if(!p2)return;if(p1!==p2){await notify('Las contraseñas no coinciden. Inténtalo de nuevo.');continue}
    try{const r=await fetch('/api/auth/reset',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:tk,password:p1})}),j=await r.json().catch(()=>({}));
      if(r.ok){sessionStorage.removeItem('lsc_token');sessionStorage.removeItem('lsc_session');await notify('Contraseña actualizada. Ya puedes iniciar sesión con la nueva.','Listo');location.reload();return}
      return notify(j.error||'No se pudo cambiar la contraseña.')}catch{return notify('No hay conexión con el servidor.')}}})();
