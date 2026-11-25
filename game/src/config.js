// Warung Bakso Malam — every tuning number, colour and piece of recipe data in one place.
// The playfield is a fixed 1280x720 logical area; the renderer scales it to the window, so no rule
// below depends on the screen size. Nothing here draws and nothing here touches the browser.
//
// Two of the checklist techniques are anchored in this file:
//
//  * canvas layered-sprite rendering — LAYER_ORDER is the canonical stack order of a bowl's
//    contents. A bowl holds component ids; render.js sorts them by this list and paints one layer
//    per id, so the visible assembly state *is* the layer stack, and it is data, not bespoke draw
//    code per dish. Adding a component to the data below is all a new ingredient ever needs.
//
//  * order-queue state machine — ORDER_STATES names every state an order may hold and
//    ORDER_TRANSITIONS documents the legal edges between them. world.js only ever moves an order
//    along one of those edges; there is no separate "isCooked"/"isReady" boolean anywhere.

export const FIELD = { width: 1280, height: 720 };

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

/**
 * Screen geometry, in logical pixels. The renderer and the world's hit tests share these.
 *
 * The picture is five bands, top to bottom: the tarp and bulb; the ticket string; the back wall
 * with the cook and the station props; the counter lip, which carries one name plate per station
 * (and becomes the live cook timer while that station is working); and the front band, split into
 * three columns — the active order on the left, the hero bowl on its board in the centre, and the
 * bumbu trays over the takings on the right. Nothing overlaps anything else, and the bowl is the
 * only object in the middle of the front band, so it is the brightest, least cluttered thing in
 * every frame.
 */
export const LAYOUT = {
  /** The counter's back edge: every station prop stands on it and the cook stands behind it. */
  counterTop: 470,
  /** The order string the tickets hang from, and the three ticket slots (left edges). */
  string: { x0: 372, x1: 1264, y: 114 },
  ticket: { w: 280, h: 168, y: 118 },
  slots: [396, 684, 972],
  /** The cook: head centre and feet. The feet are hidden behind the counter. */
  cookHead: 300,
  cookFeet: 470,
  /** The station plates on the counter lip: name, or live cook timer while that station works. */
  tags: { y: 470, w: 124, h: 34 },
  /** The wooden prep board and the hero bowl on it, front and centre. */
  board: { x: 456, y: 508, w: 368, h: 190 },
  bowl: { cx: 640, rimY: 572, rx: 180, ry: 64, bottom: 686 },
  /** HUD plaques down the left: the sign, the shift clock, the strikes. */
  sign: { x: 16, y: 10, w: 344, h: 76 },
  clock: { x: 16, y: 94, w: 344, h: 92 },
  strikes: { x: 16, y: 194, w: 344, h: 76 },
  /** The active order and its checklist, bottom left. */
  panel: { x: 16, y: 508, w: 392, h: 208 },
  /** The four bumbu trays in a row, bottom right, under the bumbu station. */
  trays: { x: 860, y: 510, w: 94, h: 96, gap: 8 },
  takings: { x: 860, y: 612, w: 404, h: 104 },
};

/**
 * The seven stations the cook walks between, left to right. `tool` is what the cook holds when
 * standing there (the renderer draws it, and null means empty-handed).
 */
export const STATIONS = [
  { id: 'pot', x: 118, name: 'PANCI BAKSO', tool: 'ladle' },
  { id: 'noodle', x: 272, name: 'REBUS MIE', tool: 'basket' },
  { id: 'wok', x: 426, name: 'WAJAN AYAM', tool: 'spatula' },
  { id: 'fryer', x: 580, name: 'GORENGAN', tool: 'basket' },
  { id: 'drink', x: 734, name: 'ES TEH', tool: 'pitcher' },
  { id: 'garnish', x: 918, name: 'BUMBU', tool: null },
  { id: 'serve', x: 1150, name: 'SERAHKAN', tool: null },
];

export const STATION_INDEX = Object.fromEntries(STATIONS.map((station, index) => [station.id, index]));

/** How near the cook has to be, in logical pixels, to be "at" a station. */
export const REACH = 84;

export const COOK = {
  speed: 430,
  minX: 84,
  maxX: 1204,
  /** How far past the middle a station is still in reach (the pots are wide). */
  stationGap: 92,
};

/**
 * Every ingredient the stall can produce. `station` says where it is made, `cook` is the number of
 * seconds before it can be pulled, `window` is how long after that it is still perfect, and `burn`
 * is when it is ruined (only the fryer's window is short enough to blacken a batch in play).
 */
