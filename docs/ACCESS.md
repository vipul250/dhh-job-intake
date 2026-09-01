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

Supabase's built-in email sender is rate-limited to a handful of messages
per hour and is meant for development. A maintenance department signing in
across a morning shift will hit that limit and people will simply stop
receiving codes, with no error to explain why.

Configure your own SMTP before turning the gate on: **Project Settings →
Authentication → SMTP Settings**. Any provider works. Fill in host, port,
username, password, and a sender address on a domain you control.

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

Open **Roster → Access**. Enter your own email, request a code, and type
the code in. Only once that succeeds does the switch become usable. This is
deliberate: the one failure that cannot be recovered from inside the app is
turning on a lock whose key does not arrive.

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
database — the anon key in the browser bundle can still read and write
`kv_store` directly. That was an acceptable trade while the app was an
internal tool behind an unlisted URL and identity was a typed name. It is
worth closing now.

Run this once you are confident sign-in works for everyone, because it
makes the app unusable for anyone not signed in:

```sql
alter table kv_store enable row level security;

create policy "signed-in users read" on kv_store
  for select to authenticated using (true);

create policy "signed-in users write" on kv_store
  for insert to authenticated with check (true);

create policy "signed-in users update" on kv_store
  for update to authenticated using (true);
```

Two things to know before you run it:

- **Do it in this order.** Enable the login gate, confirm the department is
  signing in normally for a day, and only then enable row level security.
  The reverse order breaks the app for everyone at once.
- **This is all-or-nothing access**, not per-person permissions. Every
  signed-in user can read and write every day's schedule, which is what the
  department actually does — a coordinator posts, an admin verifies, a
  supervisor reads. If you later want the admin to be the only one who can
  unlock a posted day, that is a policy on the `posted:*` keys, and it needs
  the role stored somewhere the database can see rather than in the team
  list.

## What is stored about a person

The email address, and the name and role from their team row. Sessions are
kept by Supabase in browser storage and refresh themselves; signing out
clears them. The app never sees or stores a password, because there is not
one.
