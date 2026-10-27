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

## Current state (26–27 Oct 2026)
- Latest commit: `13be79a` "Client page on model 6.1 for Nico demo".
- Both pages use **model 6.1 + rules E and A**. `app/model4` kept as a fallback (see HANDOVER).
- Pipeline: finder → quality checks (blur, size, dark, glare) → reader (MobileNetV2: chocolate, shell colour, mark) × logic step → straightening (edge maths + which-side-up model) → chocoprint (ArcFace embedding of the zoomed black-and-white number, compared with a gallery of ~963 references) → decision.
- Rule E: chocoprint must name the chocolate in ≥80% of held frames; logic check uses shell colour only. Rule A (`meta.json` `scanMajority: true`): only answer the chocolate that leads the tally since the scan began.
- Results: test 4 (rule D+) 26/29 right; test 5 (rule E) 26/27 right, typical 1.5 s; rule E + A in replay: test 5 0 wrong (25 answered), test 4 unchanged.
- iPhone speed: ~59 ms per frame, ready in 4–6 s on return visits, first visit ~15 s (~7 MB download).
- Rejected experiments (don't repeat without new data): straightened-crop reader retrain, zoom-on-number reader, hard-pair reader retrain with colour drop-out, 8-bit quantisation, merged reader + side-up model, tilt augmentation for chocoprints.

## Known weak spots
- Lookalikes: 20 ↔ 21/23/24 (20's milk+white shell barely shows from above), 13/19, 10/11, 6/9, 12/22, 18/15/23. The real fix is better chocoprints for these (reference round in different lights).
- Real training photos come mostly from one table and light.
- The three z-logo chocolates (dark, milk, white): the two dark-looking ones are hard to tell apart from above.

## Next steps
1. Nico demo on 27 Oct 2026 (client experience with a box and QR card in the existing card format); rework from his comments or make the client side ready.
2. QR card: looks like the current card but makes clear you can scan the chocolates; luxurious and simple.
3. Test 6 (full-box run-through) to confirm rule E + A; reference round to strengthen lookalike chocoprints.
4. Hooks (built, switched off for clients in `app/hooks-config.js`): welcome offer, My tasting (favourites), corporate report + thank-you. Need Nico's PrestaShop module — see the Hooks plan linked below.
5. Before Lorcan leaves: move the repo to a zChocolat GitHub account and ideally a zchocolat.com address (e.g. scan.zchocolat.com) — **before printing QR cards at scale**.
6. Later: assortment scanning (recognise the whole box), French version.

## People
- **Nico** — runs zchocolat.com (PrestaShop); liked hooks 1 (welcome offer), 2 (favourites/tasting list) and 4 (corporate engagement report).

## Other docs (in claude.ai, kept updated there)
- Progress log: "Chocolate Scanner — Progress" https://claude.ai/artifact/B6XtRkHZDR1K3UtfFKMWNy
- Code Book (all code on one page): https://claude.ai/artifact/BwSpbzVvw6ZZaXw5Dw7Wg4 — rebuild instructions are in the Chocolate Scanner project doc `zscanner-code-book-builder.md`
- Hooks plan: https://claude.ai/artifact/5u9kUajXtceKodLSuR5Fb1
- Hook proposal: "zScanner: Turning Recipients into Customers" https://claude.ai/artifact/CxboHRQnMNhXry4fWm8VWo
