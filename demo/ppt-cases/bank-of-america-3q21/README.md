# Held-out earnings presentation case

This case uses Bank of America's Q3 2021 earnings press release, supplied locally as `assets/material.txt`. Its brief gives only the audience, purpose, source and delivery constraints. It is reserved for a separate run to check whether methods learned on the JPMorgan case transfer; it is not shown to that task Agent.

From the repository root, prepare with:

The renderer creates a self-contained HTML presentation and PNG previews. It requires Microsoft Edge or Google Chrome for headless browser rendering, plus `pip install -e ".[ppt-demo]"` in the active Python environment. Set `PPT_DEMO_BROWSER` to the browser executable if it is not installed in a standard location. The delivered deck is `delivery/presentation.html` and opens directly in a browser.

```powershell
$env:PYTHONPATH = 'src'
python -m autoresearch_pi.ppt_demo --root runs/ppt-bac-3q21 --source demo/ppt-cases/bank-of-america-3q21/assets
```

Source: [SEC EDGAR Exhibit 99.1](https://www.sec.gov/Archives/edgar/data/70858/000007085821000098/bac09302021ex991.htm). No benchmark score is claimed.
