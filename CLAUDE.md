# zScanner — briefing for Claude Code

Read this first, then `HANDOVER.md` (how the code fits together). History and plans live in the claude.ai docs linked at the bottom.

## Who and what
- **Owner:** Lorcan Funnell, Corporate Sales Assistant at zChocolat (placement in Forcalquier until March 2027). Always call him Lorcan. Not a professional developer: explain changes in plain language.
- **zScanner:** a website (no app store) reached from the QR card in a zChocolat gift. The recipient points their phone at a chocolate; the camera reads the number on top and shows which chocolate it is (name, filling, tasting note, soft link to buy). Purpose: a hook that turns gift recipients into future zChocolat customers.
- **Repo:** github.com/lorcanfunnell-Z/Zscanner, hosted on GitHub Pages. Lorcan pushes with GitHub Desktop; the live site updates in about a minute.
  - Client page: https://lorcanfunnell-z.github.io/Zscanner/app/
  - Admin page (passcode, testing tools): https://lorcanfunnell-z.github.io/Zscanner/admin.html
- **Mac project folder:** `~/Chocolate Scanner` — holds "Chocolate Singular Images", number designs, recording photos and test sessions that are not all in the repo (e.g. the recording photos used by the quality check in `tools/check.sh` step 3).

## Working rules (Lorcan's)
- Before any task, show a checklist of steps with a predicted timeline, and tick steps off as you go.
- **Accuracy first** (as close to 100% as possible; he accepts about 1 wrong in 100 for a much higher answer rate), then speed. End goal: every chocolate recognised correctly in under ~3 s.
- The scanner decides by itself: no tap-to-confirm. Keep the short hold-over-the-chocolate scan.
- **Fair testing rule:** every change is measured on held-back data it has never seen (`training/sessions.json`: test-4 and test-5 held back; test-3 is in the gallery). Report % right when answering, % answered and the confusion list. Never keep a change that makes the held-back result worse. Rules chosen by looking at a test session must be confirmed on the next one.
- Every test session gets saved (`tests/test-N/` and in `~/Chocolate Scanner`), and the model should learn from mistakes in them.
- Client page look stays luxury and matches zchocolat.com (Cormorant Garamond + Jost, black and white, square edges, official logo and photos). New testing tools go on the admin page only. Everything runs on the phone.
- After changing app files, bump `VERSION` in `app/sw.js` (and `MODEL_VERSION` only if a model file changed). After editing `app/index.html`, run `python3 tools/build-admin.py`.
- Run `tools/check.sh` (add `--browser` for the browser test) before Lorcan pushes. Commit each stage separately with a clear message.
- English first; French later if needed.

