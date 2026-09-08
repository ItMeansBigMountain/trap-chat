# Who Trap Chat is for

Written after using it as a stranger would: on a phone, cold, with no idea
what it is. It is deliberately critical. The flattering version of this
document would be useless.

## What the product actually is

Random video chat with strangers, plus four one-minute competitive games
scored by the camera on your own device: push-ups, squats, shadow boxing, and
a facial symmetry contest. A rating and leaderboards sit behind an account.

The honest one-line description is **"Omegle with a scoreboard"** — and that
is a better product than either half alone, because the games solve the thing
random video chat has never solved: what to do in the first ten seconds with
somebody you have nothing to say to.

## The ideal customer

**A 17–24 year old man who is already doing this in worse ways.**

He is on TikTok for two hours a day and does not enjoy most of it. He has
tried Omegle or one of its successors and left because it was mostly men
looking for something else and nothing ever happened. He does some kind of
training — a gym, a bag in the garage, push-ups in his room — and he is
competitive about it in a way that has nowhere to go, because nobody scores a
set of push-ups.

He plays with his phone propped against something. He has three to fifteen
minutes. He wants to feel like he did something, not like he consumed
something.

Concretely:
- **Phone first**, almost never desktop
- Already in gym / hustle / streetwear culture, which is what the name, the
  black-and-lime look and "Mog Off" are speaking to
- Comfortable on camera with strangers, or wants to become so
- Motivated by a number going up: a rep count, a rating, a leaderboard

## Secondary segments, in order of how much they matter

1. **The competitor who does not want to talk.** Comes for ranked push-ups,
   ignores social entirely. Cheap to serve, converts to an account fastest,
   because the rating is the whole point for him.
2. **The bored scroller.** Comes for random chat, may never touch a game.
   Largest group and the least loyal.
3. **The pair or the group.** Two friends in a room, using it as a shared
   activity. Currently underserved: group chat exists but nothing competitive
   is playable by more than two.

## Who it is not for

Saying this plainly stops the product being pulled apart:

- **Anyone over about 30.** The tone is not for them and never will be.
- **People who want to make friends.** There is no friends list, no history,
  no way to find anyone again. Every interaction is disposable by design.
- **Anyone who wants to be anonymous.** It is a camera app. Text-only rooms
  exist but they are not what it is for.
- **Serious fitness tracking.** Sixty seconds of push-ups is a game, not a
  training log, and pretending otherwise would attract people who leave
  disappointed.

## Does it satisfy the need? Honestly, partly

### What works

**The games genuinely differentiate it.** Nothing else in random video chat
counts your push-ups from the camera. The counting is credible: form is gated
rather than just measured, the angle is smoothed, a refused rep says why.
That is a real product, not a demo.

**Nothing to say is no longer fatal.** The most common failure of random chat
is the awkward silence. A shared sixty-second contest removes it.

**Guest-first is right for this audience.** No sign-up wall, a name and a
tap. And the account has a real reason to exist — rating and leaderboard —
rather than being demanded up front.

**The competitive screen is clear.** Four cards, a one-line explanation each,
no jargon. A stranger knows what each one is.

### What does not work yet

**The empty room is the whole problem.** Everything dead-ends when nobody
else is on: Random searches forever, Competitive says you are the only one in
the queue, Browse is empty. The app is honest about it, which is much better
than a spinner, but honesty is not a product. **Nothing tells you how many
people are around, or when to come back.** This is the single biggest gap and
no amount of polish elsewhere compensates for it.

**Nothing brings anyone back.** No notifications, no streak, no history, no
"your rating dropped", no reason tomorrow exists. A doomscroll replacement
that you have to remember to open is not a doomscroll replacement.

**There is no safety layer.** Random video chat with strangers and no report,
no block, no way to end an interaction and be sure it does not come back.
This is a product failure before it is a compliance one, and it will also
stop the app being approved on either store.

**The first action is still slow.** The screen now appears instantly, but the
container sleeps to keep the pilot free, so the first tap can wait roughly
thirty seconds while it wakes. The button says "Waking the server…", which is
honest, and it is still thirty seconds of somebody's first impression.

**Video does not always connect.** There is no TURN server, so a share of
pairs — usually mobile networks — connect the signalling and then never see
each other. The failure rate is finally being measured; the fix costs money.

## What I would build next, in this order

1. **Report and block.** The product cannot responsibly grow without it, and
   no store will take it.
2. **A presence signal.** "14 people online", "3 waiting for push-ups". It
   turns an empty app from broken into quiet, and tells somebody when to come
   back. Cheap, and it makes every other number honest.
3. **A reason to return.** Start with the smallest real one: your rating, and
   who passed you on the leaderboard while you were away.
4. **TURN**, once the measured failure rate says how much it is worth.
5. **Group competitive**, which is the one thing the third segment is asking
   for and the natural home for the voting that already exists.

## How to tell if this is working

The metric that matters is not sign-ups. It is **the share of sessions with at
least one completed match**, split guest and account. A session where nobody
was found is the failure mode this product has to beat, and it is now
measurable via `/api/metrics/summary`.
