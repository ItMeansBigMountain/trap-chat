#!/usr/bin/env python3
"""Trap Chat — backend API smoke tests.

Exercises the real HTTP surface of a running deployment: identity, the game
catalog, social rooms and competitive matchmaking. Unit tests prove the logic;
this proves the thing that is actually deployed answers correctly.

    python e2e/api_smoke.py https://<backend-host>
"""

import sys
import time

import requests

results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> bool:
    results.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  |  {detail[:160]}" if detail else ""), flush=True)
    return ok


def guest(base: str, name: str) -> requests.Session:
    session = requests.Session()
    created = session.post(f"{base}/api/auth/guest", json={"display_name": name}, timeout=60)
    created.raise_for_status()
    session.headers["X-Guest-Session"] = created.json()["guest_session_id"]
    session.display_name = created.json()["display_name"]  # type: ignore[attr-defined]
    return session


def main() -> int:
    base = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://127.0.0.1:8091"
    print(f"api smoke target: {base}\n")
    stamp = int(time.time())

    # --- HEALTH AND STORAGE ------------------------------------------
    health = requests.get(f"{base}/api/health", timeout=90).json()
    check("health reports the backend", health.get("service") == "trap-chat-backend", str(health))
    check("health reports durable storage", health.get("productionReadyStorage") is True, str(health))

    # --- CATALOG ------------------------------------------------------
    games = requests.get(f"{base}/api/games", timeout=60).json()
    slugs = {g["slug"] for g in games}
    social = {g["slug"] for g in games if g["category"] == "social"}
    competitive = {g["slug"] for g in games if g["category"] == "competitive"}
    check("catalog has both social shapes", social == {"chat1v1", "groupchat"}, str(sorted(social)))
    check("catalog has the ranked games", {"pushups", "rapbattle", "looks"} <= competitive, str(sorted(competitive)))
    check("no superseded games are offered", not ({"textchat", "ffa", "symmetry", "mog"} & slugs), str(sorted(slugs)))

    # --- IDENTITY -----------------------------------------------------
    one = guest(base, f"smoke{stamp}")
    check("guest keeps its chosen name", one.display_name.startswith(f"smoke{stamp}#"), one.display_name)  # type: ignore[attr-defined]

    account = requests.Session()
    reg = account.post(
        f"{base}/api/auth/register",
        json={"username": f"smoke{stamp}", "password": "Str0ng-Pass!1"},
        timeout=60,
    )
    check("registration returns a bearer token", bool(reg.json().get("token")), str(reg.status_code))
    account.headers["Authorization"] = f"Bearer {reg.json()['token']}"
    me = account.get(f"{base}/api/auth/me", timeout=60).json()
    check("token authenticates without cookies", me.get("user", {}).get("username") == f"smoke{stamp}", str(me))

    # --- SOCIAL ROOMS -------------------------------------------------
    made = one.post(f"{base}/api/rooms", json={"game_slug": "groupchat", "name": "smoke room"}, timeout=60)
    check("guest can open a social room", made.status_code == 200, made.text[:120])
    code = made.json()["code"]
    check("the room keeps its name", made.json().get("name") == "smoke room", str(made.json()))

    joined = one.post(f"{base}/api/rooms/{code}/join", timeout=60)
    check("creator can join their room", joined.status_code == 200, joined.text[:120])

    two = guest(base, "second")
    joined_two = two.post(f"{base}/api/rooms/{code}/join", timeout=60)
    check("a second person joins the same match",
          joined_two.status_code == 200
          and joined_two.json()["match_id"] == joined.json()["match_id"],
          joined_two.text[:120])

    listed = requests.get(f"{base}/api/rooms", timeout=60).json()
    mine = [r for r in listed if r["code"] == code]
    check("the room is browsable with occupancy", bool(mine) and mine[0]["player_count"] >= 2,
          str(mine[:1]))

    # --- COMPETITIVE RULES --------------------------------------------
    ranked_room = account.post(f"{base}/api/rooms", json={"game_slug": "pushups"}, timeout=60)
    check("ranked games refuse room codes", ranked_room.status_code == 400, ranked_room.text[:120])

    a = guest(base, "queue_a")
    b = guest(base, "queue_b")
    qa = a.post(f"{base}/api/matches/quick", json={"game_slug": "squats"}, timeout=60).json()
    qb = b.post(f"{base}/api/matches/quick", json={"game_slug": "squats"}, timeout=60).json()
    check("two queuers land in one match", qa.get("match_id") == qb.get("match_id"),
          f"{qa.get('match_id')} vs {qb.get('match_id')}")
    check("the second queuer starts the match", qb.get("status") == "active", str(qb.get("status")))

    requeue = a.post(f"{base}/api/matches/quick", json={"game_slug": "squats"}, timeout=60).json()
    check("re-queueing returns the started match", requeue.get("status") == "active", str(requeue.get("status")))

    # --- SCORING AND THE LADDER ---------------------------------------
    scorer = requests.Session()
    reg2 = scorer.post(
        f"{base}/api/auth/register",
        json={"username": f"scorer{stamp}", "password": "Str0ng-Pass!1"},
        timeout=60,
    )
    scorer.headers["Authorization"] = f"Bearer {reg2.json()['token']}"
    rival = guest(base, "rival")
    ranked = scorer.post(f"{base}/api/matches/quick", json={"game_slug": "pushups"}, timeout=60).json()
    rival.post(f"{base}/api/matches/quick", json={"game_slug": "pushups"}, timeout=60)
    ranked_id = ranked["match_id"]

    cheat = scorer.post(f"{base}/api/matches/{ranked_id}/submit", json={"score": 90000}, timeout=60)
    check("an impossible score is refused", cheat.status_code == 400, cheat.text[:120])

    real = scorer.post(f"{base}/api/matches/{ranked_id}/submit", json={"score": 21}, timeout=60)
    check("a real score is accepted", real.status_code == 200, real.text[:120])

    again = scorer.post(f"{base}/api/matches/{ranked_id}/submit", json={"score": 99}, timeout=60)
    check("a score cannot be resubmitted", again.status_code == 400, again.text[:120])

    board = requests.get(f"{base}/api/leaderboard/pushups", timeout=60).json()
    mine = [row for row in board if row["username"] == f"scorer{stamp}"]
    check("the score reaches the leaderboard", bool(mine) and mine[0]["score"] == 21, str(mine[:1]))

    # --- ABUSE --------------------------------------------------------
    throttled = False
    for _ in range(14):
        attempt = requests.post(
            f"{base}/api/auth/login",
            json={"username": f"scorer{stamp}", "password": "definitely-wrong"},
            timeout=60,
        )
        if attempt.status_code == 429:
            throttled = True
            break
    check("password guessing is throttled", throttled)

    # --- REALTIME TRANSPORT -------------------------------------------
    handshake = requests.get(f"{base}/socket.io/?EIO=4&transport=polling", timeout=60)
    check("socket.io handshake works", handshake.status_code == 200, str(handshake.status_code))

    failed = [name for name, ok, _ in results if not ok]
    print("\n" + "=" * 60)
    print(f"{len(results) - len(failed)}/{len(results)} passed")
    if failed:
        print("FAILED:")
        for name in failed:
            print(f"  - {name}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
