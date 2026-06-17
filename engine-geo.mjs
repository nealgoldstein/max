// @ts-check
// engine-geo.js — country reference data + lookup helpers.
//
// Round PD.95: Option C from the country-list discussion. A small,
// self-contained geography module: ISO 3166-1 countries, UN M49
// subregions, common alternate spellings, capitals, currencies,
// primary languages, drives-on side, and approximate centroids.
//
// Use cases this seam unlocks (each is implemented incrementally
// in the main script as needed):
//   • Strip country suffixes from place names without an inline regex
//   • Validate paste-list scope against the trip's region
//   • Detect a trip's primary country from a paste-list when the user
//     didn't name it explicitly
//   • Group destinations by subregion in multi-country trips
//   • Feed scope hints into LLM prompts (capital, currency, language,
//     subregion neighbors)
//   • Fit map bounds to a country centroid for first-load zoom
//   • Surface drives-on warning + currency-aware totals on the trip view
//
// Surface:
//   MaxGeo.byName(s)          → entry or null
//   MaxGeo.isCountry(s)       → boolean (works on names + altNames)
//   MaxGeo.byIso(code)        → entry or null
//   MaxGeo.subregion(name)    → "Northern Europe" or null
//   MaxGeo.countriesIn(sub)   → array of names
//   MaxGeo.neighbors(name)    → countries in the same subregion
//   MaxGeo.stripCountrySuffix(s) → "Selfoss, Iceland" → "Selfoss"
//   MaxGeo.detectCountry(text) → most-mentioned country in a string
//   MaxGeo.all()              → all entries

