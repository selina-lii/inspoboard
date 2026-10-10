// Record types. See docs/SPEC.md section 2.
// All records use one ID space. An ID never changes.

export type Id = string;

/** Metadata of an item. The body text is a separate record (TextRecord). */
export type ItemRecord = {
  id: Id;
  name: string;
  /** ISO 8601 time of creation in the app. */
  created: string;
  /** ISO 8601 time of the last change to the name or the body text. Missing until the first change. */
  modified?: string;
  /**
   * A date that the user types, for example the date of a document that was made outside the app.
   * Free text, for example "1998", "2021-05", or "2021-05-03".
   */
  date?: string;
  /**
   * True if the user made this item a board while it has no children. An item with children is
   * always a board. See isBoardItem() in graph.ts.
   */
  board?: boolean;
  /** True if the name is a code that the app made because the user left the name empty. */
  codeName?: boolean;
  /**
   * Older versions only: the list style of the whole board. The app keeps the field but does not use it.
   * Outlines have their own list style (OutlineRecord).
   */
  list?: ListStyle;
  /** Background of the board of this item: a color "#rrggbb", or an image path "images/<name>". */
  background?: string;
  /**
   * A background image of the board: its width and the board point of its middle (board coordinates). The image lies
   * on the board: it zooms and moves with the cards. Missing: it covers the area of the cards.
   */
  backgroundWidth?: number;
  backgroundCenter?: [number, number];
  /** True: the background image stays still (it fills the view; it does not move or zoom with the cards). */
  backgroundFixed?: boolean;
  /** A link object (view "weblink"): the web address it opens. The name is the text that shows. */
  url?: string;
  /** A comment (view "comment"): the signature of the person who wrote it (Settings → Your name). */
  author?: string;
  /**
   * The item that this object is attached to (a comment, or a link object). It shows next to that item:
   * on the board, at the side of its card; on its text page, in the side column.
   */
  on?: Id;
  /** A comment on a text passage: an exact text in the body of the item `on`. */
  quote?: string;
  /**
   * A resolved comment thread: it is hidden, but it stays (with its replies) until it is deleted.
   * A reply is a comment item attached (`on`) to the comment it answers. It has no placement.
   */
  resolved?: boolean;
  /** A small item in a page (comment or note): its place, [x, y] (px) from the top-right corner of the text. Missing: in the column at the right edge of the text. */
  pageAt?: [number, number];
  /** Trash: the time (ISO 8601) when the item lost its last board placement. Missing: not in the trash, or an item of an older version. */
  trashed?: string;
  /** Trash: the board and the card that the item was on, to put it back there ("Restore"). */
  trashedFrom?: TrashedFrom;
};

/** The last card of an item in the trash: its board, position, size, and card kind. */
export type TrashedFrom = { board: Id; x: number; y: number; w: number; h: number; view: ViewStyle };

export type ListStyle = "bullets" | "numbers";
export const LIST_STYLES: readonly ListStyle[] = ["bullets", "numbers"];

/** Body text of an item. It has the same ID as its item. */
export type TextRecord = {
  id: Id;
  body: string;
};

/**
 * How a card shows its item. The first three are the basic cards. The others are objects:
 * - "comment": a remark with a signature, attached to an item (`ItemRecord.on`) or free.
 * - "weblink": a web address (`ItemRecord.url`) with a name. It opens the page.
 * - "todo": an action item on half-transparent colored film. "Done" removes it.
 * - "flashcard": two sides: the name is the front, the text is the back. A click flips it.
 * - "quote": a passage on paper, framed by quotation marks (`PlaceLink.marks`). The text is the passage; the name
 *   is its source (it can be empty).
 */
export type ViewStyle = "note" | "page" | "text" | "comment" | "weblink" | "todo" | "flashcard" | "quote";

export const VIEW_STYLES: readonly ViewStyle[] = ["note", "page", "text", "comment", "weblink", "todo", "flashcard", "quote"];
/** The object views (one tool bar button for all). */
export const OBJECT_VIEWS: readonly ViewStyle[] = ["comment", "weblink", "todo", "flashcard", "quote"];

/**
 * The quotation marks of a quote card: "en" ‘ ’, "cjk" 「 」 (Traditional Chinese, Japanese), "zh" “ ” (Chinese),
 * "es" « » (Spanish, French), "none".
 */
export type QuoteMarks = "en" | "cjk" | "zh" | "es" | "none";
export const QUOTE_MARKS: readonly QuoteMarks[] = ["en", "cjk", "zh", "es", "none"];

export type Point3 = [number, number, number];

