# canvas-announcements-to-discord

Posts new Canvas course announcements to a Discord channel, with Canvas
formatting (bold, italics, headings, lists, links) converted to Discord
markdown. Runs on a GitHub Actions schedule, so there is no server to maintain.

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
| `state/seen.json` | Remembers which announcement IDs have already been posted |

## Setup

### 1. Create your repository

Click **Use this template** → **Create a new repository**. That gives you an
independent copy with its own history.

### 2. Confirm the state file is empty

Open `state/seen.json`. It must read exactly:

```json
{
  "bootstrapped": false,
  "seenIds": []
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

The cron in `poll.yml` is `5,35 15,16 * * *` — four runs at 15:05, 15:35, 16:05
and 16:35 UTC. During US Central daylight time that's 10:05 through 11:35 AM,
sized for a course that posts announcements around 10:00 AM.

**Adjust this for your own timezone and posting time.** GitHub cron is UTC only
and has no daylight-saving awareness, so a single precisely-timed run drifts by
an hour twice a year. Running a few times in a window is more robust than
running once: duplicate runs cost nothing, because anything already posted is
skipped.

Scheduled runs are best-effort. They are commonly several minutes late and are
occasionally skipped entirely under load, which is the other reason to schedule
more than one attempt.

**Scheduled workflows only run from the default branch.** If `poll.yml` lives on
any other branch, the schedule is ignored.

## Customizing the post

Near the top of `index.js`:

- `MENTION` (default `"@everyone"`) — prefixed to every post. Set to `""` for no
  mention, or use `"@here"` or a role like `"<@&123456789>"`.
- `MAX_POSTS_PER_RUN` (default 10) — caps messages per run so a burst doesn't hit
  Discord's rate limit. Leftovers post on the next run.
- `MAX_REMEMBERED_IDS` (default 500) — how many IDs to keep before old ones roll
  off.
- `DELAY_BETWEEN_POSTS_MS` (default 1200) — spacing between messages.

In `buildMessage`, the body is capped at 1500 characters and the course label is
the `-#` line at the end. In `htmlToMarkdown`, headings map to `#`/`##`/`###`;
if your instructors use headings for ordinary sentences, changing those to `**`
renders them as bold instead.

## Testing without waiting for a new announcement

Open `state/seen.json`, delete one ID from `seenIds`, commit, and run the
workflow manually. That announcement is treated as new and posts once. The run
re-adds the ID, so it won't repeat. Handy for previewing formatting changes.

## Things worth knowing

**Failed posts retry automatically.** If Discord rejects a message, that ID is
deliberately left out of the state file so the next run tries again.

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
