# AraLegal (aralocal) — istruzioni di progetto

Desktop app Electron che impacchetta una web app Next.js + Express, con tutto
in locale (SQLite, filesystem, niente cloud). Fork AGPL-3.0 di
[mikelocal](https://github.com/rafal-fryc/mikelocal) — la nota di fork nel
README è un obbligo di licenza (AGPL §5a): non rimuoverla.

Repo: `Leapfrog-LSA/aralocal` · branch di lavoro: `main`

## Stack

| Parte    | Tecnologia                                              |
| -------- | ------------------------------------------------------- |
| Shell    | Electron 33 + electron-builder (installer NSIS Windows) |
| Frontend | Next.js + React + Radix UI + Tiptap                     |
| Backend  | Express + TypeScript, avviato come processo figlio      |
| Dati     | SQLite via `better-sqlite3`, dentro la workspace utente |
| Modelli  | SDK Anthropic e Google GenAI, chiavi utente in SQLite   |

## Comandi

```
npm run install:all     # installa root + frontend + backend
npm run dev             # frontend + Electron in sviluppo
npm run build           # build electron + backend + frontend
npm run dist            # installer Windows completo (scarica LibreOffice)
npm --prefix frontend run lint   # eslint (unico controllo automatico esistente)
```

**Non esiste una test suite.** Non dire che una modifica è "testata" senza
averla eseguita davvero: verifica avviando l'app o il singolo flusso toccato.

## Vincoli da rispettare

- **Sicurezza filesystem**: ogni accesso ai file passa dal layer con guardia
  contro path traversal. Non aggirarlo con `fs` diretto su percorsi utente.
- **Niente cloud**: il progetto esiste per non chiamare servizi esterni. Le
  uniche chiamate di rete ammesse sono ai provider di modelli configurati.
- **Native module**: `better-sqlite3` va ricompilato per la versione di
  Electron (`npm run rebuild-native`) se cambia Electron o Node.
- **Segreti**: le chiavi API stanno in SQLite nella workspace, non nel repo.
  Non committare mai `.aralegal/`, `files/` o `.env`.

## Documenti del repo

- `DECISIONS.md` — registro delle decisioni architetturali con alternative e
  trade-off. Aggiungi una voce quando prendi una decisione strutturale. Quando
  una decisione cambia, non riscrivere la voce vecchia: marcala `SUPERSEDED`
  con un rimando e aggiungine una nuova datata in fondo.
- `TODO.md` — lavori aperti.
- `CODE-REVIEW-0.2.0.md` — review della versione corrente.
- `.claude/phases/` — storico delle fasi di sviluppo completate (PHASE-01..08).
