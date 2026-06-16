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
declare var _generatedCityData: any;
declare var _mdcItems: any;
declare var parseNightsFromRange: any;
declare var haversineKm: any;

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
declare var _escHtml: any;
declare var _fileHandle: any;
declare var _mergeAdjacentSamePlaceDests: any;
declare var _reconcileDestinations: any;
declare var _refreshUserListedFromRecords: any;
declare var activeDest: any;
declare var addPendingAction: any;
declare var getCityCenter: any;
declare var makeDays: any;

// ── Batch 2: UI/glue cross-module globals (auto-collected) ──
declare var L: any;
declare var MaxBuild: any;
declare var MaxEngineClassify: any;
declare var MaxGeo: any;
declare var MaxIngestion: any;
declare var MaxMapPin: any;
declare var MaxTripUI: any;
declare var Pikaday: any;
declare var _findMatchingRequired: any;
declare var _fqFastestPractical: any;
declare var _fqGetTransitInfo: any;
declare var _fqHaversineKm: any;
declare var _fqInflight: any;
declare var _fqPairKey: any;
declare var _fqPairMemo: any;
declare var _ftFormatHours: any;
declare var _ftParseHoursInput: any;
declare var _fuCoordSane: any;
declare var _mainMap: any;
declare var _makeCandidateIcon: any;
declare var _mapExecMode: any;
declare var _maxBuildBannerSet: any;
declare var _offEnhDone: any;
declare var _offEnhStart: any;
declare var _offError: any;
declare var _reEvaluateOverBudget: any;
declare var _renderEntryPointsOnCeMap: any;
declare var _roleInfo: any;
declare var _saveTimer: any;
declare var _titleCaseCity: any;
declare var _undoTimer: any;
declare var clockMinutesBetween: any;
declare var computePendingActions: any;
declare var currentDayItems: any;
declare var currentTripStatus: any;
declare var dayRationale: any;
declare var movingId: any;
declare var orderKeptCandidates: any;
declare var parseStartDateFromBrief: any;
declare var runPickerDayTripDiscovery: any;
declare var runPickerWaysideDiscovery: any;
declare var transitRationale: any;

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

// app-main.js cross-module surface: globals it references that live in other
// modules / the remaining small inline blocks (declared ambient any).
declare var MaxPlaceSet: any;
declare var PlaceRepository: any;
declare var SectionKind: any;
declare var _PA_BUF: any;
declare var _addAirportsToCeMap: any;
declare var _isSingleSight: any;
declare var _maxBuildBannerRecontext: any;
declare var _paintMapMenuTrigger: any;
declare var _renderPickerCategoryNav: any;
declare var _serializeTbForPrompt: any;
declare var bindCrossLink: any;
declare var buildDayTripNote: any;
declare var extendDays: any;
declare var isSingleSight: any;
declare var showToast: any;
interface Event { [key: string]: any; }
interface Navigator { [key: string]: any; }
interface Function { [key: string]: any; }

// ESM-conversion cross-module surface: globals DEFINED in converted .mjs modules
// (now module-scoped to TS) but referenced by still-classic modules. Ambient any
// until those references migrate to imports (the rewiring phase). Runtime is
// unaffected — the .mjs modules still set these on globalThis.
declare var _EP_MODE_LABEL: any;
declare var _EP_TYPE_TO_MODE: any;
declare var _apiKey: any;
declare var _briefPersonalContext: any;
declare var _destNotes: any;
declare var _destStories: any;
declare var _edMap: any;
declare var _edMarkers: any;
declare var _ensureEntryPointsForRegion: any;
declare var _epCache: any;
declare var _epIconFor: any;
declare var _epLoading: any;
declare var _escapeHtml: any;
declare var _ffHistories: any;
declare var _fqBannerInnerHtml: any;
declare var _ftGetThresholdHours: any;
declare var _ftPeerDayTripCandidates: any;
declare var _ftRecomputeTripDates: any;
declare var _ftReverseNightTransfer: any;
declare var _ftSchedulePeerDayTrip: any;
declare var _isWellFormedApiKey: any;
declare var _phaseChipsHtml: any;
declare var _pmDocAdd: any;
declare var _pmDocLinkNavigate: any;
declare var _pmDocLinkPickerClose: any;
declare var _pmDocLinkPickerShow: any;
declare var _pmDocOpen: any;
declare var _pmDocRemove: any;
declare var _pmDocsBindDnd: any;
declare var _pmDocsClearActive: any;
declare var _pmDocsEnsure: any;
declare var _pmDocsReadFromDom: any;
declare var _pmDocsRefreshActive: any;
declare var _pmDocsRender: any;
declare var _pmDocsSetActive: any;
declare var _pmDocsSyncToNotes: any;
declare var _pmEnsureCandidate: any;
declare var _pmFmtAbsolute: any;
declare var _pmFmtRelative: any;
declare var _pmMaybeRenderSharedDiscovery: any;
declare var _pmMaybeStartClipFlow: any;
declare var _pmOpenDocEditor: any;
declare var _pmRtCmd: any;
declare var _pmRtFieldHtml: any;
declare var _pmRtInitContent: any;
declare var _pmRtSetup: any;
declare var _pmShareDiscovery: any;
declare var _pmShowClipperSetup: any;
declare var _pmShowUndo: any;
declare var _pmSurgicalKeepUpdate: any;
declare var _pmUnRejectFromList: any;
declare var _renderTripDetailsStrip: any;
declare var _sightStories: any;
declare var _tbAvoidFieldHtml: any;
declare var _tbAvoidSummary: any;
declare var _tbCaptureAvoid: any;
declare var _tbCaptureDates: any;
declare var _tbDatesFieldHtml: any;
declare var _tbPartySummary: any;
declare var _tbSectionHead: any;
declare var _tbSetupShapeBadges: any;
declare var _tbTransportModes: any;
declare var duplicateTrip: any;
declare var enterApp: any;
declare var fetchRegionEntryPoints: any;
declare var getAllSights: any;
declare var getTodayIds: any;
declare var goToTripStep2: any;
declare var hideNewTripForm: any;
declare var loadApiKey: any;
declare var mkExSight: any;
declare var rIcon: any;
declare var renderCandidateCards: any;
declare var renderTripBrief: any;
declare var renderTripStep1: any;
declare var saveApiKey: any;
declare var selectTrip: any;
declare var setCS: any;
declare var showApiKeyForm: any;
declare var showTripBrief: any;
