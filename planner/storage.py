"""Transactional persistence; each save also keeps a bounded recovery history."""
import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from .domain import Invalid, validate
from .audit import audit


class Conflict(Invalid):
    pass


class Store:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.db() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS schools (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, document TEXT NOT NULL, updated TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS history (school_id TEXT NOT NULL, revision INTEGER NOT NULL, document TEXT NOT NULL, updated TEXT NOT NULL, PRIMARY KEY(school_id, revision));
            ''')

    @contextmanager
    def db(self):
        conn = sqlite3.connect(self.path, timeout=10)
        try:
            conn.execute('PRAGMA synchronous=FULL')
            with conn:
                yield conn
        finally:
            conn.close()

    def list(self):
        with self.db() as db:
            return [dict(id=row[0], revision=row[1], name=json.loads(row[2])['name'], updated=row[3]) for row in db.execute('SELECT * FROM schools ORDER BY updated DESC')]

    def get(self, school_id):
        with self.db() as db:
            row = db.execute('SELECT document FROM schools WHERE id=?', (school_id,)).fetchone()
        if not row:
            raise Invalid('مدرسه پیدا نشد.')
        return json.loads(row[0])

    def save(self, raw, *, create=False, solved=False):
        s = validate(raw)
        expected = s.get('revision', 0)
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT revision, document FROM schools WHERE id=?', (s['id'],)).fetchone()
            if create and row:
                raise Conflict('شناسهٔ مدرسه قبلاً وجود دارد.')
            if not create and (not row or row[0] != expected):
                raise Conflict('مدرسه در پنجرهٔ دیگری تغییر کرده است. ابتدا آخرین نسخه را باز کنید.')
            if row and not solved:
                old = json.loads(row[1])
                s['solution'] = old.get('solution')
                if s['solution']:
                    s['solution']['stale'] = True
            if (solved or create) and s.get('solution'):
                if s['solution'].get('stale'):
                    s['solution'] = None
                else:
                    report = audit(s, s['solution'].get('schedule', []))
                    if not report['valid']:
                        raise Invalid('برنامهٔ ذخیره‌شده با داده‌های مدرسه سازگار نیست: '+'؛ '.join(report['errors'][:5]))
                    s['solution']['audit'] = report
            s['revision'] = (row[0] if row else 0)+1
            stamp = datetime.now(timezone.utc).isoformat()
            encoded = json.dumps(s, ensure_ascii=False)
            if row:
                db.execute('INSERT INTO history VALUES (?,?,?,?)', (s['id'], row[0], row[1], stamp))
                db.execute('DELETE FROM history WHERE school_id=? AND revision NOT IN (SELECT revision FROM history WHERE school_id=? ORDER BY revision DESC LIMIT 30)', (s['id'], s['id']))
            db.execute('INSERT OR REPLACE INTO schools VALUES (?,?,?,?)', (s['id'], s['revision'], encoded, stamp))
        return s

    def history(self, school_id):
        with self.db() as db:
            return [dict(revision=r[0], updated=r[1]) for r in db.execute('SELECT revision, updated FROM history WHERE school_id=? ORDER BY revision DESC', (school_id,))]

    def restore(self, school_id, revision):
        current = self.get(school_id)
        with self.db() as db:
            row = db.execute('SELECT document FROM history WHERE school_id=? AND revision=?', (school_id, revision)).fetchone()
        if not row:
            raise Invalid('نسخهٔ موردنظر پیدا نشد.')
        restored = json.loads(row[0]); restored['revision'] = current['revision']
        return self.save(restored, solved=True)

    def delete(self, school_id, revision):
        with self.db() as db:
            cur = db.execute('DELETE FROM schools WHERE id=? AND revision=?', (school_id, revision))
            if cur.rowcount != 1:
                raise Conflict('مدرسه تغییر کرده است؛ فهرست را تازه کنید.')
            db.execute('DELETE FROM history WHERE school_id=?', (school_id,))
