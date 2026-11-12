# The exam session — about 300 scans, written for Lorcan

## Why this, and why now

Every keep-or-reject decision so far has rested on 85 to 112 held-back scans. At that size a difference of one to
three scans is noise, and the scorecard (`python3 training/scorecard.py`) now says so plainly: pooled over test-4 to
test-7 the live rule answers 102 of 112 scans with 11 wrong, and the honest statement is **somewhere between 6 and 18
wrong per 100 answers**, not "about 10". Without test-6 it is 4 wrong per 100, with a range of 1.4 to 11. Nobody can
tell from that whether the scanner is at the target or far from it.

One session of about 300 ordinary scans changes that. The table below is what a session proves, depending on how many
wrong answers it contains (95% Wilson ranges, upper end):

| answered scans | 0 wrong | 1 wrong | 2 wrong | 3 wrong | 5 wrong |
|---|---|---|---|---|---|
| 150 | under 2.5 per 100 | 3.7 | 4.7 | 5.7 | 7.6 |
| 280 | under 1.4 per 100 | 2.0 | 2.6 | 3.1 | 4.1 |
| 300 | under 1.3 per 100 | 1.9 | 2.4 | 2.9 | 3.8 |

So about 300 scans with two or fewer wrong would be the first real evidence of "around 1 wrong in 50 or better". It
also gives the compare tool something to work with: a real difference between two versions needs at least six scans
that change the same way, and with 300 scans that is achievable where 112 made it nearly impossible.

## What the session is, in one sentence

All 28 chocolates, about 11 scans each, scanned the ordinary way a client would — overhead, normal distance, normal
room light — labelled honestly, saved in three or four sittings, and never used for training or the gallery until it
has been scored.

## Before the first sitting (about ten minutes, once)

1. **Tilt logging must be confirmed working.** No saved session has a single tilt value, and the cause is known (see
   CLAUDE.md, "Scorecard", 13 Nov): the permission request runs outside the tap, so iOS refuses it silently. Once the fix
   is in, the check takes two minutes: on the admin page, start a scan and look at the DEBUG line under the hint — it
   must say something like `tilt 4°`, not `tilt –`. If it says `–`, stop and say so; don't run the exam without it, because
   tilt is one of the signals the exam is meant to check.
2. **Run the admin "Camera test" once** and keep the numbers it prints (the live feed size). It tells us how many pixels
   your phone's camera square really has, which the gate work needs.
3. **Note the app version** (`VERSION` in `app/sw.js`, visible in the admin page's footer if shown, otherwise ask). The
   exam measures whatever is live at the time, so it should be the version meant for clients — with the look-again
   finder in, after it has had its own quick phone check.

## How to run a sitting (75 to 100 scans, 30 to 45 minutes)

- **Shuffle.** Don't go through the tray in order. Deal the chocolates out like cards, or draw numbers, so that no
  sequence can help the scanner or you. The 3 Nov vision-chat test showed how much a predictable order flatters a result.
- **One chocolate at a time, on the table, overhead, normal distance.** The same as a client holding a phone over a
  box. No flash, no deliberate tilt, no arm's-length shots — those are separate hard-case sessions and must not be
  mixed in here.
- **Let the app decide.** Wait for the answer or for "I don't know". Don't retake a scan because the answer looked
  wrong: a wrong answer is exactly the thing being measured.
- **Label carefully.** Tap the true chocolate before moving on, and check it. Two past results were muddled by a
  mis-tap or a chocolate swapped mid-scan (test-7's N°22, the N°24 trace). If something went wrong with the handling,
  use the note field and say so; the scan stays in the log.
- **Vary the ordinary things, not the difficult ones:** a different spot on the table, window light one sitting and
  lamp light another, a different chocolate on the card or beside it. Keep it to what a client would plausibly do.
- **Keep the sitting continuous.** If the page resets or the phone crashes, write it down and carry on; it is useful
  data in itself.
- **Download the zip at the end of each sitting** and send it. One zip per sitting.

Four sittings of about 77 scans cover all 28 chocolates 11 times (308 scans). Three sittings of about 100 also work.
Each chocolate should appear in every sitting at least twice, so that light and position vary for all of them.

## What happens to the zips

Each sitting is filed as its own session (`tests/exam-A/`, `exam-B/`, …) and added to the held-back list in
`training/sessions.json`. Nothing from the exam goes into the gallery or any retrain until the whole exam has been
scored. Then:

```bash
python3 training/scorecard.py --sessions exam-A,exam-B,exam-C,exam-D
```

gives the answered, right and wrong counts with their ranges — the number this whole exercise is for — and

```bash
python3 training/scorecard.py risk --sessions exam-A,exam-B,exam-C,exam-D
```

checks, on scans that were never looked at while choosing anything, whether the leads from the current pool hold: that
a scan which takes the phone more than about twelve frames, or ends with a thin margin between its top two guesses,
is where most wrong answers live. If that holds on 300 fresh scans, it becomes a candidate for a change to the
decision rule — fair-tested with the compare tool, not adopted by eye.

## Time

About 308 scans at roughly 20 seconds each including labelling: about 1 hour 45 minutes of scanning in total, over three
or four sittings on different days or at different times of day. The ten-minute setup happens once.