export const COMPONENTS = {
  meatballs: { name: 'BAKSO', station: 'pot', cook: 2.6, window: 2.8, burn: 8.4, layer: 'meatballs' },
  noodles: { name: 'MIE', station: 'noodle', cook: 2.2, window: 2.6, burn: 7.6, layer: 'noodles' },
  chicken: { name: 'AYAM', station: 'wok', cook: 3.0, window: 2.4, burn: 8.6, layer: 'chicken' },
  gorengan: { name: 'GORENGAN', station: 'fryer', cook: 2.4, window: 1.5, burn: 4.5, layer: 'gorengan' },
  tea: { name: 'ES TEH', station: 'drink', cook: 1.0, window: 90, burn: 900, layer: 'tea' },
  seledri: { name: 'SELEDRI', station: 'garnish', cook: 0, window: 0, burn: 900, layer: 'seledri' },
  bawang: { name: 'BAWANG', station: 'garnish', cook: 0, window: 0, burn: 900, layer: 'bawang' },
  telur: { name: 'TELUR', station: 'garnish', cook: 0, window: 0, burn: 900, layer: 'telur' },
  sambal: { name: 'SAMBAL', station: 'garnish', cook: 0, window: 0, burn: 900, layer: 'sambal' },
};

/** Stable ids and indices, so a bowl's contents are a fixed-size bitfield and not a Set. */
export const COMPONENT_IDS = Object.keys(COMPONENTS);
export const COMPONENT_INDEX = Object.fromEntries(COMPONENT_IDS.map((id, index) => [id, index]));

/** The order layers are stacked in, bottom of the bowl to the top. */
export const LAYER_ORDER = ['noodles', 'meatballs', 'chicken', 'gorengan', 'telur', 'sambal', 'seledri', 'bawang'];

/** The four trays on the bumbu station, in keyboard order 1-4. */
export const TRAYS = ['seledri', 'bawang', 'telur', 'sambal'];

/** The three dishes on the menu. `base` is what the dish needs before any extras. */
export const DISHES = {
  bakso: { name: 'BAKSO', price: 18000, vessel: 'bowl', base: ['meatballs', 'noodles', 'seledri'], weight: 44 },
  mie: { name: 'MIE AYAM', price: 15000, vessel: 'bowl', base: ['noodles', 'chicken', 'bawang'], weight: 32 },
  teh: { name: 'ES TEH MANIS', price: 6000, vessel: 'glass', base: ['tea'], weight: 24 },
};

export const DISH_IDS = Object.keys(DISHES);

/**
 * What a customer can ask for on top. `comp` adds an ingredient, `remove` takes one off the dish
 * (that is how "tanpa seledri" is expressed: the recipe simply never contains seledri, so the
 * bumbu station refuses it).
 */
export const EXTRAS = {
  gorengan: { name: 'GORENGAN', price: 5000, comp: 'gorengan' },
  telur: { name: 'TELUR', price: 4000, comp: 'telur' },
  sambal: { name: 'SAMBAL', price: 2000, comp: 'sambal' },
  tanpaSeledri: { name: 'TANPA SELEDRI', price: 0, remove: 'seledri' },
};

export const SHIFT = {
  /** Orders in a full shift. */
  orders: 10,
  /** The shift clock, in seconds. Run out and the stall closes where it stands. */
  seconds: 240,
  /** At most this many tickets on the string at once; arrivals wait for a free slot. */
  maxTickets: 3,
  /** Seconds between arrivals once the shift is moving. */
  arrival: 13,
  /** Seconds a normal customer waits before walking off. */
  patience: 62,
  /** An ojek driver's rush order waits half as long and pays double. */
  ojekPatience: 31,
  ojekEvery: 4,
};

/** How many walkouts and how many burnt batches close the stall early. */
export const FAIL = { walkouts: 3, burnt: 2 };

/** Money for quality: a perfect pull is worth this much, an overcooked one costs that much. */
export const MONEY = { perfectPull: 1500, overcookedPull: -1800, fastTip: 0.25, slowTip: 0.1, fastAt: 0.62, slowAt: 0.3 };

/**
 * Eight base colours (night, wall, tarp, orange, amber, cream, wood, ink) and the accents that
 * only ever appear in small amounts (tealLite, red, green, paper, woodDark, steel). Teal and warm
 * orange carry the whole picture; nothing else is allowed to be a large flat area.
 */
export const PALETTE = {
  night: '#061a21',
  wall: '#0e3742',
  tarp: '#17545f',
  tealLite: '#2f8f99',
  orange: '#f0862a',
  amber: '#ffc45c',
  cream: '#f4e6cb',
  paper: '#fff8e8',
  red: '#d94b2b',
  ink: '#08171c',
  wood: '#8a4a26',
  woodDark: '#542b16',
  green: '#6fc46f',
  steel: '#9fb4b8',
};

export const FONT = 'system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

/** Where the best takings are kept between visits (this browser only). */
export const BEST_KEY = 'warung-bakso-malam.best';
