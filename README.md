# HAUNT line review

A web page for rating candidate abundance lines in the HAUNT star (TIC 79433333) and the Sun (Ceres), observed
with GHOST. A reviewer enters their name, chooses an element, and rates each line window. Ratings go to a shared
Google Sheet, with one tab per element.

Each line window has four panels:

| | Alex Ji's line list | TSFitPy line list |
|---|---|---|
| **HAUNT star** (Korg synthesis at 4850 K, log g 3, R = 75000) | | |
| **Sun** (5777 K, log g 4.44, R = 56000) | | |

In each panel:
- **Upper part:** the full synthesis (solid line), the synthesis without the element's lines (dashed), and the
  GHOST spectrum (black). The spectrum is shifted to the rest frame and scaled to the synthetic continuum.
- **Lower part:** the synthesis without the element minus the full synthesis, which shows how much the element
  absorbs.
- **Labels:** red labels mark the element's lines. Grey labels mark element lines with no visible effect, and black
  labels name the other lines.

## Rating options

| Key | Rating |
|---|---|
| 1 | Accept: strong, independent |
| 2 | Accept: blended |
| 3 | Maybe: blended |
| 4 | Maybe: weak |
| 5 | Maybe: poor line list |
| 6 | Reject |

Every line also has an optional comment box. The page can show one line at a time (keys 1–6 rate the line, ← →
move between lines, and "Next unrated" skips ahead) or all lines on one page. Ratings are saved in the browser as
you go and sent to the sheet automatically.

## Files

```
index.html, style.css, app.js     the page
config.js                         Google Sheet URL, rating choices, colours
data/elements.json                element menu (element, number of lines)
data/{el}.json                    the four panels for every line window of one element
google_apps_script/Code.gs        receives ratings and writes them to the Google Sheet
```

`data/` is written by `Line_Synthesis/export_web_data.py` in the GHOST_LLP analysis directory:

```
cd ~/Projects/GHOST_LLP/Line_Synthesis
python make_all_stamps.py          # choose the line windows (Stamps/windows/{el}.csv)
python export_web_data.py          # write ../HAUNT_line_inspection/data/ (or: python export_web_data.py Zr Eu)
```

## Connect the Google Sheet (once)

1. Create a Google Sheet, for example "HAUNT line ratings". The script adds a tab for each element the first time
   someone rates one of its lines.
2. In the sheet, open **Extensions → Apps Script**. Replace the contents of `Code.gs` with
   `google_apps_script/Code.gs` from this repo, then save.
3. Click **Deploy → New deployment**. Choose the type **Web app** and set:
   - **Execute as:** Me
   - **Who has access:** Anyone

   Click **Deploy**, authorize the script when asked, and copy the **Web app URL** (it ends in `/exec`).
4. Paste that URL into `SHEET_URL` in `config.js`, then commit and push.

If you edit `Code.gs` later, use **Deploy → Manage deployments → Edit → Version: New version** to keep the same
URL. A **New deployment** gets a new URL.

Each tab has the columns `updated, reviewer, element, line, center (A), species, rating, comment`. Each reviewer
has one row per line. If they change a rating, the row is updated rather than added again. A reviewer who types
the same name on another computer gets their earlier ratings back.

## Publish with GitHub Pages

1. On GitHub, open **Settings → Pages** for this repo.
2. Set **Source** to **Deploy from a branch**, choose `main` and `/ (root)`, and save.
3. After a minute or two the site is at `https://13emilygriffith.github.io/HAUNT_line_inspection/`.

To update the site:

```
cd ~/Projects/GHOST_LLP/HAUNT_line_inspection
git add .
git commit -m "update line data"
git push
```

To try the page locally before pushing, run `python -m http.server 8000` in this folder and open
<http://localhost:8000>.

## Notes

- **The page is public.** GitHub Pages sites are public, and so are the spectra in `data/`.
- **Anyone with the page can send ratings.** The Apps Script URL is visible in `config.js`, so anyone with it can
  write to the sheet. The script only accepts element names as tab names and one row per reviewer and line, but it
  checks nothing else.
- **If the sheet can't be reached,** ratings stay in the browser and are sent the next time the page can reach it.
  The status at the top right says how many are waiting.
