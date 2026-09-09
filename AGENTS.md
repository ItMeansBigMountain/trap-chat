# Trap Chat — working agreements for agents

Read this before changing anything. It records decisions that are already
settled, so they do not get re-litigated or accidentally reverted.

Multiple agents work on this repo concurrently. **Never force-push, revert,
or broadly reformat work you did not write.** Always `git fetch origin` and
re-check for divergence immediately before pushing.

## Current deployment

| What | Value |
|---|---|
| Frontend | https://zealous-bay-02a100210.3.azurestaticapps.net |
| Backend | https://trap-chat-api.bluerock-306ed9db.centralus.azurecontainerapps.io |
| Health | `/api/health` |
| Subscription | `4f070006-f5e7-471d-a859-b15a2a8ee406` (oyamaProductions) |
| Resource group | `rg-trap-chat-prod` (Central US) |
| Container App | `trap-chat-api` in env `cae-trap-chat-prod` |
| Static Web App | `stapp-trap-chat-prod` |
| Durable storage | Azure Files share `trapchat-data` on `trpchat4f070006f5`, mounted at `/data` |

Both hostnames contain generated segments and change whenever the
resource is recreated, as the Central US move proved. Never hardcode
either one: the frontend build reads the backend FQDN from Azure, and
Terraform reads the frontend hostname off the Static Web App resource.

## Delivery model: push to deploy

There are **no manual deployments and no manual applies**. Nothing is
created by hand in the Azure Portal, and no one is expected to click "Run
workflow" as part of normal operation. You ship a change by pushing it.

The single exception is the infrastructure **approval gate** described
below, which is a review step, not a manual deployment step.

## Three pipelines, one per component, two stages each

Pipelines are organised by component, not by stage. Each has exactly two
jobs so a run shows two bubbles, and the second waits on a manual approval.

| Pipeline | File | Stage 1 | Stage 2 (gated) |
|---|---|---|---|
| `frontend CICD` | `.github/workflows/frontend-cicd.yml` | Build: typecheck, web export, upload bundle | Deploy: publish that bundle to Static Web Apps, verify |
| `backend CICD` | `.github/workflows/backend-cicd.yml` | Build: pytest, build image, push to GHCR | Deploy: roll out to Container Apps, verify health |
| `infra CICD` | `.github/workflows/infra-cicd.yml` | Plan: fmt, validate, plan into the run summary | Apply: apply the reviewed plan |

The frontend deploy publishes the **artifact the build produced**, so
approving ships exactly what was reviewed rather than rebuilding.

Rules that follow from this shape:

- **Pull requests never deploy.** Deploy steps are guarded with
  `if: github.event_name != 'pull_request'`. PRs run tests and builds only.
- **A successful `infra CICD` run re-triggers both app pipelines** via
  `workflow_run`, so newly created infrastructure immediately receives the
  current image and a frontend built against the real backend URL. If you
  rename a workflow, fix the `workflow_run.workflows` reference too.
- **Each pipeline keeps its own `concurrency` group.** Do not give them a
  shared group to serialise them. GitHub allows only one running plus one
  pending run per group and **cancels** the rest, so a push that starts all
  three pipelines loses two of them outright. This was tried and reverted.
- **Both `infra CICD` and `backend CICD` modify the same Container App**,
  and Azure rejects a second concurrent modification with
  `409 ContainerAppOperationInProgress`. Each therefore polls
  `provisioningState` and waits for the in-flight operation to drain before
  touching `trap-chat-api`. Keep those waits.

## No staging environment

There is one environment and it is public. This is a decision, not an
oversight: a second environment doubles the Azure bill and halves how often
anything actually gets looked at. Pushing to `main` releases to real users, so
the tests in the pipeline are the safety net, and a broken deploy is fixed
forward rather than promoted through a staging tier.

## The approval gates

Every pipeline's second stage waits on a GitHub Environment. Each of these
must have at least one **Required Reviewer** under Settings → Environments:

| Environment | Gates |
|---|---|
| `infra-prod-apply` | `infra CICD` → Apply |
| `backend-prod` | `backend CICD` → Deploy |
| `frontend-prod` | `frontend CICD` → Deploy |

GitHub auto-creates an environment on first use with **no** protection
rules, so if that one-time setup is missing the stage runs unattended. If a
deploy ever runs without prompting you, the environment protection is not
configured. Do not add reviewers to `infra-prod`: that is the plan stage,
and gating it would mean approving a plan before you can read it.

Always read the plan for destroys before approving an apply.

## Azure architecture and why

- **Backend runs on Azure Container Apps (Consumption), not App Service.**
  This is not a preference, it is forced. This subscription has a hard
  quota of zero for App Service Plans, on both `B1` and `F1`:
  `Current Limit (F1 VMs): 0 / Amount required: 1`. Do not "fix" a
  deployment failure by switching App Service SKUs. That path is closed
  until the subscription owner obtains a quota increase.
- **Durable storage is an Azure Files share mounted into the container**
  at `/data`, holding the SQLite database. This is what makes scores and
  accounts survive restarts and redeploys. The container filesystem alone
  is ephemeral.
