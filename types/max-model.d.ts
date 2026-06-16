// Max core data shapes — the single written-down definition of the trip/
// candidate/etc. shapes that, until now, lived only in people's heads and were
// defended by scattered `||` fallbacks + dual-shape readers.
//
// AMBIENT (no import/export) so JSDoc `@type {Trip}` / `@param {Candidate}` work
// in any `// @ts-check` file WITHOUT importing. Permissive on purpose — optional
// fields + `[k: string]: any` index signatures — so turning on a file's type
// check doesn't flood it with errors; the value is catching typos + wrong field
// usage on the KNOWN fields. Tighten field-by-field over time (e.g. drop an index
// signature once a shape is fully enumerated).
//
// This is lever #1 of the extensibility roadmap: make a shape change a compile-
// time event ("the checker names every site that breaks") instead of a runtime
// mystery ripple. It is the foundation that makes the module-system (#2) and the
// canonical-model completion (#3) safe to attempt.

declare var module: any;
declare var global: any;

// The app reaches sibling globals via `window.<name>` too. A permissive index
// signature lets `window.<appGlobal>` resolve under // @ts-check without typing
// every property (mirrors the classic-script reality). Tighten as #2 lands.
interface Window { [key: string]: any; }

// The app attaches custom fields to Error instances (the sync layer's _request
// tags code/status/data/serverRev so callers can branch). Declaration-merge them
// onto the global Error so // @ts-check files can read/write them.
interface Error { code?: string; status?: number; data?: any; serverRev?: any; }

// ── Cross-module global surface ──────────────────────────────────────────────
// Max is (still) a classic-script app: ~56 modules share state through globals on
// window (extensibility lever #2 is migrating this to ES modules). Declared here
// as `any` so a `// @ts-check` module can reference a sibling's global without a
// TS2304 — faithful to the current architecture. Tightening these (real types) or
// removing them (as #2 lands) is future work; today they unblock typing.
declare var _tb: any;
declare var trip: any;
declare var _currentTripId: any;
declare var _pmPlaceMeta: any;
declare var TripStore: any;
declare var MaxDB: any;
declare var MaxDecisions: any;
declare var MaxDiscovery: any;
declare var MaxEnginePicker: any;
declare var MaxEngineTrip: any;
declare var MaxMigration: any;
declare var MaxData: any;
declare var MaxRoute: any;
declare var MaxSync: any;
declare function _normPlaceName(s: any): string;
declare function autoSave(opts?: any): void;
declare function _upsertTripIndexEntry(entry: any): any;
declare var _coarseGeocode: any;
declare var _generatedCityData: any;
declare var _mdcItems: any;
declare var parseNightsFromRange: any;
declare var haversineKm: any;
declare var destCtr: any;
declare var sidCtr: any;
declare var bkCtr: any;

/** A wayside's transit-leg placement (decision-model). */
interface MaxLeg { fromPlace: string; toPlace: string; }

/** A place's immutable FACTS (decision-model). Set at ingestion, never mutated. */
interface Facts {
  origin?: "user" | "max" | "max-hub" | string;
  role?: string | null;
  kind?: string | null;
  themeFit?: any;
  nearListed?: any;
  [k: string]: any;
}

/** The user's DECISION for a place (decision-model) — the only writable surface. */
interface MaxDecisionSpec {
  kept?: boolean | null;
  rejected?: boolean | null;
  role?: string | null;
  hub?: string | null;
  leg?: MaxLeg | null;
}

/** A discovery candidate (pre-publish picker + lean persisted snapshot). */
interface Candidate {
  id?: string;
  place: string;
  country?: string | null;
  role?: string | null;
  stayRange?: string;
  lat?: number | null;
  lng?: number | null;
  nights?: number;
  status?: string | null;
  whyItFits?: string;
  tradeoffs?: string | null;
  tags?: string[];
  intent?: string | null;
  overnightCapable?: boolean | null;
  _required?: boolean;
  _requiredFor?: string[];
  [k: string]: any;
}

/** A place referenced by a placeActivity. */
interface RequiredPlace {
  place: string;
  country?: string;
  nights?: number;
  lat?: number | null;
  lng?: number | null;
  _keep?: boolean;
  _isDayTrip?: boolean;
  _dayTripHub?: string;
  _rejected?: boolean;
  [k: string]: any;
}

