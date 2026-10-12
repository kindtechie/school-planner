"""Loopback-only HTTP adapter with session protection and background solving."""
import copy
import json
import mimetypes
import secrets
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from .domain import Invalid, KINDS, new_school
from .storage import Conflict
from .solver import solve
from .reports import pdf

WEB = Path(__file__).resolve().parent.parent/'web'


class Application(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, store, port=0):
        self.store = store
        self.token = secrets.token_urlsafe(32)
        self.jobs = {}
        self.job_lock = threading.Lock()
        self.stopping = threading.Event()
        self.pool = ThreadPoolExecutor(max_workers=1)
        super().__init__(('127.0.0.1', port), Handler)
        self.origin = 'http://127.0.0.1:'+str(self.server_port)

    @property
    def launch_url(self):
        return self.origin+'/?token='+self.token

    def start_solve(self, school_id, seconds, weight):
        snapshot = self.store.get(school_id)
        with self.job_lock:
            if any(j['state'] == 'running' for j in self.jobs.values()):
                raise Conflict('یک برنامه در حال ساخت است؛ تا پایان آن صبر کنید.')
            job_id = str(uuid.uuid4())
            self.jobs = {job_id: dict(state='running', schoolId=school_id)}
        def work():
            try:
                result = solve(snapshot, seconds, weight, self.stopping)
                saved = None
                if 'schedule' in result:
                    snapshot['solution'] = result
                    saved = self.store.save(snapshot, solved=True)
                value = dict(state='done', result=result, school=saved)
            except Conflict as exc:
                value = dict(state='error', message='داده‌ها هنگام حل تغییر کردند؛ نتیجه جایگزین نشد. '+str(exc))
            except Exception as exc:
                value = dict(state='error', message=str(exc))
            with self.job_lock:
                self.jobs[job_id].update(value)
        self.pool.submit(work)
        return dict(jobId=job_id)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # Launch tokens must never be written to request logs.

    def send(self, value, code=200, mime='application/json; charset=utf-8', filename=None):
        data = value if isinstance(value, bytes) else json.dumps(value, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        if filename:
            self.send_header('Content-Disposition', 'attachment; filename="'+filename+'"')
        self.end_headers()
        self.wfile.write(data)

    def authorized(self):
        if self.headers.get('Host') != '127.0.0.1:'+str(self.server.server_port):
            return False
        if self.headers.get('Origin') not in [None, self.server.origin]:
            return False
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get('Cookie', ''))
        except Exception:
            return False
        return 'session' in cookie and secrets.compare_digest(cookie['session'].value, self.server.token)

    def do_GET(self):
        self.handle_request('GET')

    def do_POST(self):
        self.handle_request('POST')

    def handle_request(self, method):
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        route = parsed.path
        if method == 'GET' and route == '/' and query.get('token') == [self.server.token] and self.headers.get('Host') == '127.0.0.1:'+str(self.server.server_port):
            self.send_response(303)
            self.send_header('Set-Cookie', 'session='+self.server.token+'; HttpOnly; SameSite=Strict; Path=/')
            self.send_header('Location', '/')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.end_headers()
            return
        if not self.authorized():
            self.send(dict(error='برنامه را از میان‌بر آن باز کنید.'), 403)
            return
        try:
            body = {}
            if method == 'POST':
                if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                    raise Invalid('درخواست باید JSON باشد.')
                size = int(self.headers.get('Content-Length', '0'))
                if not 0 < size <= 8_000_000:
                    raise Invalid('حجم درخواست نامعتبر است (حداکثر ۸ مگابایت).')
                body = json.loads(self.rfile.read(size))
                if not isinstance(body, dict):
                    raise Invalid('درخواست معتبر نیست.')
            store = self.server.store
            sid = query.get('id', [''])[0]
            if method == 'GET' and route == '/api/state':
                self.send(dict(schools=store.list(), kinds=KINDS, database=str(store.path)))
            elif method == 'GET' and route == '/api/school':
                self.send(store.get(sid))
            elif method == 'GET' and route == '/api/history':
                self.send(store.history(sid))
            elif method == 'GET' and route == '/api/job':
                with self.server.job_lock:
                    result = copy.deepcopy(self.server.jobs.get(sid, dict(state='error', message='عملیات پیدا نشد.')))
                self.send(result)
            elif method == 'GET' and route == '/api/export':
                self.send(store.get(sid), filename='school-'+sid+'.json')
            elif method == 'GET' and route == '/api/pdf':
                self.send(pdf(store.get(sid), query.get('view', ['school'])[0], query.get('target', [''])[0]), mime='application/pdf', filename='timetable.pdf')
            elif method == 'POST' and route == '/api/create':
                self.send(store.save(new_school(body.get('name', 'مدرسهٔ جدید')), create=True))
            elif method == 'POST' and route == '/api/import':
                school = body.get('school', {})
                school['id'] = str(uuid.uuid4()); school['revision'] = 0
                self.send(store.save(school, create=True))
            elif method == 'POST' and route == '/api/save':
                self.send(store.save(body))
            elif method == 'POST' and route == '/api/delete':
                store.delete(body['id'], body['revision']); self.send(dict(ok=True))
            elif method == 'POST' and route == '/api/restore':
                self.send(store.restore(body['id'], body['revision']))
            elif method == 'POST' and route == '/api/solve':
                seconds, weight = body.get('seconds', 30), body.get('preserveWeight', 0)
                if type(seconds) is not int or not 1 <= seconds <= 300 or type(weight) is not int or not 0 <= weight <= 1000:
                    raise Invalid('زمان حل یا وزن حفظ برنامه معتبر نیست.')
                self.send(self.server.start_solve(body['id'], seconds, weight))
            elif method == 'POST' and route == '/api/quit':
                self.server.stopping.set()
                self.send(dict(ok=True))
                threading.Thread(target=self.server.shutdown, daemon=True).start()
            elif method == 'GET' and not route.startswith('/api/'):
                path = (WEB / ('index.html' if route == '/' else route.lstrip('/'))).resolve()
                if WEB.resolve() not in path.parents or not path.is_file():
                    self.send(dict(error='فایل پیدا نشد.'), 404)
                else:
                    self.send(path.read_bytes(), mime=mimetypes.guess_type(str(path))[0] or 'application/octet-stream')
            else:
                self.send(dict(error='مسیر پیدا نشد.'), 404)
        except Conflict as exc:
            self.send(dict(error=str(exc)), 409)
        except (Invalid, ValueError, KeyError, TypeError) as exc:
            self.send(dict(error=str(exc)), 400)
        except Exception:
            import traceback
            traceback.print_exc()
            self.send(dict(error='خطای داخلی؛ اطلاعات ذخیره‌شده حفظ شده‌اند. گزارش اجرا را بررسی کنید.'), 500)
