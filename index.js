import { readFile, writeFile } from "node:fs/promises";
import { XMLParser } from "fast-xml-parser";

const STATE_FILE = "state/seen.json";

// --- Posting schedule -------------------------------------------------------
// The announcement is written in Canvas once a week; it is posted to Discord
// on each of these weekdays. Weekday and date are evaluated in TIMEZONE, not
// UTC, so the schedule follows local days across daylight-saving changes.
const POST_DAYS = ["Fri", "Mon", "Wed"];
const TIMEZONE = "America/Chicago";

// An announcement is only eligible while it is this fresh. This is what stops
// a week with no new Canvas post from reposting the previous week's forever.
// Must be >= the longest gap from the Canvas post to its last repost (Fri->Wed
// is 5 days) and < the gap to the following week's first post day (7 days).
const MAX_AGE_DAYS = 6;

// Subtext line added to the 2nd and 3rd posting of the same announcement, so
// members can tell a reminder from the original. "" disables it.
const REPOST_NOTE = "Reminder - originally posted {weekday}";

// Written into the state file when upgrading from the older format, which
// recorded only that an announcement was known - not which days it went out
// on. It counts as one prior posting so the reminder note and the counter are
// right for the changeover week.
const LEGACY_POST_MARKER = "(before upgrade)";

// Prefixed to every post. Set to "" to disable, or use "@here" / "<@&ROLE_ID>".
const MENTION = "@everyone";

const MAX_POSTS_PER_RUN = 10;
const MAX_REMEMBERED_IDS = 500;
const DELAY_BETWEEN_POSTS_MS = 1200;
// Hard ceiling on any single HTTP request.
const REQUEST_TIMEOUT_MS = 20000;

const webhookUrl = requireEnv("DISCORD_WEBHOOK_URL");
const feeds = parseFeedConfig(requireEnv("CANVAS_FEEDS"));

// OVERRIDE_NOW lets a run be evaluated as if it were another moment, for
// testing the schedule without waiting for the day. Unset in normal use.
function currentTime() {
  const override = process.env.OVERRIDE_NOW;
  if (override) {
    const parsed = new Date(override);
    if (Number.isNaN(parsed.getTime())) {
      console.error(`OVERRIDE_NOW is not a valid date: ${override}`);
      process.exit(1);
    }
    return parsed;
  }
  return new Date();
}

// The local calendar date and weekday in TIMEZONE. The date string is the
// dedupe key: an announcement is posted at most once per local date, however
// many times the workflow runs that day.
function localParts(date) {
  const parts = {};
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  for (const part of formatter.formatToParts(date)) {
    parts[part.type] = part.value;
  }
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: parts.weekday,
  };
}

function ageInDays(entry, now) {
  if (!entry.published) return null;
  const published = Date.parse(entry.published);
  if (Number.isNaN(published)) return null;
  return (now.getTime() - published) / 86400000;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

// CANVAS_FEEDS is one feed per line, formatted as:  Label|https://...atom
function parseFeedConfig(raw) {
  const feeds = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const split = line.indexOf("|");
      if (split === -1) {
        throw new Error(`Bad feed line (expected "Label|URL"): ${line}`);
      }
      return {
        label: line.slice(0, split).trim(),
        url: line.slice(split + 1).trim(),
      };
    });

  if (feeds.length === 0) throw new Error("CANVAS_FEEDS contained no feeds.");
  return feeds;
}

// State maps each announcement id to the list of local dates it was posted on.
// An empty list means "known but never posted" - that is how the first run and
// migrated v1 state mark the existing backlog as absorbed.
async function loadState() {
  try {
    const raw = await readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const posts = {};

    if (parsed.posts && typeof parsed.posts === "object") {
      for (const [id, dates] of Object.entries(parsed.posts)) {
        posts[id] = Array.isArray(dates) ? dates.filter((d) => typeof d === "string") : [];
      }
    }

    // Migrate v1 state: a flat seenIds array carries no dates, so each id is
    // credited with one prior posting. Entries older than MAX_AGE_DAYS are
    // never eligible anyway, so this does not repost the existing backlog.
    if (Array.isArray(parsed.seenIds)) {
      for (const id of parsed.seenIds) {
        if (!(id in posts)) posts[id] = [LEGACY_POST_MARKER];
      }
    }

    return { bootstrapped: Boolean(parsed.bootstrapped), posts };
  } catch {
    // No state file yet -> this is the very first run.
    return { bootstrapped: false, posts: {} };
  }
}