/** A discovery activity (the picker's working items). */
interface PlaceActivity {
  id?: string;
  name?: string;
  type?: string;
  checked?: boolean;
  description?: string;
  requiredPlaces?: RequiredPlace[];
  [k: string]: any;
}

/** A committed trip destination (an overnight stop in the itinerary). */
interface Destination {
  id?: string;
  place: string;
  placeId?: string | null;
  nights?: number;
  lat?: number | null;
  lng?: number | null;
  days?: any[];
  suggestions?: any[];
  [k: string]: any;
}

/** A route between two destinations (transit / day-trip). */
interface Route {
  id?: string;
  subKind?: string | null;
  kind?: string | null;
  fromDestId?: string | null;
  toDestId?: string | null;
  [k: string]: any;
}

/** Per-place research metadata (notes / links / stay override). */
interface PlaceMetaEntry {
  notes?: string;
  links?: any[];
  stayOverride?: boolean | null;
  [k: string]: any;
}

/** The trip brief — intent + budget + persisted research. */
interface Brief {
  region?: string;
  sentence?: string;
  duration?: string;
  startDate?: string;
  endDate?: string;
  placeMeta?: { [k: string]: PlaceMetaEntry };
  tripMeta?: { notes?: string; links?: any[] };
  [k: string]: any;
}

/** The trip envelope — the canonical persisted state. */
interface Trip {
  id?: string;
  name?: string;
  brief?: Brief;
  destinations?: Destination[];
  routes?: Route[];
  places?: { [id: string]: any };
  candidates?: Candidate[];
  placeActivities?: PlaceActivity[];
  [k: string]: any;
}

// Cross-module globals referenced by the UI/glue layer (construct-decorate, sync,
// apikey, engine-picker, …). Declared 'any' — same incremental approach. Owned-by-a-
// typed-module names are excluded (TS resolves those).
declare var MaxEnrich: any;
declare var MaxGenPost: any;
declare var MaxGenPrompt: any;
declare var MaxPickerUI: any;
declare var MaxPublish: any;
declare var PlaceKey: any;
declare var _actionCtr: any;
declare var _emitTripMutation: any;
declare var _escHtml: any;
declare var _fileHandle: any;
declare var _listedGroundTruth: any;
declare var _mdcItemDelete: any;
declare var _mergeAdjacentSamePlaceDests: any;
declare var _reconcileDestinations: any;
declare var _refreshUserListedFromRecords: any;
declare var _tripsIndex: any;
declare var _wispDelete: any;
declare var _wispMarkProcessed: any;
declare var _wispUnprocessed: any;
declare var _wispsArrayMigrated: any;
declare var activeDest: any;
declare var addPendingAction: any;
declare var callMax: any;
declare var discoverBreadthPlaces: any;
declare var drawTripMode: any;
declare var g: any;
declare var getCityCenter: any;
declare var localSave: any;
declare var makeDays: any;
declare var maxAlert: any;
declare var renderActivityPicker: any;
declare var saveTripsIndex: any;
declare var showSaveStatus: any;

