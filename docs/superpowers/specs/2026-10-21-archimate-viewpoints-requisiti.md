# Requisiti sessione 2026-10-21 — ArchiMate Viewpoints + riorganizzazione nav

Recap di lavoro per avviare il branch `feature/archimate-viewpoint`. Non è ancora
lo spec formale (manca il confronto di approcci e la review finale) — è l'input
da cui scriverlo.

## 1. Viewpoint Catalog (nuova entità — nome ufficiale della feature)

**Dove:** terzo sotto-tab "Viewpoint Catalog" in Architecture Studio (Card
Mapping resta primo; Relations Mapping resta nascosto, non cancellato).

**Modello dati:**
- `key`, `name`, `icon` (Material Symbol), `layer` (1 dei 7 — classificazione/badge
  admin, NON vincolo sulla composizione), `description`
- Lista di **Enterprise Object ammessi**, **editabile in qualsiasi momento**
  (non solo alla creazione) — non relation type — le relazioni restano
  governate dalla matrice globale `isRelationshipAllowed`, già ristretta
  naturalmente perché sul canvas ci sono solo gli oggetti ammessi dal viewpoint
- `examples`: **lista**, non singolo campo (coerente con la grid "un
  rettangolo per ciascun esempio" di §1 sotto) — ciascuno un diagramma
  caricabile e **validato sintatticamente all'upload**, riusando
  `validate_exchange()` già esistente (stesso validatore dell'import nel
  designer). Upload accetta sia Exchange XML sia `.archimate` nativo Archi
  (come quelli appena scaricati), passato dal convertitore
  `archi_native_import.py` già esistente prima della validazione.

**Seed:** i 23 viewpoint standard caricati al boot (`is_standard=True`, stesso
pattern di `seed_enterprise_objects`); admin può disabilitarli (`is_hidden`) ma
non cancellarli. Viewpoint custom: CRUD completo. Lista Enterprise Object
ammessi dei 23 standard seedata dalla colonna "Elementi" già raccolta dalla
guida Visual Paradigm (vedi tabella in `docs/data/viewpoint-examples/`),
editabile dall'admin dopo.

**UI selezione oggetti ammessi:** tag chip, icona+colore **presi direttamente
da `EnterpriseObject.icon`/`EnterpriseObject.color`** (non uno stile a parte)
+ pulsante "+", riuso del pattern già costruito in Relations Mapping/Card
Mapping.

**Creazione diagramma:** niente più modalità "Free" — ogni nuovo diagramma
nasce legato a un viewpoint, scelta obbligatoria. Flusso UX, raffinato rispetto
al pattern BPMN puro: **combo box** in alto per scegliere il Viewpoint (lista
pre-filtrata per layer del tab di ingresso, vedi §2) — non una grid flat di
tutti i viewpoint insieme come in `BpmnTemplateChooser.tsx`. Scelto il
viewpoint dalla combo, sotto compaiono le card tipo BPMN (stesso
`CardActionArea` pattern) ma solo per **quel** viewpoint: un rettangolo
"blank" + un rettangolo per ciascun esempio precaricato di quel viewpoint.

**Designer:** diagramma legato a un viewpoint → palette elementi ristretta ai
soli Enterprise Object ammessi da quel viewpoint. Nessuna whitelist di
relazioni separata (deciso per non ripetere il problema di restrittività che
ci ha fatto nascondere Relations Mapping).

**Diagrammi esistenti pre-feature:** risolto — non ne esistono in produzione
(il sandbox Architecture Studio è nascosto/inutilizzato), zero migrazione
necessaria.

**Materiale di riferimento già raccolto** (in
`analisi-documenti/Progetti/Turbo-ea-prod/docs/data/viewpoint-examples/`):
- 34 diagrammi `.archimate` reali (repo ArchiSurance_Practice), mappati ai 23
  viewpoint standard
- 36 diagrammi `.archimate` reali (repo ArchiMetal_Practice, scaricato per
  intero), 32 classificati sui 23 viewpoint standard (3 sono modelli completi
  non singole viste, 1 è un pattern generico). Le sezioni del repo (CRM
  Vision, Transformation Challenges/Overview, Detailed Target EA, Target
  State Scenarios, Modeling Patterns) sono i capitoli del case study
  ufficiale Open Group "ArchiMetal" — narrazione cronologica propria di
  questo case study (stesso autore/corso di ArchiSurance, taglio
  manifatturiero vs assicurativo), non una tassonomia da preservare: già
  ricondotta ai 23 viewpoint standard, nessuna riconciliazione ulteriore
  necessaria.
- Con ArchiSurance+ArchiMetal insieme: 18 dei 23 viewpoint hanno almeno un
  esempio reale sorgente. Mancano Technology Usage, Physical, Layered,
  Outcome Realization, Motivation puro — per questi 5 l'esempio verrà
  trascritto dall'immagine Visual Paradigm (li abbiamo per tutti e 23),
  non da un repo GitHub
- 23 immagini + tabella (nome, stakeholder, concern, scope, elementi ammessi)
  scaricate dalla guida ufficiale Visual Paradigm
- Tabella derivata (layer coinvolti + card Turbo EA impattata) per tutti i 23,
  incrociando `taxonomy.py` (LAYERS) e `default_mapping.py`
  (CARD_TYPE_DEFAULTS/SUBTYPE_DEFAULTS)

**Deciso:** generare tutti e 23 i file `.archimate` di esempio (trascrizione
visiva manuale dalle 23 immagini, lavoro corposo ma scope confermato per
intero, non un sottoinsieme). Servono come anteprima/contenuto di partenza
nella grid picker sopra.

## 2. Riorganizzazione nav principale

| Tab (rename) | Figli, in ordine | Layer scoped per "Diagram" |
|---|---|---|
| **Business Architecture** (ex `strategy_process`/"Org&Process") | Value Chain, BPM, Business Diagram | Strategy + Business + Motivation |
| **Application&Data Architecture** (ex `app_data`/"App&Data") | SWOT Analysis (placeholder), What-if Analysis (placeholder — poi si decide porting estensione `product-technology-what-if` vs sviluppo nuovo), Data Flow (placeholder), Application Diagram | Application |
| **Technology Architecture** (nuovo tab) | Technology Diagram (altri figli — deferiti, li vediamo dopo) | Technology + Physical |

SWOT/What-if/Data Flow: solo voce di menu placeholder in questo branch,
nessuna funzionalità. Si riparla di porting vs sviluppo nuovo a parte.

`Diagrams` top-level (`/diagrams`, lista non filtrata di tutto) **resta
invariato**, non si tocca.

**Ogni "X Architecture Diagram"** apre una dashboard nuova: step 1 scegli
Viewpoint, step 2 scegli Card di riferimento, poi apre il designer scoped.

**Regola di assegnazione viewpoint→tab:** non si usa il campo `layer` del
viewpoint (quello resta solo badge/classificazione admin) — si usa il set
reale di layer toccati dai suoi Enterprise Object ammessi. Un viewpoint
multi-layer compare automaticamente in ogni tab il cui layer tocca, senza
caso speciale per-viewpoint. Confermato concretamente su:
- **Implementation and Deployment** (Application+Technology) → compare in
  entrambi i tab
- **Migration / Project / Implementation and Migration** (Business +
  Implementation&Migration) → compare in tutti e tre i tab (il layer
  Implementation&Migration non ha un tab proprio, si appoggia agli altri tre)
- **Layered** (tutti e 7 i layer) → compare in tutti e tre, stessa regola

**Card suggerita nel picker non è proprietà del viewpoint** — dipende dal tab
di ingresso:

| Viewpoint multi-tab | Business | Application | Technology |
|---|---|---|---|
| Implementation and Deployment | — | Application | ITComponent, Platform |
| Migration / Project / Implementation and Migration | **Initiative** (proposta: coerente con WorkPackage→Initiative già mappato, non BusinessContext) | Application, DataObject | ITComponent, Platform |

## 3. Ultime decisioni (round finale pre-spec)

- **Cancellazione viewpoint custom:** bloccata se almeno un diagramma lo usa
  (stesso pattern di EnterpriseObject standard — disabilita con `is_hidden`,
  cancella solo se inutilizzato).
- **Tab `Diagrams` globale:** mantiene "+ Nuovo diagramma" con lo stesso
  combo+grid degli altri tab, ma la combo elenca tutti i viewpoint senza
  filtro layer (nessuna restrizione di scope).
- **Card suggerita per viewpoint multi-tab:** tabella di override esplicita
  nel DB (non calcolata al volo) — un record per combinazione
  viewpoint×tab→card, editabile dall'admin indipendentemente dal mapping
  EnterpriseObject→card di default.

Nessun aperto rimasto. Pronto per lo spec formale (`superpowers:brainstorming`
→ design doc → `superpowers:writing-plans`).

## 4. Deferiti volutamente (non bloccano l'avvio del branch)

- Tab Technology Architecture: contenuto oltre a Technology Diagram
- SWOT Analysis, Data Flow, What-if Analysis: solo placeholder nel menu in
  questo branch; design/porting discussi a parte più avanti
