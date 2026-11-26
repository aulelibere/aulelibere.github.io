# Aule libere UdA — Pescara

Pagina web che mostra le aule libere del Polo di viale Pindaro e del Polo Micara
(Università "G. d'Annunzio"), leggendo gli orari pubblici di University Planner (Cineca).

- **App:** https://aulelibere.github.io/UdA-Pescara/ — su Android: Chrome → menu ⋮ → Installa app / Aggiungi a schermata Home.
- **Segnalibro:** `bookmarklet.txt` contiene la stessa funzione come bookmarklet da usare sul sito degli orari.

"Libera" significa che su University Planner non c'è nulla in programma per quell'aula:
un'aula senza lezioni potrebbe comunque essere chiusa o riservata.

## Come si aggiornano i dati

Circa ogni 2 ore, di giorno, GitHub Actions esegue `scripts/aggiorna-dati.mjs` (il workflow tenta ogni 30 minuti
e si ferma se i dati di oggi hanno meno di 110 minuti; la puntualità non è garantita). Lo script scarica gli orari
da University Planner, li riduce e li pubblica insieme al sito in `data/`:
oggi viene riscaricato a ogni esecuzione, i 7 giorni successivi una volta al giorno.
L'app legge questi file, quindi il numero di studenti che la usano non cambia il carico sul server
dell'università. Se i file mancano o sono troppo vecchi, l'app interroga direttamente l'università.

