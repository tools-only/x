# ALE-Bench evaluation environment

## Python and system dependencies

Use Python 3.11 through 3.15. Install this project with its ALE-Bench extra:

```powershell
python -m pip install -e ".[ale-bench]"
```

On Windows, CairoSVG needs a Cairo DLL available on `PATH`. For example, when Cairo is installed in a Conda environment:

```powershell
$env:PATH="D:\path\to\conda-env\Library\bin;$env:PATH"
```

The ALE-Bench bridge sets UTF-8 mode and normalizes POSIX container paths for Windows Docker Desktop.

## Docker judge image

ALE-Bench invokes Docker for Rust tool builds, input generation, and evaluation. Its Rust tools use the upstream image name `rust:1.79.0-buster`. Pull it from Docker Hub when available:

```powershell
docker pull rust:1.79.0-buster
```

If Docker Hub is unreachable, pull a compatible mirror and tag it with ALE-Bench's expected local name:

```powershell
docker pull docker.m.daocloud.io/library/rust:1.79.0-buster
docker tag docker.m.daocloud.io/library/rust:1.79.0-buster rust:1.79.0-buster
```

Confirm the daemon and image before running:

```powershell
docker info
docker image inspect rust:1.79.0-buster
```

The bridge talks to the host Docker daemon. Do not run the bridge inside the Rust judge container.

## Data and credentials

Copy `.env.ale-bench.example` to a local `.env` and set the AZ-compatible API endpoint and key. Keep `.env` untracked. The runner accepts an explicit environment file through `ALE_ENV_FILE`.

ALE-Bench downloads problem archives from Hugging Face on first use. To use a local cache, set `ALE_BENCH_DATA` to a directory containing `problem_ids_lite.txt` and the requested problem archive, such as `ahc008.zip`. The archive contains the benchmark's private evaluation material. Keep it outside source control and do not expose it to the Pi task context.

Example Lite run:

```powershell
$env:ALE_ENV_FILE="D:\path\to\project\.env"
$env:ALE_BENCH_DATA="D:\path\to\ale-bench-data"
python -m autoresearch_pi.cli ale-bench-pi-e2e `
  --problem-id ahc008 `
  --provider az `
  --model gpt-6-luna `
  --prompt "Solve the public ALE-Bench problem, evaluate public cases, then submit the best source." `
  --root runs/ale-bench-ahc008 `
  --max-public 2 `
  --harness-profile A
```

Use an empty run directory for a new session. `private_eval` is a one-shot terminal evaluation. Lite results use Lite cases and standings and do not represent full-benchmark rank.
