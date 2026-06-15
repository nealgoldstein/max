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
declare function autoSave(): void;
declare function _upsertTripIndexEntry(entry: any): any;
declare var _coarseGeocode: any;
declare var _generatedCityData: any;
declare var _mdcItems: any;
declare var _parseTripDuration: any;
declare var parseNightsFromRange: any;
declare var haversineKm: any;
declare var findAttachedEvents: any;
declare var newActionId: any;
declare var updateTrackerBadge: any;

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
