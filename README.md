# canvas-announcements-to-discord

Posts Canvas course announcements to a Discord channel, with Canvas formatting
(bold, italics, headings, lists, links) converted to Discord markdown. Runs on a
GitHub Actions schedule, so there is no server to maintain.

It is built for a weekly rhythm: **one announcement written in Canvas on Friday
morning goes to Discord three times** - once on Friday, then again as a reminder
on Monday and Wednesday. Each posting carries the `@everyone` mention.

This is **not** a Discord bot. There is no bot application, no token, and no
always-on process — just a script that wakes up on a schedule, checks the
announcement feeds, and posts anything new via a webhook.

## Files

| File | What it does |
| --- | --- |
| `index.js` | Fetches feeds, filters out anything already posted, converts HTML to markdown, sends to Discord |
| `package.json` | Declares the one dependency (`fast-xml-parser`) |
| `package-lock.json` | Pins the exact dependency version — `npm ci` fails without it |
| `.github/workflows/poll.yml` | Runs the script on a schedule and commits the state file |
| `state/seen.json` | Remembers which announcements went out, and on which dates |

## Setup

### 1. Create your repository

Click **Use this template** → **Create a new repository**. That gives you an
independent copy with its own history.

### 2. Confirm the state file is empty

Open `state/seen.json`. It must read exactly:

```json
{
  "bootstrapped": false,
  "posts": {}
}
```

**This matters.** `bootstrapped: false` tells the script that its first run is a
first run: it reads every feed, records all existing announcements as
already-seen, and posts nothing. That's what stops a semester of backlog from
dumping into your channel at once. If this file arrives with IDs already in it
(because it was copied from a working repo rather than the template), reset it
to the above before going any further.

### 3. Get your Discord webhook URL

In the Discord server where you want announcements posted:

1. Right-click the target channel → **Edit Channel**
2. **Integrations** → **Webhooks** → **New Webhook**
3. Name it, pick the channel, then **Copy Webhook URL**

Treat that URL like a password — anyone with it can post to that channel. You
need the Manage Webhooks permission, so on someone else's server an admin has to
do this part.

If you want the `@everyone` ping to actually notify people, the channel also has
to allow mentioning everyone. Discord will accept the message either way; it
just won't ping if the permission is denied.

### 4. Get your Canvas feed URLs

Open each course in Canvas, go to its **Announcements** page, and find the
RSS/Atom feed link — usually an orange RSS icon or a "Subscribe to course
announcements feed" link near the bottom of the page or in the sidebar. Copy
that URL.

The URL contains a long token tied to your account. **Treat each feed URL as a
secret.** Don't commit it and don't paste it into Discord. It goes into a GitHub
secret in the next step.

### 5. Add the two repository secrets

**Settings** → **Secrets and variables** → **Actions** → **New repository
secret**.

**`DISCORD_WEBHOOK_URL`** — the webhook URL from step 3, nothing else.

**`CANVAS_FEEDS`** — one course per line, formatted `Label|URL`. The label
appears as small grey text at the bottom of each Discord post:

```
Honors Chemistry|https://yourschool.instructure.com/feeds/announcements/...atom
AP World History|https://yourschool.instructure.com/feeds/announcements/...atom
```

Adding a class later means editing this secret and adding one line. Lines
starting with `#` are ignored.

### 6. Run it manually

**Actions** tab → enable workflows if GitHub shows a banner → **Poll Canvas
announcements** → **Run workflow**.

Expand the "Check for new announcements" step. You should see one line per feed
with an entry count, then a message saying it marked those as seen and posted
nothing. A zero entry count means the feed URL is wrong or expired.

Run it a second time; it should say "No new announcements." After that the
schedule takes over.

## Schedule

Two things decide when a post happens, and they do different jobs.

**`POST_DAYS` in `index.js`** is the real schedule: `["Fri", "Mon", "Wed"]`.
The script evaluates the weekday in `TIMEZONE` (default `America/Chicago`), so
it follows local days and does not drift with daylight saving.

**The cron in `poll.yml`** just decides how often the script gets a chance to
run: `7,37 13-21 * * 1,3,5`, which is every 30 minutes across the local morning
and early afternoon on Mon/Wed/Fri - 18 attempts per day.

That many attempts is deliberate. GitHub's scheduled runs are best-effort: the
docs say they can be delayed or dropped under load, and in practice they are
sometimes hours late. The script posts each announcement **at most once per
local calendar date**, so extra runs cannot produce duplicate posts. They only
raise the odds that at least one run lands while the announcement is fresh.

Because the script re-checks the weekday itself, a cron slot that fires on an
unintended day is a no-op rather than a stray post.

