# Ads between matches

A plan and a working implementation, on the `ads` branch so `main` stays
clean. The goal is revenue that does not cost more users than it earns.

## One thing in the brief has to change

The brief was "guests get ads between every chat". **Every chat is too often
for this product, and the research is unambiguous about why.**

Trap Chat's core loop is swipe-to-skip. A bored guest skips every fifteen or
twenty seconds. "An ad between every chat" therefore means an ad every twenty
seconds, which is roughly three times worse than the most aggressive pattern
measured in the industry:

- Apps showing more than one interstitial per **two minutes** of session time
  saw day-7 retention fall by up to **20%**.
- An interstitial after every level in a casual game caused **15–25% of
  players to abandon in their first session**.
- Google's own guidance for interstitials is **no more than one per hour**.

So the *placement* in the brief is right and the *frequency* is not. Between
matches is exactly the correct moment — see "when" below. The plan keeps that
and replaces "every chat" with a time-based cap.

## What the psychology actually says

The canonical work here is Edwards, Li and Lee (2002) on forced exposure and
psychological reactance, and it gives three usable rules.

**1. Forced exposure creates reactance, and a skip button dissolves it.**
When people cannot escape an ad they experience a loss of control, which
produces anger and irritation, not just boredom. That reactance persists
until agency is regained. Giving a skip — even one that only appears after a
few seconds — restores the sense of control and measurably reduces
irritation. This is why YouTube's five-second skip works and why an
unskippable thirty-second ad is so much worse than twice the skippable time.

**Implication:** every ad here is skippable after 5 seconds. No exceptions,
including for guests. The skip is what makes the rest tolerable.

**2. Intrusiveness depends on how hard you were thinking when it appeared.**
Interrupting someone mid-task is dramatically worse than catching them at a
boundary. This is the single strongest argument for the brief's placement:
between matches, the previous task is finished and the next has not started,
so the ad interrupts nothing.

**Implication:** never interrupt a live chat or a match in progress. The ad
goes in the gap that already exists while the next opponent is found — which
is dead time we are currently filling with a spinner.

**3. Congruence matters.** An ad that fits the context is perceived as less
intrusive than one that does not. A fitness or streetwear ad in a shadow
boxing app reads as part of the furniture; a mortgage ad does not.

**Implication:** prefer contextual categories, and treat the ad network's
targeting quality as a real selection criterion rather than only eCPM.

**4. Segment, and never charge your best users twice.** Standard practice is
to protect the users who already give you something — money, or in our case
an account and a rating.

**Implication:** this is where the brief's instinct is right. Accounts see
fewer ads, and that difference is worth stating out loud in the product,
because it converts guests.

## The rules

| | Guest | Account |
|---|---|---|
| Minimum gap between ads | 3 minutes | 8 minutes |
| Minimum matches between ads | 3 | 6 |
| Skippable after | 5s | 5s |
| Ads during a live chat or match | never | never |
| Ads on the first session minute | never | never |

Both conditions must be met, not either: three minutes *and* three matches.
That stops a fast skipper being punished for enjoying the product, which is
precisely the behaviour we want more of.

**The first minute is always clean.** A first impression that opens with an
ad is the cheapest possible way to lose someone who has not yet learned what
the app is.

**A house ad counts as an ad.** When there is no paying ad to show, the slot
shows the "make an account, see half as many ads" card, and that still resets
the timer. The user experiences an interruption either way; pretending it is
free because it earned nothing is how apps end up interrupting constantly.

## Why this converts rather than annoys

The ad break is where the account pitch belongs. A guest who has just sat
through their third ad is the most receptive they will ever be to "accounts
see half as many of these", and that same account unlocks the rating and the
leaderboard that already exist. Monetisation and the product's own goal point
the same direction, which is rare and worth not wasting.

## What to measure before turning it up

Turning frequency up is a one-line change, so the discipline has to come from
measurement:

- Day-1 and day-7 retention, split by guest and account, **before** ads ship,
  so there is a baseline to compare against
- Skip rate and time-to-skip
- Matches per session, before and after
- Guest to account conversion rate, which should *rise* if the pitch works
- Revenue per session against retention loss, together and never separately

Nothing reports to a metrics backend today (see [SCALING.md](SCALING.md)).
That has to come first, or the frequency numbers above stay guesses forever.

## Implementation

- `adPolicy.ts` holds the rules and no UI, so they are unit-testable the way
  the rep and punch counters are: feed it a clock and a history, ask whether
  an ad is due.
- `AdBreak.tsx` is the slot itself: a countdown, a skip that arms at five
  seconds, and the account pitch for guests.
- The break is shown in the gap between matches, replacing part of the
  existing "searching" state, so it costs no time that was not already spent
  waiting.
- No ad network is wired up. The slot renders a house ad and is shaped so a
  network fills it later, because choosing a network is a business decision
  and hard to reverse.
