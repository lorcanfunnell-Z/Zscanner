# Builds app/admin.html from app/index.html so the admin page is always the same scanner as the client page,
# plus the admin bar, passcode screen and testing tools. Run after changing index.html:
#   python3 tools/build-admin.py
import os
ROOT = os.path.join(os.path.dirname(__file__), "..", "app")
h = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()

h = h.replace("<title>zScanner · zChocolat</title>", "<title>zScanner Admin</title>\n  <meta name=\"robots\" content=\"noindex, nofollow\">")
h = h.replace('<link rel="manifest" href="manifest.webmanifest">\n', "")          # admin isn't installable as the client app
h = h.replace('<link rel="stylesheet" href="styles.css">', '''<link rel="stylesheet" href="styles.css">
  <script>window.ZADMIN = true;</script>
  <style>
    .adminbar{position:sticky;top:env(safe-area-inset-top,0px);z-index:30;background:#1d1d1d;color:#fff;display:flex;align-items:center;gap:6px;flex-wrap:wrap;
      padding-block:10px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
    .adminbar strong{font:500 10.5px var(--sans);letter-spacing:.24em;text-transform:uppercase;margin-right:auto}
    .adminbar button{appearance:none;background:transparent;color:#fff;border:1px solid rgba(255,255,255,.3);padding:8px 10px;font:500 10px var(--sans);letter-spacing:.16em;text-transform:uppercase;cursor:pointer}
    .gate{position:fixed;inset:0;z-index:100;background:#000;color:#fff;display:grid;place-items:center;padding:24px}
    .gate form{width:100%;max-width:340px;display:flex;flex-direction:column;gap:14px}
    .gate h1{color:#fff;font-size:34px}
    .gate input{font:16px var(--sans);padding:14px;border:1px solid rgba(255,255,255,.35);background:#111;color:#fff;border-radius:0}
    .gate-msg{min-height:20px;color:#f0b9a8;font-size:13px;margin:0}
  </style>''')
h = h.replace('<body>\n', '''<body>
  <div class="gate" id="gate">
    <form autocomplete="off">
      <p class="eyebrow">zScanner</p>
      <h1>Admin</h1>
      <input type="password" id="gatePass" placeholder="Passcode" aria-label="Passcode">
      <button class="btn btn-light" type="submit">Unlock</button>
      <p class="gate-msg"></p>
    </form>
  </div>
''', 1)
h = h.replace('  <header class="masthead">', '''  <div class="adminbar">
    <strong>Admin</strong>
    <button type="button" id="modeTest">Test log</button>
    <button type="button" id="modeCollect">Collect photos</button>
    <button type="button" id="modeAdd">Add chocolate</button>
    <button type="button" id="modeLock">Lock</button>
  </div>

  <header class="masthead">''', 1)
h = h.replace('  <script src="install.js"></script>', '''  <script src="vendor/jszip.min.js"></script>
  <script src="debuglog.js"></script>
  <script src="collect.js"></script>
  <script src="addchoc.js"></script>
  <script src="admin.js"></script>''')
open(os.path.join(ROOT, "admin.html"), "w", encoding="utf-8").write(h)
print("admin.html built")