**If your Canvas post happens at a different time**, widen or shift the UTC
hours in the cron. US Central is UTC-6 in winter and UTC-5 in summer, so
`13-21` UTC covers 07:07-15:37 local in winter and 08:07-16:37 in summer.

**If you are in a different timezone**, change `TIMEZONE` in `index.js` to your
IANA zone (for example `America/New_York`, `Europe/London`) and shift the cron
hours to match. `TIMEZONE` controls which local day a run counts as; the cron
controls when runs happen.

**Scheduled workflows only run from the default branch.** If `poll.yml` lives on
any other branch, the schedule is ignored.

## How the reposting works

Each run, on a posting day, the script:

1. Fetches the feeds and finds the newest announcement still inside the
   freshness window (`MAX_AGE_DAYS`, default 6 days).
2. Skips it if it has already been posted on today's local date.
3. Otherwise posts it, and records today's date against that announcement.

So one Canvas announcement produces one post on each of Friday, Monday and
Wednesday. The second and third carry a small `Reminder - originally posted
Fri` subtext line so members can tell a reminder from the original.

**The freshness window is what makes a missed week safe.** If nobody posts to
Canvas one Friday, the previous week's announcement is by then more than 6 days
old, so it is not reposted - the channel simply stays quiet. The window has to
be at least 5 days (Friday to Wednesday) and less than 7 (Friday to the
following Friday), which is why 6 is the default. **If you move the Canvas post
to Thursday, raise `MAX_AGE_DAYS` to 7**, or the Wednesday reminder will fall
outside the window.

Anything new that appears inside the window is also posted on the next posting
day, so a second announcement in the same week is not lost.

## Customizing the post

Near the top of `index.js`:

- `POST_DAYS` (default `["Fri", "Mon", "Wed"]`) — the days an announcement goes
  out. Three entries means three postings. Use short weekday names.
- `TIMEZONE` (default `"America/Chicago"`) — the zone the weekday and the
  once-per-day rule are evaluated in.
- `MAX_AGE_DAYS` (default 6) — how fresh an announcement must be to be posted or
  reposted. See the freshness note above before changing it.
- `REPOST_NOTE` (default `"Reminder - originally posted {weekday}"`) — the
  subtext line on the 2nd and 3rd posting. `""` removes it, making all three
  postings identical.
- `MENTION` (default `"@everyone"`) — prefixed to every post. Set to `""` for no
  mention, or use `"@here"` or a role like `"<@&123456789>"`.
- `MAX_POSTS_PER_RUN` (default 10) — caps messages per run so a burst doesn't hit
  Discord's rate limit. Leftovers post on the next run.
- `MAX_REMEMBERED_IDS` (default 500) — how many announcements to remember before
  old ones roll off.
- `DELAY_BETWEEN_POSTS_MS` (default 1200) — spacing between messages.
- `REQUEST_TIMEOUT_MS` (default 20000) — ceiling on any single HTTP request, so a
  stalled Canvas connection cannot hang the job.

In `buildMessage`, the body is capped at 1500 characters and the course label is
the `-#` line at the end. In `htmlToMarkdown`, headings map to `#`/`##`/`###`;
if your instructors use headings for ordinary sentences, changing those to `**`
renders them as bold instead.

## Testing without waiting for a new announcement

**To replay the current announcement**, open `state/seen.json` and delete
today's date from that announcement's list (or delete its whole entry), commit,
and run the workflow manually. It will post again on the next run.

**To test the schedule without waiting for the day**, set `OVERRIDE_NOW` to an
ISO timestamp and the run is evaluated as if it were that moment. Locally:

```
OVERRIDE_NOW=2026-11-09T09:07:00-06:00 node index.js
```

Leave it unset in normal operation.

## Things worth knowing

**Failed posts retry automatically.** If Discord rejects a message, today's date
is deliberately left unrecorded, so a later run that day tries again.

**Upgrading from the earlier one-post-per-announcement version** is automatic.
The old `seenIds` list is converted on first run, and each entry is credited
with one prior posting - so the changeover week gets its Monday and Wednesday
reminders without the backlog being reposted.

**A broken feed doesn't stop the others.** Each feed is fetched independently;
failures are logged and the rest continue.

**Workflows auto-disable after 60 days of repository inactivity.** State commits
normally keep this at bay, but a long break with no announcements means no
commits. GitHub emails you if it disables the workflow; re-enable from the
Actions tab.

**Private repos consume Actions minutes** from your monthly allowance. Four short
runs a day is a small fraction of it. Public repos don't consume minutes at all.

**Canvas feeds return a limited number of recent announcements** (commonly 15).
If more than that were posted between two runs, the oldest would scroll off
before the script saw them.
