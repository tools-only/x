from __future__ import annotations

import hashlib
import json
import os
import tempfile
import time
from pathlib import Path, PurePosixPath
from typing import Mapping


class StoreError(RuntimeError):
    pass


class IntegrityError(StoreError):
    pass


class InvalidReference(StoreError):
    pass


def _canonical_json(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _safe_relative_path(value: str) -> PurePosixPath:
    path = PurePosixPath(value.replace("\\", "/"))
    if path.is_absolute() or not path.parts or any(part in {"", ".", ".."} for part in path.parts):
        raise ValueError(f"unsafe relative path: {value!r}")
    return path


class ObjectStore:
    def __init__(self, root: Path | str):
        self.root = Path(root).resolve()
        self.objects_dir = self.root / "objects"
        self.refs_dir = self.root / "refs"
        self.staging_dir = self.root / ".staging"
        for directory in (self.objects_dir, self.refs_dir, self.staging_dir):
            directory.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _payload_bytes(payload: Mapping[str, str | bytes] | None) -> dict[str, bytes]:
        result: dict[str, bytes] = {}
        for raw_path, value in (payload or {}).items():
            path = _safe_relative_path(raw_path).as_posix()
            result[path] = value.encode("utf-8") if isinstance(value, str) else bytes(value)
        return result

    @classmethod
    def digest_for(cls, manifest: dict, payload: Mapping[str, str | bytes] | None = None) -> str:
        payload_bytes = cls._payload_bytes(payload)
        hasher = hashlib.sha256()
        manifest_bytes = _canonical_json(manifest)
        hasher.update(b"manifest\0")
        hasher.update(len(manifest_bytes).to_bytes(8, "big"))
        hasher.update(manifest_bytes)
        for path in sorted(payload_bytes):
            content = payload_bytes[path]
            path_bytes = path.encode("utf-8")
            hasher.update(b"payload\0")
            hasher.update(len(path_bytes).to_bytes(8, "big"))
            hasher.update(path_bytes)
            hasher.update(len(content).to_bytes(8, "big"))
            hasher.update(content)
        return f"sha256:{hasher.hexdigest()}"

    def object_path(self, digest: str) -> Path:
        if not digest.startswith("sha256:") or len(digest) != 71:
            raise InvalidReference(f"invalid object digest: {digest!r}")
        hexadecimal = digest.removeprefix("sha256:")
        if any(character not in "0123456789abcdef" for character in hexadecimal):
            raise InvalidReference(f"invalid object digest: {digest!r}")
        return self.objects_dir / hexadecimal

    def _read_payload(self, object_dir: Path) -> dict[str, bytes]:
        payload_dir = object_dir / "payload"
        if not payload_dir.exists():
            return {}
        return {
            path.relative_to(payload_dir).as_posix(): path.read_bytes()
            for path in sorted(payload_dir.rglob("*"))
            if path.is_file()
        }

    def verify(self, digest: str) -> None:
        object_dir = self.object_path(digest)
        manifest_path = object_dir / "manifest.json"
        if not manifest_path.is_file():
            raise IntegrityError(f"object {digest} has no manifest")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        actual = self.digest_for(manifest, self._read_payload(object_dir))
        if actual != digest:
            raise IntegrityError(f"object {digest} content hashes to {actual}")

    def publish(self, manifest: dict, payload: Mapping[str, str | bytes] | None = None) -> str:
        payload_bytes = self._payload_bytes(payload)
        digest = self.digest_for(manifest, payload_bytes)
        destination = self.object_path(digest)
        if destination.exists():
            self.verify(digest)
            return digest

        with tempfile.TemporaryDirectory(prefix="publish-", dir=self.staging_dir) as temporary:
            object_dir = Path(temporary) / "object"
            payload_dir = object_dir / "payload"
            payload_dir.mkdir(parents=True)
            (object_dir / "manifest.json").write_bytes(_canonical_json(manifest))
            for relative, content in payload_bytes.items():
                target = payload_dir.joinpath(*PurePosixPath(relative).parts)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(content)
            for attempt in range(6):
                try:
                    os.replace(object_dir, destination)
                    break
                except OSError as exc:
                    if destination.exists():
                        self.verify(digest)
                        break
                    if not isinstance(exc, PermissionError) or attempt == 5:
                        raise
                    time.sleep(0.01 * (2**attempt))
        self.verify(digest)
        return digest

    def read(self, ref: str) -> dict:
        digest = self.resolve_ref(ref)
        object_dir = self.object_path(digest)
        if not object_dir.exists():
            raise FileNotFoundError(digest)
        self.verify(digest)
        manifest = json.loads((object_dir / "manifest.json").read_text(encoding="utf-8"))
        return {"digest": digest, "manifest": manifest, "payload_dir": object_dir / "payload"}

    def set_ref(self, name: str, digest: str) -> None:
        self.verify(digest)
        safe_name = _safe_relative_path(name)
        destination = self.refs_dir.joinpath(*safe_name.parts)
        destination.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=destination.parent, delete=False) as handle:
            handle.write(digest + "\n")
            temporary = Path(handle.name)
        os.replace(temporary, destination)

    def resolve_ref(self, ref: str) -> str:
        if ref.startswith("sha256:"):
            return ref
        if not ref.startswith("ref:"):
            raise InvalidReference(f"reference must be sha256: or ref:, got {ref!r}")
        safe_name = _safe_relative_path(ref.removeprefix("ref:"))
        path = self.refs_dir.joinpath(*safe_name.parts)
        if not path.is_file():
            raise InvalidReference(f"unknown ref: {ref}")
        return path.read_text(encoding="utf-8").strip()
