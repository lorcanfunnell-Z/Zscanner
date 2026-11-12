# Finder photo round — what to shoot

A short, practical brief for one capture session with the **Manual label** tool on the admin page.
Everything below is aimed at one problem, and nothing else.

## Why we're doing this

The scanner has two separate jobs. First the **finder** looks at the whole camera square and says *there's a
chocolate, and it's about here*. Then everything else — the reader, the straightening, the chocoprint — only
ever looks inside that box. If the finder points at the wrong thing, nothing downstream can recover.

The finder is excellent close up and falls apart further back. Measured today
(`training/baseline-finder.txt`):

| | box actually lands on the chocolate |
|---|---|
| Held-back close-ups (339 photos) | **325/327 — 99%** |
| test-9, a bit further back | 3/9 |
| test-10, arm's length (60–90cm) | 0/3 |
| test-11, the ~50cm target | 0/5 |
| **the three distance sessions together** | **3/17 — 18%** |

And in **all 17** of those frames it said it was sure a chocolate was there. In test-11 it even claimed one in
the deliberately empty shot. So its confidence tells us nothing — it isn't hesitating, it's confidently
pointing at a laptop keyboard.

The likely reason is in the training photos, not the code. Of the 1,333 we have, virtually every one is a
chocolate on the same white card on the same wood table, and all 45 "nothing here" photos are bare wood grain
with nothing else in the scene — never a hand, a laptop, a bag. So the finder has probably learned a shortcut:
*a light-coloured rectangle on wood grain is the chocolate.* A keyboard and trackpad fit that description
nicely, which is exactly what it picks.

A synthetic version of this fix (pasting cut-out chocolates onto fake backgrounds) was built and tested on
9 November and made things slightly worse. Real photos are the lever that has worked every time on this
project. That's what this round is.

## How to use the tool

Admin page → **Manual label**. For each shot:

1. **Take photo.**
2. Tap which chocolate it is — or **Nothing** if there's no chocolate in the picture.
3. For a chocolate, **drag a box** from one corner of it to the other, then **Save**.

The box only needs to be roughly right. "Nothing" shots need no box at all and are the fastest to do.

When you're finished, **Download labelled photos (.zip)** and send it over.

## Round 1 (12 Nov) — what arrived, and what round 2 needs

28 photos came back: every chocolate once, all on bare wood on one desk, always in the same spot lower-centre,
and no "Nothing" shots. Retrained and fair-tested properly: no change (3/17 → 3/17), so nothing shipped. The
boxes were all drawn correctly and the distance was right — the gaps are in *variety*, so round 2 is not about
covering all 28 numbers again. Four or five chocolates is plenty. What matters:

- **Chocolate ON the white card or napkin, at distance.** Every held-back test photo has it on the napkin and
  none of the 28 did, so the finder still boxes the napkin instead of the chocolate. Roughly a third of the
  chocolate shots on the card, the rest off it.
- **"Nothing" shots — still none.** About 40: the same desk with the chocolate taken away, the napkin on its
  own, the laptop keyboard and trackpad, the edge of the table with the floor below it.
- **Move it around.** At least three different surfaces and two kinds of light, and put the chocolate in the
  corners, near the edges and in the **top half** of the frame, not always bottom-centre.
- **A spread of sizes.** Some a bit back (0.135–0.20 wide in the ingest summary), most around the 50cm target
  (0.095–0.135), a few further. One thing to know: the live app currently refuses anything under 0.13 as
  "too small, move closer", so the 50cm target sits right on that line — a decision on lowering it is pending
  (see CLAUDE.md, 12 Nov).

## What to shoot

Roughly 150 photos. It goes quickly — the "Nothing" half needs no box drawing.

### 1. Chocolates further away — about 70 photos

The target distance agreed on 4 November is **roughly 50cm**: far enough to cover someone holding their phone
a bit loosely (the likely cause of the real-world failure), without chasing arm's length, which isn't
realistic to fix. Shoot a spread around it — some at your normal scanning distance, more at 50cm, a few
further still — so it learns the range rather than one fixed height.

Use whatever chocolates are to hand; this is about the finder, which doesn't care which number it is. Six or
seven different ones is plenty of variety.

### 2. Off the white card — mixed into the 70 above

This is the half that's never been captured at all, and probably matters most:

- the chocolate straight on a **bare table**, no card underneath
- on **other surfaces** — a dark worktop, a cloth, a notebook, a tray
- **held in your hand**
- still on the white card sometimes too, so we don't swing the other way

### 3. "Nothing" shots of real clutter — about 70 photos

Just as important, and quick, since there's no box to draw. Point the camera at a real scene with **no
chocolate in it at all** and tag it **Nothing**:

- **a laptop — the keyboard and trackpad especially.** This is the confirmed culprit: in test-11 the finder
  put its box on the same keyboard in all six scans, including the empty one. Shoot plenty of these, from
  several angles and distances.
- a hand with nothing in it
- a bag, a phone, a mug, keys, papers, a notebook
- a busy desk generally
- a few plain empty surfaces as well

### 4. A few harder ones — about 10 photos

A chocolate in frame **with** clutter around it — next to the laptop, beside a mug, on a cluttered desk. These
teach the hardest case: there's a chocolate here *and* there's other stuff, pick the right one.

## How we'll know you shot far enough

The ingest tool measures how big the chocolate actually came out in each photo and compares it with the real
hand-measured sizes from the three distance sessions, so this is checked by the numbers rather than by eye:

| chocolate's width in frame | roughly what that is |
|---|---|
| above 0.20 | normal close scanning distance (~25cm) |
| 0.135 – 0.20 | a bit further back |
| 0.095 – 0.135 | around the 50cm target |
| below 0.095 | further than the target |

If the summary comes back saying most shots were close-ups, that's worth another short round — the finder is
already at 99% on close-ups, so those photos teach it nothing new.

One thing to know while shooting: the tool ignores a box drawn smaller than 3% of the frame, treating it as a
stray tap. A chocolate at 50cm comes out at about 6–9%, so this is fine at the target distance — but if you
go much further than that and **Save** stays greyed out after a drag, that's why.

## What happens to the zip

```bash
node tools/ingest_manual_labels.js ~/Downloads/zscanner-manual-labels-YYYY-MM-DD.zip
```

It files the photos in `training-photos-wide/` (kept separate from `training-photos/`, which holds close-ups
on a different scale), checks every entry before writing anything, and is safe to run twice. It refuses
outright if the export contains a frame from test-9, test-10 or test-11 — those are the held-back check for
this work, and training on them would make any improvement meaningless.

Then:

```bash
PATH="$HOME/.local/node20/bin:$PATH" node training/train_finder.js
```

which trains a new finder into `experiments/` — never into `app/` — and finishes by scoring old against new on
the three distance sessions *and* on the held-back close-ups, with a plain verdict. Per the project's own
rule it only goes live if it's better at distance **and** no worse close up. That second half matters: both
oblique-angle retrains failed by trading away something that already worked.