- **The Container App runs a single replica.** SQLite over a network file
  share is only safe with one writer, and Socket.IO keeps room and match
  state in process memory. Do not raise `max_replicas` without first
  moving that state out of process and off SQLite.
- **The Azure Files volume is mounted `nobrl`.** SQLite coordinates writers
  with POSIX byte-range locks, which Azure Files over SMB does not implement
  reliably; without `nobrl` every write fails with `database is locked` and
  the Gunicorn worker dies before binding a port. This is only safe because
  there is exactly one replica running one worker. Raising either without
  first moving off SQLite risks database corruption, not just contention.
- **Terraform seeds the initial container image; `backend CICD` owns
  rollouts.** The image is under `lifecycle.ignore_changes`, so an infra
  apply will not reset the running container to `var.backend_image` and
  silently undo the most recent application deploy.
- **The backend image is a public GHCR image**
  (`ghcr.io/itmeansbigmountain/trap-chat-backend`), pulled anonymously, so
  no registry credential is stored in Terraform state.
- **Frontend stays on the existing Azure Static Web App.** Do not delete or
  replace it. Private DNS is out of scope.
- **Vercel is not used for this project at all.** The Vercel configs and the
  `backend/api/index.py` serverless entrypoint were removed. Do not
  reintroduce them or add `VERCEL` environment branches to the backend.

## Everything lives in Central US

All resources sit in `centralus`, and every resource inherits the resource
group's location. Do not reintroduce a separate `location` variable: the
Static Web App used to read one independently, which is how the frontend
ended up in East US 2 while the backend sat in East US.

Region is a force-new property, so changing it destroys and recreates
everything, which wipes the Azure Files share and issues brand new
hostnames. If you ever have to do it again: back up
`trapchat.db` off the share first, and expect two transient failures that
clear on a re-run, a provider inconsistency recreating the Static Web App
and a 404 reading storage keys under a just-released account name.

## Frontend and backend contracts

These break silently: nothing fails to compile, the UI just renders
undefined or a handler never fires. `backend/tests/test_api_contracts.py`
guards them.

- **CORS must always negotiate credentials.** The frontend sends every
  request with `credentials: 'include'`, and a browser discards the response
  unless `Access-Control-Allow-Credentials` is true. The backend enables
  `supports_credentials` whether or not `FRONTEND_ORIGIN` is pinned;
  without it the whole UI fails against a local backend.
- **Socket event names must match exactly.** The backend relays game moves
  back out on `game_action`, not `game_state`. A listener on the wrong name
  is silent, not an error.
- **Match players are objects, not strings.** `/api/matches/quick` returns
  `players: [{display_name}]` to match the `MatchmakingResponse` interface
  and the `player_joined` event.
- **Auth cannot depend on cookies.** The frontend and backend are on
  different sites, so every cookie the backend sets is a third-party cookie:
  Chrome incognito drops it outright, which made guests fail with
  `401 guest session required`. Login and register return the JWT in the
  body, the client stores it and sends `Authorization: Bearer`, guests send
  `X-Guest-Session`, and the socket passes both in its handshake `auth`
  payload. Cookies remain only as a same-site convenience.
- **The socket's identity is fixed at handshake time.** It is captured on
  connect and kept in `SOCKET_IDENTITIES`, so the client must reconnect
  after every auth transition or the socket stays anonymous and every
  `join_match` is rejected.
- **Two tabs of one browser are one player.** They share a cookie jar and
  localStorage, so signing in as a guest twice gives you the same guest.
  Test with two separate browsers, or one normal window and one incognito.

## Deployment semantics you must not break

- **Azure never re-pulls a mutable tag.** Pushing a new
  `:latest` to the registry does not change what a running Container App
  serves. Every deploy must roll out an **immutable per-commit SHA tag**
  via `az containerapp update --image ...:${{ github.sha }}`. Without that
  step, code changes silently never reach production.
- **Never publish a guessed backend hostname into the frontend.** The
  Container Apps FQDN is dynamic (`*.azurecontainerapps.io`) and is not
  knowable before apply. The frontend pipeline reads it from Azure at build
  time with `az containerapp show`. Do not replace this with a hardcoded
  URL or a hand-set repo variable.

## Matchmaking, and why it kept breaking

Two players stuck on Searching has been the most persistent bug in this
project. Every cause was different, so check these before assuming a new one:

- **Every path that adds a player must end at `start_if_ready`.** The path
  that hands back a match you are already in once skipped it, so a complete
  pair sat on `waiting` and nobody was ever told to start.
- **Only count players who are present.** Counting people who had left made
  a room holding one live player and one ghost look full.
- **A dropped socket is not a decision to leave.** Socket.IO reconnects on
  any blip and a backgrounded tab is cut off, so treating a disconnect as
  leaving pulled players out of their own queue. A disconnect only settles a
  match that is already **active**; an abandoned queue is handled by
  `QUEUE_TIMEOUT_MINUTES`.
- **A reconnect must re-join the room.** Room membership is per socket
  session and a reconnect gets a new one, so `match_start` was broadcast to a
  room the client had silently dropped out of. The client remembers the match
  it belongs in and re-joins on every connect.
