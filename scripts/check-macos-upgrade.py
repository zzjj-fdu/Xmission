"""Exercise the actual packaged Mac app against synthetic historical databases.

Never opens the developer's or a customer's application data.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import time


def fixture(folder, migrations, style):
    folder.mkdir(parents=True, exist_ok=False)
    with sqlite3.connect(folder / "xmission.db") as db:
        db.execute("""CREATE TABLE _sqlx_migrations (
            version BIGINT PRIMARY KEY, description TEXT NOT NULL,
            installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            success BOOLEAN NOT NULL, checksum BLOB NOT NULL, execution_time BIGINT NOT NULL)""")
        for path in sorted(migrations.glob("*.sql")):
            version = int(path.name.split("_")[0])
            if version > 13:
                continue
            sql = path.read_text(encoding="utf-8").replace("\r\n", "\n")
            if style == "crlf" or (style == "mac-oct12" and version in (8, 12)):
                sql = sql.replace("\n", "\r\n")
            db.executescript(sql)
            db.execute("INSERT INTO _sqlx_migrations(version,description,success,checksum,execution_time) VALUES(?,?,1,?,0)",
                       (version, path.stem.split("_", 1)[1].replace("_", " "), hashlib.sha384(sql.encode()).digest()))
        db.execute("INSERT INTO tasks(id,title,notes,form,created_at) VALUES(?,?,?,?,?)",
                   ("upgrade-sentinel", "我的旧任务", "升级前的备注", "side_quest", "2026-10-01"))
        db.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('upgrade-sentinel','旧设置')")
        return db.execute("SELECT version,hex(checksum) FROM _sqlx_migrations ORDER BY version").fetchall()


def launch(app, folder, log, env, seconds=12):
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    env = dict(env, XMISSION_DATA_DIR=str(folder), XMISSION_INSTANCE_PORT=str(port),
               XMISSION_QA_CREDENTIAL_SCOPE="mac-upgrade-regression", RUST_BACKTRACE="1")
    with log.open("wb") as output:
        process = subprocess.Popen([str(app)], env=env, stdout=output, stderr=subprocess.STDOUT)
        try:
            deadline = time.monotonic() + seconds
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise AssertionError(f"{folder.name}: app exited {process.returncode}\n{log.read_text(errors='replace')}")
                time.sleep(0.25)
            with sqlite3.connect(folder / "xmission.db") as db:
                assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
                return db.execute("SELECT version,hex(checksum) FROM _sqlx_migrations ORDER BY version").fetchall()
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--app", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    app = args.app.resolve(strict=True)
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    migrations = Path(__file__).resolve().parents[1] / "src-tauri/migrations"
    expected_count = len(list(migrations.glob("*.sql")))
    results = []
    for style in ("lf", "crlf", "mac-oct12", "fresh"):
        folder = output / style
        before = [] if style == "fresh" else fixture(folder, migrations, style)
        after = launch(app, folder, output / f"{style}.log", os.environ)
        assert len(after) == expected_count, (style, len(after), expected_count)
        if before:
            assert [row for row in after if row[0] <= 13] == before
        with sqlite3.connect(folder / "xmission.db") as db:
            if before:
                assert db.execute("SELECT title,notes FROM tasks WHERE id='upgrade-sentinel'").fetchone() == ("我的旧任务", "升级前的备注")
                assert db.execute("SELECT value FROM settings WHERE key='upgrade-sentinel'").fetchone() == ("旧设置",)
                assert not db.execute("SELECT value FROM settings WHERE key='first_experience_eligible'").fetchall()
            else:
                assert db.execute("SELECT value FROM settings WHERE key='first_experience_eligible'").fetchone() == ("true",)
        reopened = launch(app, folder, output / f"{style}-reopen.log", os.environ, seconds=5)
        assert reopened == after
        results.append(dict(case=style, migrations=len(after), old_checksums_unchanged=True, reopened=True))
        print(f"PASS {style}: packaged app starts, data intact, reopens", flush=True)
    (output / "result.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