## Current state (28 Oct 2026)
- Latest commit as of this write-up: `96084e4` "Save test 6..." (see `git log` for anything after).
- Both pages still use **model 6.1 + rules E and A**. The reader/finder/quarter/chocoprint model weights haven't changed since 6.1 shipped, but `app/model6/gallery.json` grew from 963 to 1395 references on 28 Oct (see "Test 6 + reference round" below) — `MODEL_VERSION` bumped so phones refetch it. `app/model4` kept as a fallback (see HANDOVER).
- Pipeline: finder → quality checks (blur, size, dark, glare) → reader (MobileNetV2: chocolate, shell colour, mark) × logic step → straightening (edge maths + which-side-up model) → chocoprint (ArcFace embedding of the zoomed black-and-white number, compared with a gallery of 1395 references as of 28 Oct, plus anything added this visit — see below) → decision.
- Rule E: chocoprint must name the chocolate in ≥80% of held frames; logic check uses shell colour only (skipped specifically for N°20, see fixes below). Rule A (`meta.json` `scanMajority: true`): only answer the chocolate that leads the tally since the scan began — chosen from test 5. **Now checked against a second fresh session (test 6, 28 Oct): zero effect** — identical answered count and wrong list with or without it, same as test-4. Across 3 sessions it has changed the outcome exactly once (test-5, and even then it was a trade-off). Never made a held-back result worse, so it hasn't failed the keep-it bar, but the evidence it's *earning* its place is thin — worth a real decision, not yet made.
- **27–28 Oct fixes, all code-only (zero new training data), each checked against the held-back test-4/test-5 traces with `training/trace_replay.py` before keeping:**
  - **Rotation fix:** when the "which way up" model isn't confident, the chocoprint now tries both likely rotations and keeps whichever matches a real reference, instead of trusting one blind guess that fed straight into 80% of the decision.
  - **N°20 shell fix:** N°20's milk+white shell is read unreliably (flips between "dark"/"milk"); the shell-match check is now skipped just for it, since it was vetoing correct chocoprint answers. Fixed the only remaining real error in test-5; improved test-4's answer rate. Audited every other chocolate the same way — none of the other 27 have this problem.
  - **Quality-gate audit:** MIN_SHARP (45) and MIN_LIGHT (50) confirmed well-calibrated (real accepted data sits right at the boundary); MAX_GLARE (0.03) has never once been triggered by any real frame across all 5 test sessions on record — still completely unvalidated. Rejected frames (too small/blurry/dark/glare) are now logged too (a `rejected` array alongside `trace`), so a future session can finally check this properly.
  - **Self-reinforcing gallery** (`Recognizer.reinforce`/`unreinforce`): mirrors how Face ID actually works (confirmed from Apple's own docs) — a confident answer's chocoprint joins the gallery for the rest of that visit. Fires on the highest-confidence tier (both signals agree AND ≥99% sure) and on an explicit correction, captured from **any** tray tap after an automatic answer (not only the "choose the number instead" link — that was too narrow, see the independent review below). A correction now *moves* the reinforcement (undoing whatever the automatic answer wrongly added) rather than just piling on top. Session-only, capped at 5 per chocolate, off during admin DEBUG test sessions.
  - **Reference round** can now feed the gallery immediately ("Use right away" button) instead of only via the old zip + `tools/add_to_gallery.js` retrain cycle; fixed (28 Oct, round 2) to stop re-merging the same shots every time it's clicked.
  - `tools/check.sh`'s baseline diff had a macOS-only bug (GNU-only sed syntax) that was silently masking failures — fixed. It now runs clean end to end again: "ALL CHECKS PASSED", identical to baseline.
- **28 Oct, round 2 — an independent, adversarially-verified code review** (explicitly asked for "a non-biased approach"; 7 fresh reviewers with no knowledge of this file or the commit history, each finding checked by 3 independent skeptics, 33 of 51 raw findings survived) found real problems with round 1's own fixes and its verification claims, not just new bugs. Fixed:
  - **Model-load retry**: a failed first download left the scanner permanently broken until page reload; now resets and retries.
  - **Rotation-cache bug**: the rotation fix above only fixed the current frame — the corrected orientation was never written back into the cache used to short-circuit the next frame, so the very next frame could silently revert to the rejected rotation. Now the cache stores what was actually decided.
  - **NaN bug**: averaging over held frames could produce NaN (and block a decision forever) when an admin-added custom chocolate's match flickered in and out of frames.
  - **Rule A's own Z-flicker bug**: it compared raw per-frame keys instead of the normalised key used everywhere else, so a Z chocolate could fail the majority check rule A exists to apply.
  - Plus: a missing photo-decode error handler, a duplicate dead-code line, the dead `meta.align:true` branch (confirmed unreachable — deleted), `app/reference.js` duplicating prints on repeat use, several stale "(admin)" comments describing behaviour that's live for everyone, and `training/trace_replay.py` itself not having the N°20 exception (so it couldn't actually reproduce the claim above until now — fixed and re-run, see the Results line below).
  - **Both deferred items done too, once `tools/check.sh --browser` was actually working** (it silently hadn't run all night - Playwright's browser binary had never been downloaded; fixed by running `npx playwright install chromium`): `collect.js`/`reference.js`/`debuglog.js`'s hand-rolled IndexedDB storage code is now one shared helper (`app/idbstore.js`), verified interactively (Reference round's home screen, both store configurations write-then-read-back); and `tools/browser_smoke.js` now automatically checks `recognizer.js`'s live edgeAngle() against `training/align_lib.js`'s copy on a real photo (passing: 0.4° apart, well inside the documented ~0.3° approximation gap).
  - **The most important finding wasn't a bug**: test-4 and test-5 have now been used to pick rule E, then rule A, then every fix since — they aren't really "held-back" any more by the project's own definition, and rule A specifically was never confirmed on a fresh session as the fair-testing rule requires. Test 6 is the first genuine check on everything since rule E, not an optional extra.
