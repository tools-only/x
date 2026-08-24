from __future__ import annotations

import json
import os
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def required_environment(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"{name} is required")
    return value


def main() -> int:
    # base_url = required_environment("https://yibuapi.com").rstrip("/")
    # api_key = required_environment("sk-F3saKlmHn0dqPKSiZtVTMF97P3mAHkQCMRM1sApkv3AocBPp")
    # model = required_environment("a:deepseek-v4-flash")


    base_url = "https://yibuapi.com"
    api_key = "sk-F3saKlmHn0dqPKSiZtVTMF97P3mAHkQCMRM1sApkv3AocBPp"
    model = "a:deepseek-v4-flash"
    payload = {
        "model": model,
        "max_tokens": 64,
        "messages": [{"role": "user", "content": "hi"}],
    }
    request = Request(
        f"{base_url}/v1/messages",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "content-type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        },
        method="POST",
    )

    try:
        with urlopen(request, timeout=60) as response:
            print(response.read().decode("utf-8"))
    except HTTPError as error:
        print(error.read().decode("utf-8", errors="replace"), file=sys.stderr)
        return 1
    except URLError as error:
        print(f"Request failed: {error.reason}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
