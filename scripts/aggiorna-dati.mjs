// Scarica gli orari pubblici da University Planner (Cineca) e li salva in forma ridotta,
// così l'app legge questi file invece di interrogare il server dell'università.
//
// Uso:  node scripts/aggiorna-dati.mjs <cartella-di-uscita> [url-del-sito-pubblicato]
//
// - data/aule.json            elenco aule dell'Ateneo (aggiornato una volta al giorno)
// - data/giorni/AAAA-MM-GG.json  impegni di un giorno, da oggi a 7 giorni avanti
// Oggi viene riscaricato a ogni esecuzione; gli altri giorni una volta al giorno.
// I file non riscaricati vengono ripresi dal sito già pubblicato.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const BASE = 'https://unich.prod.up.cineca.it';
const CLIENTE = '5a65a9ebd9fe4f6d0ccf9df6';
const LINK = '5e71ea91e897450019127e0b';     // un calendario pubblico qualsiasi: serve solo come chiave d'accesso
const SOGLIA = 150;                          // il server restituisce al massimo 150 impegni per richiesta
const GIORNI_AVANTI = 7;
const TZ = 'Europe/Rome';

const OUT = process.argv[2] || 'dist';
const SITO = (process.argv[3] || '').replace(/\/?$/, '/');
const fetchImpl = globalThis.__fetch || fetch;     // sostituibile nei test

// ---------- date in ora italiana ----------
const fmtGiorno = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const isoGiorno = t => fmtGiorno.format(new Date(t));                  // "2026-11-24"
function offsetRoma(t) {                                               // minuti di differenza da UTC a quell'istante
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
    .formatToParts(new Date(t)).map(x => [x.type, x.value]));
  return (Date.UTC(+p.year, p.month - 1, +p.day, +p.hour, +p.minute) - Math.floor(t / 60e3) * 60e3) / 60e3;
}
function oraRoma(giorno, ora) {                                        // timestamp di giorno+ora in ora italiana
  const [y, m, d] = giorno.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, ora);
  return guess - offsetRoma(guess) * 60e3;
}
const aggiungiGiorni = (giorno, n) => isoGiorno(oraRoma(giorno, 12) + n * 86400e3);

// ---------- rete ----------
async function richiesta(url, opzioni = {}, tentativi = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetchImpl(url, { ...opzioni, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      if (i >= tentativi) throw new Error(`${url.split('?')[0]}: ${e.message}`);
      await new Promise(res => setTimeout(res, 2000 * i));
    }
  }
}

let nRichieste = 0;
async function finestra(a, b, prof = 0) {
  nRichieste++;
  const q = new URLSearchParams({ clienteId: CLIENTE, dataInizio: new Date(a).toISOString(), dataFine: new Date(b).toISOString() });
  const d = await richiesta(`${BASE}/api/Impegni/getImpegniPublic?${q}`, { headers: { Accept: 'application/json' } });
  if (!Array.isArray(d)) throw new Error('risposta inattesa dal server');
  if (d.length >= SOGLIA && b - a > 15 * 60e3 && prof < 7) {
    const m = Math.round((a + b) / 2);
    return (await finestra(a, m, prof + 1)).concat(await finestra(m, b, prof + 1));
  }
  return d;
}

// Un giorno: un'ora alla volta dalle 7 alle 21, tre richieste in parallelo
async function scaricaGiorno(giorno) {
  const fasce = [];
  for (let h = 7; h < 21; h++) fasce.push([oraRoma(giorno, h), oraRoma(giorno, h + 1)]);
  const visti = new Map();
  for (let i = 0; i < fasce.length; i += 3) {
    const blocchi = await Promise.all(fasce.slice(i, i + 3).map(([a, b]) => finestra(a, b)));
    for (const x of blocchi.flat()) visti.set(x.id, x);
  }
  const aule = {};
  const impegni = [...visti.values()].map(i => {
    const dd = i.evento && i.evento.dettagliDidattici && i.evento.dettagliDidattici[0];
    for (const a of i.aule || []) {
      aule[a.id] = { codice: a.codice, desc: a.descrizione, edId: a.edificioId || (a.edificio && a.edificio.id),
        edCod: a.edificio && a.edificio.codice, edDesc: a.edificio && a.edificio.descrizione };
    }
    return {
      id: i.id,
      s: new Date(i.dataInizio).getTime(),
      e: new Date(i.dataFine).getTime(),
      nome: (dd && dd.nome) || (i.evento && (i.evento.nome || i.evento.descrizione)) ||
            (i.indisponibilita ? 'Aula non disponibile' : 'Impegno'),
      a: (i.aule || []).map(a => a.id)
    };
  }).sort((x, y) => x.s - y.s);
  return { giorno, generato: Date.now(), impegni, aule };
}

