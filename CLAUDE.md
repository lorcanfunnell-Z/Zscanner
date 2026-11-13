# zScanner — briefing for Claude Code

Read this first, then `HANDOVER.md` (how the code fits together). The full dated history of every experiment, result
and decision since October is `docs/HISTORY.md`, kept verbatim: search it before repeating anything.

## Who and what
- **Owner:** Lorcan Funnell, Corporate Sales Assistant at zChocolat (placement in Forcalquier until March 2027). Always call him Lorcan. Not a professional developer: explain changes in plain language.
- **zScanner:** a website (no app store) reached from the QR card in a zChocolat gift. The recipient points their phone at a chocolate; the camera reads the number on top and shows which chocolate it is (name, filling, tasting note, soft link to buy). Purpose: turn gift recipients into future customers.
- **Repo:** github.com/lorcanfunnell-Z/Zscanner, hosted on GitHub Pages. Lorcan pushes with GitHub Desktop; the live site updates in about a minute. Client page https://lorcanfunnell-z.github.io/Zscanner/app/ ; admin page https://lorcanfunnell-z.github.io/Zscanner/admin.html (passcode, all testing tools).
- **Mac project folder:** `~/Chocolate Scanner` — chocolate images, number designs, recording photos and test sessions that are not all in the repo.

## Working rules (Lorcan's)
- Before any task, show a checklist of steps with a predicted timeline, and tick steps off as you go.
- **Accuracy first** (as close to 100% as possible; he accepts about 1 wrong in 100 for a much higher answer rate), then speed. End goal: every chocolate recognised correctly in under ~3 s. The scanner decides by itself: no tap-to-confirm; keep the short hold over the chocolate.
- **Fair testing:** every change is measured on held-back sessions it has never seen (`training/sessions.json`). Report % right when answering, % answered and the confusion list; never keep a change that makes the held-back result worse; rules chosen by looking at a session must be confirmed on the next one. Use `python3 training/scorecard.py compare` for any before/after claim and quote its verdict word for word (a proposed stronger wording is in Open decisions).
- Every test session is saved (`tests/test-N/` and in `~/Chocolate Scanner`); the model should learn from the mistakes in them.
- Client page look stays luxury and matches zchocolat.com (Cormorant Garamond + Jost, black and white, square edges, official logo and photos). New testing tools go on the admin page only. Everything runs on the phone. No paid services.
- After changing app files, bump `VERSION` in `app/sw.js` (`MODEL_VERSION` only if a model or gallery file changed; after any gallery change run `node tools/pack_gallery.js` first). After editing `app/index.html`, run `python3 tools/build-admin.py`.
- Run `tools/check.sh` (`--browser` for the browser test, `--photo` for the single-photo path) before Lorcan pushes. Commit each stage separately with a clear message. Scratch scripts and outputs go in `experiments/` (gitignored).
- English first; French later if needed.

## How it works today (13 Nov 2026)
- Pipeline, all on the phone (`app/model6`): finder → quality gates (blur, size, dark, glare) → reader (chocolate, shell colour, mark type) × logic → straightening (edge maths + which-way-up model) → chocoprint (ArcFace embedding of the number, compared with a gallery of 1,409 real references) → decision.
- **The live rule (E + stop):** answer when reader and chocoprint agree (or the combined score is ≥ 99%), the chocoprint named it in ≥ 80% of the held frames and the shell colour fits (skipped for N°20); if not certain within 5 s of the first usable frame, no answer: "We could not be certain" and the likeliest three as chips. The 3–13 Nov forced guess is gone (it made 15 wrong instead of 7).
- **Finder look-again** (12 Nov): after its first pass the finder looks again at a window twice its own box, repeated until the box stops shrinking. Distance frames 3/17 → 9/17, close-ups unchanged.
- **Rotation re-check** (13 Nov, not yet tried on a phone): a remembered which-way-up is only trusted while the chocoprint keeps matching at ≥ 0.9; after a weaker match the model runs again and the chocoprint judges the remembered rotation against the fresh one and its opposite.
- **Settle gate** (13 Nov, not yet tried on a phone): the hold and the 5 s clock start only once the view has stayed roughly still over what the finder found (three frames within 0.15 of each other over ≥ 150 ms, or found for a second with no jump); until then the hint says "Hold still over the chocolate". Why: the finder says "found" on almost anything, so a camera switched on facing the ceiling used to start the clock on the room. On the saved sessions the gate opens a median 0.3 s after the first usable frame, never after the phone's own answer. The browser smoke test now drives the live loop on a static picture through this gate to an answer. Keep the 5 s timer: without it 12 more scans get answered of which 4 are wrong, and right answers take a median 0.8 s, 90% within 2.4 s.
- **Reinforcement:** a top-confidence answer's chocoprint joins the gallery for the rest of the visit (clients only, off in admin test sessions, never fair-tested — Open decisions). A correction is "Choose the number instead" then a tray tap; a plain tray tap never touches the gallery.
- **Single-photo path** (camera unavailable, e.g. some in-app browsers): one frame, agree-or-99%, otherwise chips. Measured 13 Nov: within noise of the live rule.
- **First visit:** the camera opens while the models download (~8.4 MB: models and packed gallery 6.8 MB, TensorFlow 1.5 MB); the viewfinder shows the progress. Return visits are ready in 4–6 s.
- **Admin page extras:** test log with Exam mode and a "Nothing" label, tilt permission asked inside the Scan tap (client page not yet), torch, speed and camera tests, reference and manual-label capture rounds.
- **Branches (13 Nov):** `main` is behind. `finder-real-photos` → `scorecard` → `ship-what-is-tested` → `eight-fixes` build on each other and are unmerged pending Lorcan's phone tests (Next steps 1).

