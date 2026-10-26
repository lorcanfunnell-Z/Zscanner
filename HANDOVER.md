# zScanner — handover guide

zScanner lets someone who receives a zChocolat gift point their phone at a chocolate and see which one it is. It is a
**website** (no app to install), reached from the QR code on the gift card. Built in 2026 by Lorcan Funnell (corporate
sales, placement until March 2027) with Claude. This guide is for whoever looks after it next.

## 1. The two pages

| Page | Address | Who | Model |
| --- | --- | --- | --- |
| Client page | `…/Zscanner/app/` | Gift recipients | model 6.1 + rules E and A (since 26 Oct 2026) |
| Admin page | `…/Zscanner/admin.html` (passcode) | zChocolat staff only | the same model + all testing tools |

The site is hosted free on **GitHub Pages** from the repository `lorcanfunnell-Z/Zscanner`. Pushing to it (GitHub
Desktop → Commit → Push) updates the live site within about a minute.

> **Before Lorcan leaves:** move the repository to a zChocolat-owned GitHub account (GitHub → Settings → Transfer), and
> ideally give it a zchocolat.com address (e.g. `scan.zchocolat.com`, set in GitHub Pages "Custom domain" plus a DNS
> record by whoever manages zchocolat.com). Do this **before printing QR cards at scale**, because the QR codes contain
> the address.

The admin passcode is checked on the phone (the site has no server), so it keeps clients out but is not real security.
Never put anything confidential on the admin page.

## 2. How recognition works (all on the phone)

1. **Finder** finds the chocolate in the camera view.
2. **Quality checks** skip frames that are blurry, too small, too dark or have a strong reflection, and show a hint.
3. **Reader** names the chocolate, its shell colour and its number of digits; these are multiplied (the "logic step"):
   e.g. a dark, two-digit chocolate can't be N°7.
4. **Straightening** (edge maths + a "which side is up" model) turns the number upright.
5. **Chocoprint**: a fingerprint of the zoomed number (black and white, shape only), compared with a **gallery** of
   reference fingerprints from real photos.
6. **Decision** over 0.4 s (at least 3 frames): answer only if the reader and the chocoprint agree, or it is ≥ 99%
   sure; otherwise "I don't know" + a hint. The number tray is always there as a one-tap fallback.

Both pages use `app/model6` (its `meta.json` holds the answering rules). `app/model4` is the older model (steps 1–3 only), kept as a fallback: to go back, set `DIR` in `recognizer.js` and the meta path in `app.js` to `model4`.

## 3. Folders

| Folder / file | What it is |
| --- | --- |
| `app/` | The website: `index.html` (client), `admin.html` (generated, see below), `app.js`, `recognizer.js`, `styles.css`, `sw.js` (offline/speed), `data/chocolates.js` (names and descriptions) |
| `app/hooks.js`, `app/hooks-config.js` | Welcome offer / My tasting / corporate thank-you. **Off for clients** until switched on in `hooks-config.js` (needs Nico's PrestaShop module) |
| `app/debuglog.js`, `collect.js`, `reference.js`, `addchoc.js`, `speedtest.js`, `admin.js` | Admin-only tools |
| `training/` | Training and checking (Node.js + TensorFlow). `lib/` holds the shared pieces; `config.json` the settings; `archive/` old experiments |
| `tools/` | `check.sh` (run before every push), `fair_check.sh`, `add_to_gallery.js`, `quantize.py`, `build-admin.py` |
| `tests/` | Real test sessions (close-ups + labels), the honest measure of accuracy |
| `training/sessions.json` | Which test session is **held back** (never used for training or the gallery) |

## 4. Everyday tasks

- **Change a chocolate's name or description:** edit `app/data/chocolates.js`, push.
- **Change the client or admin page layout:** edit `app/index.html`, then run `python3 tools/build-admin.py` (the admin page
  is generated from it), push.
- **Any change to app files:** bump `VERSION` in `app/sw.js` so phones pick it up. Bump `MODEL_VERSION` only if a model
  file changed (models are kept on phones after the first visit).
- **Add a new chocolate (seasonal etc.):** admin page → *Add chocolate* → record → download `custom-chocolates.json` →
  put it in `app/` → push. No retraining (works with model 6 and later).

## 5. Testing and improving accuracy (the important part)

The rule: **every change is measured on data it has never seen, and kept only if it is at least as good.**

1. **Test session** (admin page → Test log): scan each chocolate, mark Right/Wrong, download the zip, save it as
   `tests/test-N/`. The test log's running total shows "proven better than 1 wrong in N" across sessions.
2. **Fair check:** `tools/fair_check.sh <name> app/model6/reader/model.json app/model6` reports answered / wrong on
   the held-back test session and held-back recording photos.
3. **Adapt (no retraining):** once a newer session has been held back in `training/sessions.json`, add the older one
   to the gallery: `node tools/add_to_gallery.js tests/test-N`. The tool refuses to add the only held-back session.
4. **Reference round** (admin page): each chocolate in a few lights; add its zip the same way.
5. **Before pushing:** `tools/check.sh` (add `--browser` for the full browser test). If you improved the model on
   purpose, save the new numbers: `tools/check.sh --update-baseline`.

## 6. Retraining (only if needed)

Install once: Node.js, then `npm install` in this folder. Defaults reproduce the current recipes:

| Model | Command | Notes |
| --- | --- | --- |
| Chocoprint + gallery | `OUT=experiments/print-new node training/train_print.js` | ~70 min on a laptop CPU; saves after every round (`RESUME=1` to continue) |
| Reader | `OUT=experiments/reader-new node training/train_reader.js` | ~95 min |
| Which side is up | `OUT=experiments/quarter-new node training/train_quarter.js` | ~45 min |

Then fair-check it against model 6; if better, shrink it with `tools/quantize.py <folder> <out> float16` (not uint8,
which lost accuracy), copy it into a new `app/modelN/`, point the admin page at it in `recognizer.js` and `app.js`, and test.

## 7. Known limits (October 2026)

- Real training photos come mostly from one table and light; accuracy in other places is still being measured (test 4).
- Fair evidence so far: about 1 wrong in 350 unseen frames, but only 27 truly independent real scans (test 3).
- 6/9 and dark-vs-milk in warm light are the most fragile cases. A badly lit or blurred number can fool both opinions.
- First visit downloads ~7 MB (about 15 s on mobile data); later visits load from the phone (4–6 s to get ready).

## 8. People

- **Lorcan Funnell** (corporate sales): built and tested it; placement until March 2027.
- **Nico** (PrestaShop): needed for the hooks (welcome offer, favourites email, corporate report) — see the
  implementation plan document in the Chocolate Scanner project.
- Progress log: the "Chocolate Scanner — Progress" document in the Chocolate Scanner project.
