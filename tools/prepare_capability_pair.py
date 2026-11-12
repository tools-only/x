"""Freeze the fixed two-episode PPT contract. This launcher never starts inference."""
from autoresearch_pi.evo_ppt import main

if __name__ == "__main__":
    import sys
    if "--run" in sys.argv or "--round-plan" in sys.argv:
        raise SystemExit("This launcher freezes only; run the authorized manifest separately with evo_ppt --run")
    sys.argv.append("--two-episode")
    main()