## The numbers that matter
The live rule replayed on the held-back sessions (`python3 training/scorecard.py`; ranges are Wilson 95%):

| session | answered | right | wrong | wrong per 100 answers |
|---|---|---|---|---|
| test-4 | 20/29 | 20 | 0 | 0 (0–16) |
| test-5 | 27/27 | 27 | 0 | 0 (0–12.5) |
| test-6 (deliberately hard, angled shots) | 21/29 | 16 | 5 | 24 (11–45) |
| test-7 | 22/27 | 20 | 2 | 9 (2.5–28) |
| **pooled** | **90/112** | **83** | **7** | **7.8 (3.8–15.2)** |
| pooled without test-6 | 69/83 | 67 | 2 | 2.9 (0.8–10.0) |

- Claiming "at most 2 wrong per 100" at 95% needs 149 answered scans with zero wrong (236 allowing one); "1 per 100" needs 299. The exam session (`training/exam-session-brief.md`, ~300 ordinary scans) is what gets there.
- A real difference between two versions needs at least 6 changed scans all one way (then 8 vs 1, 10 vs 2, 12 vs 3). Only the scans that change count; the total never helps.
- The 7 wrong answers, stage by stage: 4 are tilted, side-on or blurred frames the gates let through (all test-6; the chocoprint is wrong at every rotation), 3 were a wrong rotation locked in from the first frame on clean shots (fixed by the re-check if the phone agrees). Finder, reader shell colour and the rule were never the first failure.
- On the 22 of 112 scans that end with no answer, the likeliest three contain the true chocolate 17 times and the single likeliest is right 11 times: the "not certain" chips earn their place.
- Finder: held-back close-ups 325/327; distance sessions 9/17 with look-again, 0 at arm's length (the first look lands on a keyboard). Speed about 59 ms per frame on an iPhone.

## Known limits
- **Camera tilt / angle:** only roughly overhead shots work. Two code-only corrections and two synthetic oblique retrains were tried and rejected; steep angles are a real ceiling. The gyroscope hint nudges people flatter but needs the tilt permission (Open decisions 1).
- **Distance:** the finder is excellent close up and lost at arm's length; look-again fixes the middle range. The app refuses chocolates under 13% of the view (`MIN_SIZE`); the models cope down to about 9%, but the sharpness check (`MIN_SHARP` 45) would refuse most such frames, so both must move together, calibrated from a real session's logged size and sharpness.
- **Lookalikes:** 20↔21/23/24, 13 with 15/18/19/21/23 (a design-level ambiguity in the artwork), 6/9, 12/22, 4/7, 5/6, 22/16; N°16 is worth watching. Two tie-breakers against the official designs failed because the same bad crop poisons both galleries.
- **Not a chocolate:** nothing in the pipeline can say "this is not a zChocolat chocolate"; an empty desk is "found" at 99% with a chocoprint match as strong as a real answer. No wrapper, card, hand or other-brand photo exists on disk yet.
- **Tilt logging:** no saved session has a tilt value, because the permission request ran outside the Scan tap and iOS refused it silently; fixed on the admin page only, and the outcome is now recorded in every test-log entry.
- **Glare gate** (`MAX_GLARE` 0.03): never triggered in eight sessions; unvalidated. The three Z chocolates are hard to tell apart by mark alone; the reader's shell colour corrects most of it.
- **Reinforcement** has never been measured in a live session (a single-frame replay of test-4..7 showed 25 reinforcements, all on right answers, and no outcome change).

## Open decisions (Lorcan's)
1. Tilt permission on the client page: a second system prompt for a gift recipient, yes or no.
2. Automatic reinforcement for clients: left on; the recommendation was to switch it off until the exam measures it.
3. The size gate and a size-aware sharpness threshold, set from the exam's logged pairs.
4. A stronger fair-testing rule: "a change is kept on a real improvement; a real regression is never kept; a can't-tell is never written up as a win and may be kept only if it answers no more wrong than before and is wanted for another reason; error rates are stated as ranges until the pool reaches the rule-of-three size."
5. Merging the four branches to main after the phone tests.