- **Environment:** `@tensorflow/tfjs-node` doesn't run on this Mac's Node (v24.21.0) — a second Node 20 install is needed for `tools/check.sh` or retraining (see HANDOVER §6 for the one-time setup).
- Results before tonight's fixes: test 4 (rule D+) 26/29 right; test 5 (rule E) 26/27 right, typical 1.5 s. After the N°20 fix: **properly reproducible now** with `python3 training/trace_replay.py tests/test-N new` ("E + A (current production rule)" row) — `training/trace_replay.py` itself didn't have the N°20 exception until 28 Oct, so earlier claims citing it couldn't actually be reproduced; it's fixed now. Confirmed result: test-4 20/29→21/29 answered (0 wrong), test-5 27/27→26/27 answered (0 wrong, the one remaining error gone).
- iPhone speed: ~59 ms per frame, ready in 4–6 s on return visits, first visit ~15 s (~7 MB download). Unaffected by the 27–28 Oct code fixes (unaffected by the 28 Oct gallery growth too — gallery size doesn't change per-frame cost, only the one-time chocoprint comparison, which stays fast).
- Rejected experiments (don't repeat without new data): straightened-crop reader retrain, zoom-on-number reader, hard-pair reader retrain with colour drop-out, 8-bit quantisation, merged reader + side-up model, tilt augmentation for chocoprints.
- **Test 6 + reference round (28 Oct, live on a real phone for the first time since rule E):**
  - Test 6 itself: **21/29 right (72%)** — notably below test-4/test-5, but the session deliberately included harder shots (angled, attempted glare) per the plan, so it isn't a clean apples-to-apples comparison. Real confirmations: N°20 read correctly live (first real-phone confirmation of that fix); `trace_replay.py`'s replay of this session exactly matched the live app's actual decision (29 answered, 8 wrong, same list) — the replay tool genuinely mirrors live behaviour now.
  - **New finding**: half the wrong answers (zdark, N°1, N°8, N°21) all matched N°5's chocoprint specifically, even though N°5 itself was read correctly when actually scanned — a reference-quality problem for N°5, not a logic one.
  - Immediately followed by a reference round: 432 real close-ups (all 27 chocolates Lorcan has, 16 each, window + lamp light; only zmilk missing — still never captured in any session). Added to `app/model6/gallery.json` with `tools/add_to_gallery.js` (963 → 1395 references), backed up first (`experiments/gallery-before-2026-10-28.json`).
  - **Checked properly, old gallery vs new, on test-4/5/6 before keeping** (not just asserted): no regression anywhere; real improvement on test-6 specifically, the freshest and most relevant session — the "agree" decision metric went from 3 wrong (of 14 answered) to 2 wrong (of 13 answered), and the combined classifier×chocoprint signal improved from 19/29 to 22/29 right. N°10, N°11 and N°21 specifically went from wrong to right. The N°5 magnet effect **reduced but didn't disappear**: zdark→5, N°1→5 and N°8→5 are still mismatched at the raw chocoprint level (N°19→5 and N°21→5 are fixed). Partial, real progress — not a complete fix.
  - MAX_GLARE **still** never registered (max reading 0.004 against 0.03) — still completely unvalidated; unclear whether a real glare attempt was made or just didn't produce a strong enough reflection.

## Known weak spots
- **N°5 "magnet" effect (new, 28 Oct)**: several other chocolates' chocoprints matched N°5's references more closely than their own. Reduced by the 28 Oct reference round but not resolved — N°1 and N°8 (and the dark Z chocolate) still show this at the raw chocoprint level. Next lever: more/better N°5 references specifically, or check whether N°5's embossed number is simply less distinctive than most.
- Lookalikes: 20 ↔ 21/23/24 — the shell-logic veto that caused this is fixed (28 Oct); the underlying weakness remains (the reader still can't reliably read N°20's milk+white shell, we've just stopped trusting that reading for this one chocolate). 10/11 and N°21 improved by the 28 Oct reference round (confirmed via before/after check). 13/19, 6/9, 12/22, 18/15/23 still open.
- Real training photos come mostly from one table and light; the 28 Oct reference round adds window + lamp light for every chocolate Lorcan has, which should help generalise beyond that one table.
- The three z-logo chocolates (dark, milk, white): the two dark-looking ones are hard to tell apart from above. zmilk specifically has never appeared in any test or reference session yet.
- MAX_GLARE (0.03) is completely unvalidated — no real test frame has ever shown any glare to check it against, across 6 sessions now.
- **Camera tilt (viewing angle, not rotation):** untested and likely weak. Only handles roughly-overhead shots well.
  Tilt augmentation for the chocoprint was tried before (train a model to be tilt-invariant from examples) and
  rejected — not currently used (`TILT=0` in the model 6.1 recipe). The better next attempt (28 Oct, not yet built):
  geometric perspective correction — detect the chocolate's visible top-face outline as a quadrilateral and
  mathematically unwarp it to square-on *before* reading it, the way document-scanner apps handle a tilted page,
  rather than training a model to tolerate the tilt. Needs real photos of chocolates shot at an angle to build and
  check against — we have none yet. Hard limit regardless: at a steep enough angle the embossed number is physically
  self-occluded (same reason Face ID fails at extreme head poses) — the realistic goal is "any angle a person could
  still read it at by eye", not literally any angle.

## Next steps
1. **Decide on rule A**: zero effect on 2 of 3 real sessions now (test-4, test-6), one trade-off effect on test-5. Never harmful, but thin evidence it helps. Keep, drop, or wait for more data?
2. **Validate glare** (MAX_GLARE=0.03): still never triggered across 6 sessions. Needs a deliberate, successful attempt — check in person what actually produces a strong enough reflection on a chocolate shell before assuming the threshold itself is wrong.
3. **N°5 "magnet" effect**: reduced but not resolved by the 28 Oct reference round (N°1, N°8 and the dark Z chocolate still mismatch to it). More/better N°5-specific references, or investigate whether its embossed number is just less distinctive.
4. **zmilk**: still never appeared in any test or reference session. Capture it when possible.
5. **Reclassify test-4/test-5** in `training/sessions.json`: they've now been used to pick rule E, then rule A, then every fix since — not meaningfully "held-back" any more. Test-6 is the only genuinely fresh held-back session right now. Worth a decision on whether to move test-4/5 into `inGallery` (so they can strengthen the gallery like test-3 does) and run a test-7 as the next fresh check, rather than leaving them labelled "held back" when they no longer function as one.
6. **Tilt / "scan from any angle"**: build the perspective-correction step (detect the chocolate's outline, unwarp to square-on before reading) described under "Known weak spots" above. Needs real angled photos to check against — unclear if test 6 captured any; confirm with Lorcan and capture some deliberately if not.
7. Nico demo feedback: client experience with a box and QR card in the existing card format; rework from his comments or make the client side ready.
8. QR card: looks like the current card but makes clear you can scan the chocolates; luxurious and simple.
9. Hooks (built, switched off for clients in `app/hooks-config.js`): welcome offer, My tasting (favourites), corporate report + thank-you. Need Nico's PrestaShop module — see the Hooks plan linked below.
10. Before Lorcan leaves: move the repo to a zChocolat GitHub account and ideally a zchocolat.com address (e.g. scan.zchocolat.com) — **before printing QR cards at scale**.
11. Later: assortment/box-position scanning (recognise the whole box) — the real fix for melted/deformed chocolates, since no visual signal survives that; French version.

## People
- **Nico** — runs zchocolat.com (PrestaShop); liked hooks 1 (welcome offer), 2 (favourites/tasting list) and 4 (corporate engagement report).

## Other docs (in claude.ai, kept updated there)
- Progress log: "Chocolate Scanner — Progress" https://claude.ai/artifact/B6XtRkHZDR1K3UtfFKMWNy
- Code Book (all code on one page): https://claude.ai/artifact/BwSpbzVvw6ZZaXw5Dw7Wg4 — rebuild instructions are in the Chocolate Scanner project doc `zscanner-code-book-builder.md`
- Hooks plan: https://claude.ai/artifact/5u9kUajXtceKodLSuR5Fb1
- Hook proposal: "zScanner: Turning Recipients into Customers" https://claude.ai/artifact/CxboHRQnMNhXry4fWm8VWo
