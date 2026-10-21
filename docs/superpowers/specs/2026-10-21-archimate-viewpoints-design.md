# ArchiMate Viewpoint Catalog + Scoped Architecture Diagrams — Design

**Branch:** `feature/archimate-viewpoint`
**Input:** `docs/superpowers/specs/2026-10-21-archimate-viewpoints-requisiti.md` (recap
della sessione di brainstorming — questo documento ne è la forma finale, auto-contenuta)

## Intent

Oggi Architecture Studio lascia disegnare un diagramma ArchiMate libero (modalità
"Free"): qualunque Enterprise Object, qualunque relazione ammessa dalla matrice
standard. Questo è flessibile ma non guida l'utente — non c'è un modo per dire
"sto facendo una vista Organizzativa" o "una vista di Application Cooperation" e
avere l'editor che si comporta di conseguenza (solo gli oggetti pertinenti, un
esempio da cui partire).

Il concetto di **Viewpoint** è nello standard ArchiMate esattamente per questo:
un sottoinsieme di concetti rilevanti per un concern specifico. Questo design
introduce un catalogo di Viewpoint (i 23 standard più eventuali custom) e lo
usa per guidare la creazione dei diagrammi, e riorganizza la navigazione
principale in tre aree (Business / Application&Data / Technology Architecture)
ciascuna con il proprio punto di ingresso ai diagrammi, scoped per layer.

## Goals

- Un catalogo Viewpoint Catalog gestibile da admin: create/edit/disable/delete,
  con un set di Enterprise Object ammessi per ciascuno, editabile in ogni
  momento.
- I 23 viewpoint ufficiali ArchiMate 3.1 precaricati come standard, con almeno
  un esempio reale o trascritto per ciascuno.
- Ogni nuovo diagramma nasce legato a un viewpoint; il designer, quando un
  diagramma è legato a un viewpoint, mostra in palette solo gli Enterprise
  Object ammessi da quello.
- Tre nuovi/rinominati tab di navigazione (Business Architecture,
  Application&Data Architecture, Technology Architecture), ciascuno con un
  punto di ingresso "X Diagram" che apre una dashboard di creazione scoped per
  layer.
- Il tab globale `Diagrams` resta per creare/vedere diagrammi di qualunque
  viewpoint, senza filtro di layer.

## Non-goals

- Non si introduce una whitelist di tipi di relazione per viewpoint — le
  relazioni restano governate dalla matrice `isRelationshipAllowed` esistente,
  naturalmente ristretta perché sul canvas compaiono solo gli oggetti ammessi.
- Non si costruisce SWOT Analysis, Data Flow, o il porting di What-if Analysis
  in questo branch — solo voci di menu placeholder.
- Non si definiscono i figli del tab Technology Architecture oltre a
  "Technology Diagram" — deferito.
- Non si tocca il tab `Diagrams` esistente oltre a adattarne il flusso di
  creazione al nuovo requisito "ogni diagramma ha un viewpoint" (resta
  altrimenti invariato: lista non filtrata, nessun cambio di layout).

## Anti-goals

- Reintrodurre per vie traverse una modalità "disegna senza vincoli" (es. un
  viewpoint "Free" fittizio con tutti gli oggetti ammessi) vanificherebbe lo
  scopo del feature.
- Un catalogo Viewpoint che duplica a mano le informazioni già derivabili da
  `EnterpriseObjectCardMapping` (icona/colore degli oggetti, layer) sarebbe
  lavoro sprecato e fonte di disallineamento — si riusano i campi esistenti.

## Constraints

- Ogni nuova stringa UI va tradotta nelle 10 locale esistenti (pattern già
  seguito per Relations Mapping).