## Next steps
1. **Phone tests of `eight-fixes` before merging** (admin page unless stated): a normal scan answers as before; a hard chocolate held past 5 s gives "not certain" and three chips, and the test-log card says so; the tilt check (DEBUG line shows `tilt 4°`, not `–`; the card says "Tilt sensor: granted"); client page: one camera prompt only; after an answer, a plain tray tap just shows that chocolate, and "Choose the number instead" then a tap does too; one scan from a bit further back than usual; a first visit (or after clearing the site data) shows "Preparing the scanner… N%" in the viewfinder with the camera already open; a hard lookalike (N°4, N°22, N°13) to exercise the rotation re-check; Exam mode deals a list and saves a scan with no tap; the settle gate: switch the camera on facing the ceiling, then move to a chocolate - the ring and "Reading the number…" must only start once the phone is still over it, and the answer must come without the chips appearing first.
2. Run the admin Camera test once and note the camera square size.
3. **Exam session** per `training/exam-session-brief.md`, in Exam mode, with the twenty "Nothing" shots at the end of a sitting.
4. From the exam: set `MIN_SIZE` and a size-aware `MIN_SHARP`; check the rotation re-check and the time-to-answer lead (scans held over ~12 frames contain most errors) with `python3 training/scorecard.py risk`.
5. Finder photo round 2 (`training/finder-capture-brief.md`, top section): variety over coverage, on-the-napkin shots, Nothing shots of the keyboard and table edge.
6. A "not a chocolate" answer once the Nothing shots exist (a negative class for the reader), medium.
7. Before Lorcan leaves: move the repo to a zChocolat GitHub account and ideally a zchocolat.com address, before QR cards are printed; QR card design; Nico's hooks stay off until his PrestaShop module; French later.

## Tools
- `tools/check.sh [--browser] [--photo] [--update-baseline]` — the pre-push check: syntax, self-tests, packed-gallery sync, the model-6 quality baseline, the live-rule baseline (`training/baseline-ruleE.txt`), the browser smoke test, the photo path (`training/baseline-photo.txt`). Run as `bash tools/check.sh` if the executable bit is missing.
- `python3 training/scorecard.py` — every held-back number with its range; `compare <before> <after>` — the verdict (replay rules such as `E`, `LIVE`, `E+forced5`, or two DUMP files); `risk` — which logged signals predict a wrong answer; `selftest`.
- `python3 training/trace_replay.py tests/test-N [new|sweep]` — the live rule and variants replayed from a session's traces; its first "new" row is what step 4 checks.
- `tools/fair_check.sh <name> app/model6/reader/model.json app/model6` — reader and chocoprint on held-back photos and scans (`training/eval_combo.js` underneath, `SCAN_DIR=` to read scans from a copy).
- `node training/eval_finder.js`, `training/lookagain_probe.js`, `training/lookagain_closeups.js` — the finder scored on where its box lands (`training/baseline-finder.txt`); `tests/test-9|10|11/finder-truth.json` are its hand-measured truths.
- `python3 training/gate_sim.py` then `gate_sim_report.py` — how the models cope with smaller chocolates.
- `node tools/ingest_manual_labels.js <zip>` files a Manual-label round into `training-photos-wide/`; `node training/train_finder.js` retrains the finder with its own old-vs-new verdict.
- `node tools/add_to_gallery.js tests/test-N`, `node tools/audit_gallery.js`, `node tools/pack_gallery.js` — grow, audit and pack the gallery.
- `tools/photo_check.js` — the single-photo path through the real page in headless Chromium (about 6 minutes).
- Node 20 is needed for anything using `@tensorflow/tfjs-node`: `PATH="$HOME/.local/node20/bin:$PATH"` (HANDOVER §6).

## Rejected — don't repeat without new data (details in docs/HISTORY.md)
- Straightened-crop, zoom-on-number and hard-pair reader retrains; 8-bit quantisation; a merged reader + side-up model; MobileNetV3 as the backbone (not fine-tunable in TensorFlow.js); tilt augmentation for the chocoprint.
- Two code-only tilt corrections (shear guesses; quadrilateral unwarp) and two synthetic oblique retrains (3f, 3f-ii): never fixed a wrong answer, broke right ones; steep angles are a real ceiling.
- Removing every negative-similarity gallery entry in bulk (hurt test-6); gallery k other than 3; printShare other than 0.8; rule A (whole-scan majority).
- Lookalike tie-breakers against the official designs, classical and design-embedding.
- Cut-paste synthetic finder backgrounds (needs real photos first); a finder retrain on 28 one-scene photos (no change; heavier weighting overfits that scene).
- Dropping the reader's agreement from the rule (7 → 11 wrong); the 5 s forced guess (15 wrong instead of 7).
- A paid vision-API fallback: deliberately deferred; needs Lorcan's explicit go.

## People and other docs
- **Nico** runs zchocolat.com (PrestaShop); liked hooks 1 (welcome offer), 2 (favourites/tasting list) and 4 (corporate engagement report). **Julien** (zChocolat's 3D artist) made the 3D chocolate model behind the result card.
- Progress log: https://claude.ai/artifact/B6XtRkHZDR1K3UtfFKMWNy · Code Book: https://claude.ai/artifact/BwSpbzVvw6ZZaXw5Dw7Wg4 · Hooks plan: https://claude.ai/artifact/5u9kUajXtceKodLSuR5Fb1 · Hook proposal: https://claude.ai/artifact/CxboHRQnMNhXry4fWm8VWo
