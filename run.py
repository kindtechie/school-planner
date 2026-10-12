"""Entry point for source execution and the Windows frozen application."""
import argparse
import os
import sys
import threading
import webbrowser
from pathlib import Path
from planner.storage import Store
from planner.server import Application


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-dir', type=Path)
    parser.add_argument('--port', type=int, default=0)
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args()
    base = args.data_dir or (Path(os.environ.get('LOCALAPPDATA', Path.home()/'.local/share'))/'SchoolPlanner')
    base.mkdir(parents=True, exist_ok=True)
    if getattr(sys, 'frozen', False):
        log = open(base/'application.log', 'a', encoding='utf-8', buffering=1)
        sys.stdout = sys.stderr = log
    # A process lock prevents accidentally opening two writers on different ports.
    lock = open(base/'instance.lock', 'a+b')
    try:
        if sys.platform == 'win32':
            import msvcrt
            lock.seek(0); lock.write(b'0'); lock.flush(); lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        state = base/'session.url'
        if state.exists() and not args.no_browser:
            webbrowser.open(state.read_text())
        return
    app = Application(Store(base/'schools.sqlite3'), args.port)
    state = base/'session.url'
    state.write_text(app.launch_url)
    if sys.platform != 'win32':
        state.chmod(0o600)
    if not args.no_browser:
        threading.Timer(0.3, lambda: webbrowser.open(app.launch_url)).start()
    if sys.stdout:
        print('School Planner is ready at '+app.origin, flush=True)
    try:
        app.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        app.stopping.set()
        app.server_close()
        app.pool.shutdown(wait=True, cancel_futures=True)
        state.unlink(missing_ok=True)
        lock.close()


if __name__ == '__main__':
    main()
