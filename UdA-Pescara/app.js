/*
 * Aule libere UdA — mostra quali aule di un edificio sono libere in un dato momento e fino a quando.
 *
 * Fonte dei dati: i file in data/, che GitHub Actions rigenera ogni ora da University Planner
 * (scripts/aggiorna-dati.mjs). Se mancano o sono troppo vecchi, l'app interroga direttamente
 * il server dell'università come ripiego.
 */
(async () => {
  const HOST = 'unich.prod.up.cineca.it';
  const CLIENTE = '5a65a9ebd9fe4f6d0ccf9df6';
  const BASE = 'https://unich.prod.up.cineca.it';
  const API = BASE + '/api/Impegni/getImpegniPublic';
  const SOGLIA_SPLIT = 150;     // limite massimo di risultati per richiesta imposto dal server
  const LINK_DEFAULT = '5e71ea91e897450019127e0b'; // un calendario pubblico qualsiasi, serve solo come chiave d'accesso
  const LS_KEY = 'auleLibereUdA.v3';
  const DATI = 'data/';                   // file pre-calcolati pubblicati insieme al sito
  // Aule preferite (con prese per il PC): compaiono per prime, con un'etichetta. Modifica qui per cambiarle.
  const PREFERITE = new Set([
    'PE_PIN_28DIS', 'PE_PIN_34DIS', 'PE_PIN_38DIS', 'PE_PIN_39DIS',            // viale Pindaro: aule Disegno
    'PE_PIN_32', 'PE_PIN_36INF', 'PE_PIN_37',                                  // viale Pindaro: 32, 36 Informatica, 37
    'PE_MIC_1', 'PE_MIC_2', 'PE_MIC_3', 'PE_MIC_4', 'PE_MIC_5', 'PE_MIC_6',  // Polo Micara: M1–M6
    'PE_MIC_A', 'PE_MIC_B', 'PE_MIC_C', 'PE_MIC_D'                           // Polo Micara: Lab. A–D
  ]);
  const preferita = a => PREFERITE.has(a.codice);
  const COMBO = 'PE_PIN+PE_MIC';

  document.getElementById('aule-libere-panel')?.remove();

  // ---------- utilità ----------
  const pad = n => String(n).padStart(2, '0');
  const hhmm = d => pad(d.getHours()) + ':' + pad(d.getMinutes());
  const isoDay = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const dayStart = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const durata = ms => { const m = Math.round(ms / 60000); return m >= 60 ? Math.floor(m / 60) + 'h' + (m % 60 ? ' ' + pad(m % 60) : '') : m + ' min'; };
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const store = {
    get() { try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; } },
    set(v) { try { localStorage.setItem(LS_KEY, JSON.stringify(v)); } catch { } }
  };

  function slim(i) {
    const dd = i.evento && i.evento.dettagliDidattici && i.evento.dettagliDidattici[0];
    return {
      id: i.id,
      s: new Date(i.dataInizio).getTime(),
      e: new Date(i.dataFine).getTime(),
      nome: (dd && dd.nome) || (i.evento && (i.evento.nome || i.evento.descrizione)) ||
            (i.indisponibilita ? 'Aula non disponibile' : 'Impegno'),
      aule: (i.aule || []).map(a => ({
        id: a.id, codice: a.codice, desc: a.descrizione,
        edId: a.edificioId || (a.edificio && a.edificio.id),
        edCod: a.edificio && a.edificio.codice, edDesc: a.edificio && a.edificio.descrizione
      }))
    };
  }

  async function finestra(a, b, depth = 0) {
    const q = new URLSearchParams({ clienteId: CLIENTE, dataInizio: new Date(a).toISOString(), dataFine: new Date(b).toISOString() });
    const r = await fetch(API + '?' + q, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('Il server ha risposto ' + r.status);
    const d = await r.json();
    if (!Array.isArray(d)) throw new Error('Risposta inattesa dal server');
    if (d.length >= SOGLIA_SPLIT && b - a > 15 * 60e3 && depth < 7) {
      const m = Math.round((a + b) / 2);
      const [x, y] = await Promise.all([finestra(a, m, depth + 1), finestra(m, b, depth + 1)]);
      return x.concat(y);
    }
    return d.map(slim);
  }

  // Il server restituisce al massimo 150 impegni per richiesta: interrogo un'ora alla volta
  // (in parallelo, 5 per volta) e divido ancora solo le fasce che toccano il limite.
  async function giorno(d) {
    const base = dayStart(d).getTime();
    const fasce = [];
    for (let h = 7; h < 21; h++) fasce.push([base + h * 3600e3, base + (h + 1) * 3600e3]);
    const visti = new Map();
    for (let i = 0; i < fasce.length; i += 5) {
      const blocchi = await Promise.all(fasce.slice(i, i + 5).map(([a, b]) => finestra(a, b)));
      for (const x of blocchi.flat()) visti.set(x.id, x);
    }
    return [...visti.values()];
  }

  // ---------- UI ----------
  const panel = document.createElement('div');
  panel.id = 'aule-libere-panel';
  panel.innerHTML = `
  <style>
    #aule-libere-panel{position:fixed;inset:0;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);max-width:640px;margin:0 auto;
      background:var(--bg);color:var(--tx);font:15px/1.4 Roboto,system-ui,-apple-system,"Segoe UI",sans-serif;
      display:flex;flex-direction:column;overflow:hidden;text-align:left}
    /* Material You (Material 3): palette tonale calcolata dall'azzurro UdA #5685b5 con la libreria Material di Google.
       Chiaro = M1, scuro = M3. --sc* sono i "surface container", --pc/--opc il primary container, --sec/--osec il secondary container */
    #aule-libere-panel{--bg:#f8f9ff;--sf:#ffffff;--scl:#f2f3f9;--sc:#eceef4;--sch:#e0e2e8;--tx:#191c20;--mu:#42474e;--ol:#73777f;--bd:#c2c7cf;
      --ac:#33618d;--hl:#33618d;--on:#ffffff;--pc:#d0e4ff;--opc:#154974;--sec:#d6e4f7;--osec:#3b4857;--now:#ba1a1a;
      --free:var(--scl);--occ:var(--sc);--track:var(--pc);--busy:var(--ac);--hd:var(--sc);--hdtx:var(--mu);
      --sh:0 1px 2px rgba(0,0,0,.12),0 1px 3px 1px rgba(0,0,0,.06);color-scheme:light}
    @media (prefers-color-scheme:dark){#aule-libere-panel{--bg:#101418;--sf:#0b0e12;--scl:#191c20;--sc:#1d2024;--sch:#32353a;--tx:#e0e2e8;--mu:#c2c7cf;--ol:#8c9199;--bd:#42474e;
      --ac:#9ecafc;--hl:#9ecafc;--on:#003256;--pc:#154974;--opc:#d0e4ff;--sec:#3b4857;--osec:#d6e4f7;--now:#ffb4ab;
      --sh:0 1px 2px rgba(0,0,0,.4),0 1px 3px 1px rgba(0,0,0,.2);color-scheme:dark}}
    #aule-libere-panel *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
    #al-head{padding:6px 14px 14px;background:var(--hd);border-radius:0 0 28px 28px}
    #al-top{display:flex;align-items:center;gap:12px;padding:6px 2px 12px}
    #al-top img{width:40px;height:40px;border-radius:12px;flex-shrink:0}
    #al-top b{display:block;font-size:22px;font-weight:500;line-height:1.15;color:var(--tx)}
    #al-top span{display:block;font-size:13px;color:var(--mu)}
    #aule-libere-panel.mini #al-top{display:none}
    #al-head #al-ctrl label{color:var(--hdtx)}
    #al-ctrl .riga1{grid-column:1/-1;display:flex;gap:8px;align-items:center}
    #al-ctrl .riga1 select{flex:1}
    #al-now{width:48px;height:48px;flex-shrink:0;border:0;border-radius:50%;cursor:pointer;background:var(--sec);color:var(--osec);display:flex;align-items:center;justify-content:center;padding:0}
    #al-now svg{width:24px;height:24px;display:block}
    #al-now:active svg{transform:rotate(-30deg)}
    #al-sum{display:none;width:100%;margin:4px 0 10px;padding:12px 16px;border:0;border-radius:28px;background:var(--sch);color:var(--tx);
      font:500 14px/1.3 Roboto,system-ui,-apple-system,"Segoe UI",sans-serif;text-align:left;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #aule-libere-panel.mini #al-sum{display:block}
    #aule-libere-panel.mini #al-ctrl .riga1,#aule-libere-panel.mini #al-ctrl .dt{display:none}
    #al-ctrl{display:grid;grid-template-columns:1.35fr 1fr 1fr;gap:10px 8px}
    #al-ctrl label{font-size:12px;font-weight:500;letter-spacing:.2px;color:var(--mu);display:flex;flex-direction:column;gap:3px;min-width:0}
    #al-ctrl select,#al-ctrl input{font:16px/1.3 Roboto,system-ui,-apple-system,"Segoe UI",sans-serif;padding:10px 12px;min-width:0;width:100%;-webkit-appearance:none;appearance:none;min-height:48px;border:1px solid var(--ol);border-radius:12px;background:var(--sf);color:var(--tx)}
    #al-ctrl .dt input,#al-ctrl .dt select{padding:10px 8px}
    #al-ctrl select:focus,#al-ctrl input:focus{outline:2px solid var(--ac);outline-offset:-1px}
    #al-ctrl .full{grid-column:1/-1}
    #al-ctrl .cerca{grid-column:1/3}
    #al-ctrl #al-q{border:0;border-radius:28px;padding-left:44px;background:var(--sch) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888e96' stroke-width='2.4' stroke-linecap='round'%3E%3Ccircle cx='10.5' cy='10.5' r='6.5'/%3E%3Cpath d='M15.5 15.5 21 21'/%3E%3C/svg%3E") no-repeat 16px center/20px}
    /* "PC" come filter chip di Material 3: contorno quando spento, pieno con la spunta quando acceso */
    #al-ctrl .pc{position:relative;flex-direction:row;align-items:center;justify-content:center;gap:6px;min-height:48px;padding:0 12px;border:1px solid var(--ol);border-radius:8px;
      background:transparent;color:var(--mu);font-size:14px;font-weight:500;letter-spacing:.1px;cursor:pointer;user-select:none}
    #al-ctrl .pc input{position:absolute;opacity:0;width:1px;height:1px;min-height:0;margin:0;padding:0;pointer-events:none}
    #al-ctrl .pc .ck{display:none;width:18px;height:18px}
    #al-ctrl .pc:has(input:checked){background:var(--sec);border-color:var(--sec);color:var(--osec)}
    #al-ctrl .pc:has(input:checked) .ck{display:block}
    #al-ctrl .pc:has(input:focus-visible){outline:2px solid var(--ac);outline-offset:1px}
    #al-body{overflow:auto;padding:8px 14px 16px;flex:1}
    #al-status{font-size:12.5px;line-height:1.45;color:var(--mu);margin:8px 2px}
    .al-sec{margin:18px 2px 8px;font-weight:600;font-size:15px;letter-spacing:.1px;color:var(--ac)}
    .al-room{padding:14px 16px;border-radius:16px;margin:10px 0;background:var(--occ)}
    .al-room.free{background:var(--free);box-shadow:var(--sh)}
    .al-room .t{display:flex;justify-content:space-between;gap:8px;font-size:16px;font-weight:600}
    .al-room .t>span:last-child{white-space:nowrap;flex-shrink:0;font-size:14px}
    .al-room.free .t>span:last-child{align-self:flex-start;background:var(--pc);color:var(--opc);border-radius:8px;padding:3px 10px;font-size:13px}
    .al-room .s{font-size:12.5px;color:var(--mu)}
    .al-room small.i{font-weight:400;color:var(--mu)}
    .al-room small.p{font-weight:500;color:var(--osec);background:var(--sec);border-radius:8px;padding:1px 7px;white-space:nowrap}
    /* timeline: il segno rosso dell'ora attuale sporge sopra e sotto la barra, come in Google Calendar */
    .al-tl{position:relative;margin-top:12px}
    .al-bar{position:relative;height:6px;background:var(--track);border-radius:3px;overflow:hidden}
    .al-bar i{position:absolute;top:0;bottom:0;background:var(--busy);border-radius:3px}
    .al-tl .ora{position:absolute;top:-7px;height:20px;width:3px;margin-left:-1.5px;border-radius:2px;background:var(--now)}
    .al-tl .ora::before{content:"";position:absolute;top:-3px;left:50%;width:9px;height:9px;margin-left:-4.5px;border-radius:50%;background:var(--now)}
    .al-ticks{display:flex;justify-content:space-between;font-size:10.5px;color:var(--mu);margin-top:6px}
    .al-closed{text-align:center;padding:36px 20px;margin:12px 0;border-radius:24px;background:var(--free)}
    .al-closed .ic{font-size:40px;line-height:1}
    .al-closed h3{margin:10px 0 6px;font-size:22px;font-weight:500;color:var(--tx)}
    .al-closed p{margin:4px 0;color:var(--tx)}
    .al-closed .n{font-size:13px;color:var(--mu);margin-top:10px}
    #al-inst{position:fixed;left:10px;right:10px;bottom:calc(10px + env(safe-area-inset-bottom));max-width:620px;margin:0 auto;z-index:5;
      display:flex;gap:12px;align-items:center;padding:12px 12px 12px 14px;border-radius:24px;background:var(--sc);
      box-shadow:0 4px 8px 3px rgba(0,0,0,.15),0 1px 3px rgba(0,0,0,.3);animation:al-su .25s ease-out}
    #al-inst img{width:44px;height:44px;border-radius:12px;flex-shrink:0}
    #al-inst .tx{flex:1;font-size:13px;line-height:1.35;color:var(--mu)}
    #al-inst .tx b{display:block;font-size:15px;font-weight:600;color:var(--tx)}
    #al-inst button{border:0;border-radius:20px;font:500 14px Roboto,system-ui,-apple-system,"Segoe UI",sans-serif;cursor:pointer}
    #al-inst .ok{background:var(--ac);color:var(--on);padding:10px 16px}
    #al-inst .no{background:none;color:var(--mu);padding:6px;font-size:20px;line-height:1}
    @keyframes al-su{from{transform:translateY(120%)}to{transform:none}}
    #al-fb{display:block;margin:22px 0 4px;padding:12px;border-radius:20px;border:1px solid var(--ol);background:transparent;
      color:var(--ac);font-weight:500;text-align:center;text-decoration:none}
    #al-fb-n{margin:0 0 70px;font-size:12px;color:var(--mu);text-align:center}
  </style>
  <div id="al-head">
    <div id="al-top"><img src="../icon-192.png?v=5" alt=""><div><b>Aule libere</b><span>UdA · Pescara</span></div></div>
    <button type="button" id="al-sum" aria-label="Mostra i filtri"></button>
    <div id="al-ctrl">
      <div class="riga1"><select id="al-ed" aria-label="Edificio"><option>caricamento…</option></select>
        <button type="button" title="Torna ad adesso" aria-label="Torna ad adesso" id="al-now"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/></svg></button></div>
      <label class="dt">Giorno<input type="date" id="al-day"></label>
      <label class="dt">Ora<input type="time" id="al-time" step="900"></label>
      <label class="dt">Libera per
        <select id="al-min"><option value="0">qualsiasi</option><option value="30">30 min</option>
        <option value="60" selected>1 ora</option><option value="120">2 ore</option><option value="180">3 ore</option></select></label>
      <label class="cerca"><input type="search" id="al-q" placeholder="Cerca aula (es. M3)" autocomplete="off" enterkeyhint="search" aria-label="Cerca un'aula"></label>
      <label class="pc" title="Mostra prima le aule con le prese per il PC"><input type="checkbox" id="al-pc"><svg class="ck" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg><span>🔌 PC</span></label>
    </div>
  </div>
  <div id="al-body"><div id="al-status">Avvio…</div><div id="al-out"></div>
    <a id="al-fb" href="#" target="_blank" rel="noopener">💬 Suggerimenti e segnalazioni</a>
    <p id="al-fb-n">Hai trovato un errore o hai un'idea? Il modulo è anonimo.<br>
      Progetto non ufficiale di studenti, non affiliato all'Università "G. d'Annunzio".<br>
      Statistiche di visita anonime, senza cookie.</p></div>`;
  document.body.appendChild(panel);
  const $ = s => panel.querySelector(s);
  $('#al-now').onclick = () => { cache.clear(); const n = new Date(); $('#al-day').value = isoDay(n); $('#al-time').value = hhmm(n); run(); };
  const status = t => { $('#al-status').textContent = t; };

  // Modulo Google anonimo per suggerimenti e segnalazioni: precompilo i dettagli di ciò che si stava guardando
  const MODULO = 'https://docs.google.com/forms/d/e/1FAIpQLSeyGnxiCHDgDTpsxyFJVrsXedcJjeVB5fdDHP4Kagtocl5Wpw/viewform';
  const linkModulo = () => {
    const ed = ($('#al-ed').selectedOptions[0]?.textContent || '').split(' — ')[0];
    const dett = [`Giorno ${$('#al-day').value}`, `ora ${$('#al-time').value}`, ed,
      $('#al-q').value ? `ricerca "${$('#al-q').value}"` : '', $('#al-pc').checked ? 'PC attivo' : '',
      matchMedia('(display-mode: standalone)').matches ? 'app installata' : 'browser'].filter(Boolean).join(' · ');
    const p = new URLSearchParams({ usp: 'pp_url', 'entry.867016280': dett });
    if ($('#al-q').value) p.set('entry.1792769006', $('#al-q').value);
    return `${MODULO}?${p}`;
  };
  $('#al-fb').addEventListener('click', () => { $('#al-fb').href = linkModulo(); });

  // ---------- invito a installare l'app (solo su telefono, solo se non è già installata) ----------
  try { navigator.serviceWorker?.register('sw.js'); } catch { }

  // Evento anonimo per GoatCounter (lo script si carica in modo asincrono: aspetto che sia pronto)
  const conta = (path, title) => {
    let n = 0;
    const t = setInterval(() => {
      if (window.goatcounter?.count) { clearInterval(t); try { goatcounter.count({ path, title, event: true }); } catch { } }
      else if (++n > 20) clearInterval(t);
    }, 500);
  };
  addEventListener('appinstalled', () => conta('app-installata', 'App installata (Android)'));
  (() => {
    const installata = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const android = /android/i.test(navigator.userAgent);
    const rifiutato = Date.now() - (store.get().installNo || 0) < 14 * 86400e3;   // dopo "non ora" riappare tra 2 settimane
    if (installata || rifiutato || !(ios || android)) return;
    function mostra(testo, conPulsante, onOk) {
      if (panel.querySelector('#al-inst')) return;
      const b = document.createElement('div');
      b.id = 'al-inst';
      b.innerHTML = `<img src="../icon-192.png?v=5" alt=""><div class="tx"><b>Scarica l'app</b>${testo}</div>` +
        (conPulsante ? '<button class="ok" type="button">Installa</button>' : '') +
        '<button class="no" type="button" aria-label="Non ora">×</button>';
      b.querySelector('.no').onclick = () => { store.set({ ...store.get(), installNo: Date.now() }); b.remove(); };
      if (conPulsante) b.querySelector('.ok').onclick = () => { b.remove(); onOk(); };
      panel.appendChild(b);
    }
    if (ios) {
      // Safari non permette l'installazione automatica: spiego i due passaggi
      setTimeout(() => mostra('Tocca <b style="display:inline;font-size:13px">Condividi</b> ' +
        '<svg width="14" height="16" viewBox="0 0 14 18" style="vertical-align:-2px" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 11V1M3.5 4.5 7 1l3.5 3.5M4 7H1.5v10h11V7H10"/></svg>' +
        ' e poi <b style="display:inline;font-size:13px">Aggiungi alla schermata Home</b>.', false), 1500);
    } else {
      // Android: Chrome segnala quando l'app è installabile; uso la sua finestra di installazione
      addEventListener('beforeinstallprompt', e => {
        e.preventDefault();
        mostra('Aprila dalla schermata Home, come un\'app normale.', true, async () => {
          e.prompt();
          const scelta = await e.userChoice.catch(() => null);
          if (!scelta || scelta.outcome !== 'accepted') store.set({ ...store.get(), installNo: Date.now() });
        });
      });
    }
  })();

  // Barra ridotta: scorrendo i risultati restano solo ricerca e PC, più una riga di riepilogo
  // che riapre i filtri. Soglie diverse in discesa e in salita per evitare sfarfallii.
  const corpo = () => $('#al-body');
  function riepilogo() {
    const ed = ($('#al-ed').selectedOptions[0]?.textContent || '').split(' — ')[0]
      .replace('Viale Pindaro + Polo Micara', 'Pindaro + Micara').replace(/^Polo (v\.le )?/, '');
    const [y, m, d] = $('#al-day').value.split('-').map(Number);
    const g = y ? new Date(y, m - 1, d).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'numeric' }) : '';
    $('#al-sum').textContent = `${ed} · ${g} · ${$('#al-time').value} · ${$('#al-min').selectedOptions[0]?.textContent || ''}  ▾`;
  }
  setTimeout(() => corpo().addEventListener('scroll', () => {
    const y = corpo().scrollTop, mini = panel.classList.contains('mini');
    if (!mini && y > 60) { riepilogo(); panel.classList.add('mini'); }
    else if (mini && y < 4) panel.classList.remove('mini');
  }, { passive: true }));
  $('#al-sum').onclick = () => { panel.classList.remove('mini'); corpo().scrollTo({ top: 0, behavior: 'smooth' }); };

  const now = new Date();
  $('#al-day').value = isoDay(now);
  $('#al-pc').checked = store.get().pc === true;   // disattivata di default
  $('#al-time').value = hhmm(now);

  // ---------- dati ----------
  const cache = new Map(); // isoDay -> impegni
  const fonte = new Map(); // isoDay -> ora di generazione del file, oppure null se scaricato in diretta

  // Giorno dal file pre-calcolato; null se manca o è troppo vecchio (oggi: più di 3 ore; altri giorni: 36 ore)
  async function giornoDaFile(d) {
    const k = isoDay(d);
    try {
      const r = await fetch(`${DATI}giorni/${k}.json`, { cache: 'no-cache' });
      if (!r.ok) return null;
      const j = await r.json();
      const maxEta = (k === isoDay(new Date()) ? 3 : 36) * 3600e3;
      if (!j || !Array.isArray(j.impegni) || Date.now() - j.generato > maxEta) return null;
      fonte.set(k, j.generato);
      return j.impegni.map(i => ({ id: i.id, s: i.s, e: i.e, nome: i.nome,
        aule: i.a.map(id => ({ id, ...(j.aule[id] || {}) })) }));
    } catch { return null; }
  }

  async function getGiorno(d) {
    const k = isoDay(d);
    if (!cache.has(k)) {
      const p = (async () => {
        const daFile = await giornoDaFile(d);
        if (daFile) return daFile;
        fonte.set(k, null);
        return giorno(d);
      })();
      p.catch(() => cache.delete(k));   // in caso di errore riprova al prossimo calcolo
      cache.set(k, p);
    }
    return cache.get(k);
  }

  // Elenco completo delle aule dell'Ateneo (anagrafica di University Planner), salvato per 7 giorni.
  // Le aule che non hanno lezioni nel giorno scelto risultano quindi libere tutto il giorno.
  const ESCLUDI_EDIFICI = /PAR|TRIB|ONLINE/i;
  const ESCLUDI_AULE = /parcheggio|studio docent|\(stanza\)/i;
  async function elencoAule() {
    const st = store.get();
    if (st.elenco && Date.now() - st.elencoData < 7 * 86400e3) return st.elenco;
    status('Scarico l\'elenco delle aule…');
    try {   // prima il file pre-calcolato
      const r = await fetch(DATI + 'aule.json', { cache: 'no-cache' });
      if (r.ok) {
        const j = await r.json();
        if (j && Array.isArray(j.aule) && j.aule.length && Date.now() - j.generato < 7 * 86400e3) {
          const elenco = j.aule.filter(a => !ESCLUDI_EDIFICI.test(a.edCod || '') && !ESCLUDI_AULE.test(a.desc || ''));
          store.set({ ...store.get(), elenco, elencoData: Date.now() });
          return elenco;
        }
      }
    } catch { }
    const linkPagina = (location.href.match(/linkCalendarioId=([0-9a-f]{24})/) || [])[1];
    for (const link of [...new Set([linkPagina, LINK_DEFAULT].filter(Boolean))]) {
      try {
        const r = await fetch(BASE + '/api/Aule/getAulePerCalendarioPubblico', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ linkCalendarioId: link, clienteId: CLIENTE, limit: 5000 })
        });
        if (!r.ok) continue;
        const d = await r.json();
        if (!Array.isArray(d) || !d.length) continue;
        const nomiEd = new Map();   // l'elenco aule riporta solo il codice dell'edificio: i nomi li prendo a parte
        try {
          const re = await fetch(BASE + '/api/Edifici/getEdificiPerCalendarioPubblico', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ linkCalendarioId: link, clienteId: CLIENTE })
          });
          if (re.ok) for (const e of await re.json()) nomiEd.set(e.id, (e.descrizione || '').trim());
        } catch { }
        const elenco = d.filter(a => a.abilitato !== false && a.edificio &&
            !ESCLUDI_EDIFICI.test(a.edificio.codice || '') && !ESCLUDI_AULE.test(a.descrizione || ''))
          .map(a => {
            const edId = a.edificioId || a.edificio.id;
            return { id: a.id, codice: a.codice, desc: a.descrizione, cap: a.capienza || null,
              edId, edCod: a.edificio.codice, edDesc: nomiEd.get(edId) || a.edificio.descrizione || a.edificio.codice };
          });
        store.set({ ...store.get(), elenco, elencoData: Date.now() });
        return elenco;
      } catch { }
    }
    return st.elenco || [];   // se il server non risponde uso l'ultimo elenco salvato (o solo le aule viste negli orari)
  }

  function popolaEdifici(aule) {
    const ed = new Map();
    for (const a of aule) {
      const e = ed.get(a.edId) || { id: a.edId, cod: a.edCod || '', desc: a.edDesc || a.edCod || a.edId, n: 0 };
      e.n++; ed.set(a.edId, e);
    }
    const lista = [...ed.values()].sort((x, y) => (y.cod.startsWith('PE') - x.cod.startsWith('PE')) || x.desc.localeCompare(y.desc));
    // Scelta combinata (predefinita): viale Pindaro + Polo Micara, edifici adiacenti
    const combo = lista.filter(e => /^PE_(PIN|MIC)$/.test(e.cod));
    if (combo.length) lista.unshift({ id: COMBO, cod: 'PE', desc: 'Viale Pindaro + Polo Micara', n: combo.reduce((s, e) => s + e.n, 0) });
    const scelto = store.get().edificioScelto;
    const def = lista.find(e => e.id === scelto) || lista[0];
    $('#al-ed').innerHTML = lista.map(e =>
      `<option value="${esc(e.id)}" ${e === def ? 'selected' : ''}>${esc(e.desc)} — ${e.cod.startsWith('PE') ? 'Pescara' : e.cod.startsWith('CH') ? 'Chieti' : esc(e.cod)} (${e.n} aule)</option>`).join('');
  }

  async function calcola() {
    const edId = $('#al-ed').value;
    store.set({ ...store.get(), edificioScelto: edId });
    const [y, mo, da] = $('#al-day').value.split('-').map(Number);
    const [h, mi] = ($('#al-time').value || '08:00').split(':').map(Number);
    const giornoSel = new Date(y, mo - 1, da);
    const t = new Date(y, mo - 1, da, h, mi).getTime();
    const minMs = Number($('#al-min').value) * 60e3;
    const ap = dayStart(giornoSel).getTime() + 8 * 3600e3, ch = dayStart(giornoSel).getTime() + 20 * 3600e3;

    status('Scarico gli orari del giorno…');
    const imp = await getGiorno(giornoSel);
    const gen = fonte.get(isoDay(giornoSel));
    const origine = gen ? `Dati aggiornati alle ${hhmm(new Date(gen))}` +
        (isoDay(new Date(gen)) !== isoDay(new Date()) ? ` del ${new Date(gen).toLocaleDateString('it-IT')}` : '')
      : 'Dati scaricati ora dall\'università';
    const elenco = await elencoAule();
    const edIds = new Set(edId === COMBO ? elenco.filter(a => /^PE_(PIN|MIC)$/.test(a.edCod || '')).map(a => a.edId) : [edId]);
    const auleEd = elenco.filter(a => edIds.has(a.edId));

    const perAula = new Map(auleEd.map(a => [a.id, { a, imp: [] }]));
    for (const i of imp) for (const a of i.aule) {
      if (!edIds.has(a.edId)) continue;
      if (!perAula.has(a.id)) perAula.set(a.id, { a, imp: [] });
      perAula.get(a.id).imp.push(i);
    }

    // Ricerca: ogni parola cercata deve essere l'inizio di una parola del nome dell'aula
    const norm = x => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const q = norm($('#al-q').value).split(/[^a-z0-9]+/).filter(Boolean);
    const trovata = a => { const parole = norm(a.desc || a.codice).split(/[^a-z0-9]+/).filter(Boolean);
      return q.every(p => parole.some(w => w.startsWith(p))); };

    const libere = [], occupate = [];
    for (const { a, imp: lst } of perAula.values()) {
      if (ESCLUDI_AULE.test(a.desc || '')) continue;   // uffici, parcheggi, stanzette
      if (q.length && !trovata(a)) continue;
      lst.sort((x, y) => x.s - y.s);
      const ora = lst.find(i => i.s <= t && i.e > t);
      if (ora) {
        let fine = ora.e; // finché ci sono impegni attaccati, l'aula resta occupata
        for (const i of lst) if (i.s <= fine && i.e > fine) fine = i.e;
        occupate.push({ a, lst, ora, liberaDa: fine });
      } else {
        const prox = lst.find(i => i.s > t);
        const fino = prox ? prox.s : null;
        if (fino === null || fino - t >= minMs || q.length) libere.push({ a, lst, fino, prox });
      }
    }
    const nomeAula = a => (a.desc || a.codice);
    const sede = a => edId !== COMBO ? '' : /^PE_MIC/.test(a.edCod || '') ? 'Micara' : 'Pindaro';
    const info = a => [sede(a), a.cap ? a.cap + ' posti' : ''].filter(Boolean).join(' · ');
    const pcPrima = $('#al-pc').checked;
    const titolo = a => esc(nomeAula(a)) + (info(a) ? ` <small class="i">· ${info(a)}</small>` : '') +
      (pcPrima && preferita(a) ? ' <small class="p">🔌 PC</small>' : '');
    const ord = (x, y) => nomeAula(x.a).localeCompare(nomeAula(y.a), 'it', { numeric: true });
    const pref = x => pcPrima && preferita(x.a) ? 0 : 1;
    // le aule senza nessuna lezione in tutta la giornata vanno in fondo: spesso sono chiuse o non sono aule didattiche
    const vuota = x => x.lst.length ? 0 : 1;
    libere.sort((x, y) => (pref(x) - pref(y)) || (vuota(x) - vuota(y)) || ((y.fino ?? Infinity) - (x.fino ?? Infinity)) || ord(x, y));
    occupate.sort((x, y) => (pref(x) - pref(y)) || (x.liberaDa - y.liberaDa) || ord(x, y));

    const barra = lst => {
      const span = ch - ap, pos = v => Math.max(0, Math.min(100, (v - ap) / span * 100));
      const ora = (t - ap) / span * 100;
      return `<div class="al-tl"><div class="al-bar">${lst.map(i => `<i style="left:${pos(i.s)}%;width:${pos(i.e) - pos(i.s)}%" title="${esc(hhmm(new Date(i.s)))}–${esc(hhmm(new Date(i.e)))} ${esc(i.nome)}"></i>`).join('')}</div>` +
        (ora >= 0 && ora <= 100 ? `<b class="ora" style="left:${ora}%"></b>` : '') + `</div>`;
    };
    const ticks = `<div class="al-ticks"><span>8</span><span>11</span><span>14</span><span>17</span><span>20</span></div>`;

    // Università chiusa: nessuna lezione in questi edifici quel giorno, oppure l'ora scelta è
    // prima della prima lezione o dopo la fine dell'ultima (quindi nessuna aula è occupata).
    const impEd = [...new Map([...perAula.values()].filter(x => !ESCLUDI_AULE.test(x.a.desc || ''))
      .flatMap(x => x.imp).map(i => [i.id, i])).values()];
    const primo = impEd.length ? Math.min(...impEd.map(i => i.s)) : null;
    const ultimo = impEd.length ? Math.max(...impEd.map(i => i.e)) : null;
    const chiusa = !occupate.length && (!impEd.length || t < primo || t >= ultimo);
    if (chiusa) {
      const quando = giornoSel.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
      const motivo = !impEd.length
        ? `Nessuna lezione in programma ${esc(quando)} in questi edifici.`
        : t < primo ? `Le lezioni di ${esc(quando)} iniziano alle ${hhmm(new Date(primo))}.`
        : `Le lezioni di ${esc(quando)} sono finite alle ${hhmm(new Date(ultimo))}.`;
      $('#al-out').innerHTML = `<div class="al-closed"><div class="ic">🔒</div><h3>Università chiusa</h3><p>${motivo}</p>
        <p class="n">Prova a cambiare giorno o ora.</p></div>`;
      status(`Nessuna aula occupata alle ${hhmm(new Date(t))}. ${origine}.`);
      return;
    }

    if (q.length && !libere.length && !occupate.length) {
      $('#al-out').innerHTML = `<div class="al-closed"><div class="ic">🔎</div><h3>Nessuna aula trovata</h3>
        <p>Nessuna aula di questo edificio corrisponde a “${esc($('#al-q').value)}”.</p>
        <p class="n">Prova un altro nome o scegli un altro edificio.</p></div>`;
      status(`${origine}.`);
      return;
    }

    $('#al-out').innerHTML =
      `<div class="al-sec">Libere alle ${hhmm(new Date(t))} (${libere.length})</div>` +
      (libere.length ? libere.map(x => `<div class="al-room free"><div class="t"><span>${titolo(x.a)}</span>
        <span>${x.fino ? 'fino alle ' + hhmm(new Date(x.fino)) : 'tutto il giorno'}</span></div>
        <div class="s">${x.fino ? 'Libera per ' + durata(x.fino - t) + ' · poi: ' + esc(x.prox.nome) : (x.lst.length ? 'Nessuna lezione in programma dopo quest\'ora' : 'Nessuna lezione in programma oggi')}</div>
        ${barra(x.lst)}${ticks}</div>`).join('') : '<div class="s">Nessuna aula libera con questi criteri.</div>') +
      `<div class="al-sec">Occupate (${occupate.length})</div>` +
      occupate.map(x => `<div class="al-room"><div class="t"><span>${titolo(x.a)}</span><span>libera dalle ${hhmm(new Date(x.liberaDa))}</span></div>
        <div class="s">${esc(x.ora.nome)} (${hhmm(new Date(x.ora.s))}–${hhmm(new Date(x.ora.e))})</div>${barra(x.lst)}</div>`).join('');

    $('#al-status').innerHTML = esc(`${libere.length + occupate.length} aule · ${imp.length} impegni in Ateneo quel giorno · ${origine}. ` +
      `"Libera" = nessun impegno pubblicato su University Planner: `) +
      '<b>un\'aula senza lezioni potrebbe comunque essere chiusa o riservata.</b>';
  }

  const run = () => calcola().catch(err => status('Errore: ' + err.message));
  try {
    status('Scarico gli orari…');
    let elenco = await elencoAule();
    if (!elenco.length) {   // ripiego: aule ricavate dagli orari di oggi
      const viste = new Map();
      for (const i of await getGiorno(new Date())) for (const a of i.aule) if (a.id && a.edId) viste.set(a.id, a);
      elenco = [...viste.values()];
      store.set({ ...store.get(), elenco, elencoData: 0 });
    }
    popolaEdifici(elenco.filter(a => !ESCLUDI_AULE.test(a.desc || '')));
    ['#al-ed', '#al-day', '#al-time', '#al-min'].forEach(s => $(s).addEventListener('change', run));
    $('#al-q').addEventListener('input', run);
    $('#al-pc').addEventListener('change', () => { store.set({ ...store.get(), pc: $('#al-pc').checked }); run(); });
    await run();
  } catch (err) {
    status('Errore: ' + err.message);
  }
})();