- **Reading the queue and writing to it is serialised** by
  `MATCHMAKING_LOCK`, or two callers arriving together both find it empty and
  both open a match nobody else can see.
- **A queue with nobody in it is not a stuck queue.** This one was reported as
  a bug twice and was never a bug: two tabs of one browser share
  `localStorage`, so they are one identity, and the server is right to refuse
  to pair a player with themselves. The Competitive banner counts its wait and
  says so after 15 seconds. Reproduce a real match with two browser
  *contexts*, the way `e2e/ranked_match.py` does, not two tabs.

Asking to queue again is also the recovery path: it returns an
already-started match, so missing the `match_start` broadcast is survivable.

## The queue states facts, it does not infer them

"Nobody else is queued" used to be a guess: the screen said it because nothing
had happened yet. That guess is wrong whenever two people queue for different
games, and the result looks exactly like broken matchmaking -- which it was
reported as, twice, with two real players on screen.

`GET /api/games/<slug>/queue` answers it properly: how many *other* fresh,
present players are waiting for that game. The Competitive banner polls it and
names the queue you are in, so two people in different queues can see that
immediately instead of each concluding the app is broken.

- **Cancelling actually leaves the queue.** `POST /api/matches/quick/cancel`
  removes your waiting entry and deletes the room if that empties it. It used
  to be client-side only, so a cancelled player stayed matchable for the whole
  timeout and the next arrival was paired with someone who had walked away.
  A test suite that leaves a guest queued does the same thing to the suite
  that runs after it, so every suite hands its queues back when it finishes.
- **Your own entry is never counted as an opponent.** Counting it would promise
  a match the server will not make.
- **Stale and in-progress entries do not count.** Someone who queued an hour
  ago is not an opponent, and promising one is worse than an empty queue.
- The banner never tells anyone to open a second browser. That is a testing
  technique, not advice for a person using the app.

## Room lifetime, and how presence is decided

A room disappears once nobody has been in it for `EMPTY_ROOM_TIMEOUT_SECONDS`
(60). Getting that right depends entirely on how "in it" is decided:

- **Presence is observed, never inferred from `left_at`.** `left_at` is only
  ever written by a socket event, so a player who joined a room over HTTP and
  never opened a socket, or whose socket vanished when the container
  restarted, kept their seat forever. One such ghost was enough to make a room
  immortal, and Browse filled up with eleven dead rooms in production.
- `MATCH_LAST_SEEN` records when a socket was last connected to each match,
  and `refresh_live_presence()` re-stamps every match a live socket is in
  before the reaper runs. Someone sitting silently in a group chat sends no
  events for minutes, so presence cannot be read from traffic.
- A match this process has never seen a socket for counts as last seen at
  `PROCESS_STARTED_AT`. A restart drops every socket at once, so rooms get one
  full timeout to be reconnected to instead of being swept immediately.
- This is in-process state, the same assumption `MATCHMAKING_LOCK` makes. A
  second worker would need this moved into the database.

### The same presence decides who you can be paired against

A dropped socket is deliberately **not** treated as leaving a queue: Socket.IO
reconnects on any blip, and treating that as a decision to leave used to pull
players out of their own queue, so the next arrival found an empty room and
both sat on Searching. The cost of that choice was that a genuinely closed tab
stayed pairable for the full `QUEUE_TIMEOUT_MINUTES`, and the next person to
queue started a match against somebody who was never coming back.

`find_opponent()` now skips any waiting match nobody has been seen in for
`QUEUE_PRESENCE_GRACE_SECONDS` (45). The row is left alone, so a blip can still
rejoin its own queue; it simply stops being offered to a third party. Two
things make this safe and both are load-bearing:

- `api_quick_match` calls `refresh_live_presence()` before judging anyone, or
  the only reading available is stale and everybody looks gone.
- Queueing itself stamps presence. Without that, a brand new queue inherits the
  `PROCESS_STARTED_AT` default, reads as ancient on a long-running server, and
  **nobody can pair at all** — a worse bug than the one being fixed.

A test that inserts a `waiting` Match row directly has bypassed the endpoint
that would have stamped it, so it must call `touch_match_presence()` itself or
matchmaking will correctly refuse to offer its fictional opponent.

## Account security

What was already right: bcrypt via flask-bcrypt, `SECRET_KEY` a 64-character
`random_password` injected from Terraform as a Container App secret (not the
dev default in `app.py`), and both sign-in and sign-up rate limited to 10
attempts per 5 minutes per caller, reading the first entry of
`X-Forwarded-For` because Container Apps sits behind a proxy.

What was missing, and now is not:

- **Tokens can be revoked.** A JWT lasts 30 days and signing out only forgot
  it on the device doing the forgetting, so a leaked token was good for a
  month and changing a password did nothing about it. `token_version` lives in
  `preferences_json` and is a claim in the token; bumping it invalidates
  everything issued before. Tokens minted before this carry no claim and
  default to the same 0 an untouched account has, so deploying it signs
  nobody out.