async function saveState(posts, now) {
  // Object key order is insertion order, so the oldest entries roll off first.
  const ids = Object.keys(posts).slice(-MAX_REMEMBERED_IDS);
  const trimmed = {
    bootstrapped: true,
    posts: Object.fromEntries(ids.map((id) => [id, posts[id]])),
    updatedAt: now.toISOString(),
  };
  await writeFile(STATE_FILE, JSON.stringify(trimmed, null, 2) + "\n", "utf8");
}

function toArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

// fast-xml-parser returns either a string or an object with a "#text" key,
// depending on whether the element had attributes.
function textOf(node) {
  if (node === undefined || node === null) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (typeof node === "object" && "#text" in node) return String(node["#text"]);
  return "";
}

function linkOf(link) {
  const candidates = toArray(link);
  for (const candidate of candidates) {
    if (typeof candidate === "string") return candidate;
    if (candidate && typeof candidate === "object") {
      const rel = candidate["@_rel"];
      if (!rel || rel === "alternate") return candidate["@_href"] ?? "";
    }
  }
  const first = candidates[0];
  if (first && typeof first === "object") return first["@_href"] ?? "";
  return "";
}

// Private-use sentinels. Markdown that WE emit is held as these characters
// until after the escaping pass, so escaping only ever touches the author's
// own text and never the markers we add.
const S = {
  boldOpen: "\uE001",
  boldClose: "\uE002",
  italicOpen: "\uE003",
  italicClose: "\uE004",
  underlineOpen: "\uE005",
  underlineClose: "\uE006",
  strikeOpen: "\uE007",
  strikeClose: "\uE008",
  codeOpen: "\uE009",
  codeClose: "\uE00A",
  bullet: "\uE020",
  h1: "\uE031",
  h2: "\uE032",
  h3: "\uE033",
  quote: "\uE040",
};

