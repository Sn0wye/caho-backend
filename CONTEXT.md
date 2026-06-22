# CAHO Backend

Backend for an online game of Cards Against Humanity. A real-time, room-based
party game where players answer a prompt with their funniest card and a rotating
judge picks the winner.

## Language

### Identity

**User**:
A registered account (credentials or OAuth). Exists independently of any game.
_Avoid_: account, member

**Player**:
A User as they participate inside a specific Room — carries per-room state (hand,
score, ready, judge/host flags). The same User is a different Player in each Room.
_Avoid_: participant, member

**Host**:
The Player who created the Room and may start it. Exactly one per Room.
_Avoid_: owner, admin

**Judge**:
The single Player in a Round who does not play cards and instead picks the winning
answer. Rotates each Round; the previous Judge is excluded from being picked next.
_Avoid_: czar, card czar, dealer

### Game

**Room**:
A single game instance, addressed by a short Code. Has a lifecycle status:
`LOBBY` → `IN_PROGRESS` → `FINISHED`. May be public or password-protected.
_Avoid_: game, session, lobby, match

**Code**:
The 6-character public identifier of a Room, used to join and as the real-time
channel name.
_Avoid_: id, room id, pin

**Round**:
One cycle within an in-progress Room: a Black Card is shown, non-Judge Players
play, the Judge picks a winner, the winner scores. Numbered from 1.
_Avoid_: turn, hand

**maxPoints**:
The score a Player must reach to win the Room and drive it to `FINISHED`.
_Avoid_: win score, target, goal

**Ranking**:
The Players of a Room ordered by score, highest first. A read-only projection of
player scores, not a stored entity.
_Avoid_: leaderboard, scoreboard, standings

### Cards

**Black Card**:
The prompt card shown for a Round. Carries a `pick` count (how many White Cards
an answer requires).
_Avoid_: question card, prompt card

**White Card**:
An answer card held by a Player and played against a Black Card.
_Avoid_: answer card, response

**Hand**:
The set of White Cards a Player currently holds.
_Avoid_: deck, cards

**Played Cards**:
A Player's answer for one Round — the White Card(s) they submitted against the
Black Card. The unit the Judge picks among.
_Avoid_: submission, entry, play

**Pack**:
A named, slugged collection of Black and White Cards drawn into a game.
_Avoid_: set, deck, expansion