- **Changing a password requires the current one**, or anybody holding a token
  could lock the owner out of their own account -- a leak becoming a theft. It
  revokes every other session, which includes the one that asked, so a fresh
  token comes back in the body and the client must store it.
- **`DELETE /api/auth/account`.** Apple requires this of any app that lets you
  make an account (see [MOBILE.md](MOBILE.md)). Matches are anonymised rather
  than deleted: the other player's rating was built on those results and
  erasing them would quietly rewrite somebody else's record. Reports *about*
  the account are kept and unlinked, because they are somebody else's safety
  record.
- **Login takes the same time whether or not the username exists.** It used to
  return before bcrypt ran when there was no such user, which answers
  measurably faster and tells an attacker which usernames are real.
- **`password_problem()` is the one place the rules live**, shared by register
  and change. Eight characters was previously the only rule, so `password` and
  `12345678` both passed. `COMMON_PASSWORDS` is a short list of the ones that
  actually get tried, not a dictionary -- a real wordlist is a file to ship
  and maintain, and nearly all the value is in the first few entries.

Still absent, deliberately: password reset by email. There is no mail service
and adding one is a bill and a deliverability problem; the honest state is
that a forgotten password means a new account until that changes.

## Video is a mesh, and everybody gets a tile

`webrtc.ts` holds one `RTCPeerConnection` per peer, keyed by **socket id**.
The socket id is the only identity signalling can be routed to -- a player row
id cannot be delivered to -- so the roster (`peers`, `peer_joined`,
`peer_left`) is expressed in those terms even though `player_joined` already
existed.

- **Signals are addressed.** `signal` honours a `to` field and delivers to
  that socket alone. Broadcasting an offer into a room of three means two
  people answer it, and both answers land on connections that were never
  offered to them. An unaddressed signal still goes to the room, which is
  correct in a room of two and keeps a pre-mesh client working.
- **One end offers, decided by comparing the two socket ids.** Neither side
  needs to know who arrived first, and both reach the same answer, so they
  cannot collide.
- **Subscribe before asking for the camera.** The roster is sent the instant
  you join and the permission prompt takes long enough that it had already
  been and gone: the *second* person into a room saw only themselves, every
  time, while the first saw both. Connections still wait on `mediaReady`,
  because one built before the camera exists carries no tracks.
- **A tile per person, camera or not.** Turning your camera off removes your
  face, not you. Two per row: it is what was asked for and the only column
  count that leaves a face readable on a phone.
- The mesh is capped at `MAX_VIDEO_PEERS` (6) and the reason is in
  [SCALING.md](SCALING.md). Past the cap people keep their tile and lose their
  video, which is honest; silently dropping them would not be.

## When a match ends

Conceding and leaving are two different decisions, and the split matters.

- `forfeit_match` settles the match and leaves the player in the room.
  `leave_match` releases the seat. They used to be the same event, and because
  `leave_match` calls `leave_room()` *before* the match settles, whoever
  forfeited was out of the room when the result was broadcast and never saw
  it -- they were dropped to the lobby knowing nothing, while the winner got a
  whole screen about it.
- Leaving mid-match without conceding is still scored as a forfeit. Splitting
  the events must not open a way to walk out for free, and a test pins it.
- Settling twice would move rating twice, so `forfeit_match` returns early
  unless the match is still `active`. The button stays on screen until they
  leave, so it can be pressed again.
- `MatchOutcome` is the one panel every competitive game ends with: the result,
  **Find next match**, and **Back to game modes**. Shadow Boxing and Mog Off
  previously ended with text and no way out at all. Playing again is the
  primary action because it is what somebody who just finished a match wants,
  and it queues in one tap rather than making them find the game again.
- The clock reads `Over` once a match is finished. Letting it run past the
  result made a finished match look live.

## Presence, and saying whether anybody is here

`GET /api/presence` returns `online`, `waiting` per competitive game, and
`open_rooms`. An empty app and a broken app are otherwise the same screen:
Random dead-ends, the queue says you are the only one, Browse is empty, and
none of it said whether that was bad luck or a dead product.

- `online` counts distinct identities, not sockets, so one person with two tabs
  is one person.
- Held-back games (`HIDDEN_GAMES`) are not reported, or the numbers would
  advertise something nobody can play.
- Surfaced on the Social start screen and on the Competitive cards, polled
  every 15s and only while there is nothing else on screen. Counted from live
  sockets, so it is exact on one replica and moves to Redis with everything
  else in [SCALING.md](SCALING.md) before a second.

## A reason to come back

The app had nothing to say to somebody who already left. `POST /api/me/catchup`
is the smallest honest answer: your rating moved, or somebody passed you on the
ladder, shown once on the Competitive screen.

- **It never invents drama.** A refresh is not a return, so nothing is reported
  unless `AWAY_RESET_MINUTES` (30) has passed. Somebody who was always ahead of
  you did not pass you. Holding your place is said plainly rather than dressed
  up. An app that manufactures a reason to come back is one you stop believing.
