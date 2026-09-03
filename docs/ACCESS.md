# Signing in

Until this build, "who are you" was a name typed into a box. That was fine
while the app only needed attribution — a name against a move, a name
against an outcome. It stops being fine now that the dashboard reads those
names back as a judgement on a coordinator's decisions, because anybody
could type anybody's name.

So there is now a real login: you enter your email, a six-digit code
arrives in your inbox, you type it in. No passwords to forget, reset or
share, which matters for a department where people rotate shifts and use
whatever device is on the desk.

**It ships switched off.** Turning a login screen on before email delivery
is known to work would lock the whole department out of the tool they run
their day on, and the only way back would be a redeploy. The gate reads a
stored setting; the setting starts off; and the screen that turns it on
(Roster → Access) will not let you turn it on until you have received a
real code yourself. Work through this page first, prove it end to end, then
flip it.

---

## 0. Put everyone's work email on the team list first

**Roster → Team → Work email.** Do this before anything else, because it is
the one step that cannot be undone quietly.

A signed-in session gives the app an email address. To write history under
the name the board already uses, it has to match that address to a team row.
Where it cannot, it falls back to the address itself — so
`kajamohideen.mugusin@…` starts filing work under "Kajamohideen Mugusin"
while every schedule ever written says "Kaja". One person, two histories,
and the *who did what* table split down the middle.

The Access panel counts them for you and will not let you forget the
coordinators, who are the people who will use this most.

These addresses are already on the team list, so this step is done for the
office:

| Person | Work email | |
|---|---|---|
| Haris | haris@deluxehomes.com | coordinator |
| Kaja | kajamohideen@deluxehomes.com | coordinator |
| Tiyana | tiyana@deluxehomes.com | coordinator |
| Monish | monishraj@deluxehomes.com | manager |
| Vipul | vipul@deluxehomes.com | **administrator** |

They are filled in on any list that does not already have them, without
overwriting anything typed by hand. Everyone else — the technicians — has a
blank Work email box waiting, and **Add someone** on the team list takes a
person who is not on it at all.

**The administrator is the only one who can switch sign-in back off.**
Everything else in the app stays open to everybody on purpose: a maintenance
department does not need permission tiers to schedule a job, and every
action already carries a name. This one control is different because getting
it wrong shuts the whole team out. Mark another administrator by ticking
`admin` on their team row.

## 1. Add the people who are allowed in

In the Supabase dashboard: **Authentication → Users → Add user → Send
invitation**. Add one for each person who should be able to open the app.

Use the same email address that is on their row in **Roster → Team**. That
is how the app knows that `haris@…` is Haris the coordinator and not just
an anonymous session — it matches the signed-in email against the team
list, and the name it stamps on events comes from there. An address with no
matching team row can still sign in, but everything it does is recorded
against the bare email address, which is worth avoiding.

Nobody who is not in this list can get in. The app calls Supabase with
`shouldCreateUser: false`, which means a code is only ever sent to an
address that already exists. Somebody who finds the URL and types their own
email gets told the address is not set up, not a code.

## 2. Make sure the email actually arrives

**This project uses Supabase's built-in email sender rather than its own
SMTP.** That was a deliberate choice, and it is workable for five office
addresses, but it has two hard edges that decide how the rollout has to be
done.

**It is rate-limited to a couple of messages an hour.** That is a project-wide
limit, not per person. It is survivable here only because a code is *not* a
daily event: Supabase keeps the session in the browser and refreshes it on
its own, so somebody who signs in once stays signed in for weeks. A code is
needed when a person uses a new device, clears their browser, opens a
private window, or signs out.

What that means in practice:

- **Stagger the first sign-ins.** Five people signing in over five minutes
  will hit the limit and the last three will get nothing, with no error that
  explains why. Do them a few at a time, or one person per day.
- **Do not extend sign-in to the sixteen technicians on this sender.** A
  shift's worth of first-time sign-ins is far beyond a couple an hour. If
  the field team ever needs to sign in, configure SMTP first (Project
  Settings → Authentication → SMTP Settings — any provider).

**It may only deliver to addresses on the Supabase account.** Depending on
the project, the built-in sender will refuse addresses outside the Supabase
organisation. If that applies here, `vipul@deluxehomes.com` receives codes
and `haris@deluxehomes.com` does not — and testing with your own address
tells you nothing, because yours is the one that works either way.

**This is why the Access panel will not unlock on your own address.** It
waits for a code proved against one of the *coordinators'* addresses. You
will usually not have their mailbox, so the way to do it is to send the test
code to Haris, Kaja or Tiyana and ask them to read the six digits back to
you. That is one phone call, and it is the only thing that actually proves
the department can get in tomorrow morning.

