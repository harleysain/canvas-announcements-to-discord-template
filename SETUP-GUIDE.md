# Setting up Canvas announcements in Discord

This walks you through connecting a Canvas class to a Discord channel.

One announcement written in Canvas on Friday morning gets posted to Discord
three times: on Friday, then again as a reminder on Monday and Wednesday. Each
one notifies the channel with `@everyone`.

**You don't need to know how to code.** You'll be copying and pasting a few web
addresses. Plan on about 20 minutes.

You'll be working in three places: Discord, Canvas, and GitHub. GitHub is the
service that runs the automation on a schedule — think of it as the machine that
checks Canvas for you every morning.

---

## Step 1 — Make a GitHub account

Go to [github.com](https://github.com) and sign up if you don't already have an
account. The free plan is all you need. Verify your email before continuing, or
some buttons won't appear.

---

## Step 2 — Make your own copy of the project

Open the link you were sent. Near the top of the page there's a green button
that says **Use this template**. Click it, then choose **Create a new
repository**.

On the next screen:

- **Repository name**: anything you like — `canvas-to-discord` works fine
- **Private**: leave it selected

Click **Create repository**.

You now have your own copy. Nothing you do here affects anyone else's.

> **What's a repository?** It's just a folder of files that lives on GitHub.
> You won't need to edit any of them.

---

## Step 3 — Create the Discord webhook

A webhook is a private web address that lets something post messages into one
specific Discord channel.

You need the **Manage Webhooks** permission on the server. If it's not your
server, ask an admin to either do this step for you or give you that permission.

1. In Discord, find the channel where announcements should appear
2. Hover over the channel name, click the **gear icon** (Edit Channel)
3. In the left sidebar, click **Integrations**
4. Click **Webhooks**, then **New Webhook**
5. Give it a name — "Canvas" is fine — and confirm the channel is right
6. Click **Copy Webhook URL**

Paste it somewhere safe for a minute — a notes app, a draft email to yourself.
You'll need it in Step 5.

> **Keep this private.** Anyone who has this address can post messages into that
> channel. Don't share it or post it in chat.

**One more thing while you're here:** for the `@everyone` ping to actually
notify people, the channel has to allow mentioning everyone. If you're not sure,
just continue — you'll find out when the first message arrives, and an admin can
flip that setting later.

---

## Step 4 — Get the Canvas feed address

Canvas can publish a course's announcements as a "feed" — a web address that
lists recent announcements in a format programs can read.

1. Log into Canvas and open the course you want
2. Click **Announcements** in the course menu
3. Look for an **RSS** link or an orange RSS icon. It's usually near the bottom
   of the page, or in the sidebar on the right. It might say something like
   "Subscribe to course announcements feed"
4. Right-click it and choose **Copy link address**

Paste that somewhere safe too.

> **Can't find it?** Canvas looks different from school to school, and some
> schools turn this off. Take a screenshot of your Announcements page and send
> it over — it's usually findable, just tucked away somewhere odd.

> **Keep this private too.** That address has a long random code in it that's
> tied to your Canvas account.

---

## Step 5 — Tell GitHub your two addresses

Back on your GitHub repository page.

1. Click **Settings** (in the row of tabs across the top: Code, Issues, ...,
   Settings). If you don't see it, you may be on the wrong page — go back to
   your repository first
2. In the left sidebar, find **Secrets and variables**, click it, then click
   **Actions** underneath it
3. Click the green **New repository secret** button

**Add the first one:**

- **Name**: `DISCORD_WEBHOOK_URL`
- **Secret**: paste your Discord webhook address from Step 3
- Click **Add secret**

The name has to match exactly — all capitals, underscores between words, no
spaces.

**Add the second one.** Click **New repository secret** again:

- **Name**: `CANVAS_FEEDS`
- **Secret**: type a short label for the class, then a `|` character (shift +
  backslash), then paste your Canvas feed address from Step 4. All on one line,
  no spaces around the `|`. For example:

  ```
  Honors Chemistry|https://canvas.yourschool.edu/feeds/announcements/...
  ```

  The label is what shows in small grey text at the bottom of each Discord post,
  so make it something readable.

- Click **Add secret**

> **Adding more classes later?** Come back here, click the pencil icon next to
> `CANVAS_FEEDS`, and add another line in the same `Label|address` format.

> **Why "secrets"?** GitHub stores these encrypted and hides them from the logs.
> Once saved, you can replace them but not read them back — so keep your own
> copy of both addresses somewhere.

---

## Step 6 — Turn it on and test it

1. Click the **Actions** tab at the top of your repository
2. If you see a green banner asking you to enable workflows, click the button to
   enable them
3. In the left sidebar, click **Poll Canvas announcements**
4. On the right, click **Run workflow**, then the green **Run workflow** button
   in the little dropdown

Wait about 30 seconds and refresh the page. A new run appears at the top.

**Click it, then click the "poll" box, then click the line that says "Check for
new announcements"** to expand the log.

**What you should see:**

```
Honors Chemistry: fetched 15 entries.
First run: marked 15 existing announcements as seen. Nothing posted.
```

**Nothing appearing in Discord is correct here.** The first run deliberately
posts nothing — it reads all the announcements that already exist and marks them
as "already handled" so your channel doesn't get flooded with a semester of old
announcements. From now on, only genuinely new ones get posted.

**If you see `fetched 0 entries`,** the Canvas address isn't right. Go back to
Step 4.

**If the run fails with a red X,** click into it and read the error. Send a
screenshot if it isn't obvious.

---

## Step 7 — Check that it repeats

Run it one more time the same way. This time the log should say:

```
No new announcements.
```

That means it's remembering correctly. You're done with setup.

---

## Step 8 — Check the timezone

The schedule is already set up for Monday, Wednesday and Friday. The one thing
worth checking is the timezone, because that decides which local day a run
counts as.

1. Go to the **Code** tab and click `index.js`
2. Click the **pencil icon** (top right) to edit
3. Near the top, find this line:

   ```
   const TIMEZONE = "America/Chicago";
   ```

4. If you are not in US Central time, replace it with your own zone — for
   example `"America/New_York"`, `"America/Denver"`, `"America/Los_Angeles"`, or
   `"Europe/London"`
5. Click **Commit changes**, then **Commit changes** again in the popup

**If your Canvas announcement goes up outside roughly 7 AM – 3 PM your local
time**, the checking window needs shifting too. That one is fiddlier (the
schedule is written in UTC), so send a message rather than guessing — say what
time the announcement usually appears and it can be adjusted for you.

> **Why it checks so many times.** The schedule runs every 30 minutes through
> the morning on those three days. GitHub's scheduled jobs are unreliable —
> often minutes late, sometimes skipped entirely — so checking often is how you
> make sure at least one lands. It cannot cause duplicate posts: the same
> announcement is only ever posted once per day, no matter how many times the
> check runs.

## What to expect from here

The next time an announcement is posted in Canvas on a Friday morning, it shows
up in Discord at the next scheduled check — with `@everyone`, the title in bold,
and the text with its formatting preserved. The same announcement is posted
again on Monday and on Wednesday, with a small "Reminder" line above the title.

**If nobody posts to Canvas one week, Discord stays quiet.** The reminders only
repeat an announcement from the last few days, so an old one never gets dragged
back up.

**It only looks back a little way.** Canvas feeds typically only list the 15 most
recent announcements, and checks happen in a window each morning, so an
announcement posted after the last check waits until the next day's window.

**If it ever goes quiet for a couple of months,** GitHub may email you saying the
automation was disabled for inactivity. Go to the **Actions** tab and click to
re-enable it.

## Want to see what a post looks like right now?

You don't have to wait for a new announcement:

1. **Code** tab → click the `state` folder → click `seen.json`
2. Click the **pencil icon** to edit
3. Find the most recent `"tag:canvas..."` entry. It has a list of dates under
   it. Delete the dates, leaving `[]` — so it looks like:

   ```
   "tag:canvas.instructure.com,...": [],
   ```

4. **Commit changes**
5. **Actions** tab → **Poll Canvas announcements** → **Run workflow**

If today is a Monday, Wednesday or Friday, and that announcement is less than
six days old, it posts to Discord again. If nothing appears, it is one of those
two conditions — the log for the run will say which.