- **The ladder is only people who have played.** `ladder_standings()` excludes
  accounts with no rated games, or hundreds of untouched 1000s would sit in the
  middle of it and make every rank meaningless.
- **Stored in `preferences_json`, not new columns.** Production is a live
  SQLite file on an SMB share and `create_all()` does not add columns to a
  table that already exists, so a schema change is real work this did not need.
- When it speaks is tested in `backend/tests/test_catchup.py`, where a visit
  can be aged past the window without waiting. What it says is tested in
  `e2e/welcome_back.py` against a stubbed response. Doing the second half in a
  browser would have meant a rating-setting endpoint living in production
  forever, which is not a trade worth making for a test.

## Gameplay and scoring

- **Reps are counted in the player's browser** from MediaPipe pose landmarks.
  The counting rules live in `frontend/expo/src/services/repCounter.ts` with
  no camera or MediaPipe dependency, so they can be driven with synthetic
  joints. A rep is the full travel down and back up, counted on the way up.
  Separate down and up thresholds give hysteresis; a single threshold turns
  pose noise into dozens of reps. The descent must also take time, which is
  what stops jitter counting.
- **MediaPipe is loaded from a CDN at runtime, never bundled.** Its package
  ships a dynamic import Metro cannot parse, which fails the whole web build.
- **The server does not trust a submitted score.** Counting happens in a
  browser, so anything there can be edited. `validate_result` rejects
  negatives, non-numbers, and rep counts beyond two a second for the round.
  A result can be submitted once: both results are broadcast when a match
  ends, so a second submission would let someone see the opponent's number
  and then beat it.
- **Login and registration are rate limited** per caller, in memory. That
  holds while the backend is one replica; more than one needs shared storage
  for it to be a real limit.

## Winning, losing and the ladder

A ranked match produces a winner and moves both ratings. Before this it did
neither: both results were broadcast side by side, nobody was declared the
winner, and `User.rating` was read for matchmaking but never written, so
everybody sat at 1000 forever and the rating preference was a no-op.

- **Higher score wins**, equal scores draw, and the ladder is zero-sum: the
  points the winner gains are the points the loser drops. K is 32 for the
  first ten rated games and 16 after, so a new player finds their level fast
  and then stops swinging.
- **Forfeiting is a loss.** It is a decision to leave, and it is scored like
  one. **A dropped connection is a stalemate** and costs nobody rating,
  because a match must not be winnable by outlasting somebody's wifi.
- **Guest matches are unrated.** A guest has no rating to lose, so rating
  those would let an account farm points off people who cannot lose any, and
  the board would measure who played the most guests.
- **Rating is a preference, not a gate.** Matchmaking picks the closest
  rating available and never refuses a match: with one person waiting you
  pair with them however far apart you are. A small player base must not mean
  nobody ever plays. Both halves are pinned by tests.

## Who is in the room

The screen has to show the person, not the room code. Membership arrives from
three places and all three are needed:

- `match_start` and `POST /api/rooms/<code>/join` both return the players who
  are **already present**, because `player_joined` only ever tells you about
  people who arrive *after* you. Without this the person who joined a room saw
  it as empty while the person waiting saw them fine.
- `player_joined` and `player_left` update `currentMatch.players` in the
  reducer. They used to reach a `console.log` and nothing else.

## Counting reps, and what the research says

Perception is a trained model; judging is deterministic rules on top of it.
That split is why the counting rules are unit-testable with no camera.

**The model.** MediaPipe Pose Landmarker (BlazePose), running in the browser
on WASM, 33 landmarks, no frame ever leaves the device. It runs at
`pose_landmarker_full`, not `lite`: measurements of BlazePose put only about
43% of push-up joint angles within 5 degrees, and a joint angle is the thing
reps are counted from, so accuracy is worth more here than frame rate. The
confidence thresholds are raised to 0.6 from the 0.5 default for the same
reason -- a low-confidence detection is a wrong angle, and a wrong angle is
either a phantom rep or a real one refused.

**The rules**, and why each exists:

- **The angle is smoothed** before any threshold is applied. Landmarks jitter,
  and a threshold crossing on one noisy frame is a phantom rep.
- **Hysteresis**, not a single threshold: down below 95 degrees, up above 155.
- **Form is gated, not just measured.** A push-up needs the body in a line
  (shoulder-hip-ankle above 150 degrees), or bending your arms with your hips
  in the air counts. A squat needs the hips to actually drop, by at least 0.15
  of a torso length, or a small knee bend counts.
- **Distances are normalised by torso length**, so a threshold means the same
  thing two feet from the camera and ten.
- **A refused rep says why** -- "keep your body straight", "go lower" -- or
  the player has no way to fix it.

**What is deliberately not built yet.** Google's own pose classification for
these two exercises adds a k-NN classifier over pose embeddings: normalise the
pose for torso size and rotation, embed it as pairwise joint distances, then
classify up/down against a labelled sample set with two distance metrics and
EMA smoothing on the probabilities. It is more robust to camera angle than
geometry is, and it is the obvious next step -- but it needs a labelled
training set of push-up and squat frames, which we would have to collect.

## Shadow Boxing

