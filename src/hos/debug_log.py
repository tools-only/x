from __future__ import annotations

import logging
import os
import sys


_DEFAULT_LEVEL = "INFO"


def _configured_level() -> int:
    value = os.environ.get("HOS_LOG_LEVEL", _DEFAULT_LEVEL).upper()
    if value in {"OFF", "NONE", "DISABLED"}:
        return logging.CRITICAL + 1
    level = getattr(logging, value, None)
    return level if isinstance(level, int) else logging.INFO


def configured_level() -> int:
    return _configured_level()


def get_logger(name: str) -> logging.Logger:
    root = logging.getLogger("hos")
    root.setLevel(_configured_level())
    root.propagate = False
    if not any(getattr(handler, "_hos_handler", False) for handler in root.handlers):
        handler = logging.StreamHandler(sys.stderr)
        handler._hos_handler = True  # type: ignore[attr-defined]
        handler.setFormatter(
            logging.Formatter(
                "%(asctime)s | %(levelname)s | %(name)s | pid=%(process)d | %(message)s"
            )
        )
        root.addHandler(handler)

    logger = logging.getLogger(f"hos.{name}")
    logger.setLevel(logging.NOTSET)
    logger.propagate = True
    return logger