const global = /** @type {any} */ (globalThis);
  'use strict';

  // Field key (kept short to make the data block readable):
  //   n  name                       c   capital
  //   a  altNames                   cu  currency (ISO 4217)
  //   r  subregion (UN M49)         l   primary language (ISO 639-1)
  //   ct continent                  d   drivesOn ("L" or "R")
  //   p  approximate centroid [lng, lat]
  var DATA = [
    // ─── Northern Europe ─────────────────────────────────────────
    { iso2:"IS", n:"Iceland",        a:["Ísland","Republic of Iceland"], r:"Northern Europe", ct:"Europe", c:"Reykjavík",   cu:"ISK", l:"is", d:"R", p:[-19.02,64.96] },
    { iso2:"NO", n:"Norway",         a:["Norge","Kingdom of Norway"],     r:"Northern Europe", ct:"Europe", c:"Oslo",        cu:"NOK", l:"no", d:"R", p:[8.47,60.47] },
    { iso2:"SE", n:"Sweden",         a:["Sverige","Kingdom of Sweden"],   r:"Northern Europe", ct:"Europe", c:"Stockholm",   cu:"SEK", l:"sv", d:"R", p:[18.64,60.13] },
    { iso2:"DK", n:"Denmark",        a:["Danmark"],                       r:"Northern Europe", ct:"Europe", c:"Copenhagen",  cu:"DKK", l:"da", d:"R", p:[9.50,56.26] },
    { iso2:"FI", n:"Finland",        a:["Suomi"],                         r:"Northern Europe", ct:"Europe", c:"Helsinki",    cu:"EUR", l:"fi", d:"R", p:[25.75,61.92] },
    { iso2:"EE", n:"Estonia",        a:["Eesti"],                         r:"Northern Europe", ct:"Europe", c:"Tallinn",     cu:"EUR", l:"et", d:"R", p:[25.01,58.60] },
    { iso2:"LV", n:"Latvia",         a:["Latvija"],                       r:"Northern Europe", ct:"Europe", c:"Riga",        cu:"EUR", l:"lv", d:"R", p:[24.60,56.88] },
    { iso2:"LT", n:"Lithuania",      a:["Lietuva"],                       r:"Northern Europe", ct:"Europe", c:"Vilnius",     cu:"EUR", l:"lt", d:"R", p:[23.88,55.17] },
    { iso2:"IE", n:"Ireland",        a:["Éire","Republic of Ireland"],    r:"Northern Europe", ct:"Europe", c:"Dublin",      cu:"EUR", l:"en", d:"L", p:[-8.24,53.41] },
    { iso2:"GB", n:"United Kingdom", a:["UK","Britain","Great Britain","England","Scotland","Wales","Northern Ireland"], r:"Northern Europe", ct:"Europe", c:"London", cu:"GBP", l:"en", d:"L", p:[-3.44,55.38] },
    { iso2:"FO", n:"Faroe Islands",  a:["Føroyar"],                       r:"Northern Europe", ct:"Europe", c:"Tórshavn",    cu:"DKK", l:"fo", d:"R", p:[-6.91,61.89] },
    // ─── Western Europe ─────────────────────────────────────────
    { iso2:"FR", n:"France",         a:["French Republic","République française"], r:"Western Europe", ct:"Europe", c:"Paris", cu:"EUR", l:"fr", d:"R", p:[2.21,46.23] },
    { iso2:"DE", n:"Germany",        a:["Deutschland","Federal Republic of Germany"], r:"Western Europe", ct:"Europe", c:"Berlin", cu:"EUR", l:"de", d:"R", p:[10.45,51.17] },
    { iso2:"BE", n:"Belgium",        a:["België","Belgique"],             r:"Western Europe", ct:"Europe", c:"Brussels",    cu:"EUR", l:"nl", d:"R", p:[4.66,50.50] },
    { iso2:"NL", n:"Netherlands",    a:["Holland","Nederland"],           r:"Western Europe", ct:"Europe", c:"Amsterdam",   cu:"EUR", l:"nl", d:"R", p:[5.29,52.13] },
    { iso2:"LU", n:"Luxembourg",     a:["Lëtzebuerg"],                    r:"Western Europe", ct:"Europe", c:"Luxembourg",  cu:"EUR", l:"lb", d:"R", p:[6.13,49.82] },
    { iso2:"AT", n:"Austria",        a:["Österreich"],                    r:"Western Europe", ct:"Europe", c:"Vienna",      cu:"EUR", l:"de", d:"R", p:[14.55,47.52] },
    { iso2:"CH", n:"Switzerland",    a:["Schweiz","Suisse","Svizzera","Helvetia"], r:"Western Europe", ct:"Europe", c:"Bern", cu:"CHF", l:"de", d:"R", p:[8.23,46.82] },
    { iso2:"LI", n:"Liechtenstein",  a:[],                                r:"Western Europe", ct:"Europe", c:"Vaduz",       cu:"CHF", l:"de", d:"R", p:[9.55,47.17] },
    { iso2:"MC", n:"Monaco",         a:[],                                r:"Western Europe", ct:"Europe", c:"Monaco",      cu:"EUR", l:"fr", d:"R", p:[7.42,43.74] },
    // ─── Southern Europe ────────────────────────────────────────
    { iso2:"IT", n:"Italy",          a:["Italia","Italian Republic"],     r:"Southern Europe", ct:"Europe", c:"Rome",        cu:"EUR", l:"it", d:"R", p:[12.57,41.87] },
    { iso2:"ES", n:"Spain",          a:["España","Kingdom of Spain"],     r:"Southern Europe", ct:"Europe", c:"Madrid",      cu:"EUR", l:"es", d:"R", p:[-3.75,40.46] },
    { iso2:"PT", n:"Portugal",       a:["Portuguese Republic"],           r:"Southern Europe", ct:"Europe", c:"Lisbon",      cu:"EUR", l:"pt", d:"R", p:[-8.22,39.40] },
    { iso2:"GR", n:"Greece",         a:["Hellas","Ελλάδα","Hellenic Republic"], r:"Southern Europe", ct:"Europe", c:"Athens", cu:"EUR", l:"el", d:"R", p:[21.82,39.07] },
    { iso2:"MT", n:"Malta",          a:[],                                r:"Southern Europe", ct:"Europe", c:"Valletta",    cu:"EUR", l:"mt", d:"L", p:[14.38,35.94] },
    { iso2:"CY", n:"Cyprus",         a:["Κύπρος"],                        r:"Southern Europe", ct:"Asia",   c:"Nicosia",     cu:"EUR", l:"el", d:"L", p:[33.43,35.13] },
    { iso2:"AD", n:"Andorra",        a:[],                                r:"Southern Europe", ct:"Europe", c:"Andorra la Vella", cu:"EUR", l:"ca", d:"R", p:[1.60,42.55] },
    { iso2:"SM", n:"San Marino",     a:[],                                r:"Southern Europe", ct:"Europe", c:"San Marino",  cu:"EUR", l:"it", d:"R", p:[12.46,43.94] },
    { iso2:"VA", n:"Vatican City",   a:["Holy See","Vatican"],            r:"Southern Europe", ct:"Europe", c:"Vatican City",cu:"EUR", l:"it", d:"R", p:[12.45,41.90] },
    { iso2:"HR", n:"Croatia",        a:["Hrvatska"],                      r:"Southern Europe", ct:"Europe", c:"Zagreb",      cu:"EUR", l:"hr", d:"R", p:[15.20,45.10] },
    { iso2:"SI", n:"Slovenia",       a:["Slovenija"],                     r:"Southern Europe", ct:"Europe", c:"Ljubljana",   cu:"EUR", l:"sl", d:"R", p:[14.99,46.15] },
    { iso2:"BA", n:"Bosnia and Herzegovina", a:["Bosnia","BiH"],          r:"Southern Europe", ct:"Europe", c:"Sarajevo",    cu:"BAM", l:"bs", d:"R", p:[17.68,43.92] },
    { iso2:"RS", n:"Serbia",         a:["Srbija"],                        r:"Southern Europe", ct:"Europe", c:"Belgrade",    cu:"RSD", l:"sr", d:"R", p:[20.91,44.02] },
    { iso2:"ME", n:"Montenegro",     a:["Crna Gora"],                     r:"Southern Europe", ct:"Europe", c:"Podgorica",   cu:"EUR", l:"sr", d:"R", p:[19.37,42.71] },
    { iso2:"MK", n:"North Macedonia",a:["Macedonia","Северна Македонија"],r:"Southern Europe", ct:"Europe", c:"Skopje",      cu:"MKD", l:"mk", d:"R", p:[21.75,41.61] },
    { iso2:"AL", n:"Albania",        a:["Shqipëria"],                     r:"Southern Europe", ct:"Europe", c:"Tirana",      cu:"ALL", l:"sq", d:"R", p:[20.05,41.15] },
    { iso2:"XK", n:"Kosovo",         a:["Kosova"],                        r:"Southern Europe", ct:"Europe", c:"Pristina",    cu:"EUR", l:"sq", d:"R", p:[20.90,42.60] },
    // ─── Eastern Europe ─────────────────────────────────────────
    { iso2:"PL", n:"Poland",         a:["Polska"],                        r:"Eastern Europe", ct:"Europe", c:"Warsaw",      cu:"PLN", l:"pl", d:"R", p:[19.13,51.92] },
    { iso2:"CZ", n:"Czech Republic", a:["Czechia","Česko"],               r:"Eastern Europe", ct:"Europe", c:"Prague",      cu:"CZK", l:"cs", d:"R", p:[15.47,49.82] },
    { iso2:"SK", n:"Slovakia",       a:["Slovensko"],                     r:"Eastern Europe", ct:"Europe", c:"Bratislava",  cu:"EUR", l:"sk", d:"R", p:[19.70,48.67] },
    { iso2:"HU", n:"Hungary",        a:["Magyarország"],                  r:"Eastern Europe", ct:"Europe", c:"Budapest",    cu:"HUF", l:"hu", d:"R", p:[19.50,47.16] },
    { iso2:"RO", n:"Romania",        a:["România"],                       r:"Eastern Europe", ct:"Europe", c:"Bucharest",   cu:"RON", l:"ro", d:"R", p:[24.97,45.94] },
    { iso2:"BG", n:"Bulgaria",       a:["България"],                      r:"Eastern Europe", ct:"Europe", c:"Sofia",       cu:"BGN", l:"bg", d:"R", p:[25.49,42.73] },
    { iso2:"MD", n:"Moldova",        a:["Republic of Moldova"],           r:"Eastern Europe", ct:"Europe", c:"Chișinău",    cu:"MDL", l:"ro", d:"R", p:[28.37,47.41] },
    { iso2:"UA", n:"Ukraine",        a:["Україна"],                       r:"Eastern Europe", ct:"Europe", c:"Kyiv",        cu:"UAH", l:"uk", d:"R", p:[31.17,48.38] },
    { iso2:"BY", n:"Belarus",        a:["Беларусь"],                      r:"Eastern Europe", ct:"Europe", c:"Minsk",       cu:"BYN", l:"be", d:"R", p:[27.95,53.71] },
    { iso2:"RU", n:"Russia",         a:["Russian Federation","Россия"],   r:"Eastern Europe", ct:"Europe", c:"Moscow",      cu:"RUB", l:"ru", d:"R", p:[105.32,61.52] },
    // ─── Northern America ───────────────────────────────────────
    { iso2:"US", n:"United States",  a:["USA","US","United States of America","America"], r:"Northern America", ct:"North America", c:"Washington, D.C.", cu:"USD", l:"en", d:"R", p:[-95.71,37.09] },
    { iso2:"CA", n:"Canada",         a:[],                                r:"Northern America", ct:"North America", c:"Ottawa",      cu:"CAD", l:"en", d:"R", p:[-106.35,56.13] },
    { iso2:"BM", n:"Bermuda",        a:[],                                r:"Northern America", ct:"North America", c:"Hamilton",    cu:"BMD", l:"en", d:"L", p:[-64.75,32.32] },
    { iso2:"GL", n:"Greenland",      a:["Kalaallit Nunaat"],              r:"Northern America", ct:"North America", c:"Nuuk",        cu:"DKK", l:"kl", d:"R", p:[-42.60,71.71] },
    // ─── Central America ────────────────────────────────────────
    { iso2:"MX", n:"Mexico",         a:["México","United Mexican States"],r:"Central America", ct:"North America", c:"Mexico City", cu:"MXN", l:"es", d:"R", p:[-102.55,23.63] },
    { iso2:"GT", n:"Guatemala",      a:[],                                r:"Central America", ct:"North America", c:"Guatemala City", cu:"GTQ", l:"es", d:"R", p:[-90.23,15.78] },
    { iso2:"BZ", n:"Belize",         a:[],                                r:"Central America", ct:"North America", c:"Belmopan",    cu:"BZD", l:"en", d:"R", p:[-88.50,17.19] },
    { iso2:"HN", n:"Honduras",       a:[],                                r:"Central America", ct:"North America", c:"Tegucigalpa", cu:"HNL", l:"es", d:"R", p:[-86.24,15.20] },
    { iso2:"SV", n:"El Salvador",    a:[],                                r:"Central America", ct:"North America", c:"San Salvador",cu:"USD", l:"es", d:"R", p:[-88.90,13.79] },
    { iso2:"NI", n:"Nicaragua",      a:[],                                r:"Central America", ct:"North America", c:"Managua",     cu:"NIO", l:"es", d:"R", p:[-85.21,12.87] },
    { iso2:"CR", n:"Costa Rica",     a:[],                                r:"Central America", ct:"North America", c:"San José",    cu:"CRC", l:"es", d:"R", p:[-83.75,9.75] },
    { iso2:"PA", n:"Panama",         a:["Panamá"],                        r:"Central America", ct:"North America", c:"Panama City", cu:"PAB", l:"es", d:"R", p:[-80.12,8.54] },
    // ─── Caribbean ──────────────────────────────────────────────
    { iso2:"CU", n:"Cuba",           a:[],                                r:"Caribbean", ct:"North America", c:"Havana",      cu:"CUP", l:"es", d:"R", p:[-77.78,21.52] },
    { iso2:"DO", n:"Dominican Republic", a:[],                            r:"Caribbean", ct:"North America", c:"Santo Domingo", cu:"DOP", l:"es", d:"R", p:[-70.50,18.74] },
    { iso2:"HT", n:"Haiti",          a:["Haïti"],                         r:"Caribbean", ct:"North America", c:"Port-au-Prince", cu:"HTG", l:"fr", d:"R", p:[-72.29,18.97] },
    { iso2:"JM", n:"Jamaica",        a:[],                                r:"Caribbean", ct:"North America", c:"Kingston",    cu:"JMD", l:"en", d:"L", p:[-77.30,18.11] },
    { iso2:"TT", n:"Trinidad and Tobago", a:["Trinidad"],                 r:"Caribbean", ct:"North America", c:"Port of Spain", cu:"TTD", l:"en", d:"L", p:[-61.22,10.69] },
    { iso2:"BB", n:"Barbados",       a:[],                                r:"Caribbean", ct:"North America", c:"Bridgetown",  cu:"BBD", l:"en", d:"L", p:[-59.54,13.19] },
    { iso2:"BS", n:"Bahamas",        a:["The Bahamas"],                   r:"Caribbean", ct:"North America", c:"Nassau",      cu:"BSD", l:"en", d:"L", p:[-77.40,25.03] },
    { iso2:"PR", n:"Puerto Rico",    a:[],                                r:"Caribbean", ct:"North America", c:"San Juan",    cu:"USD", l:"es", d:"R", p:[-66.59,18.22] },
    { iso2:"AW", n:"Aruba",          a:[],                                r:"Caribbean", ct:"North America", c:"Oranjestad",  cu:"AWG", l:"nl", d:"R", p:[-69.97,12.52] },
    { iso2:"CW", n:"Curaçao",        a:["Curacao"],                       r:"Caribbean", ct:"North America", c:"Willemstad",  cu:"ANG", l:"nl", d:"R", p:[-69.06,12.17] },
    { iso2:"AG", n:"Antigua and Barbuda", a:["Antigua"],                  r:"Caribbean", ct:"North America", c:"Saint John's",cu:"XCD", l:"en", d:"L", p:[-61.80,17.06] },
    { iso2:"DM", n:"Dominica",       a:[],                                r:"Caribbean", ct:"North America", c:"Roseau",      cu:"XCD", l:"en", d:"L", p:[-61.37,15.41] },
    { iso2:"GD", n:"Grenada",        a:[],                                r:"Caribbean", ct:"North America", c:"Saint George's", cu:"XCD", l:"en", d:"L", p:[-61.68,12.12] },
    { iso2:"KN", n:"Saint Kitts and Nevis", a:["Saint Kitts"],            r:"Caribbean", ct:"North America", c:"Basseterre",  cu:"XCD", l:"en", d:"L", p:[-62.78,17.36] },
    { iso2:"LC", n:"Saint Lucia",    a:[],                                r:"Caribbean", ct:"North America", c:"Castries",    cu:"XCD", l:"en", d:"L", p:[-60.98,13.91] },
    { iso2:"VC", n:"Saint Vincent and the Grenadines", a:["Saint Vincent"], r:"Caribbean", ct:"North America", c:"Kingstown", cu:"XCD", l:"en", d:"L", p:[-61.29,12.98] },
    // ─── South America ──────────────────────────────────────────
    { iso2:"BR", n:"Brazil",         a:["Brasil"],                        r:"South America", ct:"South America", c:"Brasília",    cu:"BRL", l:"pt", d:"R", p:[-51.93,-14.24] },
    { iso2:"AR", n:"Argentina",      a:[],                                r:"South America", ct:"South America", c:"Buenos Aires", cu:"ARS", l:"es", d:"R", p:[-63.62,-38.42] },
    { iso2:"CL", n:"Chile",          a:[],                                r:"South America", ct:"South America", c:"Santiago",    cu:"CLP", l:"es", d:"R", p:[-71.54,-35.68] },
    { iso2:"PE", n:"Peru",           a:["Perú"],                          r:"South America", ct:"South America", c:"Lima",        cu:"PEN", l:"es", d:"R", p:[-75.02,-9.19] },
    { iso2:"CO", n:"Colombia",       a:[],                                r:"South America", ct:"South America", c:"Bogotá",      cu:"COP", l:"es", d:"R", p:[-74.30,4.57] },
    { iso2:"VE", n:"Venezuela",      a:[],                                r:"South America", ct:"South America", c:"Caracas",     cu:"VES", l:"es", d:"R", p:[-66.59,6.42] },
    { iso2:"EC", n:"Ecuador",        a:[],                                r:"South America", ct:"South America", c:"Quito",       cu:"USD", l:"es", d:"R", p:[-78.18,-1.83] },
    { iso2:"BO", n:"Bolivia",        a:[],                                r:"South America", ct:"South America", c:"Sucre",       cu:"BOB", l:"es", d:"R", p:[-63.59,-16.29] },
    { iso2:"PY", n:"Paraguay",       a:[],                                r:"South America", ct:"South America", c:"Asunción",    cu:"PYG", l:"es", d:"R", p:[-58.44,-23.44] },
    { iso2:"UY", n:"Uruguay",        a:[],                                r:"South America", ct:"South America", c:"Montevideo",  cu:"UYU", l:"es", d:"R", p:[-55.77,-32.52] },
    { iso2:"GY", n:"Guyana",         a:[],                                r:"South America", ct:"South America", c:"Georgetown",  cu:"GYD", l:"en", d:"L", p:[-58.93,4.86] },
    { iso2:"SR", n:"Suriname",       a:[],                                r:"South America", ct:"South America", c:"Paramaribo",  cu:"SRD", l:"nl", d:"L", p:[-56.03,3.92] },
    { iso2:"GF", n:"French Guiana",  a:["Guyane"],                        r:"South America", ct:"South America", c:"Cayenne",     cu:"EUR", l:"fr", d:"R", p:[-53.13,3.93] },
    // ─── Northern Africa ────────────────────────────────────────
    { iso2:"EG", n:"Egypt",          a:["مصر"],                           r:"Northern Africa", ct:"Africa", c:"Cairo",       cu:"EGP", l:"ar", d:"R", p:[30.80,26.82] },
    { iso2:"LY", n:"Libya",          a:[],                                r:"Northern Africa", ct:"Africa", c:"Tripoli",     cu:"LYD", l:"ar", d:"R", p:[17.23,26.34] },
    { iso2:"TN", n:"Tunisia",        a:[],                                r:"Northern Africa", ct:"Africa", c:"Tunis",       cu:"TND", l:"ar", d:"R", p:[9.54,33.89] },
    { iso2:"DZ", n:"Algeria",        a:[],                                r:"Northern Africa", ct:"Africa", c:"Algiers",     cu:"DZD", l:"ar", d:"R", p:[1.66,28.03] },
    { iso2:"MA", n:"Morocco",        a:["Maroc","المغرب"],                r:"Northern Africa", ct:"Africa", c:"Rabat",       cu:"MAD", l:"ar", d:"R", p:[-7.09,31.79] },
    { iso2:"SD", n:"Sudan",          a:[],                                r:"Northern Africa", ct:"Africa", c:"Khartoum",    cu:"SDG", l:"ar", d:"R", p:[30.22,12.86] },
    { iso2:"EH", n:"Western Sahara", a:[],                                r:"Northern Africa", ct:"Africa", c:"El Aaiún",    cu:"MAD", l:"ar", d:"R", p:[-12.89,24.22] },
    // ─── Western Africa ─────────────────────────────────────────
    { iso2:"NG", n:"Nigeria",        a:[],                                r:"Western Africa", ct:"Africa", c:"Abuja",       cu:"NGN", l:"en", d:"R", p:[8.68,9.08] },
    { iso2:"GH", n:"Ghana",          a:[],                                r:"Western Africa", ct:"Africa", c:"Accra",       cu:"GHS", l:"en", d:"R", p:[-1.02,7.95] },
    { iso2:"SN", n:"Senegal",        a:[],                                r:"Western Africa", ct:"Africa", c:"Dakar",       cu:"XOF", l:"fr", d:"R", p:[-14.45,14.50] },
    { iso2:"ML", n:"Mali",           a:[],                                r:"Western Africa", ct:"Africa", c:"Bamako",      cu:"XOF", l:"fr", d:"R", p:[-3.96,17.57] },
    { iso2:"BF", n:"Burkina Faso",   a:[],                                r:"Western Africa", ct:"Africa", c:"Ouagadougou", cu:"XOF", l:"fr", d:"R", p:[-1.56,12.24] },
    { iso2:"NE", n:"Niger",          a:[],                                r:"Western Africa", ct:"Africa", c:"Niamey",      cu:"XOF", l:"fr", d:"R", p:[8.08,17.61] },
    { iso2:"CI", n:"Côte d'Ivoire",  a:["Ivory Coast"],                   r:"Western Africa", ct:"Africa", c:"Yamoussoukro",cu:"XOF", l:"fr", d:"R", p:[-5.55,7.54] },
    { iso2:"GN", n:"Guinea",         a:[],                                r:"Western Africa", ct:"Africa", c:"Conakry",     cu:"GNF", l:"fr", d:"R", p:[-9.70,9.95] },
    { iso2:"SL", n:"Sierra Leone",   a:[],                                r:"Western Africa", ct:"Africa", c:"Freetown",    cu:"SLL", l:"en", d:"R", p:[-11.78,8.46] },
    { iso2:"LR", n:"Liberia",        a:[],                                r:"Western Africa", ct:"Africa", c:"Monrovia",    cu:"LRD", l:"en", d:"R", p:[-9.43,6.43] },
    { iso2:"TG", n:"Togo",           a:[],                                r:"Western Africa", ct:"Africa", c:"Lomé",        cu:"XOF", l:"fr", d:"R", p:[0.82,8.62] },
    { iso2:"BJ", n:"Benin",          a:[],                                r:"Western Africa", ct:"Africa", c:"Porto-Novo",  cu:"XOF", l:"fr", d:"R", p:[2.32,9.31] },
    { iso2:"MR", n:"Mauritania",     a:[],                                r:"Western Africa", ct:"Africa", c:"Nouakchott",  cu:"MRU", l:"ar", d:"R", p:[-10.94,21.01] },
    { iso2:"CV", n:"Cape Verde",     a:["Cabo Verde"],                    r:"Western Africa", ct:"Africa", c:"Praia",       cu:"CVE", l:"pt", d:"R", p:[-23.51,15.12] },
    { iso2:"GM", n:"Gambia",         a:["The Gambia"],                    r:"Western Africa", ct:"Africa", c:"Banjul",      cu:"GMD", l:"en", d:"R", p:[-15.31,13.44] },
    { iso2:"GW", n:"Guinea-Bissau",  a:[],                                r:"Western Africa", ct:"Africa", c:"Bissau",      cu:"XOF", l:"pt", d:"R", p:[-15.18,11.80] },
    // ─── Middle Africa ──────────────────────────────────────────
    { iso2:"CM", n:"Cameroon",       a:[],                                r:"Middle Africa", ct:"Africa", c:"Yaoundé",     cu:"XAF", l:"fr", d:"R", p:[12.35,7.37] },
    { iso2:"TD", n:"Chad",           a:["Tchad"],                         r:"Middle Africa", ct:"Africa", c:"N'Djamena",   cu:"XAF", l:"fr", d:"R", p:[18.73,15.45] },
    { iso2:"CF", n:"Central African Republic", a:["CAR"],                 r:"Middle Africa", ct:"Africa", c:"Bangui",      cu:"XAF", l:"fr", d:"R", p:[20.94,6.61] },
    { iso2:"CD", n:"Democratic Republic of the Congo", a:["DR Congo","DRC","Congo-Kinshasa"], r:"Middle Africa", ct:"Africa", c:"Kinshasa", cu:"CDF", l:"fr", d:"R", p:[21.76,-4.04] },
    { iso2:"CG", n:"Republic of the Congo", a:["Congo","Congo-Brazzaville"], r:"Middle Africa", ct:"Africa", c:"Brazzaville", cu:"XAF", l:"fr", d:"R", p:[15.83,-0.23] },
    { iso2:"GA", n:"Gabon",          a:[],                                r:"Middle Africa", ct:"Africa", c:"Libreville",  cu:"XAF", l:"fr", d:"R", p:[11.61,-0.80] },
    { iso2:"GQ", n:"Equatorial Guinea", a:[],                             r:"Middle Africa", ct:"Africa", c:"Malabo",      cu:"XAF", l:"es", d:"R", p:[10.27,1.65] },
    { iso2:"AO", n:"Angola",         a:[],                                r:"Middle Africa", ct:"Africa", c:"Luanda",      cu:"AOA", l:"pt", d:"R", p:[17.87,-11.20] },
    { iso2:"ST", n:"São Tomé and Príncipe", a:["Sao Tome"],               r:"Middle Africa", ct:"Africa", c:"São Tomé",    cu:"STN", l:"pt", d:"R", p:[6.61,0.19] },
    // ─── Eastern Africa ─────────────────────────────────────────
    { iso2:"ET", n:"Ethiopia",       a:[],                                r:"Eastern Africa", ct:"Africa", c:"Addis Ababa", cu:"ETB", l:"am", d:"R", p:[40.49,9.15] },
    { iso2:"KE", n:"Kenya",          a:[],                                r:"Eastern Africa", ct:"Africa", c:"Nairobi",     cu:"KES", l:"sw", d:"L", p:[37.91,-0.02] },
    { iso2:"TZ", n:"Tanzania",       a:[],                                r:"Eastern Africa", ct:"Africa", c:"Dodoma",      cu:"TZS", l:"sw", d:"L", p:[34.89,-6.37] },
    { iso2:"UG", n:"Uganda",         a:[],                                r:"Eastern Africa", ct:"Africa", c:"Kampala",     cu:"UGX", l:"en", d:"L", p:[32.29,1.37] },
    { iso2:"RW", n:"Rwanda",         a:[],                                r:"Eastern Africa", ct:"Africa", c:"Kigali",      cu:"RWF", l:"rw", d:"R", p:[29.87,-1.94] },
    { iso2:"BI", n:"Burundi",        a:[],                                r:"Eastern Africa", ct:"Africa", c:"Gitega",      cu:"BIF", l:"rn", d:"R", p:[29.92,-3.37] },
    { iso2:"SS", n:"South Sudan",    a:[],                                r:"Eastern Africa", ct:"Africa", c:"Juba",        cu:"SSP", l:"en", d:"R", p:[31.31,6.88] },
    { iso2:"SO", n:"Somalia",        a:[],                                r:"Eastern Africa", ct:"Africa", c:"Mogadishu",   cu:"SOS", l:"so", d:"R", p:[46.20,5.15] },
    { iso2:"DJ", n:"Djibouti",       a:[],                                r:"Eastern Africa", ct:"Africa", c:"Djibouti",    cu:"DJF", l:"fr", d:"R", p:[42.59,11.83] },
    { iso2:"ER", n:"Eritrea",        a:[],                                r:"Eastern Africa", ct:"Africa", c:"Asmara",      cu:"ERN", l:"ti", d:"R", p:[39.78,15.18] },
    { iso2:"MG", n:"Madagascar",     a:[],                                r:"Eastern Africa", ct:"Africa", c:"Antananarivo",cu:"MGA", l:"mg", d:"R", p:[46.87,-18.77] },
    { iso2:"MZ", n:"Mozambique",     a:["Moçambique"],                    r:"Eastern Africa", ct:"Africa", c:"Maputo",      cu:"MZN", l:"pt", d:"L", p:[35.53,-18.67] },
    { iso2:"MW", n:"Malawi",         a:[],                                r:"Eastern Africa", ct:"Africa", c:"Lilongwe",    cu:"MWK", l:"en", d:"L", p:[34.30,-13.25] },
    { iso2:"ZM", n:"Zambia",         a:[],                                r:"Eastern Africa", ct:"Africa", c:"Lusaka",      cu:"ZMW", l:"en", d:"L", p:[27.85,-13.13] },
    { iso2:"ZW", n:"Zimbabwe",       a:[],                                r:"Eastern Africa", ct:"Africa", c:"Harare",      cu:"ZWL", l:"en", d:"L", p:[29.15,-19.02] },
    { iso2:"KM", n:"Comoros",        a:[],                                r:"Eastern Africa", ct:"Africa", c:"Moroni",      cu:"KMF", l:"ar", d:"R", p:[43.87,-11.65] },
    { iso2:"MU", n:"Mauritius",      a:[],                                r:"Eastern Africa", ct:"Africa", c:"Port Louis",  cu:"MUR", l:"en", d:"L", p:[57.55,-20.35] },
    { iso2:"SC", n:"Seychelles",     a:[],                                r:"Eastern Africa", ct:"Africa", c:"Victoria",    cu:"SCR", l:"en", d:"L", p:[55.49,-4.68] },
    // ─── Southern Africa ────────────────────────────────────────
    { iso2:"ZA", n:"South Africa",   a:[],                                r:"Southern Africa", ct:"Africa", c:"Pretoria",    cu:"ZAR", l:"en", d:"L", p:[22.94,-30.56] },
    { iso2:"NA", n:"Namibia",        a:[],                                r:"Southern Africa", ct:"Africa", c:"Windhoek",    cu:"NAD", l:"en", d:"L", p:[18.49,-22.96] },
    { iso2:"BW", n:"Botswana",       a:[],                                r:"Southern Africa", ct:"Africa", c:"Gaborone",    cu:"BWP", l:"en", d:"L", p:[24.68,-22.33] },
    { iso2:"LS", n:"Lesotho",        a:[],                                r:"Southern Africa", ct:"Africa", c:"Maseru",      cu:"LSL", l:"en", d:"L", p:[28.23,-29.61] },
    { iso2:"SZ", n:"Eswatini",       a:["Swaziland"],                     r:"Southern Africa", ct:"Africa", c:"Mbabane",     cu:"SZL", l:"en", d:"L", p:[31.47,-26.52] },
    // ─── Western Asia / Middle East ─────────────────────────────
    { iso2:"SA", n:"Saudi Arabia",   a:["KSA","Kingdom of Saudi Arabia"], r:"Western Asia", ct:"Asia",   c:"Riyadh",      cu:"SAR", l:"ar", d:"R", p:[45.08,23.89] },
    { iso2:"AE", n:"United Arab Emirates", a:["UAE","Emirates"],          r:"Western Asia", ct:"Asia",   c:"Abu Dhabi",   cu:"AED", l:"ar", d:"R", p:[53.85,23.42] },
    { iso2:"QA", n:"Qatar",          a:[],                                r:"Western Asia", ct:"Asia",   c:"Doha",        cu:"QAR", l:"ar", d:"R", p:[51.18,25.35] },
    { iso2:"BH", n:"Bahrain",        a:[],                                r:"Western Asia", ct:"Asia",   c:"Manama",      cu:"BHD", l:"ar", d:"R", p:[50.55,25.93] },
    { iso2:"KW", n:"Kuwait",         a:[],                                r:"Western Asia", ct:"Asia",   c:"Kuwait City", cu:"KWD", l:"ar", d:"R", p:[47.48,29.31] },
    { iso2:"OM", n:"Oman",           a:[],                                r:"Western Asia", ct:"Asia",   c:"Muscat",      cu:"OMR", l:"ar", d:"R", p:[55.92,21.51] },
    { iso2:"YE", n:"Yemen",          a:[],                                r:"Western Asia", ct:"Asia",   c:"Sana'a",      cu:"YER", l:"ar", d:"R", p:[48.52,15.55] },
    { iso2:"IQ", n:"Iraq",           a:[],                                r:"Western Asia", ct:"Asia",   c:"Baghdad",     cu:"IQD", l:"ar", d:"R", p:[43.68,33.22] },
    { iso2:"IR", n:"Iran",           a:["Persia","Islamic Republic of Iran"], r:"Southern Asia", ct:"Asia", c:"Tehran",    cu:"IRR", l:"fa", d:"R", p:[53.69,32.43] },
    { iso2:"IL", n:"Israel",         a:[],                                r:"Western Asia", ct:"Asia",   c:"Jerusalem",   cu:"ILS", l:"he", d:"R", p:[34.85,31.05] },
    { iso2:"PS", n:"Palestine",      a:["Palestinian Territories"],       r:"Western Asia", ct:"Asia",   c:"Ramallah",    cu:"ILS", l:"ar", d:"R", p:[35.23,31.95] },
    { iso2:"JO", n:"Jordan",         a:[],                                r:"Western Asia", ct:"Asia",   c:"Amman",       cu:"JOD", l:"ar", d:"R", p:[36.24,30.59] },
    { iso2:"LB", n:"Lebanon",        a:[],                                r:"Western Asia", ct:"Asia",   c:"Beirut",      cu:"LBP", l:"ar", d:"R", p:[35.86,33.85] },
    { iso2:"SY", n:"Syria",          a:[],                                r:"Western Asia", ct:"Asia",   c:"Damascus",    cu:"SYP", l:"ar", d:"R", p:[38.99,34.80] },
    { iso2:"TR", n:"Turkey",         a:["Türkiye"],                       r:"Western Asia", ct:"Asia",   c:"Ankara",      cu:"TRY", l:"tr", d:"R", p:[35.24,38.96] },
    { iso2:"AM", n:"Armenia",        a:["Հայաստան"],                      r:"Western Asia", ct:"Asia",   c:"Yerevan",     cu:"AMD", l:"hy", d:"R", p:[45.04,40.07] },
    { iso2:"AZ", n:"Azerbaijan",     a:["Azərbaycan"],                    r:"Western Asia", ct:"Asia",   c:"Baku",        cu:"AZN", l:"az", d:"R", p:[47.58,40.14] },
    { iso2:"GE", n:"Georgia",        a:["Sakartvelo","საქართველო"],       r:"Western Asia", ct:"Asia",   c:"Tbilisi",     cu:"GEL", l:"ka", d:"R", p:[43.36,42.32] },
    // ─── Central Asia ───────────────────────────────────────────
    { iso2:"KZ", n:"Kazakhstan",     a:[],                                r:"Central Asia", ct:"Asia", c:"Astana",      cu:"KZT", l:"kk", d:"R", p:[66.92,48.02] },
    { iso2:"UZ", n:"Uzbekistan",     a:[],                                r:"Central Asia", ct:"Asia", c:"Tashkent",    cu:"UZS", l:"uz", d:"R", p:[64.59,41.38] },
    { iso2:"TM", n:"Turkmenistan",   a:[],                                r:"Central Asia", ct:"Asia", c:"Ashgabat",    cu:"TMT", l:"tk", d:"R", p:[59.56,38.97] },
    { iso2:"TJ", n:"Tajikistan",     a:[],                                r:"Central Asia", ct:"Asia", c:"Dushanbe",    cu:"TJS", l:"tg", d:"R", p:[71.28,38.86] },
    { iso2:"KG", n:"Kyrgyzstan",     a:[],                                r:"Central Asia", ct:"Asia", c:"Bishkek",     cu:"KGS", l:"ky", d:"R", p:[74.77,41.20] },
    // ─── Southern Asia ──────────────────────────────────────────
    { iso2:"IN", n:"India",          a:["Bharat","भारत"],                  r:"Southern Asia", ct:"Asia", c:"New Delhi",   cu:"INR", l:"hi", d:"L", p:[78.96,20.59] },
    { iso2:"PK", n:"Pakistan",       a:[],                                r:"Southern Asia", ct:"Asia", c:"Islamabad",   cu:"PKR", l:"ur", d:"L", p:[69.35,30.38] },
    { iso2:"BD", n:"Bangladesh",     a:[],                                r:"Southern Asia", ct:"Asia", c:"Dhaka",       cu:"BDT", l:"bn", d:"L", p:[90.36,23.69] },
    { iso2:"LK", n:"Sri Lanka",      a:["Ceylon"],                        r:"Southern Asia", ct:"Asia", c:"Colombo",     cu:"LKR", l:"si", d:"L", p:[80.77,7.87] },
    { iso2:"NP", n:"Nepal",          a:["नेपाल"],                          r:"Southern Asia", ct:"Asia", c:"Kathmandu",   cu:"NPR", l:"ne", d:"L", p:[84.12,28.39] },
    { iso2:"BT", n:"Bhutan",         a:["Druk Yul"],                      r:"Southern Asia", ct:"Asia", c:"Thimphu",     cu:"BTN", l:"dz", d:"L", p:[90.43,27.51] },
    { iso2:"MV", n:"Maldives",       a:[],                                r:"Southern Asia", ct:"Asia", c:"Malé",        cu:"MVR", l:"dv", d:"L", p:[73.22,3.20] },
    { iso2:"AF", n:"Afghanistan",    a:[],                                r:"Southern Asia", ct:"Asia", c:"Kabul",       cu:"AFN", l:"ps", d:"R", p:[67.71,33.94] },
    // ─── South-Eastern Asia ─────────────────────────────────────
    { iso2:"TH", n:"Thailand",       a:["Siam","ประเทศไทย"],              r:"South-Eastern Asia", ct:"Asia", c:"Bangkok", cu:"THB", l:"th", d:"L", p:[100.99,15.87] },
    { iso2:"VN", n:"Vietnam",        a:["Việt Nam"],                      r:"South-Eastern Asia", ct:"Asia", c:"Hanoi",   cu:"VND", l:"vi", d:"R", p:[108.28,14.06] },
    { iso2:"KH", n:"Cambodia",       a:["Kampuchea"],                     r:"South-Eastern Asia", ct:"Asia", c:"Phnom Penh", cu:"KHR", l:"km", d:"R", p:[104.99,12.57] },
    { iso2:"LA", n:"Laos",           a:["Lao PDR"],                       r:"South-Eastern Asia", ct:"Asia", c:"Vientiane", cu:"LAK", l:"lo", d:"R", p:[102.50,19.86] },
    { iso2:"MM", n:"Myanmar",        a:["Burma"],                         r:"South-Eastern Asia", ct:"Asia", c:"Naypyidaw", cu:"MMK", l:"my", d:"R", p:[95.96,21.91] },
    { iso2:"MY", n:"Malaysia",       a:[],                                r:"South-Eastern Asia", ct:"Asia", c:"Kuala Lumpur", cu:"MYR", l:"ms", d:"L", p:[101.98,4.21] },
    { iso2:"SG", n:"Singapore",      a:[],                                r:"South-Eastern Asia", ct:"Asia", c:"Singapore",  cu:"SGD", l:"en", d:"L", p:[103.82,1.35] },
    { iso2:"ID", n:"Indonesia",      a:[],                                r:"South-Eastern Asia", ct:"Asia", c:"Jakarta",    cu:"IDR", l:"id", d:"L", p:[113.92,-0.79] },
    { iso2:"PH", n:"Philippines",    a:["Pilipinas"],                     r:"South-Eastern Asia", ct:"Asia", c:"Manila",     cu:"PHP", l:"tl", d:"R", p:[121.77,12.88] },
    { iso2:"BN", n:"Brunei",         a:["Brunei Darussalam"],             r:"South-Eastern Asia", ct:"Asia", c:"Bandar Seri Begawan", cu:"BND", l:"ms", d:"L", p:[114.73,4.54] },
    { iso2:"TL", n:"Timor-Leste",    a:["East Timor"],                    r:"South-Eastern Asia", ct:"Asia", c:"Dili",        cu:"USD", l:"pt", d:"L", p:[125.73,-8.87] },
    // ─── Eastern Asia ───────────────────────────────────────────
    { iso2:"CN", n:"China",          a:["People's Republic of China","PRC","中国"], r:"Eastern Asia", ct:"Asia", c:"Beijing", cu:"CNY", l:"zh", d:"R", p:[104.20,35.86] },
    { iso2:"JP", n:"Japan",          a:["Nippon","日本"],                  r:"Eastern Asia", ct:"Asia", c:"Tokyo",       cu:"JPY", l:"ja", d:"L", p:[138.25,36.20] },
    { iso2:"KR", n:"South Korea",    a:["Republic of Korea","한국"],       r:"Eastern Asia", ct:"Asia", c:"Seoul",       cu:"KRW", l:"ko", d:"R", p:[127.77,35.91] },
    { iso2:"KP", n:"North Korea",    a:["DPRK","조선"],                    r:"Eastern Asia", ct:"Asia", c:"Pyongyang",   cu:"KPW", l:"ko", d:"R", p:[127.51,40.34] },
    { iso2:"MN", n:"Mongolia",       a:["Монгол улс"],                    r:"Eastern Asia", ct:"Asia", c:"Ulaanbaatar", cu:"MNT", l:"mn", d:"R", p:[103.85,46.86] },
    { iso2:"TW", n:"Taiwan",         a:["Republic of China","ROC","臺灣"], r:"Eastern Asia", ct:"Asia", c:"Taipei",      cu:"TWD", l:"zh", d:"R", p:[121.00,23.70] },
    { iso2:"HK", n:"Hong Kong",      a:["香港"],                          r:"Eastern Asia", ct:"Asia", c:"Hong Kong",   cu:"HKD", l:"zh", d:"L", p:[114.11,22.32] },
    { iso2:"MO", n:"Macau",          a:["Macao","澳門"],                  r:"Eastern Asia", ct:"Asia", c:"Macau",       cu:"MOP", l:"zh", d:"L", p:[113.55,22.20] },
    // ─── Oceania ────────────────────────────────────────────────
    { iso2:"AU", n:"Australia",      a:[],                                r:"Australia and New Zealand", ct:"Oceania", c:"Canberra", cu:"AUD", l:"en", d:"L", p:[133.78,-25.27] },
    { iso2:"NZ", n:"New Zealand",    a:["Aotearoa"],                      r:"Australia and New Zealand", ct:"Oceania", c:"Wellington", cu:"NZD", l:"en", d:"L", p:[174.89,-40.90] },
    { iso2:"PG", n:"Papua New Guinea", a:[],                              r:"Melanesia", ct:"Oceania", c:"Port Moresby", cu:"PGK", l:"en", d:"R", p:[143.96,-6.31] },
    { iso2:"FJ", n:"Fiji",           a:[],                                r:"Melanesia", ct:"Oceania", c:"Suva",        cu:"FJD", l:"en", d:"L", p:[179.41,-16.58] },
    { iso2:"SB", n:"Solomon Islands",a:[],                                r:"Melanesia", ct:"Oceania", c:"Honiara",     cu:"SBD", l:"en", d:"L", p:[160.16,-9.65] },
    { iso2:"VU", n:"Vanuatu",        a:[],                                r:"Melanesia", ct:"Oceania", c:"Port Vila",   cu:"VUV", l:"bi", d:"R", p:[166.96,-15.38] },
    { iso2:"NC", n:"New Caledonia",  a:["Nouvelle-Calédonie"],            r:"Melanesia", ct:"Oceania", c:"Nouméa",      cu:"XPF", l:"fr", d:"R", p:[165.62,-20.90] },
    { iso2:"WS", n:"Samoa",          a:[],                                r:"Polynesia", ct:"Oceania", c:"Apia",        cu:"WST", l:"sm", d:"L", p:[-172.10,-13.76] },
    { iso2:"TO", n:"Tonga",          a:[],                                r:"Polynesia", ct:"Oceania", c:"Nuku'alofa",  cu:"TOP", l:"to", d:"L", p:[-175.20,-21.18] },
    { iso2:"TV", n:"Tuvalu",         a:[],                                r:"Polynesia", ct:"Oceania", c:"Funafuti",    cu:"AUD", l:"en", d:"L", p:[177.65,-7.11] },
    { iso2:"PF", n:"French Polynesia", a:["Tahiti"],                      r:"Polynesia", ct:"Oceania", c:"Papeete",     cu:"XPF", l:"fr", d:"R", p:[-149.41,-17.68] },
    { iso2:"FM", n:"Micronesia",     a:["Federated States of Micronesia","FSM"], r:"Micronesia", ct:"Oceania", c:"Palikir", cu:"USD", l:"en", d:"R", p:[150.55,7.43] },
    { iso2:"PW", n:"Palau",          a:[],                                r:"Micronesia", ct:"Oceania", c:"Ngerulmud",   cu:"USD", l:"en", d:"R", p:[134.58,7.51] },
    { iso2:"MH", n:"Marshall Islands", a:[],                              r:"Micronesia", ct:"Oceania", c:"Majuro",      cu:"USD", l:"en", d:"R", p:[171.18,7.13] },
    { iso2:"NR", n:"Nauru",          a:[],                                r:"Micronesia", ct:"Oceania", c:"Yaren",       cu:"AUD", l:"na", d:"L", p:[166.93,-0.52] },
    { iso2:"KI", n:"Kiribati",       a:[],                                r:"Micronesia", ct:"Oceania", c:"Tarawa",      cu:"AUD", l:"en", d:"L", p:[-168.73,-3.37] }
  ];

  // ── Helpers ────────────────────────────────────────────────────
  // Mirror _normPlaceName's substitution rules so lookups against
  // user-typed names ("Ísland", "Türkiye") line up with the canonical
  // entries. Kept inline so this module is self-contained.
  function _norm(s) {
    if (!s) return '';
    return String(s)
      .toLowerCase()
      .replace(/þ/g, 'th')
      .replace(/æ/g, 'ae')
      .replace(/ð/g, 'd')
      .replace(/ø/g, 'o')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  var byIso = {};
  var byNorm = {};
  var bySubregion = {};

  DATA.forEach(function (entry) {
    // Public-shape entry — translate short field names to full ones.
    var pub = {
      iso2: entry.iso2,
      name: entry.n,
      altNames: entry.a || [],
      capital: entry.c,
      continent: entry.ct,
      subregion: entry.r,
      language: entry.l,
      currency: entry.cu,
      drivesOn: entry.d === "L" ? "left" : "right",
      centroid: entry.p
    };
    byIso[entry.iso2.toLowerCase()] = pub;
    byNorm[_norm(entry.n)] = pub;
    (entry.a || []).forEach(function (alt) {
      var k = _norm(alt);
      if (k) byNorm[k] = pub;
    });
    if (!bySubregion[entry.r]) bySubregion[entry.r] = [];
    bySubregion[entry.r].push(pub);
  });

  var COUNTRY_WORD_SET = {};
  Object.keys(byNorm).forEach(function (k) {
    // Treat each country name + altName as a single "word" — joined by
    // single spaces. Used by stripCountrySuffix to test the trailing
    // token(s) of a place string.
    COUNTRY_WORD_SET[k] = true;
  });

  function byName(s) { return byNorm[_norm(s)] || null; }
  function isCountry(s) { return !!byNorm[_norm(s)]; }
  function byIsoCode(code) { return byIso[String(code || "").toLowerCase()] || null; }
  function subregionOf(name) { var e = byName(name); return e ? e.subregion : null; }
  function countriesIn(sub) { return (bySubregion[sub] || []).map(function (e) { return e.name; }); }
  function neighbors(name) {
    var e = byName(name);
    if (!e) return [];
    return (bySubregion[e.subregion] || [])
      .filter(function (n) { return n.name !== e.name; })
      .map(function (n) { return n.name; });
  }

  // Strip a trailing country word (or two-word country) off a string.
  // "Selfoss, Iceland" → "Selfoss"
  // "London, United Kingdom" → "London"
  // "Mont Blanc" → "Mont Blanc" (no country)
  function stripCountrySuffix(s) {
    if (!s) return s;
    // Trim ", Country" or " — Country" or "; Country" — anything after
    // a comma / em-dash / semicolon that resolves to a known country.
    var m = String(s).match(/^(.*?)[\s]*[,;—–][\s]*(.+?)$/);
    if (m && isCountry(m[2])) return m[1].trim();
    // Try the last word(s) without a separator — "Vík Iceland" or
    // "London United Kingdom". Walk back word by word.
    var tokens = String(s).trim().split(/\s+/);
    for (var i = 1; i <= Math.min(tokens.length - 1, 3); i++) {
      var tail = tokens.slice(tokens.length - i).join(" ");
      if (isCountry(tail)) {
        return tokens.slice(0, tokens.length - i).join(" ");
      }
    }
    return s;
  }

  // Scan a block of text and tally which countries are mentioned.
  // Returns the most-mentioned country's name, or null. Useful for
  // auto-detecting the trip region from a paste-list.
  function detectCountry(text) {
    if (!text) return null;
    var counts = {};
    var seen = {};
    // Walk every known country name + altName; count occurrences in the
    // (lowercased, normalized) text. Longest names first so "United
    // Arab Emirates" wins over the bare word "United".
    var keys = Object.keys(byNorm).sort(function (a, b) { return b.length - a.length; });
    var nText = " " + _norm(text) + " ";
    keys.forEach(function (k) {
      if (seen[k]) return;
      seen[k] = true;
      var needle = " " + k + " ";
      var idx = nText.indexOf(needle);
      var n = 0;
      while (idx >= 0) { n++; idx = nText.indexOf(needle, idx + needle.length); }
      if (n > 0) {
        var entry = byNorm[k];
        counts[entry.name] = (counts[entry.name] || 0) + n;
      }
    });
    var best = null;
    var bestN = 0;
    Object.keys(counts).forEach(function (name) {
      if (counts[name] > bestN) { bestN = counts[name]; best = name; }
    });
    return best;
  }

  function all() { return DATA.map(function (e) { return byNorm[_norm(e.n)]; }); }

  var MaxGeo = {
    byName: byName,
    byIso: byIsoCode,
    isCountry: isCountry,
    subregion: subregionOf,
    countriesIn: countriesIn,
    neighbors: neighbors,
    stripCountrySuffix: stripCountrySuffix,
    detectCountry: detectCountry,
    all: all
  };

  global.MaxGeo = MaxGeo;
  // engine-trip.js can use this internally when present; back-compat
  // alias for any direct script-tag consumer that wants the raw map.
  if (typeof global.MaxEngineTrip !== "undefined") {
    global.MaxEngineTrip.geo = MaxGeo;
  }


/* #2 Stage 2 interim: expose this module's non-colliding top-level bindings
   as globals (restores pre-ESM flat-script behavior for bare-global + window.*
   consumers, incl. app-main.js boot refs). esbuild isolates each .mjs to an IIFE;
   any-cast keeps it tsc-valid; the import-rewiring phase removes this. */
{
  const __expg = /** @type {any} */ (globalThis);
  __expg.DATA = DATA;
  __expg.byIso = byIso;
  __expg.byNorm = byNorm;
  __expg.bySubregion = bySubregion;
  __expg.COUNTRY_WORD_SET = COUNTRY_WORD_SET;
  __expg.byName = byName;
  __expg.isCountry = isCountry;
  __expg.byIsoCode = byIsoCode;
  __expg.subregionOf = subregionOf;
  __expg.countriesIn = countriesIn;
  __expg.neighbors = neighbors;
  __expg.stripCountrySuffix = stripCountrySuffix;
  __expg.detectCountry = detectCountry;
  __expg.all = all;
  __expg.MaxGeo = MaxGeo;
}

export {};