Same camera and same model as push-ups, read differently. A punch is not a
rep, and counting one like the other does not work:

- **The two arms are independent.** A rep counter has one state machine; this
  has two, or a one-two combination reads as a single movement.
- **Speed is the whole difference** between a punch and reaching for a glass.
  The arm has to straighten inside 600ms, or it does not count.
- **A punch has to be pulled back before it can be thrown again**, or holding
  your arm out scores forever.
- **The score is not the punch count.** Every ten unbroken punches raises the
  multiplier by one, to a cap of five, and each punch is worth the multiplier
  it lands on. Let two seconds pass and the combo resets to one. Sustained
  output is the point, so a hundred punches in one run beats a hundred in
  bursts.
- **Its score ceiling is its own.** Punches times a multiplier is far above
  any rep count, so `COMBO_SCORED_GAMES` is validated against five punches a
  second at the maximum multiplier rather than the rep rule.

`PoseTracker` owns the camera, the model and the frame loop and knows nothing
about what the frames mean, which is what lets both games share all of it.

## Mog Off

Renamed from Looks Battle, and it no longer takes a vote. It measures
**facial symmetry** from MediaPipe Face Landmarker, and the screen says so in
as many words. A model cannot rank faces by how good they look, and one
claiming to would be dishonest as well as unpleasant; symmetry is a real
geometric property and is what this game was before it got a nickname.

- The midline is the line through the landmarks that sit on it. Each left and
  right pair is measured against that line, and their **signed** distances are
  compared -- unsigned would call a face with both eyes shifted the same way
  perfectly symmetric.
- Everything is divided by face width, so distance from the camera does not
  change the score.
- The result is the **median** of every frame, so one lucky or one terrible
  frame cannot decide a match.
- Because the result is a number, it settles like push-ups: higher wins, the
  ladder moves, no vote involved. Voting stays for the group formats that are
  coming, where there is genuinely nothing to measure. `JUDGED_GAMES` is now
  Rap Battle alone.

### Showing the measurement

Mog Off draws the midline and the ten measured pairs over your own camera,
toggled by **Lines on / Lines off** and on by default. The score was otherwise
a number with nothing behind it: 71 out of 100, with no way to tell whether
the model had found your face, found the lamp behind you, or simply disliked
you. The lines make the claim checkable, and they make the advice actionable —
you can watch the pairs go uneven as you turn your head.

- `MIDLINE` and `PAIRS` are exported from `faceScorer.ts` and the overlay
  draws those exact indices. A second copy would be a second thing to keep in
  step, and the drawing would quietly stop describing the measurement.
- It draws the measurement, not a 468-point mesh. A full mesh looks more
  impressive and explains less.
- The camera is mirrored, so the overlay mirrors too (`1 - x`) or the lines
  sit on the wrong side of the face.
- A headless browser's fake camera has no face in it, so the browser test
  checks that the toggle and the explanation are there. The drawing itself is
  visual and is not asserted on.

## The nav is always there

Competitive matches used to render outside `ScreenFrame`, so a match had no
hamburger and no way out except forfeiting. They render inside it now:

- A live competitive match is the content of the Competitive page, so the
  drawer, the room card and Leave room are always one tap away.
- Starting a match navigates you to it, or the match would begin on a page
  you are not looking at, which is indistinguishable from nothing happening.
- Navigating away leaves the match running; the room card offers **Back to
  match**. The match clock is local state, so it currently restarts on the way
  back -- worth fixing by deriving it from a deadline if this becomes common.

## Video, profanity and room names

- **Video is a switch, not a property of the room shape.** It sits beside 1:1
  and Groups in the room panel and again in Profile, defaults on, and applies
  to groups as well. Turning it off is how you get a text-only room.
- **The profanity filter is on by default** and applied where messages are
  rendered, not where they are sent: two people in a room can hold different
  settings, and filtering at the sender would impose one person's choice on
  the other. It masks rather than deletes, so nobody wonders whether a message
  failed to arrive, and it matches whole words only. Censoring an ordinary
  word is a worse failure than missing a rude one, so the tests give
  Scunthorpe as many cases as the swearing.
- **A room can be renamed by anyone in it**, and only by them: a name is what
  people pick a room out by in Browse, so a passer-by renaming it would be a
  way to impersonate somebody else's room. Everyone in the room is told over
  `room_renamed`.

## Judged battles: what the machine decides and what it does not

Rap Battle and Looks Battle have no objective score. Every real battle rap
platform settles that the same way, and so does this one:

- **The audience decides the winner.** `POST /api/matches/<id>/vote`, one vote
  per identity, changeable, never for yourself. Spectators who are not
  competing can vote: an audience is the point. Games with a real score
  (push-ups, squats) reject votes outright, or the room could overrule the
  leaderboard.
- **Looks Battle is the vote and nothing else.** A face has no rep count and
  no beat to be on, so any number an algorithm produced would be invented.
  The camera is only how you make your case; `LooksBattleScreen` shows both
  faces for thirty seconds and then hands over to `VotePanel`.