/** Record `to` shows on board `from`. */
export type PlaceLink = {
  id: Id;
  kind: "place";
  from: Id;
  to: Id;
  x: number;
  y: number;
  w: number;
  h: number;
  view: ViewStyle;
  /** 3D position. Missing until the user moves the record in 3D. */
  p3?: Point3;
  /** True if the card shows its text. A card that is not expanded shows only its name. */
  expanded?: boolean;
  /** Order among the rows of the same outline parent (0, 1, 2, ...). Older versions: order on the board. */
  rank?: number;
  /** The outline that holds this card. Its position then comes from the outline layout. */
  outline?: Id;
  /** The place link of the parent row in the same outline. Missing: a top row. */
  parent?: Id;
  /**
   * True if this placement is a reference: the item lives on a different board (its home board).
   * A reference shows as a ghost card. Each item has one home placement (see GraphIndex.homeOf).
   */
  ref?: boolean;
  /** Card color "#rrggbb". Missing: the color of the card kind. */
  color?: string;
  /** A card in a calendar group: its day "YYYY-MM-DD" (its first day, if it has `until`). */
  day?: string;
  /** A card on more than one day: its last day "YYYY-MM-DD" (after `day`). It has no time. */
  until?: string;
  /** A card at a time of its day: "HH:MM", or "HH:MM–HH:MM" (start and end). Only on one day (no `until`). */
  time?: string;
  /** A quote card: its quotation marks. Missing: from the text (CJK text 「 」, else ‘ ’). */
  marks?: QuoteMarks;
};

/** The shape at one end of a link line. */
export type LinkCap =
  | "none"
  | "arrow"
  | "open-arrow"
  | "circle"
  | "filled-circle"
  | "square"
  | "filled-square"
  | "diamond"
  | "filled-diamond";

export const LINK_CAPS: readonly LinkCap[] = [
  "none",
  "arrow",
  "open-arrow",
  "circle",
  "filled-circle",
  "square",
  "filled-square",
  "diamond",
  "filled-diamond",
];

/** Caps when the record has no value. Only other values are saved (SPEC P5). */
export const DEFAULT_START_CAP: LinkCap = "none";
export const DEFAULT_END_CAP: LinkCap = "arrow";

/** Item `from` refers to item `to`. The direction is data. The caps only change how the line looks. */
export type RelationLink = {
  id: Id;
  kind: "link";
  from: Id;
  to: Id;
  label?: string;
  group?: string;
  /** Cap at the `from` end. Missing means "none". */
  start?: LinkCap;
  /** Cap at the `to` end. Missing means "arrow". */
  end?: LinkCap;
  /**
   * A location in the target item: an exact text in its body, or in its saved web page or PDF (a link object).
   * A jump along the link shows this text.
   */
  quote?: string;
  /**
   * A location in the source item, when the source text cannot hold the link: an exact text in its saved web page
   * or PDF (or in its body, if the text changed). A source passage in a note or page is "[text](link:<id>)" in
   * its body instead.
   */
  fromQuote?: string;
};

export type LinkRecord = PlaceLink | RelationLink;

/** A small freehand drawing. `path` is an SVG path. Coordinates have one decimal. */
export type StampRecord = {
  id: Id;
  alt: string;
  w: number;
  h: number;
  path: string;
};

/**
 * A group on a board: a set of cards with one shape, one level below the board ("subtitle" to the board "title").
 * - Outline (no `type`): its cards show as an aligned list.
 * - Calendar (`type: "calendar"`): a month grid. Each card is on one day (PlaceLink.day).
 * The member cards point to the group (PlaceLink.outline). The group gives their positions.
 * The table is "outlines" for all groups: older vaults stay as they are.
 */
export type OutlineRecord = {
  id: Id;
  /** "calendar", or missing for an outline. */
  type?: GroupType;
  /** The name of the group. Missing: no name. */
  name?: string;
  /** Calendar: the first and the last month that it shows, "YYYY-MM". */
  start?: string;
  end?: string;
  /** The board that holds the outline. */
  board: Id;
  /** Top-left corner of the outline on the board. */
  x: number;
  y: number;
  /** Bullets or numbers before each row. Missing: no marks. */
  list?: ListStyle;
  /** "horizontal": top rows go from left to right, and their child rows go down under them. Missing: vertical. */
  direction?: OutlineDirection;
};

export type OutlineDirection = "vertical" | "horizontal";
export type GroupType = "calendar";

/** Maps each table name to the type of its records. */
export type TableRecords = {
  items: ItemRecord;
  texts: TextRecord;
  links: LinkRecord;
  stamps: StampRecord;
  outlines: OutlineRecord;
};

export type TableName = keyof TableRecords;

export const TABLE_NAMES: readonly TableName[] = ["items", "texts", "links", "stamps", "outlines"];

export type AnyRecord = TableRecords[TableName];