async function scaricaAule() {
  nRichieste += 2;
  const post = (path, body) => richiesta(BASE + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await post('/api/Aule/getAulePerCalendarioPubblico', { linkCalendarioId: LINK, clienteId: CLIENTE, limit: 5000 });
  if (!Array.isArray(d) || !d.length) throw new Error('elenco aule vuoto');
  const nomiEd = new Map();
  try {
    for (const e of await post('/api/Edifici/getEdificiPerCalendarioPubblico', { linkCalendarioId: LINK, clienteId: CLIENTE }))
      nomiEd.set(e.id, (e.descrizione || '').trim());
  } catch { }
  const aule = d.filter(a => a.abilitato !== false && a.edificio).map(a => {
    const edId = a.edificioId || a.edificio.id;
    return { id: a.id, codice: a.codice, desc: a.descrizione, cap: a.capienza || null,
      edId, edCod: a.edificio.codice, edDesc: nomiEd.get(edId) || a.edificio.descrizione || a.edificio.codice };
  });
  return { generato: Date.now(), aule };
}

// File già pubblicato (null se manca o se il sito non è indicato)
async function precedente(path) {
  if (!SITO) return null;
  try {
    const r = await fetchImpl(SITO + path, { signal: AbortSignal.timeout(15000) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

async function salva(path, dati) {
  const file = join(OUT, path);
  await mkdir(join(file, '..'), { recursive: true });
  await writeFile(file, JSON.stringify(dati));
  return Buffer.byteLength(JSON.stringify(dati));
}

// ---------- esecuzione ----------
const adesso = Date.now();
const oggi = isoGiorno(adesso);
const log = [];
let errori = 0;

// Elenco aule: una volta al giorno
{
  const prima = await precedente('data/aule.json');
  let dati = prima && isoGiorno(prima.generato) === oggi ? prima : null;
  if (!dati) {
    try { dati = await scaricaAule(); log.push(`aule.json: ${dati.aule.length} aule (scaricato)`); }
    catch (e) { errori++; dati = prima; log.push(`aule.json: ERRORE ${e.message}` + (prima ? ' — tengo la versione precedente' : '')); }
  } else log.push(`aule.json: ripreso dal sito`);
  if (dati) await salva('data/aule.json', dati);
}

// Giorni: oggi sempre, gli altri se mancano o sono di ieri
const indice = [];
for (let n = 0; n <= GIORNI_AVANTI; n++) {
  const g = aggiungiGiorni(oggi, n);
  const prima = await precedente(`data/giorni/${g}.json`);
  let dati = prima;
  const daRifare = n === 0 || !prima || isoGiorno(prima.generato) !== oggi;
  if (daRifare) {
    try {
      dati = await scaricaGiorno(g);
      log.push(`${g}: ${dati.impegni.length} impegni (scaricato)`);
    } catch (e) {
      errori++;
      log.push(`${g}: ERRORE ${e.message}` + (prima ? ' — tengo la versione precedente' : ''));
    }
  } else log.push(`${g}: ripreso dal sito`);
  if (dati) {
    const kb = (await salva(`data/giorni/${g}.json`, dati)) / 1024;
    indice.push({ giorno: g, generato: dati.generato, impegni: dati.impegni.length, kb: Math.round(kb) });
  }
}
await salva('data/indice.json', { generato: adesso, giorni: indice });

console.log(log.join('\n'));
console.log(`Richieste all'università: ${nRichieste}. Errori: ${errori}.`);
// Fallisce solo se non è stato possibile produrre i dati di oggi
if (!indice.some(x => x.giorno === oggi)) { console.error('Nessun dato per oggi.'); process.exit(1); }