- **The flow score is a statistic, not a verdict.** It measures whether
  syllables landed on the beat. It cannot tell a good bar from a bad one, and
  claiming otherwise would make the ladder meaningless. It breaks a tied vote
  and nothing more.
- **The beat is synthesised, not streamed** (`beatMachine.ts`). Media cannot
  load from a CDN here, and more importantly a beat we schedule ourselves has
  a grid that is exact by construction. Detecting the tempo of a recording is
  the step this whole category of app gets wrong; we never have to.
- **Onsets are timestamped on the beat machine's own AudioContext clock**, so
  the syllable and the gridline it is measured against cannot drift apart.
  Scheduling is done ahead on that clock rather than from `setInterval`, which
  drifts by the same order as the thing being measured.
- `flowScorer.ts` holds the rules and knows nothing about audio, so
  `e2e/flow_scorer.py` can feed it synthetic onsets rather than trying to rap
  into a headless Chrome.

## Brand: two modes, two colours

The layout is borrowed from the grammar of vertical video, which nobody owns.
The colour is not borrowed:

- **Social is violet `#7B5CFF`, Competitive is acid lime `#CCFF00`.** The whole
  app changes temperature with the mode, so you can tell which world you are in
  from across the room before reading a word. TikTok has one mode and no
  equivalent, which is the point: this is the brand doing work.
- **Ink is part of the accent, not a constant.** White type on lime is
  unreadable, so `ACCENT_INK` says what to print on each. Any new button with
  an accent background must use it.
- **Errors are never the accent.** On Competitive the accent is a bright lime,
  which reads as success; `T.danger` exists for anything that went wrong.
- **The mode follows the page, not the match** -- except a competitive match,
  which takes the screen over and therefore decides the colour. A social match
  renders inside its page, so reading the leaderboard from a chat is still lime.
- The wordmark is `Trap` in lime and `Chat` in violet, so the logo states what
  the product is. It previously used TikTok's offset chromatic split, which was
  the single most derivative thing in the app.

## Startup, and why it felt slow

Measured, not guessed. With the backend warm: the page arrives in 156ms and the
bundle in 374ms, so the network was never the problem.

- **First paint was 3.4 seconds** because `#root` was empty and nothing could
  render until 1.17MB of JavaScript had parsed and booted. `public/index.html`
  now paints a wordmark and a progress bar on the first byte of HTML; React
  replaces it when it mounts. This does not make the app load faster, it stops
  the load looking like a broken page.
- **Hashed bundles were cached for 30 seconds.** `public/staticwebapp.config.json`
  sets a year and `immutable` on `/_expo/static/*`, which is safe precisely
  because the filename contains a content hash, and `no-cache` on index.html so
  a deploy is picked up immediately.
- The bundle is served brotli-compressed: 1.17MB becomes 292KB in transit.
- **`min_replicas = 0` is deliberate.** The container scales to zero when idle,
  so the first request after a quiet spell pays a cold start. Keeping one
  replica alive would remove it and would also leave the free grant, so the
  cold start stays until that trade is worth making.

## Report and block

Random video chat puts strangers on camera together, so being able to end
that and not have it repeat is part of the product rather than a policy
checkbox. It is also the thing that would have stopped either app store
listing this at all (see [MOBILE.md](MOBILE.md)).

- **A block counts in both directions.** Being paired with somebody who
  blocked you is exactly as bad as being paired with somebody you blocked,
  and only one of you has to have pressed the button. This is the half that
  gets forgotten.
- **Matchmaking and Browse both honour it.** `find_opponent` filters
  candidates and `/api/rooms` hides rooms with a blocked person in them, which
  covers Random and Browse at once because Random picks from that same list.
  A block matchmaking ignores is a button that lies.
- **Reporting always blocks, and leaves the room.** Reporting a stranger you
  are on camera with is a request to get away from them; making that two
  separate actions means the second is forgotten at exactly the wrong moment.
- **The control is one tap from inside the room**, beside Leave. Somebody who
  needs it is not going to go hunting through settings for it.
- Reasons are a fixed set. Free text would need moderating before it could be
  read, which is a second problem.
- Blocking a guest is weaker than blocking an account, because a guest gets a
  new session if they clear their browser. It holds for as long as that person
  is that person, which is the same guarantee everything else makes about
  guests.

There is no moderation queue yet: reports are recorded and nothing reads them.
That is the next piece, and it is a person's job before it is a screen.

## Metrics

Nothing was measured, so every judgement about ad frequency, retention or
whether TURN is worth paying for was a guess. It is measured now, in the app's
own database rather than a monitoring service, because the questions that
matter here are app-level and invisible to infrastructure metrics. Azure can
report the container's CPU; it cannot report that a fifth of calls never see
each other.

- `POST /api/metrics` takes one event from a client. Only names in
  `KNOWN_EVENTS` are accepted: an open-ended name lets anyone fill the table,
  and an unbounded set of names cannot be queried anyway. Rate limited, and it
  never raises -- a metric that can break the thing it measures is worse than
  no metric.