- Il validatore di un diagramma caricato come esempio è `validate_exchange()`
  (già esistente, usato dall'import nel designer) — non se ne scrive uno
  nuovo.
- Un file `.archimate` nativo Archi caricato come esempio passa prima per
  `archi_native_import.py` (già esistente) e poi per `validate_exchange()`.
- Icona e colore di un Enterprise Object nella UI del catalogo vengono letti
  da `EnterpriseObject.icon`/`EnterpriseObject.color` — mai duplicati in un
  campo a parte.
- Un viewpoint standard (`is_standard=True`) non è mai cancellabile, solo
  disattivabile (`is_hidden`) — stesso pattern di `EnterpriseObject`.
- Un viewpoint (standard o custom) in uso da almeno un diagramma non è
  cancellabile, punto, indipendentemente da `is_standard`.

## Decisioni (il "come", già prese in sessione)

### 1. Modello dati — Viewpoint Catalog

Nuova entità `ArchimateViewpoint` (nome di dominio: **Viewpoint Catalog**):

- `key`, `name`, `icon` (Material Symbol), `description`
- `layer`: uno dei 7 layer standard. Campo di **classificazione/badge admin
  soltanto** — non vincola quali Enterprise Object il viewpoint può contenere,
  e non è ciò che decide in quali tab il viewpoint compare (vedi §3).
- `is_standard`, `is_hidden` (stesso significato di `EnterpriseObject`)
- Enterprise Object ammessi: bridge table M:N `ArchimateViewpointObject`
  (viewpoint_key, enterprise_object_key), editabile sempre, non solo alla
  creazione
- Esempi: tabella `ArchimateViewpointExample` (viewpoint_key, name,
  exchange_xml), **0..N per viewpoint** — non un singolo campo. Ogni upload
  passa da `archi_native_import.py` (se nativo Archi) poi da
  `validate_exchange()`; un esempio che non valida viene rifiutato con
  l'errore del validatore, non salvato.

**Seed:** i 23 viewpoint standard al boot, stesso pattern di
`seed_enterprise_objects` (idempotente, insert-only, non tocca campi
admin-editati su righe già esistenti). Enterprise Object ammessi seedati dalla
colonna "Elementi" della guida Visual Paradigm (già raccolta, vedi
`docs/data/viewpoint-examples/visual-paradigm-23-viewpoints/catalogo-23-viewpoint.md`).
Esempi seedati dai 34+36 diagrammi reali scaricati (ArchiSurance/ArchiMetal,
già classificati) dove esiste un match; per i 5 viewpoint senza un file reale
sorgente (Technology Usage, Physical, Layered, Outcome Realization, Motivation
puro) l'esempio viene trascritto a mano dall'immagine Visual Paradigm
corrispondente.

### 2. UI Viewpoint Catalog (admin)

Terzo sotto-tab "Viewpoint Catalog" in Architecture Studio (`ArchitectureStudioTab.tsx`
torna ad avere la `Tabs` shell — Card Mapping primo, Viewpoint Catalog
secondo; Relations Mapping resta non montato, file non cancellato).

- Tabella: icona, nome, layer (badge colorato), stato (standard/custom,
  attivo/disabilitato), N oggetti ammessi, azioni
- Dialog crea/modifica: nome, icona (picker Material Symbol), layer (select),
  descrizione
- Oggetti ammessi: tag chip (icona+colore presi da `EnterpriseObject`) +
  pulsante "+", stesso pattern già costruito in Relations Mapping/Card
  Mapping, editabile in ogni momento, non solo in creazione
- Esempi: lista con upload (file `.archimate` o Exchange XML), errore di
  validazione mostrato inline se il file non passa `validate_exchange()`
- Disabilita: `is_hidden`. Cancella: bloccato lato API se `is_standard` o se
  in uso da ≥1 diagramma (stesso vincolo, due motivi diversi)

### 3. Riorganizzazione nav principale

| Tab | Figli, in ordine | Layer scoped |
|---|---|---|
| **Business Architecture** (ex `strategy_process`) | Value Chain, BPM, Business Diagram | Strategy + Business + Motivation |
| **Application&Data Architecture** (ex `app_data`) | SWOT Analysis (placeholder), What-if Analysis (placeholder), Data Flow (placeholder), Application Diagram | Application |
| **Technology Architecture** (nuovo) | Technology Diagram (altri figli deferiti) | Technology + Physical |

`Diagrams` top-level resta, lista non filtrata, invariato nel layout.

**Regola di assegnazione viewpoint→tab:** non il campo `layer` del viewpoint —
il set reale di layer toccati dai suoi Enterprise Object ammessi
(calcolato da `taxonomy.py` LAYERS). Un viewpoint multi-layer compare in ogni
tab il cui layer tocca. Implementation&Migration non ha un tab proprio: i
viewpoint di quel layer (Migration, Project, Implementation and Migration)
compaiono dove i loro altri layer toccati li portano (tipicamente anche
Business).

### 4. Flusso di creazione diagramma

Ogni "X Diagram" (Business/Application/Technology/globale Diagrams) apre una
dashboard: **combo box** per scegliere il Viewpoint (lista pre-filtrata per
layer del tab di ingresso; per `Diagrams` globale, nessun filtro — tutti i
viewpoint). Scelto il viewpoint, sotto una grid di card (stesso
`CardActionArea` di `BpmnTemplateChooser.tsx`): un rettangolo "blank" + un
rettangolo per ciascun esempio di quel viewpoint. Click → crea il diagramma
legato a quel viewpoint, con quel contenuto di partenza, poi apre il designer.

Nessuna modalità "Free": la scelta del viewpoint è obbligatoria, non
bypassabile.

**Designer scoped:** quando il diagramma attivo è legato a un viewpoint, la
palette elementi mostra solo i suoi Enterprise Object ammessi. Le relazioni
restano governate dalla matrice globale esistente, invariata.

### 5. Card suggerita per viewpoint multi-tab

Nuova tabella di override esplicita `ArchimateViewpointTabCard`
(viewpoint_key, tab_key, card_type_key — editabile da admin), popolata al seed
per i casi noti:

| Viewpoint | Business | Application | Technology |
|---|---|---|---|
| Implementation and Deployment | — | Application | ITComponent, Platform |
| Migration / Project / Implementation and Migration | Initiative | Application, DataObject | ITComponent, Platform |

Per i viewpoint single-tab (la maggioranza) non serve un record: la card
suggerita è semplicemente quella già mappata di default ai loro Enterprise
Object (`EnterpriseObjectCardMapping`), nessun bisogno dell'override.

## Cosa resta al builder

- Schema esatto delle 3 nuove tabelle (`ArchimateViewpoint`,
  `ArchimateViewpointObject`, `ArchimateViewpointExample`,
  `ArchimateViewpointTabCard`) e la migrazione Alembic
- Endpoint REST per CRUD Viewpoint Catalog + upload/validazione esempio
- Componenti frontend: `ViewpointCatalogTabContent.tsx` (ricalca
  `CardMappingTabContent.tsx`/`RelationTypesPanel.tsx`), dialog crea/modifica,
  la nuova dashboard di creazione diagramma (combo+grid, ricalca
  `BpmnTemplateChooser.tsx`)
- Logica di filtro "viewpoint→tab per layer reale" e di risoluzione "card
  suggerita" (override table → fallback a `EnterpriseObjectCardMapping`)
- Trascrizione manuale dei 23 diagrammi di esempio dalle immagini/file sorgente
  già raccolti in `docs/data/viewpoint-examples/` (lavoro di contenuto, non di
  codice — va tracciato come task a parte, stimabile separatamente)
- Traduzione delle nuove stringhe UI nelle 10 locale
- Rename dei nav item esistenti (`strategy_process`→Business Architecture,
  `app_data`→Application&Data Architecture) e aggiunta del nuovo tab
  Technology Architecture in `navItems.ts`/`nav.json`
