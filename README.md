# Love Letter Online — Normal Deck Version

A deployable online version of your custom Love Letter rules, designed for GitHub + Render. The in-game layout uses a poker-table view so every player can see seats, turns, targets, public actions, eliminations, and round results.

## Custom deck

Use these normal playing cards:

| Card | Role | Copies |
|---|---|---:|
| Ace | Guard | 3 |
| Jack | Guard | 3 |
| 2 | Priest | 3 |
| 3 | Baron | 3 |
| 4 | Handmaid | 3 |
| 5 | Prince | 3 |
| 6 | King | 2 |
| 7 | Countess | 2 |
| 8 | Princess | 1 |

Total: **23 cards**. No Queens.

## Rules implemented

- **A / J — Guard:** Guess another player's card. You cannot guess Guard, so guesses are only 2–8.
- **2 — Priest:** Look privately at another player's hand.
- **3 — Baron:** Compare hands. Lower card is eliminated. Equal values are shown publicly as a draw.
- **4 — Handmaid:** Protected until your next turn.
- **5 — Prince:** Chosen player, including yourself, discards and draws. Discarding 8 eliminates that player.
- **6 — King:** Trade hands with another player.
- **7 — Countess:** Must be played if held with 5 or 6.
- **8 — Princess:** If played or discarded, that player is eliminated.

## Local run

```bash
npm install
npm start
```

Open:

```text
http://localhost:3000
```

## Test

```bash
npm test
```

The test suite checks deck composition, Countess enforcement, Handmaid protection, Guard behavior, Baron draw behavior, Prince/Princess elimination, Priest privacy, and HTTP room flow.

## Deploy to Render

### Option 1: render.yaml

1. Create a new GitHub repository.
2. Upload all files in this folder.
3. Push to GitHub.
4. In Render, choose **New +** → **Blueprint**.
5. Select your GitHub repository.
6. Render reads `render.yaml` and creates the web service.

### Option 2: manual Render web service

Use these settings:

| Setting | Value |
|---|---|
| Runtime | Node |
| Build command | `npm install` |
| Start command | `npm start` |
| Health check path | `/health` |

## How to play online

1. One player clicks **Create room**.
2. Copy the room link.
3. Send it to friends.
4. Friends enter their name and click **Join room**.
5. Host clicks **Start round**.

## Technical notes

- No external runtime dependencies.
- Uses built-in Node HTTP server.
- Uses Server-Sent Events for live updates.
- Rooms are stored in server memory.
- On Render free tier, rooms may reset when the service sleeps or restarts.