- `GET /api/metrics/summary` reports the last day and week, split by guest and
  account, plus the WebRTC failure rate, which is the number that decides the
  TURN question. No calls yet reports `null` rather than zero: zero would read
  as "nothing ever fails", which is a very different claim.
- Events are pruned after `EVENT_RETENTION_DAYS`. The table lives in a SQLite
  file on a share and cannot grow without bound.
- Whether a call connected is reported by the **client**, because the server
  only ever sees the handshake go past.

Infrastructure metrics are still absent: there is no Log Analytics workspace
and the Container App has no log destination, so the console stream is all
there is. That is the next step if CPU and memory ever matter, and it is
inside the Azure free grant, but it answers none of the questions above.

## Testing

Unit tests and both smoke suites run before anything ships, and the suites
run again against the live deployment.

| Suite | What it covers |
|---|---|
| `backend/tests/` | Backend logic, 49 tests |
| `frontend/expo/e2e/rep_counter.py` | Counting rules, driven in a browser with synthetic joints |
| `frontend/expo/e2e/smoke.py` | Every navigation path, all 20 ordered page transitions |
| `frontend/expo/e2e/ranked_match.py` | Two browsers queueing into one ranked match |
| `backend/e2e/api_smoke.py` | The deployed HTTP surface end to end |

`api_smoke.py` takes `--include-scoring`, which is used only in the build
stage. Submitting a score writes a permanent leaderboard row, so running it
against production would add a test account to the ladder on every deploy.

Tests share one imported app module and therefore one database, so
`backend/tests/conftest.py` resets the rate limiter and clears the queue
between tests. Without that, matchmaking assertions fail only when the whole
suite runs.

**A deploy is proven, not assumed.** The image is stamped with the commit it
was built from, `/api/health` reports it as `version`, and the pipeline waits
until the version being served matches the one it just pushed. Without that
the tests ran against the revision that was already serving, and a run of the
previous build reported the new one as broken.

**HTTP 200 is not a working app.** The post-deployment suites exist because
the site once returned 200 while pointing at a test backend.

## Secrets

- Never commit secrets, and never print secret values into logs or terminal
  output. That includes `SECRET_KEY`, storage keys, Azure credentials, and
  GitHub tokens.
- `SECRET_KEY` is generated by Terraform (`random_password`) and delivered
  to the container as a Container App secret. It is never in the repo.
- Do not extract credentials out of the local git credential helper.

## Definition of done

A green pipeline is not a finished feature. Do not claim completion because
the frontend returns HTTP 200. Completion requires:

- Backend `/api/health` returns 200 publicly and reports durable storage.
- Frontend bundle points at the verified backend URL.
- Register, login, session restore, logout, and guest mode work in a browser.
- Two browser clients match together, both establish authorised Socket.IO
  connections, and chat plus WebRTC signalling relay between them.
- Unauthorised clients cannot join or inject match events.
- At least one full game reaches a result screen, and scores still appear in
  the leaderboard after a redeploy.

Remove or disable non-functional controls. Do not present placeholders as
finished features.

## Local verification

```bash
# backend
python -m venv .venv && source .venv/Scripts/activate   # or bin/activate
pip install -r backend/requirements.txt pytest
PYTHONPATH=backend python -m pytest backend/tests -q
PYTHONPATH=backend python -m py_compile backend/app.py

# frontend
cd frontend/expo && npm ci && npx tsc --noEmit && npm run build:web

# terraform
terraform -chdir=infra/terraform fmt -check -recursive
terraform -chdir=infra/terraform init -backend=false
terraform -chdir=infra/terraform validate
```

## Known gotchas

- **`Microsoft.App` must be registered** on the subscription or the
  Container Apps environment fails to create. Already registered, but check
  with `az provider show --namespace Microsoft.App --query registrationState`
  if environment creation fails.
- **Azure tag keys are case-insensitive and must be unique.** A tags map
  containing both `environment` and `Environment` is rejected with
  `Duplicate tag key 'environment' found (case-insensitive)`.
- Storage account and registry names are globally unique across Azure.
- **The local Flask dev server cannot do WebSockets.** Running `python app.py`
  makes every browser log `WebSocket connection ... failed: Invalid frame
  header`, Socket.IO falls back to polling, and everything still works. It
  fails only `smoke.py`'s "no console errors" checks and is not a regression:
  the same suite passes 58/58 against production, which serves under gunicorn.
  Check against the deployed URL before chasing it.
- **A stubbed cross-origin response must echo the origin.** The app sends
  `credentials: 'include'`, so `Access-Control-Allow-Origin: *` is rejected by
  the browser and the response is discarded before any code sees it. Answer the
  OPTIONS preflight too. Both failures look identical to a feature that simply
  does not work: the screen stays empty and nothing is logged.
- **The e2e suites print to a cp1252 console on Windows.** The app is full of
  emoji, so every `check()` encodes its line to ASCII first. Printing raw
  killed a whole run with a `UnicodeEncodeError` that read like a product
  failure and hid every check after it.
- The Terraform state backend is a separate storage account
  (`cwbtfstate4f070006f5`). A normal user login has no data-plane access to
  it, so Terraform can only run from the pipeline, not from a laptop.
