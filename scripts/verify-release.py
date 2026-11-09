"""Verify the committed installer before uploading it unchanged to GitHub."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import zipfile


def verify():
    package = json.loads(Path("package.json").read_text(encoding="utf-8"))
    version = package["version"]
    artifact = Path("dist/zotero-metaflow.xpi").read_bytes()
    checksum = hashlib.sha256(artifact).hexdigest()
    verification = json.loads(Path("dist/verification.json").read_text(encoding="utf-8"))
    assert verification["version"] == version
    assert verification["sha256"] == checksum
    assert verification["sha512"] == hashlib.sha512(artifact).hexdigest()
    assert verification["bytes"] == len(artifact)
    for name in ("update.json", "dist/update.json"):
        update = json.loads(Path(name).read_text(encoding="utf-8"))["addons"]["metaflow@groele"]["updates"][0]
        assert update["version"] == version
        assert update["update_hash"] == "sha512:" + verification["sha512"]
        assert update["update_link"] == f"https://github.com/groele/Zotero-MetaFlow/releases/download/v{version}/zotero-metaflow.xpi"
        assert update["applications"]["zotero"] == {"strict_min_version": "10.0", "strict_max_version": "12.*"}
    with zipfile.ZipFile("dist/zotero-metaflow.xpi") as archive:
        names = archive.namelist()
        assert len(names) == len(set(names))
        for entry in archive.infolist():
            path = PurePosixPath(entry.filename)
            assert "\\" not in entry.filename and not path.is_absolute() and ".." not in path.parts
            assert entry.date_time == (1980, 1, 1, 0, 0, 0)
        assert archive.testzip() is None
        manifest = json.loads(archive.read("manifest.json"))
        assert manifest["version"] == version
        assert manifest["applications"]["zotero"]["id"] == "metaflow@groele"
    for line in Path("dist/SHA256SUMS.txt").read_text(encoding="utf-8").splitlines():
        digest, name = line.split("  ", 1)
        assert digest == hashlib.sha256((Path("dist") / name).read_bytes()).hexdigest()
    print(json.dumps({"version": version, "sha256": checksum, "bytes": len(artifact)}))


if __name__ == "__main__":
    verify()