// Characters Discord treats as formatting, escaped wherever they appear in
// the author's text.
function escapeMarkdown(text) {
  return text
    .replace(/([\\*_~`|])/g, "\\$1")
    .split("\n")
    .map((line) => line.replace(/^(\s*)([#>-])/, "$1\\$2"))
    .join("\n");
}

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, "&");
}

// Plain text with no markdown at all — used for link labels and comparisons.
function toPlainText(html) {
  return decodeEntities(String(html).replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

function htmlToMarkdown(html) {
  let text = String(html);

  // Canvas injects hidden "Links to an external site." text inside external
  // anchors. Removing it first keeps it from being glued onto the URL.
  text = text.replace(
    /<span[^>]*class="[^"]*screenreader-only[^"]*"[^>]*>[\s\S]*?<\/span>/gi,
    ""
  );

  // Pull anchors out entirely so their URLs never reach the escaping pass.
  const links = [];
  text = text.replace(
    /<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
    (_match, url, inner) => {
      links.push({ url, label: toPlainText(inner) });
      return `\uE050${links.length - 1}\uE050`;
    }
  );

  text = text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<h1[^>]*>/gi, `\n${S.h1}`)
    .replace(/<h2[^>]*>/gi, `\n${S.h2}`)
    .replace(/<h[3-6][^>]*>/gi, `\n${S.h3}`)
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<blockquote[^>]*>/gi, `\n${S.quote}`)
    .replace(/<li[^>]*>/gi, `\n${S.bullet}`)
    .replace(/<\/(p|div|tr|ul|ol|blockquote)>/gi, "\n")
    .replace(/<(strong|b)\b[^>]*>/gi, S.boldOpen)
    .replace(/<\/(strong|b)>/gi, S.boldClose)
    .replace(/<(em|i)\b[^>]*>/gi, S.italicOpen)
    .replace(/<\/(em|i)>/gi, S.italicClose)
    .replace(/<u\b[^>]*>/gi, S.underlineOpen)
    .replace(/<\/u>/gi, S.underlineClose)
    .replace(/<(s|del|strike)\b[^>]*>/gi, S.strikeOpen)
    .replace(/<\/(s|del|strike)>/gi, S.strikeClose)
    .replace(/<code[^>]*>/gi, S.codeOpen)
    .replace(/<\/code>/gi, S.codeClose)
    .replace(/<[^>]+>/g, "");

  text = escapeMarkdown(decodeEntities(text));

  // Canvas emits empty emphasis tags (e.g. <strong style="..."></strong>) and
  // often traps trailing whitespace inside them. Discord won't render emphasis
  // when a marker sits against a space, so drop empty pairs and shift any
  // whitespace to the outside. Repeat until nothing more changes.
  const pairs = [
    [S.boldOpen, S.boldClose],
    [S.italicOpen, S.italicClose],
    [S.underlineOpen, S.underlineClose],
    [S.strikeOpen, S.strikeClose],
    [S.codeOpen, S.codeClose],
  ];
  const openers = pairs.map(([open]) => open).join("");
  const closers = pairs.map(([, close]) => close).join("");
  const afterOpen = new RegExp(`([${openers}])([ \\t]+)`, "g");
  const beforeClose = new RegExp(`([ \\t]+)([${closers}])`, "g");

  let previous;
  do {
    previous = text;
    for (const [open, close] of pairs) {
      text = text.split(`${open}${close}`).join("");
    }
    text = text.replace(afterOpen, "$2$1").replace(beforeClose, "$2$1");
  } while (text !== previous);

  text = text
    .split(S.boldOpen).join("**")
    .split(S.boldClose).join("**")
    .split(S.italicOpen).join("*")
    .split(S.italicClose).join("*")
    .split(S.underlineOpen).join("__")
    .split(S.underlineClose).join("__")
    .split(S.strikeOpen).join("~~")
    .split(S.strikeClose).join("~~")
    .split(S.codeOpen).join("`")
    .split(S.codeClose).join("`")
    .split(S.bullet).join("- ")
    .split(S.h1).join("# ")
    .split(S.h2).join("## ")
    .split(S.h3).join("### ")
    .split(S.quote).join("> ");

  // Put the links back, after escaping, so URLs stay intact.
  text = text.replace(/\uE050(\d+)\uE050/g, (_match, index) => {
    const link = links[Number(index)];
    if (!link) return "";
    if (!link.label || link.label === link.url) return link.url;
    return `[${escapeMarkdown(link.label)}](${link.url})`;
  });

  return text
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .split("\n")
    .map((line) => (line.trim() ? line : ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncate(text, limit) {
  if (text.length <= limit) return text;
  return text.slice(0, limit - 1).trimEnd() + "\u2026";
}

// Handles both Atom (<feed><entry>) and RSS 2.0 (<rss><channel><item>).
function normalizeEntries(xml) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
  });
  const doc = parser.parse(xml);

  if (doc.feed) {
    return toArray(doc.feed.entry).map((entry) => ({
      id: String(textOf(entry.id) || linkOf(entry.link) || textOf(entry.title)),
      title: textOf(entry.title) || "(untitled announcement)",
      url: linkOf(entry.link),
      published: textOf(entry.published) || textOf(entry.updated) || null,
      body: textOf(entry.content) || textOf(entry.summary) || "",
    }));
  }

  if (doc.rss && doc.rss.channel) {
    return toArray(doc.rss.channel.item).map((item) => ({
      id: String(textOf(item.guid) || textOf(item.link) || textOf(item.title)),
      title: textOf(item.title) || "(untitled announcement)",
      url: textOf(item.link),
      published: textOf(item.pubDate) || null,
      body: textOf(item.description) || "",
    }));
  }

  throw new Error("Feed was neither Atom nor RSS 2.0.");
}

async function fetchFeed(feed) {
  const response = await fetch(feed.url, {
    headers: { "User-Agent": "canvas-announcements-to-discord" },
    // Node's fetch waits indefinitely by default; a stalled Canvas connection
    // would otherwise hold the job (and the concurrency group) for hours.
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  const xml = await response.text();
  return normalizeEntries(xml).map((entry) => ({ ...entry, course: feed.label }));
}

function sortOldestFirst(entries) {
  return entries.slice().sort((a, b) => {
    const aTime = a.published ? Date.parse(a.published) : NaN;
    const bTime = b.published ? Date.parse(b.published) : NaN;
    if (Number.isNaN(aTime) || Number.isNaN(bTime)) return 0;
    return aTime - bTime;
  });
}

// Canvas prefixes feed entry titles with "Announcement:" (and sometimes the
// course name). Strip that so the post starts with the actual subject line.
function cleanTitle(title) {
  return title.replace(/^\s*announcements?\s*:\s*/i, "").trim() || title.trim();
}

function buildMessage(entry) {
  const title = cleanTitle(entry.title);
  let body = htmlToMarkdown(entry.body);

  // Authors often repeat the title as the first line of the announcement.
  // Compare on plain text, since the body now carries markdown.
  const [firstLine, ...rest] = body.split("\n");
  if (toPlainText(firstLine).toLowerCase() === title.toLowerCase()) {
    body = rest.join("\n").trim();
  }

  const lines = [];
  if (MENTION) lines.push(MENTION);
  if (entry.isRepost && REPOST_NOTE) {
    const note = REPOST_NOTE.replace("{weekday}", entry.originalWeekday || "earlier");
    lines.push(`-# ${escapeMarkdown(note)}`);
  }
  lines.push(`**${escapeMarkdown(truncate(title, 200))}**`);

  if (body) lines.push("", truncate(body, 1500));
  lines.push("", `-# ${escapeMarkdown(entry.course)}`);

  return {
    content: truncate(lines.join("\n"), 2000),
    // Suppress link previews for any URLs inside the announcement body.
    flags: 4,
    // Allow the @everyone ping above, but keep any role or user mentions
    // inside the announcement text inert.
    allowed_mentions: { parse: ["everyone"] },
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function postToDiscord(entry, attempt = 1) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildMessage(entry)),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (response.status === 429 && attempt <= 3) {
    let waitSeconds = 5;
    try {
      const body = await response.json();
      if (typeof body.retry_after === "number") waitSeconds = body.retry_after;
    } catch {
      // Fall back to the default wait.
    }
    console.log(`Rate limited. Waiting ${waitSeconds}s before retrying.`);
    await sleep(waitSeconds * 1000 + 250);
    return postToDiscord(entry, attempt + 1);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Discord returned ${response.status}: ${body.slice(0, 300)}`);
  }
}

// On a posting day, each feed contributes its current weekly announcement
// (the newest entry still inside the freshness window) plus anything inside
// that window we have never posted at all.
function selectForFeed(entries, state, now) {
  const inWindow = entries.filter((entry) => {
    const age = ageInDays(entry, now);
    return age !== null && age >= 0 && age <= MAX_AGE_DAYS;
  });
  if (inWindow.length === 0) return [];

  const ordered = sortOldestFirst(inWindow);
  const chosen = new Map();

  // The weekly announcement: newest thing still in the window.
  const newest = ordered[ordered.length - 1];
  chosen.set(newest.id, newest);

  // Anything fresh we have not posted before (a second announcement in the
  // same week, or one that appeared on a non-posting day).
  for (const entry of ordered) {
    if (!(entry.id in state.posts)) chosen.set(entry.id, entry);
  }

  return [...chosen.values()];
}

async function main() {
  const now = currentTime();
  const { date: today, weekday } = localParts(now);
  const state = await loadState();
  const collected = [];

  console.log(`Run time: ${today} (${weekday}) in ${TIMEZONE}.`);

  for (const feed of feeds) {
    try {
      const entries = await fetchFeed(feed);
      console.log(`${feed.label}: fetched ${entries.length} entries.`);
      collected.push(...entries);
    } catch (error) {
      // One broken feed should not stop the others.
      console.error(`${feed.label}: failed to fetch - ${error.message}`);
    }
  }

  if (collected.length === 0) {
    console.error("No entries fetched from any feed. Leaving state untouched.");
    process.exit(1);
  }

  // First run: record everything as known so we don't flood the channel with
  // the entire semester's backlog.
  if (!state.bootstrapped) {
    for (const entry of collected) state.posts[entry.id] = [];
    await saveState(state.posts, now);
    console.log(
      `First run: marked ${collected.length} existing announcements as seen. Nothing posted.`
    );
    return;
  }

  if (!POST_DAYS.includes(weekday)) {
    console.log(
      `${weekday} is not a posting day (${POST_DAYS.join(", ")}). Nothing to do.`
    );
    return;
  }

  // One post per announcement per local date, so the many cron slots that
  // guard against GitHub's dropped runs cannot produce duplicate posts.
  const eligible = [];
  for (const feed of feeds) {
    const forFeed = selectForFeed(
      collected.filter((entry) => entry.course === feed.label),
      state,
      now
    );
    for (const entry of forFeed) {
      const history = state.posts[entry.id] || [];
      if (history.includes(today)) {
        console.log(`${feed.label}: already posted "${entry.title}" today.`);
        continue;
      }
      entry.isRepost = history.length > 0;
      entry.originalWeekday = entry.published
        ? localParts(new Date(entry.published)).weekday
        : null;
      eligible.push(entry);
    }
  }

  if (eligible.length === 0) {
    console.log("Nothing eligible to post today.");
    return;
  }

  const queue = sortOldestFirst(eligible).slice(0, MAX_POSTS_PER_RUN);
  let posted = 0;
  for (const entry of queue) {
    try {
      await postToDiscord(entry);
      state.posts[entry.id] = [...(state.posts[entry.id] || []), today];
      posted += 1;
      const kind = entry.isRepost
        ? `repost ${state.posts[entry.id].length}/${POST_DAYS.length}`
        : "first post";
      console.log(`Posted (${kind}): [${entry.course}] ${entry.title}`);
    } catch (error) {
      // Leave today's date unrecorded so a later run retries it.
      console.error(`Failed to post "${entry.title}": ${error.message}`);
    }
    await sleep(DELAY_BETWEEN_POSTS_MS);
  }

  await saveState(state.posts, now);
  console.log(`Done. Posted ${posted} announcement(s).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