If a coordinator's address is refused, you have found the restriction, and
SMTP is no longer optional — configure it before going any further.

Then check the code template: **Authentication → Email Templates → Magic
Link**. It must contain `{{ .Token }}` — that is the six-digit code. The
default template is a clickable link, and a link is not what this app
expects; the sign-in screen asks for a typed code so that it works when the
email is read on a phone and the app is open on the office desktop.

A template that works:

```
<h2>Your DHH Job Intake code</h2>
<p>Enter this code to sign in:</p>
<p style="font-size:28px;letter-spacing:4px"><b>{{ .Token }}</b></p>
<p>It expires in an hour. If you did not ask for it, ignore this email.</p>
```

## 3. Prove it, then switch it on

Open **Roster → Access**. Send a test code to **a coordinator's address**,
have them read the six digits back, and type them in. Only then does the
switch become usable, and only a coordinator's address counts — see section
2 for why your own proves the wrong thing. The one failure that cannot be
recovered from inside the app is turning on a lock whose key does not
arrive.

Turning it on signs out everybody who is not on the invited list, straight
away and without warning them. That is the point of it — but tell the
coordinators first, because their next page load becomes a sign-in screen.

Once it is on, anyone opening the app sees the sign-in screen.

## 4. If you get locked out anyway

The setting is a row in the same `kv_store` table as everything else. In
the Supabase SQL editor:

```sql
update kv_store set value = 'false' where key = 'auth-required';
```

The app is open again on the next reload. Keep this page where whoever
administers the Supabase project can find it.

---

## Tightening the database

The login gate controls the app. It does not, on its own, control the
database — the anon key is in the browser bundle, so anybody who has ever
had the URL can still read and write `kv_store` directly with it. Turning
the gate on stops them using the *board*; it does not stop them using the
*key*. If the reason for switching sign-in on is that people who were given
the link have been changing things, this section is the half that actually
takes the key away, and it should follow within a day or two.

**The SQL that was written here before was wrong, and would have opened the
app rather than closing it.** It granted read and write to `authenticated`
and nothing at all to `anon` — but the app reads the `auth-required` flag
*before* anybody has signed in, to decide whether to show the sign-in
screen. With no policy for `anon` that read fails, `storageGet` returns
null, the flag reads as "not required", and the app renders with **no
sign-in screen at all** while every other request is denied. Open and
broken at the same time. The version below gives the anonymous role read
access to that one key and nothing else.

Run this once the department has been signing in normally for a day:

```sql
alter table kv_store enable row level security;

-- Exactly one key, read-only, to the anonymous role. This is what lets the
-- app know a login is required before there is anybody to authenticate.
create policy "anon reads the login flag" on kv_store
  for select to anon using (key = 'auth-required');

-- Everything else needs a session.
create policy "signed-in reads" on kv_store
  for select to authenticated using (true);

create policy "signed-in inserts" on kv_store
  for insert to authenticated with check (true);

create policy "signed-in updates" on kv_store
  for update to authenticated using (true) with check (true);
```

Check it landed:

```sql
select policyname, roles, cmd, qual
from pg_policies where tablename = 'kv_store';
```

Three things to know before you run it:

- **Do it in this order.** Enable the login gate, confirm the department is
  signing in normally for a day, and only then enable row level security.
  The reverse order breaks the app for everyone at once — and note that
  with RLS on, the "Turn sign-in on" button itself needs a session, because
  it writes that flag.
- **There is deliberately no DELETE policy.** Deletes are denied to
  everybody, including signed-in users. Nothing in this app is ever
  deleted — a job is cancelled, a material line is voided, a day is
  archived before it is cleared — so the database may as well enforce what
  the app already promises.
- **This is all-or-nothing access**, not per-person permissions. Every
  signed-in user can read and write every day's schedule, which is what the
  department actually does — a coordinator posts, an admin verifies, a
  supervisor reads. If you later want the admin to be the only one who can
  unlock a posted day, that is a policy on the `posted:*` keys, and it needs
  the role stored somewhere the database can see rather than in the team
  list.

### Getting the old link out of circulation today

Both steps above depend on email delivery you have not proved yet. If
people who were given the link are changing the board *now*, the fastest
thing that costs nothing is to **change the Vercel project's domain**:
Vercel → the project → Settings → Domains → rename it. The old URL stops
resolving immediately, the app keeps working, and the coordinators are told
the new address. It is not authentication and it does not replace anything
above — anybody who kept the bundle still holds the anon key — but it ends
casual poking around the same afternoon.

## What is stored about a person

The email address, and the name and role from their team row. Sessions are
kept by Supabase in browser storage and refresh themselves; signing out
clears them. The app never sees or stores a password, because there is not
one.