// ── Batch 2: UI/glue cross-module globals (auto-collected) ──
declare var L: any;
declare var MaxBuild: any;
declare var MaxEngineClassify: any;
declare var MaxGeo: any;
declare var MaxIngestion: any;
declare var MaxMapPin: any;
declare var MaxTripUI: any;
declare var Pikaday: any;
declare var _activeDmSection: any;
declare var _briefMissingFieldMsg: any;
declare var _categoryFromSection: any;
declare var _dispatchRoute: any;
declare var _ensureMdcItemsHasPlace: any;
declare var _ensureTripRoleDefaults: any;
declare var _findMatchingRequired: any;
declare var _fmtTime12h: any;
declare var _fqFastestPractical: any;
declare var _fqGetTransitInfo: any;
declare var _fqHaversineKm: any;
declare var _fqInflight: any;
declare var _fqPairKey: any;
declare var _fqPairMemo: any;
declare var _ftFormatHours: any;
declare var _ftParseHoursInput: any;
declare var _fuCoordSane: any;
declare var _inIframe: any;
declare var _leftMode: any;
declare var _mainMap: any;
declare var _makeCandidateIcon: any;
declare var _mapExecMode: any;
declare var _maxBuildBannerSet: any;
declare var _mdcItemsDedupe: any;
declare var _moveDayTripRouteToDay: any;
declare var _notesIconBtn: any;
declare var _offEnhDone: any;
declare var _offEnhStart: any;
declare var _offError: any;
declare var _persistTripRaw: any;
declare var _pmAskMaxOpen: any;
declare var _pmAttGc: any;
declare var _pmAttGcRan: any;
declare var _pmAttHydrate: any;
declare var _pmAttSerializeBody: any;
declare var _pmAttachDictation: any;
declare var _pmEnsureResearchMeta: any;
declare var _pmEsc: any;
declare var _pmFocusPlace: any;
declare var _pmGetPlaceNotes: any;
declare var _pmIsStayCandidate: any;
declare var _pmOpenSearchedDoc: any;
declare var _pmOpenTripResearchCard: any;
declare var _pmRenderNotesSearchResults: any;
declare var _pmRoleForCheck: any;
declare var _pmRtAttachFile: any;
declare var _pmRtBindAttachmentHandlers: any;
declare var _pmSearchNotes: any;
declare var _reEvaluateOverBudget: any;
declare var _recallLastScreen: any;
declare var _refreshAllPlacePickerMaps: any;
declare var _renderEntryPointsOnCeMap: any;
declare var _renderPlaceActivityItems: any;
declare var _roleInfo: any;
declare var _saveTimer: any;
declare var _setRoadRouting: any;
declare var _showAllHotelsDests: any;
declare var _showDayTripToast: any;
declare var _splitIntentString: any;
declare var _syncInitialIntentWisps: any;
declare var _tbInstall: any;
declare var _titleCaseCity: any;
declare var _undoTimer: any;
declare var _updatePlaceActivitySummary: any;
declare var _useRoadRouting: any;
declare var addDayTripPlace: any;
declare var addDayTripToDay: any;
declare var attachScrollHint: any;
declare var clockMinutesBetween: any;
declare var closeMapPinPanel: any;
declare var computePendingActions: any;
declare var currentDayItems: any;
declare var currentTripStatus: any;
declare var dayRationale: any;
declare var ensureCoarseGeocode: any;
declare var highlightDestOnMap: any;
declare var highlightSightOnMap: any;
declare var initMainMap: any;
declare var loadTripsIndex: any;
declare var localLoad: any;
declare var makeMapIcon: any;
declare var makePopup: any;
declare var movingId: any;
declare var openMap: any;
declare var openTripFile: any;
declare var orderKeptCandidates: any;
declare var parseStartDateFromBrief: any;
declare var removeDayTripFromDayItem: any;
declare var renderTripStep1Place: any;
declare var runPickerDayTripDiscovery: any;
declare var runPickerWaysideDiscovery: any;
declare var setLeftMode: any;
declare var setTripBudgetDuration: any;
declare var showAIDisclaimer: any;
declare var showActionLog: any;
declare var showKeepToast: any;
declare var toggleDayDropdown: any;
declare var transitRationale: any;
declare var ungroupDayTrip: any;
declare var updateIndexEntry: any;
declare var updateMainMap: any;

// Batch 3: globals owned by deferred modules, referenced by typed ones.

// Batch 4: more UI/glue + booking-form globals.
declare var _ceMap: any;

// DOM element lookups return any (we type the data model, not DOM element types).
interface Document {
  getElementById(elementId: string): any;
  querySelector(selectors: string): any;
}

// Batch 5: remaining UI/glue globals.

// DOM is checked permissively — we type the data model, not DOM node shapes.
// Arbitrary property access on Element/Node/EventTarget resolves to any so the
// type-net focuses on app data flow, not on per-site DOM element casts.
interface Element { [key: string]: any; }
interface Node { [key: string]: any; }
interface EventTarget { [key: string]: any; }
interface HTMLElement { [key: string]: any; }
interface GlobalEventHandlers { [key: string]: any; }
